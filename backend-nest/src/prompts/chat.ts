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
  mode: 'reply' | 'auto';
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

function renderHistory(history: ChatHistoryItem[], playerPolityName: string): string {
  if (history.length === 0) return '(La trattativa sta iniziando)';
  return history
    .map(m => `${m.role === 'player' ? `${playerPolityName} (giocatore)` : m.role}: ${m.content}`)
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
Il giocatore rappresenta ${vars.playerPolityName}.
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
    ? `\n[Messaggio appena inviato dal giocatore]\n${vars.playerMessage.trim()}\n`
    : '';
  const modeRule = vars.mode === 'reply'
    ? `Rispondi direttamente all’ultimo messaggio di ${vars.playerPolityName}.`
    : 'Il giocatore non interviene: continua in modo naturale il confronto con le altre nazioni.';

  return `Stai simulando una diplomazia a turni. Interpreta esclusivamente ${speaker.name}, in prima persona plurale, come governo o leadership della nazione.

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
${vars.worldContext || '(Storia alternativa)'}

[Regole specifiche del preset]
${vars.simulationRules || '(Nessuna regola aggiuntiva)'}

[Data ed eventi recenti]
Data di gioco: ${vars.date}
${events}

[Mappa e rapporti di forza attuali]
${vars.mapContext}

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
  return { message: raw };
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
