/**
 * World Story — Diplomazia stile Pax Historia
 * =========================================
 * Nei gruppi la scelta del prossimo interlocutore è separata dalla generazione
 * della replica: `buildNextSpeakerPrompt` sceglie la nazione, `buildChatPrompt`
 * la interpreta. La replica visibile ha il contratto strutturato {message}.
 */

export interface ChatParticipantVars {
  name: string;
  relationship: string;
  personality: string;
  interests: string;
}

export interface ChatHistoryItem {
  role: string;
  content: string;
}

export interface ChatPromptVars {
  playerPolityName: string;
  participants: ChatParticipantVars[];
  respondingParticipant: ChatParticipantVars;
  worldContext: string;
  simulationRules: string;
  mapContext: string;
  difficultyContext: string;
  date: string;
  recentEvents: string[];
  history: ChatHistoryItem[];
  playerMessage: string;
  mode: 'reply' | 'auto' | 'reaction';
}

export interface NextSpeakerPromptVars {
  playerPolityName: string;
  participantNames: string[];
  history: ChatHistoryItem[];
  playerMessage: string;
  mode: 'reply' | 'auto';
}

const RELATIONSHIP_TEXT: Record<string, string> = {
  ally: 'alleata: esiste fiducia, senza rinunciare agli interessi nazionali',
  hostile: 'ostile: prevalgono sospetto, deterrenza e richieste concrete',
  neutral: 'neutrale: apertura prudente, senza concessioni gratuite',
};

function compact(value: unknown, maxChars: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function renderHistory(history: ChatHistoryItem[], playerPolityName: string): string {
  if (history.length === 0) return '(La trattativa sta iniziando)';
  return history.slice(-16)
    .map(m => `${m.role === 'player' ? `${playerPolityName} (voce ufficiale)` : m.role}: ${compact(m.content, 700)}`)
    .join('\n');
}

/** Prompt «Next Speaker»: decide chi ha davvero motivo di parlare ora. */
export function buildNextSpeakerPrompt(vars: NextSpeakerPromptVars): string {
  const latest = vars.playerMessage.trim()
    ? `\nUltimo messaggio del giocatore:\n${vars.playerMessage.trim()}\n`
    : '';
  const modeRule = vars.mode === 'reply'
    ? 'Il giocatore ha appena parlato: preferisci la nazione direttamente interpellata o più coinvolta.'
    : 'Il giocatore resta in ascolto: scegli una nazione con una replica utile; evita l’ultima che ha parlato se un altro partecipante può portare avanti la trattativa.';

  return `Sei il moderatore invisibile di una chat diplomatica in un gioco storico.
Il giocatore parla e agisce come ${vars.playerPolityName}: i suoi messaggi sono dichiarazioni ufficiali del governo di ${vars.playerPolityName}, e le altre nazioni devono riconoscerlo come tale.
Le sole nazioni autorizzate a rispondere sono: ${vars.participantNames.join(', ')}.

Cronaca della chat:
${renderHistory(vars.history, vars.playerPolityName)}
${latest}
${modeRule}
Non inventare partecipanti e non scrivere la replica diplomatica.
Rispondi SOLO con JSON valido: {"speaker":"<nome esatto dalla lista>"}`;
}

/** Prompt della replica, modellato sul preset originale Chat with User. */
export function buildChatPrompt(vars: ChatPromptVars): string {
  const speaker = vars.respondingParticipant;
  const events = vars.recentEvents.length > 0
    ? vars.recentEvents.map(e => `- ${e}`).join('\n')
    : '(Nessun evento recente rilevante)';
  const latest = vars.playerMessage.trim()
    ? `\n[${vars.mode === 'reaction' ? 'Ordini ed eventi appena conclusisi' : `Dichiarazione ufficiale appena inviata da ${vars.playerPolityName}`}]\n${vars.playerMessage.trim()}\n`
    : '';
  const modeRule = vars.mode === 'reply'
    ? `Rispondi direttamente all’ultimo messaggio di ${vars.playerPolityName}.`
    : vars.mode === 'reaction'
      ? `${vars.playerPolityName} non ha scritto in chat: ${speaker.name} prende formalmente posizione — nota ufficiale, protesta, apprezzamento, richiesta o avvertimento — reagendo agli ordini e agli eventi descritti qui sopra.`
      : 'Il giocatore non interviene: continua in modo naturale il confronto con le altre nazioni.';

  return `Stai simulando una diplomazia a turni. Interpreta esclusivamente ${speaker.name}, in prima persona plurale, come governo o leadership della nazione.

[Identità dell'interlocutore umano]
- Chi scrive come «${vars.playerPolityName} (voce ufficiale)» è il governo di ${vars.playerPolityName} in persona: i suoi messaggi sono dichiarazioni ufficiali di quella nazione, non commenti di uno spettatore.
- Rivolgiti sempre a ${vars.playerPolityName} come soggetto politico reale — per nome, al governo, al capo di Stato o ai ministri — e rispondi come faresti con un omologo. MAI le parole «giocatore», «utente» o «umano», mai toni da assistente o da narratore: parli nazione con nazione.
- Tratta le dichiarazioni di ${vars.playerPolityName} come atti impegnativi del suo governo (proposte, ultimatum, garanzie), da valutare sul merito con gli strumenti reali di ${speaker.name}.

[Identità e interessi]
- Nazione che parla: ${speaker.name}
- Personalità politica: ${speaker.personality}
- Interessi attuali: ${speaker.interests}
- Relazione con ${vars.playerPolityName}: ${RELATIONSHIP_TEXT[speaker.relationship] || RELATIONSHIP_TEXT.neutral}
- Altri interlocutori presenti: ${vars.participants.map(p => p.name).join(', ')}

[Difficoltà della diplomazia]
${vars.difficultyContext}
La difficoltà stabilisce quanta influenza, preparazione o contropartita serve perché ${speaker.name} accetti una proposta. Non concedere risultati che contraddicono questo livello.

[Lore prima del primo turno]
${compact(vars.worldContext, 3_000) || '(Storia alternativa)'}

[Regole specifiche del preset]
${compact(vars.simulationRules, 2_000) || '(Nessuna regola aggiuntiva)'}

[Data ed eventi recenti]
Data di gioco: ${vars.date}
${events}

[Mappa e rapporti di forza attuali]
${compact(vars.mapContext, 5_000)}

[Cronaca della trattativa]
${renderHistory(vars.history, vars.playerPolityName)}
${latest}
[Compito]
${modeRule}
- Porta la conversazione verso una posizione, una condizione, un accordo o un rifiuto chiaro: non trascinarla senza scopo.
- Valuta seriamente offerte e richieste, ma difendi gli interessi e il carattere di ${speaker.name}.
- Richiama solo fatti compatibili con lore, data, eventi e mappa; considera forza militare, territori e relazioni.
- Adatta il tono a quello del giocatore, restando professionale. Niente teatralità, gergo moderno eccessivo o spiegazioni da narratore.
- Non dire mai di essere un’IA e non parlare della meccanica del gioco.
- Scrivi in italiano, in modo concreto, normalmente 2–5 frasi e massimo 1200 caratteri.

Rispondi SOLO con un oggetto JSON valido, senza markdown o testo attorno:
{"message":"<replica diplomatica di ${speaker.name}>"}`;
}

export interface ParsedChatResponse {
  message: string;
}

/** Parsing tollerante della replica {message}, con fallback al testo puro. */
export function parseChatResponse(text: string): ParsedChatResponse {
  const raw = (text || '').trim();
  if (!raw) return { message: '…' };

  const candidates = [raw];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(raw.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      const message = typeof obj?.message === 'string' ? obj.message.trim() : '';
      if (message) return { message };
    } catch { /* prova il prossimo candidato */ }
  }
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return { message: withoutFence.substring(0, 1_200) || '…' };
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Accetta soltanto un nome presente nella whitelist dei partecipanti. */
export function parseNextSpeakerResponse(text: string, allowed: string[], fallback: string): string {
  const raw = (text || '').trim();
  let proposed = raw;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      if (typeof obj?.speaker === 'string') proposed = obj.speaker;
    } catch { /* fallback sotto */ }
  }

  const wanted = normalizedName(proposed);
  return allowed.find(name => normalizedName(name) === wanted) || fallback;
}
