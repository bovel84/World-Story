/**
 * WS-MINISTER-UX-03 — La conversazione guida la tavola
 * ====================================================
 * Finché la tavola è selezionata dal frontend (UX-01), il ministro può parlare
 * ma non può **mostrare** nulla: la destra non risponde al colloquio. Questa fase
 * dà al ministro una capacità di presentazione **strutturata**, e la dà con un
 * confine preciso:
 *
 *  - il modello **sceglie riferimenti** (una chiave di evidenza, un'operazione),
 *    non dati: non fornisce HTML, JavaScript, geometrie o serie numeriche;
 *  - il **resolver** costruisce il blocco e la geometria dalle fonti autorizzate
 *    già in memoria (`SeatCanvasBlock`, `TreasuryRoad`), come faceva UX-01;
 *  - un riferimento invalido **non fa niente**: la risposta testuale resta e la
 *    tavola non finge di aver mostrato qualcosa.
 *
 * Il formato sul filo è un blocco delimitato — un fence ```` ```tavola ```` con un
 * JSON minimale. È il ripiego previsto dalla roadmap quando il provider non
 * offre eventi strutturati: validato alla lettera, rimosso dalla prosa, e mai
 * reso a metà durante lo streaming.
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata al modello.
 */

import type { CabinetAddressView } from '../../services/api';
import type { SeatCanvasBlock } from './seatCanvasModel';
import type { TreasuryRoad } from './treasuryAct';
import { matchSpendingVoice } from './spendingFocus';
import { focusedProposals } from './seatProposals';
import { parseDecisionActions, stripDecisionFences, type DecisionAction } from './decisionWorkspace';
import { REGION_METRICS, type RegionMetric } from './regionMetrics';

/** Le chiavi di evidenza che il ministro può richiamare. */
export const EVIDENCE_KEYS = ['spesa', 'trend', 'cifre', 'piano', 'mappa', 'idee'] as const;
export type EvidenceKey = typeof EVIDENCE_KEYS[number];

/** Le operazioni ammesse sul catalogo. */
export const PRESENTATION_OPS = ['show', 'focus', 'compare', 'annotate', 'dismiss'] as const;
export type PresentationOperation = typeof PRESENTATION_OPS[number];

/**
 * WS-GOVUX-P3 — La semantica della tela dietro le operazioni storiche.
 * Il nome italiano è il requisito della roadmap; l'`op` sul filo resta quello
 * già validato dai provider, così il confine non cambia:
 *
 *  - `show` / `focus` → **sostituisci principale**
 *  - `compare`        → **aggiungi confronto** (non toglie le principali)
 *  - `annotate`       → **aggiorna** un'evidenza mirata
 *  - `dismiss`        → **rimuovi** un'evidenza mirata (o svuota la tela)
 */
export const CANVAS_OP_SEMANTICS: Record<PresentationOperation, string> = {
  show: 'sostituisci principale',
  focus: 'sostituisci principale',
  compare: 'aggiungi confronto',
  annotate: 'aggiorna',
  dismiss: 'rimuovi',
};

/**
 * P3 — Il tetto di nuove istruzioni che una sola risposta può portare (lotto
 * totale: `show`/`focus` nuove evidenze più `compare`/`annotate`/`dismiss`).
 */
export const MAX_NEW_EVIDENCES_PER_REPLY = 3;
/** P3 — Quante evidenze principali stanno visibili sulla tela. */
export const MAX_MAIN_EVIDENCES = 2;
/** Bounded canonical references, including UUID and namespaced region IDs. */
export const MAX_MAP_REGION_IDS = 20;
/**
 * M02 — Quanto può essere ampia una **scheda geografica** prima che la
 * mini-mappa venga ridotta a riepilogo. È un tetto di **resa**, non di
 * **ricezione**: una direttiva del modello resta limitata a `MAX_MAP_REGION_IDS`
 * (il payload non fidato si difende fail-closed), mentre un insieme canonico —
 * il territorio di una nazione, decine o centinaia di regioni — può essere
 * disegnato. Misurato: 4475 regioni → 4475 path, ~2,7 MB, ~750 ms nel browser;
 * il paese del giocatore (61) → ~45 ms. Oltre questo tetto si degrada al
 * riepilogo, mai al vuoto.
 */
export const MAX_MAP_PREVIEW_REGIONS = 800;
const safeRegionId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(id);

const KEY_LABEL: Record<EvidenceKey, string> = {
  spesa: 'Dove va la spesa',
  trend: 'L’andamento nel tempo',
  cifre: 'Le cifre della sedia',
  piano: 'Il piano',
  mappa: 'Le zone del paese',
  idee: 'Le idee del ministro',
};

/**
 * La chiave → l'`id` del blocco che la realizza. Il blocco lo costruisce il read
 * model: qui c'è solo la corrispondenza, non il dato. `cifre` predilige le cifre
 * portate in seduta e ripiega sul quadro operativo.
 */
const BLOCK_ID_BY_KEY: Record<EvidenceKey, string> = {
  spesa: 'bilancio',
  trend: 'trend',
  cifre: 'cifre-sedia',
  piano: 'piano',
  mappa: 'zone',
  idee: 'idee',
};

/** La direttiva: la scelta del modello, non il dato. */
export interface PresentationDirective {
  readonly op: PresentationOperation;
  /** Richiesta per `show`/`focus`/`annotate`; assente per `compare`/`dismiss`. */
  readonly evidence?: EvidenceKey;
  /** Annotazione testuale breve, per `annotate`. Non è un numero né geometria. */
  readonly note?: string;
  /**
   * WS-MINISTER-UX-04 — Per la mappa: gli `id` delle zone in evidenza. Sono
   * riferimenti, non geometrie: il path resta quello del read model.
   */
  readonly regionIds?: readonly string[];
  /** Parser provenance, not an LLM field: never draw a silently reduced map. */
  readonly invalidRegionIds?: boolean;
  /**
   * MAP05 — La **grandezza** da mostrare sulla mappa, fra le tre canoniche
   * (`pil`, `popolazione`, `difesa`). È una scelta di *cosa guardare*, mai una
   * cifra: i numeri e la scala li mette il resolver dalle regioni del motore.
   * Il modello può dichiararla quando la sua raccomandazione riguarda una
   * grandezza; altrimenti è il testo del Presidente a farla scegliere.
   */
  readonly metric?: RegionMetric;
  /**
   * WS-GOVUX-P3 — Il **bersaglio** mirato di `annotate`/`dismiss` (default:
   * `evidence`). Serve a rimuovere/aggiornare un'evidenza della tela senza
   * toccare le altre: è la differenza fra «rimuovi mirato» e «svuota».
   */
  readonly target?: EvidenceKey;
  /**
   * WS-GOVUX-P3 — La versione di stato attesa. Se non combacia con quella
   * della tela, la direttiva **degrada** (no-op): una risposta tardiva o fuori
   * ordine non riscrive una tela più recente.
   */
  readonly version?: number;
}

/** Una direttiva applicata, legata alla partita e al messaggio che l'ha prodotta. */
export interface ActivePresentation {
  readonly directive: PresentationDirective;
  readonly seat: CabinetAddressView['seat'];
  /** L'identificatore stabile del messaggio: `<sedia>#<indice>`. */
  readonly messageId: string;
  /** La citazione del messaggio, per il ritorno dal messaggio alla tavola. */
  readonly quote: string;
  /**
   * WS-MINISTER-UX-07 — L'ultimo testo del Presidente che ha innescato la
   * presentazione. Serve ad A2: la voce di spesa discussa si sceglie dal
   * **discorso**, non dalla risposta (la risposta può non nominarla).
   */
  readonly discussion?: string;
  /**
   * WS-MINISTER-UX-07 (C) — L'evidenza è **fissata**: resta sulla tavola anche
   * se la conversazione propone altro, così il Presidente finisce di leggerla.
   */
  readonly pinned?: boolean;
}

/** Ciò che la tavola deve mostrare, già risolto dal catalogo. */
export interface ResolvedPresentation {
  readonly kind: 'evidence' | 'compare';
  /** Il blocco da mettere in evidenza, per `evidence`. */
  readonly block: SeatCanvasBlock | null;
  /** Le strade delle proposte, per `compare`. */
  readonly roads: TreasuryRoad[];
  readonly label: string;
  readonly note?: string;
  /**
   * WS-MINISTER-UX-08 — La chiave richiesta, quando è un'evidenza. Serve a
   * decidere se l'atto del Tesoro è pertinente alla decisione (difetto 1):
   * l'atto non precede la mappa o il grafico richiesti.
   */
  readonly evidence?: EvidenceKey;
  /**
   * WS-MINISTER-UX-07 — La voce di spesa da evidenziare (A2), scelta in locale
   * dal discorso. `undefined` = nessuna voce pertinente, si mostra l'insieme.
   */
  readonly focusLabel?: string;
  /** WS-MINISTER-UX-07 (C) — L'evidenza è fissata dal Presidente. */
  readonly pinned?: boolean;
  /** Zone in evidenza sulla mappa, se la direttiva ne indicava. */
  readonly regionIds?: readonly string[];
  readonly messageId: string;
  readonly quote: string;
}

/** Il blocco `metrics` da usare per `cifre` quando mancano le cifre in seduta. */
function metricsFallback(blocks: readonly SeatCanvasBlock[]): SeatCanvasBlock | null {
  return blocks.find(block => block.kind === 'metrics' && block.id === 'quadro')
    ?? blocks.find(block => block.kind === 'metrics')
    ?? null;
}

/** Il blocco che realizza una chiave, o `null` se per questa sedia non esiste. */
export function blockForEvidence(
  evidence: EvidenceKey,
  blocks: readonly SeatCanvasBlock[],
): SeatCanvasBlock | null {
  const wanted = BLOCK_ID_BY_KEY[evidence];
  const exact = blocks.find(block => block.id === wanted);
  if (exact) return exact;
  if (evidence === 'cifre') return metricsFallback(blocks);
  return null;
}

/** Il catalogo disponibile per una sedia: quali chiavi hanno davvero un blocco. */
export function availableEvidence(blocks: readonly SeatCanvasBlock[]): EvidenceKey[] {
  return EVIDENCE_KEYS.filter(key => blockForEvidence(key, blocks) !== null);
}

/** La label leggibile di una chiave. */
export function evidenceLabel(evidence: EvidenceKey): string {
  return KEY_LABEL[evidence];
}

const FENCE_OPEN = /```\s*tavola\b/i;
const FENCE_BLOCK = /```\s*tavola\s*([\s\S]*?)```/gi;

/**
 * Un JSON minimale, poi un ripiego `op=… evidence=…`: i provider piccoli
 * sbagliano la sintassi, ma non devono poter introdurre campi arbitrari.
 */
export function validateDirective(raw: string): PresentationDirective | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  // Rifiuto netto di qualunque payload che sembri markup o codice.
  if (/[<>]|javascript:|on\w+\s*=/i.test(cleaned)) return null;

  let candidate: Record<string, unknown> | null = null;
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(cleaned.slice(first, last + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        candidate = parsed as Record<string, unknown>;
      }
    } catch {
      candidate = null;
    }
  }
  if (!candidate) {
    // Ripiego: `op=focus evidence=spesa` (o `op: focus, evidence: spesa`).
    const pairs: Record<string, string> = {};
    for (const match of cleaned.matchAll(/([a-z]+)\s*[:=]\s*([\w-]+)/gi)) {
      pairs[match[1].toLowerCase()] = match[2].toLowerCase();
    }
    if (Object.keys(pairs).length > 0) candidate = pairs;
  }
  if (!candidate) return null;

  // I campi che contano sono `op`, `evidence`, `note`, `regionIds`, `target`,
  // `version`: qualunque altra chiave viene **ignorata**, non interpretata. Un
  // payload con markup o codice è invece respinto del tutto (controllo sul testo
  // grezzo, sopra).
  const op = typeof candidate.op === 'string' ? candidate.op.toLowerCase() : '';
  if (!(PRESENTATION_OPS as readonly string[]).includes(op)) return null;

  const evidenceRaw = typeof candidate.evidence === 'string' ? candidate.evidence.toLowerCase() : '';
  const evidence = (EVIDENCE_KEYS as readonly string[]).includes(evidenceRaw)
    ? (evidenceRaw as EvidenceKey)
    : undefined;

  if ((op === 'show' || op === 'focus' || op === 'annotate') && !evidence) return null;

  const note = typeof candidate.note === 'string' && !/[<>\n]/.test(candidate.note)
    ? candidate.note.slice(0, 160)
    : undefined;

  // WS-MINISTER-UX-04 — Gli `id` delle zone: solo riferimenti brevi. Tutto ciò
  // che non è un id sicuro viene scartato; se non ne resta nessuno, si omette.
  const regionIds = Array.isArray(candidate.regionIds)
    ? candidate.regionIds
      .filter(safeRegionId)
      .slice(0, MAX_MAP_REGION_IDS)
    : undefined;
  const invalidRegionIds = evidence === 'mappa' && candidate.regionIds !== undefined
    && (!Array.isArray(candidate.regionIds) || !candidate.regionIds.length || candidate.regionIds.length > MAX_MAP_REGION_IDS || !candidate.regionIds.every(safeRegionId));

  // MAP05 — La grandezza da mostrare: solo le tre canoniche. Un valore ignoto è
  // omesso (si resta sul colore politico), non interpretato: il modello sceglie
  // *cosa* guardare, la scala la decide il resolver.
  const metricRaw = typeof candidate.metric === 'string' ? candidate.metric.toLowerCase() : '';
  const metric = (REGION_METRICS as readonly string[]).includes(metricRaw) ? (metricRaw as RegionMetric) : undefined;

  // WS-GOVUX-P3 — Il bersaglio mirato (solo una chiave di evidenza nota) e la
  // versione di stato (intero non negativo). Valori non validi ⇒ omessi, non
  // interpretati: la direttiva resta valida ma senza il campo inventato.
  const targetRaw = typeof candidate.target === 'string' ? candidate.target.toLowerCase() : '';
  const target = (EVIDENCE_KEYS as readonly string[]).includes(targetRaw)
    ? (targetRaw as EvidenceKey)
    : undefined;
  const versionRaw = candidate.version;
  const version = typeof versionRaw === 'number' && Number.isInteger(versionRaw) && versionRaw >= 0
    ? versionRaw
    : undefined;

  return {
    op: op as PresentationOperation,
    ...(evidence ? { evidence } : {}),
    ...(note ? { note } : {}),
    ...(regionIds && regionIds.length > 0 ? { regionIds } : {}),
    ...(invalidRegionIds ? { invalidRegionIds: true } : {}),
    ...(metric ? { metric } : {}),
    ...(target ? { target } : {}),
    ...(version !== undefined ? { version } : {}),
  };
}

/**
 * La chiave d'identità di una direttiva, per deduplicare una risposta che
 * ripete la stessa istruzione. `target` distingue un `dismiss` mirato da uno
 * generico; la nota non entra: due note diverse sulla stessa evidenza valgono
 * l'ultima (il reducer la sovrascrive).
 */
function canvasDirectiveKey(directive: PresentationDirective): string {
  return `${directive.op}:${directive.evidence ?? ''}:${directive.target ?? ''}`;
}

/**
 * Estrae le **ultime** direttive valide dal testo di una risposta (fino a
 * `MAX_NEW_EVIDENCES_PER_REPLY`) e restituisce il testo senza alcun blocco.
 * Durante lo streaming un blocco incompleto viene comunque rimosso: la tavola
 * non deve renderizzare strutture parziali.
 *
 * `directive` resta l'**ultima** valida, per retro-compatibilità con chi legge
 * una sola evidenza; `directives` è il lotto che la tela applica in ordine.
 */
export function parsePresentation(text: string): {
  text: string;
  directive: PresentationDirective | null;
  directives: PresentationDirective[];
  /**
   * WS-GOV-DIALOGUE-TO-ACT — Le azioni strutturate sul Decision Workspace,
   * estratte dallo stesso testo e **mai** mostrate al Presidente (come la tela).
   */
  decisions: DecisionAction[];
} {
  if (!text) return { text: '', directive: null, directives: [], decisions: [] };
  const found: PresentationDirective[] = [];
  FENCE_BLOCK.lastIndex = 0;
  for (const match of text.matchAll(FENCE_BLOCK)) {
    const parsed = validateDirective(match[1] ?? '');
    if (parsed) found.push(parsed);
  }
  // Deduplica per istruzione tenendo l'**ultima** occorrenza e la sua
  // posizione: una risposta che ripete la stessa `op` sulla stessa evidenza vale
  // una volta sola, e l'ultima vince (anche nell'ordine). Poi il lotto è
  // limitato alle ultime `MAX_NEW_EVIDENCES_PER_REPLY` istruzioni.
  const lastIndexByKey = new Map<string, number>();
  found.forEach((directive, index) => lastIndexByKey.set(canvasDirectiveKey(directive), index));
  const directives = found
    .filter((directive, index) => lastIndexByKey.get(canvasDirectiveKey(directive)) === index)
    .slice(-MAX_NEW_EVIDENCES_PER_REPLY);
  // Rimuove i blocchi completi e, se resta un fence aperto senza chiusura
  // (streaming in corso), tutto ciò che segue l'apertura.
  let visible = text.replace(FENCE_BLOCK, '');
  const open = visible.search(FENCE_OPEN);
  if (open >= 0) visible = visible.slice(0, open);
  // WS-GOV-DIALOGUE-TO-ACT — I blocchi `decision` non sono mai prosa visibile:
  // si estraggono e si tolgono dal testo (anche un fence aperto in streaming).
  const decisions = parseDecisionActions(text);
  visible = stripDecisionFences(visible);
  return {
    text: visible.trim(),
    directive: directives[directives.length - 1] ?? null,
    directives,
    decisions,
  };
}

/**
 * WS-MINISTER-UX-07 (C) — Una nuova direttiva rimpiazza l'evidenza corrente?
 * No, se l'evidenza è **fissata**: solo il Presidente la toglie (o un `dismiss`).
 * Funzione pura, così il lucchetto si prova senza DOM.
 */
export function shouldApplyPresentation(
  current: ActivePresentation | null | undefined,
  directive: PresentationDirective,
): boolean {
  return !(current?.pinned && directive.op !== 'dismiss');
}

/**
 * WS-MINISTER-UX-07 (A2) — La voce di spesa discussa, se la risposta parla di
 * spesa: si sceglie in locale dal discorso del Presidente (o, in mancanza, dalla
 * citazione della risposta), deterministica e senza chiamate in più.
 */
function spendFocus(evidence: EvidenceKey, block: SeatCanvasBlock, discussion: string, quote: string): string | undefined {
  if (evidence !== 'spesa' || block.kind !== 'chart') return undefined;
  return matchSpendingVoice(discussion || quote, block.figure.bars.map(bar => bar.label)) ?? undefined;
}

/** Un blocco risolto in evidenza: la parte comune di `resolvePresentation` e della tela. */
function resolveEvidence(
  input: {
    readonly evidence: EvidenceKey;
    readonly note?: string;
    readonly regionIds?: readonly string[];
    readonly pinned?: boolean;
    readonly messageId: string;
    readonly quote: string;
    readonly discussion?: string;
  },
  blocks: readonly SeatCanvasBlock[],
): ResolvedPresentation | null {
  const block = blockForEvidence(input.evidence, blocks);
  if (!block) return null;
  const focusLabel = spendFocus(input.evidence, block, input.discussion ?? '', input.quote);
  return {
    kind: 'evidence',
    block,
    roads: [],
    label: focusLabel
      ? `${evidenceLabel(input.evidence)} — ${focusLabel}`
      : evidenceLabel(input.evidence),
    evidence: input.evidence,
    ...(focusLabel ? { focusLabel } : {}),
    ...(input.pinned ? { pinned: true } : {}),
    ...(input.note ? { note: input.note } : {}),
    // Le zone in evidenza hanno senso solo su una mappa: altrove si ignorano.
    ...(block.kind === 'map' && input.regionIds?.length ? { regionIds: input.regionIds } : {}),
    messageId: input.messageId,
    quote: input.quote,
  };
}

/** Il confronto fra le proposte, dalla conversazione: pura risoluzione delle strade. */
function resolveComparison(
  input: { readonly messageId: string; readonly quote: string; readonly discussion?: string; readonly pinned?: boolean },
  roads: readonly TreasuryRoad[],
): ResolvedPresentation {
  return {
    kind: 'compare',
    block: null,
    // WS-MINISTER-UX-08 (2) — Il confronto appartiene alla proposta discussa:
    // quella nominata nella conversazione sale in testa, le altre restano
    // nell'ordine del motore. Le proposte arrivano dalla sedia aperta.
    roads: focusedProposals(roads, input.discussion || input.quote),
    label: 'Confronto tra le proposte',
    messageId: input.messageId,
    quote: input.quote,
    ...(input.pinned ? { pinned: true } : {}),
  };
}

/**
 * Risolve una direttiva contro il catalogo reale della sedia. `null` quando non
 * c'è nulla da mostrare: la tavola resta quella predefinita e la risposta
 * testuale del ministro non viene toccata.
 */
export function resolvePresentation(
  active: ActivePresentation | null | undefined,
  blocks: readonly SeatCanvasBlock[],
  roads: readonly TreasuryRoad[],
): ResolvedPresentation | null {
  if (!active) return null;
  const { directive, messageId, quote } = active;
  if (directive.op === 'dismiss') return null;

  if (directive.op === 'compare') {
    return resolveComparison(
      { messageId, quote, ...(active.discussion ? { discussion: active.discussion } : {}), ...(active.pinned ? { pinned: true } : {}) },
      roads,
    );
  }

  if (!directive.evidence) return null;
  return resolveEvidence(
    {
      evidence: directive.evidence,
      ...(directive.note ? { note: directive.note } : {}),
      ...(directive.regionIds ? { regionIds: directive.regionIds } : {}),
      ...(active.pinned ? { pinned: true } : {}),
      messageId,
      quote,
      ...(active.discussion ? { discussion: active.discussion } : {}),
    },
    blocks,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WS-GOVUX-P3 — La tela conversazionale (canvas)
// ─────────────────────────────────────────────────────────────────────────────
// Il P0 aveva rilevato che il confronto **sostituiva** la principale e che non
// esistevano né un lotto di evidenze né un aggiornamento/rimozione mirati. Qui
// la tela è un **read model puro**: le direttive si applicano a un oggetto
// immutabile (nessun I/O, nessuno stato React), e il resolver costruisce le
// evidenze dal catalogo autorizzato, come già fa `resolvePresentation`.
//
// Regole verificabili:
//  - **sostituisci principale**: `show`/`focus` porta l'evidenza in testa,
//    conserva l'altra principale, e non supera `MAX_MAIN_EVIDENCES`;
//  - **aggiungi confronto**: `compare` imposta il confronto **senza** togliere
//    le principali (era il difetto del P0);
//  - **aggiorna**: `annotate` tocca la nota dell'evidenza bersaglio;
//  - **rimuovi**: `dismiss` toglie l'evidenza bersaglio; senza bersaglio svuota;
//  - **versione di stato**: una direttiva con `version` diversa dalla tela
//    corrente **degrada** (no-op), così una risposta tardiva non riscrive;
//  - **evidenza fissata**: nessuna sostituzione né confronto scavalca il
//    lucchetto del Presidente; `annotate`/`dismiss` restano possibili;
//  - **riferimento invalido**: un blocco assente non entra nella tela risolta e
//    **non azzera** le altre evidenze; il testo valido resta leggibile.

/** Un'evidenza sulla tela: la chiave + il messaggio che l'ha portata. */
export interface CanvasMain {
  readonly id: string;
  readonly evidence: EvidenceKey;
  readonly messageId: string;
  readonly quote: string;
  readonly discussion?: string;
  readonly note?: string;
  readonly regionIds?: readonly string[];
  readonly pinned?: boolean;
  readonly version: number;
}

/** Il confronto sulla tela: non è un'evidenza, non ha una chiave. */
export interface CanvasComparison {
  readonly id: string;
  readonly messageId: string;
  readonly quote: string;
  readonly discussion?: string;
  readonly note?: string;
  readonly pinned?: boolean;
  readonly version: number;
}

/** Lo stato della tela per una sedia: un read model, non stato di gioco. */
export interface PresentationCanvas {
  readonly stateVersion: number;
  readonly mains: readonly CanvasMain[];
  readonly comparison: CanvasComparison | null;
}

/** Ciò che la tavola deve mostrare, risolto dal catalogo. */
export interface ResolvedCanvas {
  readonly mains: readonly ResolvedPresentation[];
  readonly comparison: ResolvedPresentation | null;
}

/** La tela vuota: nessuna evidenza, versione 0. */
export function emptyCanvas(): PresentationCanvas {
  return { stateVersion: 0, mains: [], comparison: null };
}

/** La direttiva portata da un messaggio: il contesto che la tela conserva. */
export interface DirectiveMeta {
  readonly messageId: string;
  readonly quote: string;
  readonly discussion?: string;
}

function canvasMainId(evidence: EvidenceKey, messageId: string): string {
  return `${evidence}@${messageId}`;
}

function hasPinnedCanvas(canvas: PresentationCanvas): boolean {
  return canvas.mains.some(item => item.pinned) || Boolean(canvas.comparison?.pinned);
}

/**
 * Applica **una** direttiva alla tela. Funzione pura: stesso input ⇒ stessa
 * tela. Restituisce la stessa istanza quando la direttiva non cambia nulla
 * (bersaglio assente, versione stantia, lucchetto): il chiamante può evitare un
 * re-render confrontando i riferimenti.
 */
export function applyCanvasDirective(
  canvas: PresentationCanvas,
  directive: PresentationDirective,
  meta: DirectiveMeta,
): PresentationCanvas {
  // Una versione esplicita che non combacia è un ordine per un'altra tela.
  if (directive.version !== undefined && directive.version !== canvas.stateVersion) return canvas;
  const now = canvas.stateVersion + 1;

  switch (directive.op) {
    case 'show':
    case 'focus': {
      // Sostituisci principale: l'evidenza sale in testa; le altre restano, ma
      // la tela non mostra più di `MAX_MAIN_EVIDENCES` principali.
      if (!directive.evidence || hasPinnedCanvas(canvas)) return canvas;
      const existing = canvas.mains.find(item => item.evidence === directive.evidence);
      const others = canvas.mains.filter(item => item.evidence !== directive.evidence);
      const primary: CanvasMain = {
        id: canvasMainId(directive.evidence, meta.messageId),
        evidence: directive.evidence,
        messageId: meta.messageId,
        quote: meta.quote,
        ...(meta.discussion ? { discussion: meta.discussion } : {}),
        ...(directive.note ?? existing?.note ? { note: (directive.note ?? existing?.note) as string } : {}),
        ...(directive.regionIds?.length
          ? { regionIds: directive.regionIds }
          : existing?.regionIds?.length ? { regionIds: existing.regionIds } : {}),
        version: now,
      };
      return {
        stateVersion: now,
        mains: [primary, ...others].slice(0, MAX_MAIN_EVIDENCES),
        comparison: canvas.comparison,
      };
    }
    case 'compare': {
      // Aggiungi confronto: NON toglie le principali (difetto del P0).
      if (hasPinnedCanvas(canvas)) return canvas;
      const comparison: CanvasComparison = {
        id: `comparison@${meta.messageId}`,
        messageId: meta.messageId,
        quote: meta.quote,
        ...(meta.discussion ? { discussion: meta.discussion } : {}),
        ...(directive.note ? { note: directive.note } : {}),
        version: now,
      };
      return { stateVersion: now, mains: canvas.mains, comparison };
    }
    case 'annotate': {
      // Aggiorna mirato: la nota va sull'evidenza bersaglio (default `evidence`).
      const target = directive.target ?? directive.evidence;
      if (!target) return canvas;
      let changed = false;
      const mains = canvas.mains.map(item => {
        if (item.evidence !== target) return item;
        changed = true;
        return { ...item, ...(directive.note ? { note: directive.note } : {}), version: now };
      });
      if (!changed) return canvas;
      return { stateVersion: now, mains, comparison: canvas.comparison };
    }
    case 'dismiss': {
      // Rimuovi mirato: senza bersaglio svuota la tela; con un bersaglio assente
      // la direttiva degrada e la tela resta com'è.
      const target = directive.target ?? directive.evidence;
      if (!target) {
        if (canvas.mains.length === 0 && !canvas.comparison) return canvas;
        return { stateVersion: now, mains: [], comparison: null };
      }
      const mains = canvas.mains.filter(item => item.evidence !== target);
      if (mains.length === canvas.mains.length) return canvas;
      return { stateVersion: now, mains, comparison: canvas.comparison };
    }
    default:
      return canvas;
  }
}

/**
 * Applica un lotto di direttive in ordine, entro `MAX_NEW_EVIDENCES_PER_REPLY`.
 * Il tetto è qui **e** nel parser: qualunque strada porti le direttive, la tela
 * non ne applica più di tre per risposta.
 */
export function applyCanvasBatch(
  canvas: PresentationCanvas,
  directives: readonly PresentationDirective[],
  meta: DirectiveMeta,
): PresentationCanvas {
  return directives
    .slice(-MAX_NEW_EVIDENCES_PER_REPLY)
    .reduce((acc, directive) => applyCanvasDirective(acc, directive, meta), canvas);
}

/**
 * Risolve la tela contro il catalogo reale. Le evidenze senza blocco **non
 * entrano** e non azzerano le altre: un riferimento invalido degrada, la tela
 * resta leggibile. Il confronto si risolve solo se la tela ne ha uno.
 */
export function resolveCanvas(
  canvas: PresentationCanvas,
  blocks: readonly SeatCanvasBlock[],
  roads: readonly TreasuryRoad[],
): ResolvedCanvas {
  const mains = canvas.mains
    .map(item => resolveEvidence(
      {
        evidence: item.evidence,
        ...(item.note ? { note: item.note } : {}),
        ...(item.regionIds ? { regionIds: item.regionIds } : {}),
        ...(item.pinned ? { pinned: true } : {}),
        messageId: item.messageId,
        quote: item.quote,
        ...(item.discussion ? { discussion: item.discussion } : {}),
      },
      blocks,
    ))
    .filter((item): item is ResolvedPresentation => item !== null);
  const comparison = canvas.comparison
    ? resolveComparison(
      {
        messageId: canvas.comparison.messageId,
        quote: canvas.comparison.quote,
        ...(canvas.comparison.discussion ? { discussion: canvas.comparison.discussion } : {}),
        ...(canvas.comparison.pinned ? { pinned: true } : {}),
      },
      roads,
    )
    : null;
  return { mains, comparison };
}
