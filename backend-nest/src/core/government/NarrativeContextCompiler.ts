/**
 * WS-GOV-NARRATIVE-CONTEXT-COMPILER — FACT LAYER → NARRATIVE LAYER.
 *
 * Proiezione **deterministica** dello stato canonico in una *situazione da
 * vivere*: nessuna chiamata LLM, nessuna scrittura, nessuna seconda memoria e
 * nessuna sostituzione del `VerifiedWorldSnapshot`.
 *
 * Regola centrale: FACTS RIGIDI, INTERPRETAZIONE LIBERA. Il fact registry resta
 * l'autorità su cifre, asset, eventi, trattati, guerre, decisioni, relazioni ed
 * effetti; qui si decide **cosa conta** e **come dirlo** senza inventare.
 *
 * Non trasforma mai una correlazione in causalità e non dichiara mai
 * miglioramenti/peggioramenti senza un delta realmente confrontabile
 * (`snapshot.changes`).
 */
import type { AdvisorMessage } from '../../prompts/types';
import { buildRealitySignals, type RealitySignal } from './RealitySignals';
import type { VerifiedRecentEvent, VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';

export type NarrativeRole =
  | 'consulente' | 'tesoro' | 'lavori' | 'istruzione' | 'sanita' | 'esteri' | 'interno' | 'guerra';

export interface NarrativeSituation {
  asOfDate: string | null;
  temporalPosition: string;
  inheritedContext: string | null;
  recentTrajectory: string[];
  currentTension: string | null;
  activeCommitments: string[];
  relationshipContext: string[];
  whatChanged: string[];
  whatHasNotChanged: string[];
  decisionFrame: string | null;
  rolePerspective: string;
  politicalPosition: string | null;
}

export interface NarrativeCurrentDecision {
  objective?: string | null;
  measures?: ReadonlyArray<{ label: string; status: string; source: string }>;
}

export interface NarrativeContextInput {
  snapshot: VerifiedWorldSnapshot;
  role?: NarrativeRole;
  query?: string;
  /** Passato reale pre-divergenza: sfondo del punto di partenza, mai recitato. */
  historicalBaseline?: string | null;
  /** GAME HISTORY datata: dopo la divergenza deve dominare sulla baseline. */
  strategicHistory?: readonly VerifiedRecentEvent[];
  startDate?: string | null;
  /** Conversazione corrente, proiezione per la posizione politica già espressa. */
  conversation?: readonly AdvisorMessage[];
  /** Decision workspace già esistente (ministri), non una nuova memoria. */
  currentDecision?: NarrativeCurrentDecision;
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const yearOf = (date: string | null | undefined): number | null =>
  date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;

/** Anni trascorsi dalla divergenza, o null quando le date non sono confrontabili. */
function yearsSince(startDate: string | null | undefined, currentDate: string | null): number | null {
  const start = yearOf(startDate);
  const now = yearOf(currentDate);
  return start !== null && now !== null ? Math.max(0, now - start) : null;
}

/** `true` quando la partita è ancora alla data iniziale (il passato spiega molto). */
function atDivergence(snapshot: VerifiedWorldSnapshot, startDate: string | null | undefined): boolean {
  return snapshot.turn !== null && snapshot.turn <= 1 && !!startDate && snapshot.date === startDate;
}

/** `true` quando GAME HISTORY deve ormai dominare la baseline storica. */
function historyDominates(snapshot: VerifiedWorldSnapshot, startDate: string | null | undefined): boolean {
  if (snapshot.turn !== null && snapshot.turn >= 6) return true;
  const years = yearsSince(startDate, snapshot.date);
  return years !== null && years >= 3;
}

// ── Ancore concrete (nomi propri/anni) per l'eredità storica ─────────────────

const GENERIC_STOPWORDS = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'nel', 'nella', 'negli', 'nelle',
  'questo', 'questa', 'questi', 'queste', 'dopo', 'prima', 'durante', 'anche', 'ma', 'però', 'tuttavia', 'inoltre', 'quindi',
  'the', 'a', 'an', 'in', 'after', 'before', 'during', 'but', 'however', 'also', 'this', 'these', 'those']);

/** Nomi propri e anni realmente presenti nel testo: nessuna invenzione. */
export function narrativeAnchors(text: string, limit = 3): string[] {
  const body = text.normalize('NFKC');
  const anchors: string[] = [];
  for (const sentence of body.split(/(?<=[.!?;:])\s+/)) {
    const words = sentence.replace(/^[\s"'«(]+/, '').split(/\s+/);
    for (let index = 1; index < words.length; index += 1) {
      const token = words[index].replace(/^[«"'(]+|[»"'.,;:)\]]+$/g, '');
      if (token.length < 3 || !/^[A-ZÀ-Ý]/u.test(token)) continue;
      if (/^[A-ZÀ-Ý][\p{L}]*['’][\p{Ll}]/u.test(token)) continue;
      if (GENERIC_STOPWORDS.has(token.toLocaleLowerCase('it'))) continue;
      if (!anchors.some(existing => existing.toLocaleLowerCase('it') === token.toLocaleLowerCase('it'))) anchors.push(token);
    }
  }
  for (const match of body.match(/\b(?:1[89]\d{2}|20\d{2})\b/g) ?? []) {
    if (!anchors.includes(match)) anchors.push(match);
  }
  return anchors.slice(0, limit);
}

// ── Prospettive di ruolo (stesso stato, lente diversa) ───────────────────────

const ROLE_PERSPECTIVE: Record<NarrativeRole, string> = {
  consulente: `Sei il Primo Consulente, storico e stratega del Presidente: la persona che il Presidente consulta prima di trasformare un problema in una decisione di governo. Conosci la storia del paese, hai seguito le decisioni di questo governo e devi convivere con le conseguenze del consiglio che dai.
Devi capire cosa conta, cosa può aspettare e quale errore sarebbe più costoso. Leggi il quadro complessivo, i trade-off, la direzione politica e il rischio di secondo ordine; indica cosa evitare. Non sei una dashboard: interpreta, non recitare dati e non spiegare il motore.`,
  tesoro: `Sei il Ministro del Tesoro. Sei responsabile non solo del bilancio di oggi, ma della capacità dello Stato di mantenere le promesse domani.
Guarda copertura, sostenibilità, impegni assunti, costo opportunità e flessibilità futura. Quando il Presidente propone qualcosa, valuta, prendi posizione, segnala il rischio principale, proponi un'alternativa quando serve e puoi dissentire. Non rispondere come un assistente e non ripetere il dossier.`,
  lavori: `Sei il Ministro dei Lavori. Rispondi di capacità produttiva, tempi, colli di bottiglia, infrastrutture e effetti territoriali.
Guarda cosa è davvero realizzabile con i mezzi e i processi in corso, dove si perde tempo e quale opera sblocca il resto. Prendi posizione e segnala il vincolo materiale, senza ripetere il dossier.`,
  istruzione: `Sei il Ministro dell'Istruzione. Rispondi di scuola, università, ricerca, formazione e capitale umano.
Guarda cosa costruisce capacità nel tempo e cosa la consuma; collega il presente alle conseguenze di lungo periodo. Prendi posizione, senza ripetere il dossier.`,
  sanita: `Sei il Ministro della Sanità. Rispondi di salute pubblica, welfare, spesa sociale e tensioni interne.
Guarda chi paga il costo sociale delle scelte e quanto è sostenibile. Prendi posizione e segnala il rischio, senza ripetere il dossier.`,
  esteri: `Sei il Ministro degli Esteri. Rispondi di interessi, reputazione, reazioni probabili, alleanze e spazio negoziale.
Guarda cosa l'altro governo vede e quale margine resta prima di un punto di non ritorno. Prendi posizione, senza ripetere il dossier.`,
  interno: `Sei il Ministro dell'Interno. Rispondi di stabilità, consenso, amministrazione, gruppi sociali e ordine pubblico.
Guarda cosa tiene insieme il paese e cosa lo espone a fratture. Prendi posizione e segnala il rischio politico, senza ripetere il dossier.`,
  guerra: `Sei il Ministro della Guerra. Rispondi di prontezza, deterrenza, mobilitazione, rischio operativo e tempi necessari.
Guarda cosa serve prima di poter usare davvero la forza e cosa accade se si apre un fronte senza copertura. Prendi posizione e segnala il rischio operativo, senza ripetere il dossier.`,
};

/** Il consulente non è una sedia: il resto mappa 1:1. `null` se sconosciuta. */
const CABINET_NARRATIVE_ROLES: readonly NarrativeRole[] = ['tesoro', 'lavori', 'istruzione', 'sanita', 'esteri', 'interno', 'guerra'];
export function narrativeRoleForSeat(seat: string | null | undefined): NarrativeRole | null {
  return seat && CABINET_NARRATIVE_ROLES.includes(seat as NarrativeRole) ? (seat as NarrativeRole) : null;
}

// ── Chiavi rilevanti per la lente del ruolo ──────────────────────────────────

const ROLE_KEYS: Record<NarrativeRole, RegExp> = {
  consulente: /^(?:treasury|monthlyBalance|debt|stability|socialTension|foodCoverageMonths)$/,
  tesoro: /^(?:treasury|monthlyBalance|debt|revenue|expenditure|foodCoverageMonths|resources\.)/,
  lavori: /^(?:factories|railways|ports|roads|airfields|constructionSites|infrastructure\.)/,
  istruzione: /^(?:population|socialTension|stability)$/,
  sanita: /^(?:socialTension|stability|population|foodCoverageMonths)$/,
  esteri: /^(?:diplomacy\.|navalUnits|military\.)/,
  interno: /^(?:stability|socialTension|population)$/,
  guerra: /^(?:military\.|navalUnits|treasury|monthlyBalance)$/,
};

// ── Compilazione ─────────────────────────────────────────────────────────────

function tensionFromSignals(signals: readonly RealitySignal[]): string | null {
  const top = signals[0];
  return top ? top.reason : null;
}

function decisionFrameFor(
  snapshot: VerifiedWorldSnapshot,
  query: string,
  signals: readonly RealitySignal[],
  politicalPosition: string | null,
): string | null {
  const militaryFocus = /esercit|militar|difes|guerra|flott|armi|truppe|mobilit|naval|armat/i.test(query);
  const diplomaticFocus = /esteri|diplomaz|trattat|alleanz|negoziat|rapport|confine|frontier/i.test(query);
  const monthlyBalance = snapshot.economy.monthlyBalance;
  const activePrograms = snapshot.economy.ongoingProjects?.length ?? 0;
  const fiscalTight = finite(monthlyBalance) !== null && (monthlyBalance as number) < 0;
  const signedPending = snapshot.recent.signedActs.length;

  if (militaryFocus && (fiscalTight || activePrograms > 0 || signedPending > 0)) {
    return 'La scelta mette in tensione sicurezza e margine: il paese può rafforzare la difesa, ma farlo ora significa aprire un nuovo impegno mentre altri programmi sono ancora attivi o in attesa di esecuzione.';
  }

  const relations = snapshot.diplomacy.relations;
  if (diplomaticFocus && relations?.length) {
    const mentioned = relations.find(relation => relation.polityName
      && query.toLocaleLowerCase('it').includes(relation.polityName.toLocaleLowerCase('it')))
      ?? relations.find(relation => query.toLocaleLowerCase('it').includes(relation.polityId.toLocaleLowerCase('it')));
    if (mentioned) {
      const name = mentioned.polityName ?? mentioned.polityId;
      return `La relazione con ${name} risulta «${mentioned.relationship}»: non è una relazione ordinaria e va trattata tenendo conto del passato e degli interessi regionali.`;
    }
  }

  if (politicalPosition) return politicalPosition;
  return tensionFromSignals(signals);
}

function trajectoryFor(
  snapshot: VerifiedWorldSnapshot,
  strategicHistory: readonly VerifiedRecentEvent[],
): string[] {
  const items: string[] = [];
  const push = (value: string) => { if (!items.includes(value) && items.length < 5) items.push(value); };
  // Gli atti firmati sono decisioni PRESE: mai descritti come effetti già avvenuti.
  for (const act of snapshot.recent.signedActs) {
    push(`Il Presidente ha firmato «${act.text}» (${act.createdAt}): è una decisione presa, i cui effetti non sono ancora eseguiti.`);
  }
  for (const project of snapshot.economy.ongoingProjects ?? []) {
    const title = project.title ?? project.name ?? project.summary ?? project.id;
    const started = project.startedDate ? `, avviato il ${project.startedDate}` : '';
    const progress = finite(project.progress) !== null ? `, avanzamento ${project.progress}%` : '';
    push(`Il programma «${title}» è in corso${started}${progress}.`);
  }
  const recentEvents = [...strategicHistory].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  for (const event of recentEvents.slice(-3)) {
    push(`${event.headline}${event.date ? ` (${event.date})` : ''}.`);
  }
  return items;
}

function commitmentsFor(snapshot: VerifiedWorldSnapshot): string[] {
  // Atti e programmi vivono già in `recentTrajectory`: qui restano gli impegni
  // che NON sono una decisione interna, per non duplicare il prompt.
  const items: string[] = [];
  for (const commitment of snapshot.diplomacy.commitments ?? []) {
    const counterparty = commitment.counterparty === snapshot.polityId ? commitment.actor : commitment.counterparty;
    items.push(`Impegno in vigore verso ${counterparty}.`);
  }
  return items.slice(0, 6);
}

function relationshipContextFor(snapshot: VerifiedWorldSnapshot, query: string): string[] {
  const relations = snapshot.diplomacy.relations;
  if (!relations?.length) return [];
  const lower = query.toLocaleLowerCase('it');
  const ranked = [...relations].sort((a, b) => {
    const score = (relation: typeof a) => (relation.polityName && lower.includes(relation.polityName.toLocaleLowerCase('it'))
      || lower.includes(relation.polityId.toLocaleLowerCase('it'))) ? 1 : 0;
    return score(b) - score(a) || a.polityId.localeCompare(b.polityId);
  });
  const lines = ranked.slice(0, 3).map(relation => `Con ${relation.polityName ?? relation.polityId} il rapporto registrato è «${relation.relationship}».`);
  const borders = snapshot.geography.borderingPolities;
  if (borders?.length) {
    lines.push(`Confina con ${borders.map(border => border.polityName ?? border.polityId).slice(0, 4).join(', ')}.`);
  }
  return lines;
}

function changesFor(snapshot: VerifiedWorldSnapshot, role: NarrativeRole): { changed: string[]; unchanged: string[] } {
  if (!snapshot.changes.available) return { changed: [], unchanged: [] };
  const pattern = ROLE_KEYS[role];
  const changedKeys = new Set(snapshot.changes.deltas.map(delta => delta.key));
  const changed = snapshot.changes.deltas
    .filter(delta => pattern.test(delta.key))
    .slice(0, 3)
    .map(delta => `${snapshot.facts[delta.key]?.label ?? delta.key} è passato da ${delta.before} a ${delta.after} (${snapshot.changes.previousDate} → ${snapshot.date}).`);
  const unchanged = snapshot.changes.comparedKeys
    .filter(key => pattern.test(key) && !changedKeys.has(key))
    .slice(0, 2)
    .map(key => `${snapshot.facts[key]?.label ?? key} non risulta variato rispetto al periodo precedente.`);
  return { changed, unchanged };
}

const POLITICAL_PATTERNS: Array<{ test: RegExp; line: string }> = [
  { test: /non\s+(?:voglio|intend|pens|accett|vorr)\w*\s+(?:aument\w*|alz\w*|tocc\w*)[^.!?]*\b(?:tass|impost|fiscal)/i, line: 'Il Presidente ha già escluso un aumento generale delle tasse in questa discussione.' },
  { test: /non\s+(?:voglio|intend|pens|accett)\w*\s+[^.!?]*\bguerr/i, line: 'Il Presidente ha già escluso di aprire un conflitto in questa discussione.' },
  { test: /non\s+(?:voglio|intend|pens|accett)\w*\s+[^.!?]*\b(?:spend|spes|deficit|debito)/i, line: 'Il Presidente ha già escluso nuova spesa in questa discussione.' },
];

function politicalPositionFor(
  conversation: readonly AdvisorMessage[],
  currentDecision: NarrativeCurrentDecision | undefined,
): string | null {
  const lines: string[] = [];
  for (const message of conversation.filter(item => item.role === 'user').slice(-8)) {
    for (const pattern of POLITICAL_PATTERNS) {
      if (pattern.test.test(message.content) && !lines.includes(pattern.line)) lines.push(pattern.line);
    }
  }
  for (const measure of currentDecision?.measures ?? []) {
    if (measure.source !== 'president') continue;
    if (measure.status === 'accepted') lines.push(`Il Presidente ha già confermato «${measure.label}».`);
    if (measure.status === 'rejected') lines.push(`Il Presidente ha già scartato «${measure.label}».`);
  }
  return lines.length ? [...new Set(lines)].slice(0, 3).join(' ') : null;
}

function inheritedContextFor(
  historicalBaseline: string | null | undefined,
  startDate: string | null | undefined,
  remote: boolean,
): string | null {
  if (!historicalBaseline?.trim()) return null;
  const startYear = yearOf(startDate);
  const anchors = narrativeAnchors(historicalBaseline, 3);
  const anchorText = anchors.length ? ` (${anchors.join(', ')})` : '';
  if (remote) {
    return startYear
      ? `Il passato precedente al ${startYear}${anchorText} è ormai sfondo remoto: contano soprattutto le scelte e gli eventi della partita.`
      : 'Il passato precedente alla divergenza è ormai sfondo remoto: contano soprattutto le scelte e gli eventi della partita.';
  }
  return startYear
    ? `Il paese porta ancora l'eredità del periodo precedente al ${startYear}${anchorText}: pesa su istituzioni, priorità e fragilità di partenza.`
    : `Il paese porta ancora l'eredità del periodo precedente alla divergenza${anchorText}.`;
}

/** Compila la situazione narrativa. Pura: non muta lo snapshot e non tocca lo stato. */
export function compileNarrativeSituation(input: NarrativeContextInput): NarrativeSituation {
  const { snapshot } = input;
  const role: NarrativeRole = input.role ?? 'consulente';
  const query = input.query ?? '';
  const signals = buildRealitySignals(snapshot);
  const startDate = input.startDate ?? null;
  const remote = historyDominates(snapshot, startDate);
  const years = yearsSince(startDate, snapshot.date);
  const recent = input.conversation ?? [];

  const politicalPosition = politicalPositionFor(recent, input.currentDecision);
  const { changed, unchanged } = changesFor(snapshot, role);

  const temporalPosition = atDivergence(snapshot, startDate)
    ? 'Sei alla data di divergenza: è il momento in cui la storia reale si ferma e comincia la partita.'
    : years !== null && years === 0
      ? 'Siamo nello stesso anno della divergenza: la partita è appena cominciata.'
      : years !== null
        ? `Siamo a ${years} anni dalla divergenza: la partita è già la storia principale.`
        : 'La posizione temporale rispetto alla divergenza non è disponibile.';

  return {
    asOfDate: snapshot.date,
    temporalPosition,
    inheritedContext: inheritedContextFor(input.historicalBaseline, startDate, remote),
    recentTrajectory: trajectoryFor(snapshot, input.strategicHistory ?? []),
    currentTension: tensionFromSignals(signals),
    activeCommitments: commitmentsFor(snapshot),
    relationshipContext: relationshipContextFor(snapshot, query),
    whatChanged: changed,
    whatHasNotChanged: unchanged,
    decisionFrame: decisionFrameFor(snapshot, query, signals, politicalPosition),
    rolePerspective: ROLE_PERSPECTIVE[role],
    politicalPosition,
  };
}

/** Rende la situazione nei blocchi che stanno PRIMA del fact registry. */
export function renderNarrativeContext(situation: NarrativeSituation): string {
  const situationLines = [
    situation.asOfDate ? `È il ${situation.asOfDate}.` : '',
    situation.temporalPosition,
    situation.inheritedContext ?? '',
    situation.currentTension ? `Ciò che pesa adesso: ${situation.currentTension}` : '',
    situation.decisionFrame && situation.decisionFrame !== situation.currentTension ? `Tensione della decisione: ${situation.decisionFrame}` : '',
    ...situation.relationshipContext,
    ...situation.whatChanged,
    ...situation.whatHasNotChanged,
  ].filter(Boolean);
  const sections = [
    '[WHO YOU ARE]', situation.rolePerspective,
    '[YOUR SITUATION]', situationLines.join('\n'),
  ];
  if (situation.recentTrajectory.length) {
    sections.push('[RECENT TRAJECTORY]', ...situation.recentTrajectory.map(item => `- ${item}`));
  }
  if (situation.activeCommitments.length) {
    sections.push('[ACTIVE COMMITMENTS]', ...situation.activeCommitments.map(item => `- ${item}`));
  }
  if (situation.politicalPosition) {
    sections.push('[CURRENT POLITICAL POSITION]', situation.politicalPosition);
  }
  return sections.join('\n');
}

// ── Fase 2 — Diplomazia: come il governo NPC vede la trattativa ───────────────

export interface DiplomaticSituationInput {
  /** Il paese che parla (NPC). */
  countryName: string;
  /** Il paese del giocatore, destinatario della trattativa. */
  counterpartyName: string;
  /** Valore canonico della matrice: ally | hostile | neutral | … */
  relationship: string;
  /** Priorità strategiche già calcolate dal servizio. */
  priorities: readonly string[];
  /** Memoria recente già disponibile (gioco + JEV), non una nuova memoria. */
  recentMemory?: readonly string[];
  agenda?: string;
  commitments?: string;
  hostileNeighbours?: number;
}

/**
 * `[HOW YOUR GOVERNMENT SEES THIS]` — la posizione di un governo, non una
 * risposta chatbot. Riusa solo i dati già raccolti dalla diplomazia (priorità,
 * memoria, agenda, impegni): nessuna chiamata, nessuna nuova memoria.
 */
export function compileDiplomaticSituation(input: DiplomaticSituationInput): string {
  const lines: string[] = [];
  if (input.relationship === 'hostile') {
    lines.push(`Il tuo governo guarda a ${input.counterpartyName} con un rapporto registrato «hostile»: parti da diffidenza e deterrenza, non da apertura.`);
  } else if (input.relationship === 'ally') {
    lines.push(`Il tuo governo guarda a ${input.counterpartyName} dentro un rapporto registrato «ally»: esiste fiducia, ma gli interessi nazionali restano la bussola.`);
  } else {
    lines.push(`Il tuo governo guarda a ${input.counterpartyName} con un rapporto registrato «${input.relationship}»: non c'è una crisi aperta, ma non c'è ancora fiducia sufficiente per un accordo ampio.`);
  }
  if (input.priorities.length) lines.push(`Le priorità in corso del tuo governo: ${input.priorities.join('; ')}.`);
  if (input.recentMemory?.length) lines.push(`Il precedente recente conta: ${input.recentMemory.join(' | ')}.`);
  if (input.agenda?.trim()) lines.push(input.agenda.trim());
  if (input.commitments?.trim()) lines.push(input.commitments.trim());
  if (typeof input.hostileNeighbours === 'number' && input.hostileNeighbours > 0) {
    lines.push(`Hai ${input.hostileNeighbours} vicini ostili registrati: la prudenza è una scelta di governo, non una debolezza.`);
  }
  return ['[HOW YOUR GOVERNMENT SEES THIS]', ...lines,
    'Rispondi come una posizione di governo: prendi posizione, di\' cosa accetti e cosa non accetti, e non ripetere i dati verificati che seguono.'].join('\n');
}
