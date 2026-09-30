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

/** Le chiavi di evidenza che il ministro può richiamare. */
export const EVIDENCE_KEYS = ['spesa', 'trend', 'cifre', 'piano', 'mappa', 'idee'] as const;
export type EvidenceKey = typeof EVIDENCE_KEYS[number];

/** Le operazioni ammesse sul catalogo. */
export const PRESENTATION_OPS = ['show', 'focus', 'compare', 'annotate', 'dismiss'] as const;
export type PresentationOperation = typeof PRESENTATION_OPS[number];

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
}

/** Una direttiva applicata, legata alla partita e al messaggio che l'ha prodotta. */
export interface ActivePresentation {
  readonly directive: PresentationDirective;
  readonly seat: CabinetAddressView['seat'];
  /** L'identificatore stabile del messaggio: `<sedia>#<indice>`. */
  readonly messageId: string;
  /** La citazione del messaggio, per il ritorno dal messaggio alla tavola. */
  readonly quote: string;
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
function validateDirective(raw: string): PresentationDirective | null {
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

  // I campi che contano sono `op`, `evidence`, `note`: qualunque altra chiave
  // viene **ignorata**, non interpretata. Un payload con markup o codice è
  // invece respinto del tutto (controllo sul testo grezzo, sopra).
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
      .filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(id))
      .slice(0, 20)
    : undefined;

  return {
    op: op as PresentationOperation,
    ...(evidence ? { evidence } : {}),
    ...(note ? { note } : {}),
    ...(regionIds && regionIds.length > 0 ? { regionIds } : {}),
  };
}

/**
 * Estrae la **ultima** direttiva valida dal testo di una risposta e restituisce
 * il testo senza alcun blocco. Durante lo streaming un blocco incompleto viene
 * comunque rimosso: la tavola non deve renderizzare strutture parziali.
 */
export function parsePresentation(text: string): { text: string; directive: PresentationDirective | null } {
  if (!text) return { text: '', directive: null };
  let directive: PresentationDirective | null = null;
  FENCE_BLOCK.lastIndex = 0;
  for (const match of text.matchAll(FENCE_BLOCK)) {
    const parsed = validateDirective(match[1] ?? '');
    if (parsed) directive = parsed;
  }
  // Rimuove i blocchi completi e, se resta un fence aperto senza chiusura
  // (streaming in corso), tutto ciò che segue l'apertura.
  let visible = text.replace(FENCE_BLOCK, '');
  const open = visible.search(FENCE_OPEN);
  if (open >= 0) visible = visible.slice(0, open);
  return { text: visible.trim(), directive };
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
    return {
      kind: 'compare',
      block: null,
      roads: [...roads],
      label: 'Confronto tra le proposte',
      messageId,
      quote,
    };
  }

  if (!directive.evidence) return null;
  const block = blockForEvidence(directive.evidence, blocks);
  if (!block) return null;
  return {
    kind: 'evidence',
    block,
    roads: [],
    label: evidenceLabel(directive.evidence),
    ...(directive.note ? { note: directive.note } : {}),
    // Le zone in evidenza hanno senso solo su una mappa: altrove si ignorano.
    ...(block.kind === 'map' && directive.regionIds?.length ? { regionIds: directive.regionIds } : {}),
    messageId,
    quote,
  };
}
