/**
 * World Story — DiplomacyService
 * =============================
 * Relazioni internazionali e canali diplomatici, estratti da `game-session.ts`
 * (Fase 1).
 *
 * Contiene:
 *  - la **matrice delle relazioni** (stato posseduto dal servizio, letta
 *    tramite `matrix()` e reimpostata da JSON in save/load/checkpoint);
 *  - i **canali diplomatici deterministici**: read model delle chat,
 *    creazione/riapertura (`ensureChat`) e apertura causale dopo un evento
 *    (`openSimulationChats`). Nessun LLM qui.
 *
 * La conversazione LLM (repliche, scelta dell'interlocutore, reazioni NPC)
 * resta in `GameSession` per un sotto-passo successivo.
 */

import { RelationshipMatrix, type RelationshipMap } from '../core/RelationshipMatrix';
import type { PolityResolver } from '../utils/name-resolver';
import { shortId } from '../utils/short-id';
import { chatRepository } from '../repositories';
import { simulationThreadKey, reactionThreadKey } from '../core/chat/threads';
import { WorldStateEngine, type NationalAccount } from '../core/simulation/WorldStateEngine';
import { currentStrategicPriorities, strategicProfileForPolity } from '../npc-agents';
import { difficultyPromptBlock, type Difficulty } from '../prompts/difficulty';
import { buildChatPrompt, buildNextSpeakerPrompt, parseChatResponse, parseNextSpeakerResponse } from '../prompts/chat';
import type { LLMRouter } from '../llm/router';
import type { SSEEventType } from '../sse';
import type { ChatRecord, ChatSummary, ChatMessageRecord, ChatParticipant } from '../repositories';
import type { SimulationChatStart } from '../prompts/types';
import type { TimelineEventRecord, TurnResultRecord } from './TimelineService';

/** Fence di contesto (ramo + revisione) per la protezione late-writeback. */
export interface DiplomacyFence {
  branchId: string | null;
  revision: number;
}

/** Regione minima richiesta dalla diplomazia (compatibile con RegionState). */
export interface DiplomacyRegion {
  id: string;
  name: string;
  owner: string;
  color?: string;
  population: number;
  gdp: number;
  militaryPower: number;
  objects?: Array<{ type?: string; level?: number }>;
  status?: string;
  coastal?: boolean;
}

/** Giocatore minimo richiesto dalla diplomazia. */
export interface DiplomacyPlayer {
  id: string;
  polityId?: string;
  color: string;
}

/** Dipendenze fornite da GameSession: stato che NON appartiene a questo dominio. */
export interface DiplomacyContext {
  readonly gameId: string;
  playerPolityId(): string;
  players(): DiplomacyPlayer[];
  regions(): Map<string, DiplomacyRegion>;
  buildResolvers(): { polities: PolityResolver };
  publicPolityName(polityId: string): string;
  polityColor(polityId: string, excludeRegionId?: string): string | undefined;
  publicText(value: unknown): string;
  /** Fase 2 (identificazione attori): resta in GameSession. */
  crisisRelevantPolityIds(texts: string[], seedPolityIds?: string[]): Set<string>;
  hasGeographicAdjacency(): boolean;

  // ── Conversazione LLM: policy di run/fence (autorità in GameSession) ──
  /** Lancia SimulationInProgressError se un run è attivo o sospeso. */
  assertNoActiveRun(): void;
  fenceContext(): DiplomacyFence;
  assertFenceValid(fence: DiplomacyFence): void;

  // ── Stato e servizi della partita usati dalle repliche/reazioni ──
  currentTurn(): number;
  currentDate(): string;
  results(): TurnResultRecord[];
  worldBasePrompt(): string;
  worldSimulationRules(): string | undefined;
  difficulty(): Difficulty;
  llm: LLMRouter;
  broadcast(type: SSEEventType, data: any): boolean;
  worldStateOptions(): { modernFacts: boolean; startDate: string; taxRateByPolity?: Record<string, number> };
  nationalEffectiveMilitaryPower(polityId: string, accounts?: Record<string, NationalAccount>): number;
  hostileNeighbourCount(polityId: string): number;
  recentStrategicMemory(polityId: string, limit?: number): string[];
}

export class DiplomacyService {
  private relationships = new RelationshipMatrix();

  constructor(private readonly ctx: DiplomacyContext) {}

  // ── Relazioni ────────────────────────────────────────────────────────────

  /** Riferimento vivo alla matrice (read model, NPC, checkpoint). */
  matrix(): RelationshipMatrix {
    return this.relationships;
  }

  /** Reimposta la matrice da JSON (save/load/checkpoint/paused run). */
  replaceFromJSON(data: RelationshipMap | undefined): void {
    this.relationships = RelationshipMatrix.fromJSON(data as RelationshipMap);
  }

  toJSON(): RelationshipMap {
    return this.relationships.toJSON();
  }

  /** Read model pubblico: relazioni serializzate per API e dossier. */
  getRelationships(): Record<string, Record<string, string>> {
    return this.relationships.toJSON();
  }

  // ── Canali diplomatici (deterministici) ──────────────────────────────────

  /** Elenco chat del gioco (per l'elenco frontend). */
  getChats(includeArchived = false): ChatSummary[] {
    return chatRepository.getChatsByGame(this.ctx.gameId, includeArchived);
  }

  /** Archivia una discussione (resta consultabile nell'archivio). */
  archiveChat(chatId: string): void {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.ctx.gameId) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    chatRepository.archiveChat(chatId);
  }

  /** Riapre una discussione archiviata. */
  unarchiveChat(chatId: string): void {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.ctx.gameId) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    chatRepository.unarchiveChat(chatId);
  }

  /** Messaggi della chat (404 se la chat è di un'altra partita). */
  getChatMessages(chatId: string): ChatMessageRecord[] {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.ctx.gameId) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    return chatRepository.getMessages(chatId);
  }

  /** Segna i messaggi delle politie della chat come letti. */
  markChatRead(chatId: string): void {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.ctx.gameId) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    chatRepository.markRead(chatId);
  }

  /**
   * Trova o crea la chat con le nazioni indicate PER NOME (come le chiama il
   * giocatore). Con più nomi crea una chat di gruppo: i partecipanti sono
   * risolti via PolityResolver; nome giocatore/neutral/inesistenti → errore.
   *
   * Ogni discussione è una chat distinta: con gli stessi interlocutori le
   * precedenti vanno in archivio. Per non moltiplicare i canali si riapre
   * soltanto una bozza ancora vuota; `dedupeKey` rende idempotenti i
   * ritentativi dello stesso evento o turno.
   */
  ensureChat(polityNames: string[], options: {
    dedupeKey?: string;
    subject?: string;
    origin?: 'player' | 'simulation';
  } = {}): ChatRecord {
    const resolvers = this.ctx.buildResolvers();
    const interlocutors: ChatParticipant[] = [];
    const playerPolityId = this.ctx.playerPolityId();

    for (const rawName of polityNames) {
      const name = (rawName || '').trim();
      if (!name) continue;
      const resolution = resolvers.polities.resolve(name);
      if (!resolution || resolution.isNew
          || resolution.polityId === 'neutral'
          || resolution.polityId === playerPolityId) {
        throw new Error(`Polity not found: ${name}`);
      }
      if (interlocutors.some(p => p.id === resolution.polityId)) continue;

      const polityRegions = Array.from(this.ctx.regions().values()).filter(r => r.owner === resolution.polityId);
      const displayName = this.ctx.publicPolityName(resolution.polityId);
      const color = this.ctx.polityColor(resolution.polityId) || polityRegions[0]?.color || '#888888';
      interlocutors.push({ id: resolution.polityId, name: displayName, color, role: 'polity' });
    }

    if (interlocutors.length === 0) {
      throw new Error('Polity not found: nessun interlocutore valido');
    }

    const player = this.ctx.players()[0];
    const participants: ChatParticipant[] = [
      {
        id: playerPolityId,
        name: this.ctx.publicPolityName(playerPolityId),
        color: player?.color || '#667eea',
        role: 'player',
      },
      ...interlocutors,
    ];
    const participantIds = participants.map(p => p.id);

    // Ritentativo dello stesso evento/turno: restituisci la chat già creata.
    if (options.dedupeKey) {
      const existing = chatRepository.getChatByDedupeKey(this.ctx.gameId, options.dedupeKey);
      if (existing) return existing;
    }

    // Bozza ancora vuota: riaprila invece di crearne una nuova. La simulazione
    // crea sempre una discussione propria e non scrive nella bozza del giocatore.
    if (options.origin !== 'simulation') {
      const draft = chatRepository.getEmptyChatByParticipants(this.ctx.gameId, participantIds);
      if (draft) return draft;
    }

    // Nuova discussione: le precedenti con gli stessi interlocutori vanno in archivio.
    chatRepository.archiveChatsForParticipants(this.ctx.gameId, participantIds);

    const primary = interlocutors[0];
    const displayName = interlocutors.length > 1
      ? interlocutors.map(p => p.name).join(' + ')
      : primary.name;

    return chatRepository.createChat({
      id: shortId(),
      gameId: this.ctx.gameId,
      polityId: primary.id,
      polityName: displayName,
      polityColor: primary.color,
      participants,
      subject: options.subject,
      dedupeKey: options.dedupeKey,
    });
  }

  /**
   * Apre i canali diplomatici richiesti dagli eventi applicati: ogni canale ha
   * già il messaggio d'apertura della controparte e non richiede LLM.
   */
  openSimulationChats(
    starts: SimulationChatStart[] | undefined,
    options: {
      turn: number;
      fallbackDate: string;
      simulationId?: string;
      events?: Array<{ headline: string; date: string }>;
      requireEventLink?: boolean;
    },
  ): {
    timelineEvents: TimelineEventRecord[];
    broadcasts: Array<Record<string, unknown>>;
    participantPolityIds: Set<string>;
  } {
    const timelineEvents: TimelineEventRecord[] = [];
    const broadcasts: Array<Record<string, unknown>> = [];
    const participantPolityIds = new Set<string>();
    const eventByHeadline = new Map(
      (options.events || []).map(event => [event.headline.trim().toLocaleLowerCase('it'), event] as const),
    );
    const opened = new Set<string>();
    const resolver = this.ctx.buildResolvers().polities;

    for (const start of starts || []) {
      const eventHeadline = (start.eventHeadline || '').trim();
      const linkedEvent = eventHeadline
        ? eventByHeadline.get(eventHeadline.toLocaleLowerCase('it'))
        : undefined;
      if (options.requireEventLink && !linkedEvent) {
        console.warn('[GameSession] startChat ignorata: evento causale non applicato:', eventHeadline || '(mancante)');
        continue;
      }

      const requestedNames = [...(Array.isArray(start.participants) ? start.participants : [])];
      if (start.polityName && !requestedNames.some(name =>
        name.toLocaleLowerCase('it') === start.polityName!.toLocaleLowerCase('it'))) {
        requestedNames.unshift(start.polityName);
      }
      const validPolityIds: string[] = [];
      for (const rawName of requestedNames) {
        const resolution = resolver.resolve(String(rawName || '').trim());
        if (!resolution || resolution.isNew || resolution.polityId === 'neutral'
            || resolution.polityId === this.ctx.playerPolityId()
            || validPolityIds.includes(resolution.polityId)) continue;
        validPolityIds.push(resolution.polityId);
        if (validPolityIds.length >= 8) break;
      }
      if (validPolityIds.length === 0) {
        console.warn('[GameSession] startChat ignorata: nessuna politia partecipante valida');
        continue;
      }
      // Crisi locali: una potenza lontana senza interesse documentato non
      // entra in una riunione né in una nota di comodo. Il filtro agisce solo
      // quando il mondo offre dati di adiacenza reali, così non svuota i mondi
      // senza confini registrati (fixture e test).
      if (this.ctx.hasGeographicAdjacency()) {
        const relevant = this.ctx.crisisRelevantPolityIds([linkedEvent?.headline || '']);
        const kept = validPolityIds.filter(id => relevant.has(id));
        if (kept.length === 0) {
          console.warn('[GameSession] startChat ignorata: partecipanti fuori dal teatro della crisi:', requestedNames.join(', '));
          continue;
        }
        if (kept.length < validPolityIds.length) {
          validPolityIds.length = 0;
          validPolityIds.push(...kept);
        }
      }

      const duplicateKey = [
        [...validPolityIds].sort().join('|'),
        eventHeadline.toLocaleLowerCase('it'),
      ].join('::');
      if (opened.has(duplicateKey)) continue;
      opened.add(duplicateKey);

      try {
        const chat = this.ensureChat(validPolityIds, {
          dedupeKey: simulationThreadKey({
            simulationId: options.simulationId,
            turn: options.turn,
            eventHeadline,
            participantIds: validPolityIds,
          }),
          subject: this.ctx.publicText(start.topic).slice(0, 90),
          origin: 'simulation',
        });
        const initiatorId = validPolityIds[0];
        const sender = chat.participants.find(p => p.id === initiatorId && p.role === 'polity')
          || chat.participants.find(p => p.role === 'polity');
        if (!sender) continue;
        const gameDate = linkedEvent?.date || options.fallbackDate;
        const topic = this.ctx.publicText(start.topic) || 'Desideriamo discutere gli ultimi sviluppi.';
        const firstMessage = chatRepository.addMessage(
          chat.id, 'polity', topic, options.turn, sender.name, gameDate,
        );
        const group = validPolityIds.length > 1;
        const openingByKind: Record<string, string> = {
          meeting: group ? 'convoca una riunione multilaterale' : 'chiede una riunione',
          summit: 'propone un vertice',
          negotiation: 'avvia un negoziato',
          conference: 'convoca una conferenza',
          ultimatum: 'apre un confronto su un ultimatum',
          technical: 'propone un tavolo tecnico',
          statement: 'invia una nota diplomatica',
        };
        const kind = start.kind || (group ? 'meeting' : 'negotiation');
        // Il canale contiene sempre anche il giocatore (serve a leggere e
        // rispondere), ma il dispaccio non deve far apparire la sua nazione
        // in un incontro fra terzi: elenchiamo solo i partecipanti NPC
        // realmente convocati.
        const npcParticipantNames = validPolityIds
          .map(id => this.ctx.publicPolityName(id))
          .filter((name): name is string => !!name && name !== this.ctx.publicPolityName(this.ctx.playerPolityId()));
        const participantsText = group && npcParticipantNames.length > 0
          ? `Alla riunione prendono parte ${npcParticipantNames.join(', ')}. `
          : '';
        timelineEvents.push({
          id: `chat-${firstMessage.id}`,
          date: gameDate,
          headline: `${sender.name} ${openingByKind[kind] || openingByKind.negotiation}`,
          detail: `${eventHeadline ? `In seguito a «${this.ctx.publicText(eventHeadline)}». ` : ''}${participantsText}${sender.name} dichiara: ${firstMessage.content}`,
          source: 'diplomacy',
          simulationId: options.simulationId,
          chatId: chat.id,
          speakerName: sender.name,
        });
        broadcasts.push({
          chatId: chat.id,
          polityId: chat.polityId,
          polityName: chat.polityName,
          participants: chat.participants,
          senderName: sender.name,
          meetingKind: kind,
          eventHeadline: eventHeadline || undefined,
          message: firstMessage,
        });
        validPolityIds.forEach(id => participantPolityIds.add(id));
      } catch (error) {
        console.warn('[GameSession] startChat: impossibile aprire il canale diplomatico:', requestedNames, error);
      }
    }

    return { timelineEvents, broadcasts, participantPolityIds };
  }

  // ── Conversazione LLM (repliche, «lascia che parlino», reazioni NPC) ──────

  /**
   * Invia un messaggio del giocatore: salva il messaggio, chiede all'LLM
   * (meccanica 'chat') CHI risponde e COSA, salva la replica e la broadcasta.
   */
  async sendChatMessage(chatId: string, content: string): Promise<{ message: ChatMessageRecord; reply: ChatMessageRecord }> {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.ctx.gameId) {
      throw new Error(`Chat not found: ${chatId}`);
    }
    // F04 passo 3: durante un run la chat risponde 409 — nessuna scrittura
    // nel contesto già congelato (politica esplicita, non bozza silenziosa).
    this.ctx.assertNoActiveRun();
    const fence = this.ctx.fenceContext();

    // Cronaca PRIMA del nuovo messaggio del giocatore
    const history = chatRepository.getMessages(chatId)
      .map(m => ({ role: m.role === 'player' ? 'player' : (m.senderName || chat.polityName), content: m.content }));

    const player = this.ctx.players()[0];
    const message = chatRepository.addMessage(
      chatId,
      'player',
      content.trim(),
      this.ctx.currentTurn(),
      this.ctx.publicPolityName(this.ctx.playerPolityId()),
      this.ctx.currentDate(),
    );

    const reply = await this.generateChatReply(chat, history, content, 'reply', fence);
    return { message, reply };
  }

  /**
   * «Lascia che parlino»: le nazioni della chat proseguono la trattativa tra
   * loro per un numero limitato di repliche, senza intervento del giocatore.
   */
  async continueChat(chatId: string, exchanges: number = 2): Promise<{ replies: ChatMessageRecord[] }> {
    const chat = chatRepository.getChatById(chatId);
    if (!chat || chat.gameId !== this.ctx.gameId) {
      throw new Error(`Chat not found: ${chatId}`);
    }

    const replies: ChatMessageRecord[] = [];
    const rounds = Math.max(1, Math.min(exchanges, 4));
    const fence = this.ctx.fenceContext();
    for (let i = 0; i < rounds; i++) {
      const history = chatRepository.getMessages(chatId)
        .map(m => ({ role: m.role === 'player' ? 'player' : (m.senderName || chat.polityName), content: m.content }));
      const reply = await this.generateChatReply(chat, history, '', 'auto', fence);
      replies.push(reply);
    }
    return { replies };
  }

  /**
   * Chiama l'LLM per la prossima battuta della chat (reply o auto), la salva
   * e la broadcasta via SSE.
   */
  private async generateChatReply(
    chat: ChatRecord,
    history: { role: string; content: string }[],
    playerMessage: string,
    mode: 'reply' | 'auto' | 'reaction',
    fence?: DiplomacyFence,
  ): Promise<ChatMessageRecord> {
    const polityParticipants = chat.participants.filter(
      p => p.role !== 'player' && p.id !== this.ctx.playerPolityId()
    );
    if (polityParticipants.length === 0) {
      polityParticipants.push({
        id: chat.polityId,
        name: chat.polityName,
        color: chat.polityColor,
        role: 'polity',
      });
    }

    const participantsVars = this.chatParticipantVarsFor(chat);

    let speakerName = participantsVars[0].name;
    if (participantsVars.length > 1) {
      const nextSpeakerPrompt = buildNextSpeakerPrompt({
        playerPolityName: this.ctx.publicPolityName(this.ctx.playerPolityId()),
        participantNames: participantsVars.map(p => p.name),
        history,
        playerMessage,
        mode: mode === 'reaction' ? 'auto' : mode,
      });
      try {
        const selection = await this.ctx.llm.generate(
          'chat',
          'Seleziona il prossimo interlocutore diplomatico. Rispondi soltanto con JSON {"speaker"}.',
          nextSpeakerPrompt,
          { temperature: 0.15, maxTokens: 120 },
        );
        speakerName = parseNextSpeakerResponse(
          selection.content,
          participantsVars.map(p => p.name),
          speakerName,
        );
      } catch (error) {
        // La selezione è ausiliaria: se un modello free la salta, il primo
        // partecipante valido può comunque rispondere senza perdere la chat.
        console.warn('[GameSession] Selezione interlocutore non disponibile; uso il fallback canonico:', error);
      }
    }
    const respondingParticipant = participantsVars.find(p => p.name === speakerName) || participantsVars[0];
    const recentEvents = this.ctx.results()
      .slice(-3)
      .flatMap(result => result.timelineEvents?.map(event => event.headline) || result.events)
      .slice(-8);
    const prompt = buildChatPrompt({
      playerPolityName: this.ctx.publicPolityName(this.ctx.playerPolityId()),
      participants: participantsVars,
      respondingParticipant,
      worldContext: this.ctx.worldBasePrompt() || 'Storia alternativa',
      simulationRules: this.ctx.worldSimulationRules() || '',
      mapContext: this.buildChatMapContext(),
      difficultyContext: difficultyPromptBlock(this.ctx.difficulty()),
      date: this.ctx.currentDate(),
      recentEvents,
      history,
      playerMessage,
      mode,
    });

    const response = await this.ctx.llm.generate(
      'chat',
      `Interpreta ${speakerName} in una trattativa storica. Rispondi in italiano e SOLO con JSON {"message"}.`,
      prompt,
      { temperature: 0.7 },
    );
    const parsed = parseChatResponse(response.content);
    // F04 passo 3: verifica del fence PRIMA della scrittura — una risposta
    // tardiva (run partito, restore con ramo nuovo, revisione cambiata) non
    // muta il ramo nuovo né broadcasta nulla.
    if (fence) this.ctx.assertFenceValid(fence);
    const reply = chatRepository.addMessage(
      chat.id,
      'polity',
      parsed.message,
      this.ctx.currentTurn(),
      speakerName,
      this.ctx.currentDate(),
    );

    this.ctx.broadcast('chat_message', {
      chatId: chat.id,
      polityId: chat.polityId,
      polityName: chat.polityName,
      participants: chat.participants,
      senderName: speakerName,
      message: reply,
    });

    return reply;
  }

  /**
   * Variabili prompt dei partecipanti NPC di una chat: stato materiale
   * (regioni, popolazione, PIL, forza) + personalità. Condivisa da repliche
   * normali e reazioni automatiche agli ordini.
   */
  private chatParticipantVarsFor(chat: ChatRecord) {
    const polityParticipants = chat.participants.filter(
      p => p.role !== 'player' && p.id !== this.ctx.playerPolityId()
    );
    if (polityParticipants.length === 0) {
      polityParticipants.push({
        id: chat.polityId,
        name: chat.polityName,
        color: chat.polityColor,
        role: 'polity',
      });
    }
    return polityParticipants.map(p => {
      const owned = Array.from(this.ctx.regions().values()).filter(r => r.owner === p.id);
      const population = owned.reduce((sum, r) => sum + (r.population || 0), 0);
      const gdp = owned.reduce((sum, r) => sum + (r.gdp || 0), 0);
      const military = owned.reduce((sum, r) => sum + (r.militaryPower || 0), 0);
      const ownedAccounts = WorldStateEngine.accounts(owned, this.ctx.worldStateOptions());
      const effectiveMilitary = this.ctx.nationalEffectiveMilitaryPower(p.id, ownedAccounts);
      const relationship = this.matrix().get(p.id, this.ctx.playerPolityId());
      const profile = strategicProfileForPolity(p.id);
      const hostileNeighbours = this.ctx.hostileNeighbourCount(p.id);
      const allRelations = [...new Set(Array.from(this.ctx.regions().values()).map(region => region.owner))]
        .filter(owner => owner && owner !== 'neutral' && owner !== p.id)
        .map(owner => this.matrix().get(p.id, owner));
      const priorities = currentStrategicPriorities(profile, {
        relationshipToPlayer: relationship,
        hostileNeighbours,
        hostileActors: allRelations.filter(value => value === 'hostile').length,
        alliedActors: allRelations.filter(value => value === 'ally').length,
        militaryPower: effectiveMilitary,
        playerMilitaryPower: this.ctx.nationalEffectiveMilitaryPower(this.ctx.playerPolityId(), ownedAccounts),
        monthlyBalance: ownedAccounts[p.id]?.monthlyBalance,
        stability: ownedAccounts[p.id]?.stability,
      });
      const memory = this.ctx.recentStrategicMemory(p.id, 2);
      return {
        name: p.name,
        relationship,
        personality: `${profile.personality}; dottrina ${profile.doctrine}; stile ${profile.negotiationStyle}`,
        interests: `priorità: ${priorities.join('; ')}; linee rosse: ${profile.redLines.join('; ')}; memoria recente: ${memory.length ? memory.join(' | ') : 'nessun precedente specifico registrato'}; [valutazione interna riservata: usa questi dati per decidere, non citarli mai nei messaggi] propensione alla forza ${Math.round(profile.aggression * 100)}%; rischio ${profile.riskTolerance}/100; affidabilità verso gli impegni ${profile.allianceReliability}/100; capacità: ${owned.length} regioni, popolazione ${population}, PIL ${gdp}, potenza militare effettiva ${effectiveMilitary} (nominale ${military})`,
      };
    });
  }

  /** Risposta minima e prudente quando il modello free non produce una nota.
   * Non concede, rifiuta o inventa contromisure: rende visibile che la
   * controparte ha ricevuto l'iniziativa e conserva la propria priorità. */
  private persistNpcReactionFallback(
    polityId: string,
    input: { turn?: number; date?: string },
  ): void {
    try {
      const owned = Array.from(this.ctx.regions().values()).filter(region => region.owner === polityId);
      if (!owned.length) return;
      const displayName = this.ctx.publicPolityName(polityId);
      const profile = strategicProfileForPolity(polityId);
      const priority = currentStrategicPriorities(profile, {
        relationshipToPlayer: this.matrix().get(polityId, this.ctx.playerPolityId()),
        hostileNeighbours: this.ctx.hostileNeighbourCount(polityId),
        militaryPower: this.ctx.nationalEffectiveMilitaryPower(polityId),
        playerMilitaryPower: this.ctx.nationalEffectiveMilitaryPower(this.ctx.playerPolityId()),
      })[0] || profile.baselinePriorities[0];
      const chat = this.ensureChat([displayName], {
        dedupeKey: reactionThreadKey(polityId, input.turn ?? this.ctx.currentTurn()),
        origin: 'simulation',
      });
      const sender = chat.participants.find(participant => participant.role === 'polity')?.name || chat.polityName;
      const content = `${sender} prende formalmente atto degli sviluppi comunicati. Non considera concluso alcun accordo e non assume nuovi impegni senza una decisione verificabile; valuterà i prossimi passi secondo la priorità «${priority}».`;
      const reply = chatRepository.addMessage(
        chat.id, 'polity', content, input.turn ?? this.ctx.currentTurn(), sender, input.date || this.ctx.currentDate(),
      );
      this.ctx.broadcast('chat_message', {
        chatId: chat.id,
        polityId: chat.polityId,
        polityName: chat.polityName,
        participants: chat.participants,
        senderName: sender,
        message: reply,
        reaction: true,
        degraded: true,
      });
    } catch (error) {
      console.warn('[GameSession] Anche il fallback di reazione NPC è fallito:', polityId, error);
    }
  }

  /**
   * Reazioni diplomatiche automatiche agli ordini del giocatore.
   *
   * Dopo un turno con ordini, le politie NPC direttamente interessate
   * (cambi di relazione, trasferimenti territoriali, oppure un vicino
   * ostile come fallback) prendono posizione con un messaggio ufficiale
   * nella chat diplomatica: la nota è persistita e broadcastata via SSE
   * (badge «Diplomazia» + cronaca), così l'ordine produce non solo notizie
   * ma anche reazioni visibili.
   *
   * Fire-and-forget: il turno è già committato; un errore LLM non lo tocca.
   * Limite fallback: massimo 4 reazioni per turno (solo controparti riconosciute).
   */
  async generateNpcReactions(input: {
    actionTexts: string[];
    eventHeadlines: string[];
    candidatePolityIds: string[];
    turn?: number;
    date?: string;
  }): Promise<void> {
    if (input.actionTexts.length === 0 && input.eventHeadlines.length === 0) return;
    const candidates = input.candidatePolityIds
      .filter(id => id && id !== this.ctx.playerPolityId() && id !== 'neutral')
      .filter((id, index, all) => all.indexOf(id) === index)
      .filter(id => Array.from(this.ctx.regions().values()).some(r => r.owner === id))
      .slice(0, 4);
    if (candidates.length === 0) return;

    const playerPolityName = this.ctx.publicPolityName(this.ctx.playerPolityId());
    const reactionBrief = [
      input.actionTexts.length > 0
        ? `Ordini resi pubblici da ${playerPolityName} in questo turno: ${input.actionTexts.join(' | ')}`
        : '',
      input.eventHeadlines.length > 0
        ? `Eventi del periodo: ${input.eventHeadlines.slice(0, 8).join('; ')}`
        : '',
    ].filter(Boolean).join('\n');

    for (const polityId of candidates) {
      try {
        const owned = Array.from(this.ctx.regions().values()).filter(r => r.owner === polityId);
        if (owned.length === 0) continue;
        // Stessa convenzione di ensureChat: nome nazionale dal registro ISO
        // per i mondi provinciali, nome della regione per le politie singole.
        const displayName = this.ctx.publicPolityName(polityId);
        const reactionSubject = (input.eventHeadlines[0] || input.actionTexts[0] || '').trim().slice(0, 90);
        const chat = this.ensureChat([displayName], {
          dedupeKey: reactionThreadKey(polityId, input.turn ?? this.ctx.currentTurn()),
          subject: reactionSubject || undefined,
          origin: 'simulation',
        });
        const sender = chat.participants.find(p => p.role === 'polity')?.name || chat.polityName;
        const history = chatRepository.getMessages(chat.id)
          .map(m => ({ role: m.role === 'player' ? 'player' : (m.senderName || chat.polityName), content: m.content }));
        const participantsVars = this.chatParticipantVarsFor(chat);
        const responding = participantsVars.find(p => p.name === sender) || participantsVars[0];
        if (!responding) continue;

        const prompt = buildChatPrompt({
          playerPolityName,
          participants: participantsVars,
          respondingParticipant: responding,
          worldContext: this.ctx.worldBasePrompt() || 'Storia alternativa',
          simulationRules: this.ctx.worldSimulationRules() || '',
          mapContext: this.buildChatMapContext(),
          difficultyContext: difficultyPromptBlock(this.ctx.difficulty()),
          date: input.date || this.ctx.currentDate(),
          recentEvents: input.eventHeadlines.slice(0, 8),
          history,
          playerMessage: reactionBrief,
          mode: 'reaction',
        });
        const response = await this.ctx.llm.generate(
          'chat',
          `Interpreta ${sender} in una trattativa storica. Rispondi in italiano e SOLO con JSON {"message"}.`,
          prompt,
          { temperature: 0.7 },
        );
        const parsed = parseChatResponse(response.content);
        const reply = chatRepository.addMessage(
          chat.id,
          'polity',
          parsed.message,
          input.turn ?? this.ctx.currentTurn(),
          sender,
          input.date || this.ctx.currentDate(),
        );
        this.ctx.broadcast('chat_message', {
          chatId: chat.id,
          polityId: chat.polityId,
          polityName: chat.polityName,
          participants: chat.participants,
          senderName: sender,
          message: reply,
          reaction: true,
        });
        console.log('[GameSession] NPC reaction generated by', sender);
      } catch (e) {
        console.warn('[GameSession] NPC reaction failed for', polityId, e);
        this.persistNpcReactionFallback(polityId, input);
      }
    }
  }

  /** Descrizione compatta della mappa per il prompt: «Politia: regione1, regione2». */
  private buildChatMapContext(): string {
    const byOwner = new Map<string, DiplomacyRegion[]>();
    for (const region of this.ctx.regions().values()) {
      if (region.owner === 'neutral') continue;
      if (!byOwner.has(region.owner)) byOwner.set(region.owner, []);
      byOwner.get(region.owner)!.push(region);
    }
    const lines: string[] = [];
    for (const regions of byOwner.values()) {
      lines.push(`${regions[0].name}: ${regions.map(r => r.name).join(', ')}`);
    }
    return lines.join('\n');
  }

  /** Trascritti delle chat recenti per il prompt di simulazione (le trattative contano). */
  buildChatTranscripts(): string {
    const chats = chatRepository.getChatsByGame(this.ctx.gameId, true).slice(0, 3);
    const parts: string[] = [];

    for (const chat of chats) {
      const messages = chatRepository.getMessages(chat.id).slice(-15);
      if (messages.length === 0) continue;
      const lines = messages.map(m =>
        m.role === 'player' ? `${this.ctx.publicPolityName(this.ctx.playerPolityId())}: ${m.content}` : `${m.senderName || chat.polityName}: ${m.content}`
      );
      parts.push(`[Trattative con ${chat.polityName}]\n${lines.join('\n')}`);
    }

    return parts.join('\n\n');
  }
}
