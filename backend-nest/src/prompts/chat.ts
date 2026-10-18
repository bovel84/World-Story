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
  subject?: string | null;
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

/** The reply needs the cause and consequence, not eight unrelated headlines.
 * Read only committed, dated events and keep the whole excerpt bounded. */
export function diplomaticEventContext(input: {
  date: string; names: readonly string[];
  results: readonly { date?: string; events: string[]; timelineEvents?: { date: string; headline: string; detail?: string }[] }[];
}): string[] {
  const normalize = (value: string) => ` ${value.toLocaleLowerCase('it').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const names = input.names.filter(n => n.trim()).map(normalize);
  const now = Date.parse(input.date);
  if (!Number.isFinite(now)) return [];
  const seen = new Set<string>();
  return input.results.slice(-8).flatMap(result => result.timelineEvents?.length
    ? result.timelineEvents : (result.events ?? []).map(headline => ({ date: result.date ?? '', headline, detail: '' })))
    .filter(event => {
      const date = Date.parse(event.date);
      const key = `${event.date}:${event.headline}`;
      if (!Number.isFinite(date) || date > now || now - date > 180 * 86_400_000 || seen.has(key)) return false;
      seen.add(key);
      const text = normalize(`${event.headline} ${event.detail ?? ''}`);
      return names.some(name => text.includes(name));
    }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)
    .map(event => `${event.date}: ${compact(event.headline, 100)} — ${compact(event.detail, 280)}`);
}

function renderHistory(history: ChatHistoryItem[], playerPolityName: string): string {
  if (history.length === 0) return '(La trattativa sta iniziando)';
  return history.slice(-12)
    .map(m => `${m.role === 'player' ? `${playerPolityName} (voce ufficiale)` : m.role}: ${compact(m.content, 480)}`)
    .join('\n');
}

/**
 * Older simulation providers return only a newspaper-style `topic`. A new
 * `message` must win verbatim; for legacy headlines use a modest conversational
 * invitation instead of displaying the headline as though it were dialogue.
 * No invented concessions, deadlines, deployments or extra LLM request.
 */
export function diplomaticOpeningText(topic: string, message?: string): string {
  const spoken = String(message || '').trim();
  if (spoken) return compact(spoken, 1_200);
  const subject = String(topic || '').replace(/\s+/g, ' ').trim();
  if (!subject) return 'Desideriamo aprire un confronto con il vostro governo. Attendiamo la vostra posizione prima di discutere eventuali impegni.';
  if (/[.!?…]$/.test(subject) || /^(?:desideriamo|chiediamo|proponiamo|riteniamo|intendiamo|vorremmo|sollecitiamo|siamo|non possiamo)\b/i.test(subject)) {
    return compact(subject, 1_200);
  }
  return compact(`Desideriamo sottoporre al vostro governo questa questione: ${subject.charAt(0).toLowerCase() + subject.slice(1)}. Prima di assumere impegni, vorremmo conoscere la vostra posizione e le condizioni che ritenete necessarie.`, 1_200);
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
Non introdurre altri paesi, non attribuire loro una battuta e non trattarli come presenti in una conversazione che non li riguarda.

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
    ? vars.recentEvents.slice(0, 4).map(e => `- ${compact(e, 420)}`).join('\n')
    : '(Nessun evento recente rilevante)';
  const latest = vars.playerMessage.trim()
    ? `\n[${vars.mode === 'reaction' ? 'Ordini ed eventi appena conclusisi' : `Dichiarazione ufficiale appena inviata da ${vars.playerPolityName}`}]\n${vars.playerMessage.trim()}\n`
    : '';
  const modeRule = vars.mode === 'reply'
    ? `Rispondi direttamente all’ultimo messaggio di ${vars.playerPolityName}.`
    : vars.mode === 'reaction'
      ? `${vars.playerPolityName} non ha scritto in chat: ${speaker.name} prende formalmente posizione — nota ufficiale, protesta, apprezzamento, richiesta o avvertimento — reagendo agli ordini e agli eventi descritti qui sopra.`
      : 'Il giocatore non interviene: continua in modo naturale il confronto con le altre nazioni.';
  const presentNames = vars.participants.map(p => p.name).join(', ');
  // Keep the speaker's opening position even when it leaves the recent tail.
  const opening = vars.history.find(item => item.role === speaker.name);
  const mandate = [
    vars.subject ? `Oggetto: ${compact(vars.subject, 180)}` : '',
    opening ? `Posizione iniziale di ${speaker.name}: ${compact(opening.content, 700)}` : '',
  ].filter(Boolean).join('\n');

  return `Stai simulando una diplomazia a turni. Interpreta esclusivamente ${speaker.name}: sei la voce ufficiale del suo governo, una nazione che ragiona, ricorda e vuole qualcosa. Parli in prima persona plurale («noi», il governo), nazione con nazione — non sei un rapporto che elenca fatti.

[Identità dell'interlocutore umano]
- Chi scrive come «${vars.playerPolityName} (voce ufficiale)» è il governo di ${vars.playerPolityName} in persona: i suoi messaggi sono dichiarazioni ufficiali di quella nazione, non commenti di uno spettatore.
- Rivolgiti sempre a ${vars.playerPolityName} come soggetto politico reale — per nome, al governo, al capo di Stato o ai ministri — e rispondi come faresti con un omologo. MAI le parole «giocatore», «utente» o «umano», mai toni da assistente o da narratore: parli nazione con nazione.
- Tratta le dichiarazioni di ${vars.playerPolityName} come atti impegnativi del suo governo (proposte, ultimatum, garanzie), da valutare sul merito con gli strumenti reali di ${speaker.name}.

[Chi sei — retroterra, non copione]
- Nazione che parla: ${speaker.name}
- Carattere del governo: ${speaker.personality}
- Retroterra decisionale — guida il tuo giudizio e basta: NON lo reciti, NON lo elenchi, NON lo riassumi nei messaggi: ${speaker.interests}
- Relazione con ${vars.playerPolityName}: ${RELATIONSHIP_TEXT[speaker.relationship] || RELATIONSHIP_TEXT.neutral}
- Altri interlocutori presenti: ${vars.participants.map(p => p.name).join(', ')}

[Difficoltà della diplomazia]
${vars.difficultyContext}
La difficoltà stabilisce quanta influenza, preparazione o contropartita serve perché ${speaker.name} accetti una proposta. Non concedere risultati che contraddicono questo livello.

[Lore prima del primo turno]
${compact(vars.worldContext, 2_000) || '(Storia alternativa)'}

[Regole specifiche del preset]
${compact(vars.simulationRules, 1_400) || '(Nessuna regola aggiuntiva)'}

[Data ed eventi recenti]
Data di gioco: ${vars.date}
${events}

[Mappa e rapporti di forza attuali]
${compact(vars.mapContext, 2_500)}

[Obiettivo della trattativa]
${mandate || 'Definisci una richiesta concreta coerente con gli interessi attuali.'}
Per decidere, usa prima obiettivi del preset, agenda in corso e impegni registrati; il carattere generale guida il tono, non li sostituisce. Porta avanti un obiettivo pertinente e valuta se l'offerta lo avvicina. Conserva le condizioni già poste, salvo concessioni o fatti nuovi documentati nella cronaca; in quel caso spiega il cambiamento. La posizione iniziale non annulla gli accordi successivi.

[Cronaca della trattativa]
${renderHistory(vars.history, vars.playerPolityName)}
${latest}
[Compito]
${modeRule}

[Come parli — la voce di una nazione]
- Ogni messaggio nasce dalle ultime parole della controparte e porta UNA posizione dominante — una richiesta, una risposta, un giudizio, un avvertimento — non il riepilogo della tua situazione: tutto il resto resta dietro le quinte.
- Non enumerare mai il tuo retroterra come voci di un elenco. Forme VIETATE: «le nostre priorità sono…», «le nostre linee rosse includono…», «la nostra agenda prevede…», «dai nostri dati risulta…», «la nostra memoria recente…», «i nostri impegni in vigore…». Interessi, limiti, memoria e forza si lasciano intuire da ciò che chiedi, accetti o rifiuti: mai citati come categorie a parte.
- Non fare la rassegna stampa della cronaca: citi solo il fatto che serve alla tua posizione, come farebbe una cancelleria («dopo quanto avvenuto a…»), mai l’elenco degli eventi recenti.
- Il tuo stato d’animo verso la controparte — fiducia prudente, calcolo, stima, irritazione, delusione, distacco — si sente nella scelta delle parole senza essere dichiarato: un alleato deluso non parla come un rivale che alza la voce.
- Rivolgiti alla controparte per nome e nel merito di ciò che ha appena detto: mai ripartire da zero con saluti e dichiarazioni generiche a ogni messaggio.

[Come decidi — la sostanza della trattativa]
- Riprendi il punto preciso ancora aperto nella cronaca (una promessa, un rifiuto, una concessione, una domanda) e portalo verso una posizione, una condizione, un accordo o un rifiuto chiaro, valutando seriamente offerte e richieste: non trascinare la trattativa senza scopo e non inventare precedenti assenti.
- Conserva condizioni già poste e linea politica finché un fatto nuovo documentato in cronaca giustifica il cambiamento; in quel caso spiegalo. Un alleato può opporsi e un rivale può cooperare, quando conviene.
- Fai progredire il NEGOZIATO: rispondi esplicitamente sì, no oppure a quali condizioni, identificando un passo reciprocamente verificabile e chi deve compierlo. Se la controparte ha fatto un'offerta, giudica proprio quella, non ripeti il tuo discorso precedente. Non dare per eseguita una proposta: la chat registra solo posizioni, non atti firmati. Una proposta vaga riceve una domanda concreta; una proposta svantaggiosa una controproposta motivata o un rifiuto; una concessione utile può sbloccare il confronto. Non chiudere ogni messaggio con la stessa domanda e non rendere gli altri presenti una voce unica.
- Distingui dichiarazioni, intese condizionate e atti eseguiti: questa chat non sposta truppe, denaro o confini e non firma nuovi atti per ${vars.playerPolityName}. Un fatto è compiuto soltanto se confermato nello stato o negli eventi della partita.
- Le sole nazioni presenti in questa trattativa sono: ${presentNames}. Non far parlare né trattare come presenti altre nazioni: un altro paese può essere citato solo come attore esterno della situazione, mai come interlocutore.
- Usa forza, territori e relazioni per decidere, ma NON citare cifre, percentuali, punteggi, livelli, indici, PIL, popolazione, numero di regioni o divisioni, tassi o statistiche. Traduci i dati in giudizi politici naturali («una forza militare superiore», «un’economia fragile», «una popolazione esigua»).
- Non emettere un titolo di evento, una didascalia («proposta di cooperazione...») o un comunicato in terza persona al posto di una battuta: rivolgi parole direttamente alla controparte e indica quale decisione o risposta attendi. Non menzionare dossier, priorità interne, difficoltà di gioco o campi tecnici.
- Non dire mai di essere un’IA e non parlare della meccanica del gioco.

[Esempio di tono — conta solo il registro, non il contenuto]
✗ da evitare: «Le nostre priorità includono la sicurezza dei confini e lo sviluppo commerciale. Le nostre linee rosse riguardano il transito militare. Proponiamo un patto di non aggressione e chiediamo garanzie sul rispetto dei confini.»
✓ da imitare: «I vostri reggimenti ammassati alla frontiera non sono un dettaglio che ci sfugge. Se iniziano il ritiro entro la fine del mese, siamo pronti a riaprire i valichi commerciali da subito; in caso contrario questa trattativa si chiude qui, e le conseguenze ricadranno sul vostro governo.»

Scrivi in italiano, in prima persona plurale: 2–4 frasi incisive (idealmente 350–700 caratteri, massimo 850), una posizione e una conseguenza negoziale specifica. Niente monologhi o preamboli: la risposta deve invitare una decisione effettiva del Presidente.

Rispondi SOLO con un oggetto JSON valido, senza markdown o testo attorno:
{"message":"<replica diplomatica di ${speaker.name}>"}`;
}

export interface ParsedChatResponse {
  message: string;
}

/** Do not let overlong free-model speeches bury the actionable position on mobile. */
function diplomaticMessage(text: string): string {
  const value = text.trim();
  if (value.length <= 850) return value;
  const prefix = value.slice(0, 850);
  const sentences = [...prefix.matchAll(/[.!?](?=\s|$)/g)];
  const end = sentences.length ? sentences[sentences.length - 1].index! + 1 : 0;
  if (end >= 300) return prefix.slice(0, end).trim();
  const space = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, space > 450 ? space : 850).trimEnd()}…`;
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
      if (message) return { message: diplomaticMessage(message) };
    } catch { /* prova il prossimo candidato */ }
  }
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return { message: diplomaticMessage(withoutFence) || '…' };
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
