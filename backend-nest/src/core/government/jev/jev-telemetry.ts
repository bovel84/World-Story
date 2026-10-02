/**
 * WS-JEV-W8 — Telemetria di memoria.
 *
 * La telemetria è un **effetto collaterale di sola lettura**: misura i retrieval
 * e il consolidamento esistenti senza cambiare né le loro decisioni né i loro
 * output. Nessun modello viene mai interrogato (`model_calls` è 0 per
 * costruzione), nessun valore dello stato deterministico ne dipende.
 *
 * La stima dei token è **deterministica** (byte UTF-8 / 4, arrotondata per
 * eccesso): è un'approssimazione stabile e ripetibile, non il conteggio del
 * tokenizer di un provider. Serve a confrontare prima/dopo, non a fatturare.
 */

/**
 * Contatori e latenze di una singola operazione di memoria JEV.
 *
 * Nei retrieval vale l'invariante `considered = selected + deferred + dropped`
 * (i non eleggibili sono pre-filtrati da `eligibleOnly`, quindi lì `dropped`
 * resta 0). Nel consolidamento vale `totale = considered + deferred + dropped`,
 * con `considered = selected` (le grezze della finestra pronta finiscono in
 * episodio).
 */
export interface JevTelemetry {
  /** Candidati letti prima di ogni selezione. */
  memoriesConsidered: number;
  /** Memorie effettivamente finite nel contesto. */
  memoriesSelected: number;
  /** Candidate eleggibili ma non selezionate (budget o pertinenza). */
  memoriesDeferred: number;
  /**
   * Candidate scartate perché non eleggibili. Nel retrieval gli store sono
   * letti con `eligibleOnly`, quindi i non eleggibili (futuro, archiviate,
   * superate) sono già esclusi a monte: qui `dropped` è 0 e la telemetria di
   * scarto vive nell'ingestion (`decision === 'DROP'`) e nel consolidamento
   * (questioni aperte non consolidate).
   */
  memoriesDropped: number;
  /** Token stimati della cronologia grezza disponibile per lo scope. */
  contextTokensBefore: number;
  /** Token stimati del contesto prodotto dopo la selezione JEV. */
  contextTokensAfter: number;
  /** after / before, arrotondato a 4 decimali; 0 se before è 0. */
  compressionRatio: number;
  /** Latenza della selezione/lettura, in millisecondi. */
  retrievalMs: number;
  /** Latenza del consolidamento, in millisecondi (0 nei retrieval). */
  consolidationMs: number;
  /** Invariante: nessun modello nel percorso di memoria. */
  model_calls: 0;
}

/** Byte UTF-8 → token stimati (deterministico, non un conteggio LLM). */
export function bytesToTokens(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.ceil(bytes / 4);
}

/** Token stimati di un testo (o buffer), in modo deterministico. */
export function estimateTokens(text: string | Buffer): number {
  return bytesToTokens(typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : text.byteLength);
}

/** Rapporto di compressione after/before, troncato a 4 decimali. */
export function compressionRatio(before: number, after: number): number {
  if (!Number.isFinite(before) || before <= 0) return 0;
  return Math.round((after / before) * 10000) / 10000;
}

export interface JevTelemetryParts {
  considered?: number;
  selected?: number;
  deferred?: number;
  dropped?: number;
  contextTokensBefore?: number;
  contextTokensAfter?: number;
  retrievalMs?: number;
  consolidationMs?: number;
}

/**
 * Costruisce la telemetria riempiendo i campi mancanti con 0 e calcolando il
 * rapporto di compressione. I conteggi negativi sono riportati a 0: la
 * telemetria non deve mai introdurre valori impossibili.
 */
export function buildJevTelemetry(parts: JevTelemetryParts = {}): JevTelemetry {
  const clamp = (value: number | undefined): number => (Number.isFinite(value) && value! > 0 ? Math.floor(value!) : 0);
  const before = clamp(parts.contextTokensBefore);
  const after = clamp(parts.contextTokensAfter);
  const latency = (value: number | undefined): number => (Number.isFinite(value) && value! >= 0 ? Math.round(value! * 1000) / 1000 : 0);
  return {
    memoriesConsidered: clamp(parts.considered),
    memoriesSelected: clamp(parts.selected),
    memoriesDeferred: clamp(parts.deferred),
    memoriesDropped: clamp(parts.dropped),
    contextTokensBefore: before,
    contextTokensAfter: after,
    compressionRatio: compressionRatio(before, after),
    retrievalMs: latency(parts.retrievalMs),
    consolidationMs: latency(parts.consolidationMs),
    model_calls: 0,
  };
}

/**
 * Somma più telemetrie (es. sezioni condivisa + percezione). È una funzione
 * pura a disposizione dei consumatori e dei test: W8 non apre un endpoint
 * `/memory/stats` (il router debug di W1 non esiste, quindi non si aggiunge
 * superficie nuova).
 */
export function sumJevTelemetry(...all: readonly JevTelemetry[]): JevTelemetry {
  const total = all.reduce<JevTelemetryParts>((acc, part) => ({
    considered: (acc.considered ?? 0) + part.memoriesConsidered,
    selected: (acc.selected ?? 0) + part.memoriesSelected,
    deferred: (acc.deferred ?? 0) + part.memoriesDeferred,
    dropped: (acc.dropped ?? 0) + part.memoriesDropped,
    contextTokensBefore: (acc.contextTokensBefore ?? 0) + part.contextTokensBefore,
    contextTokensAfter: (acc.contextTokensAfter ?? 0) + part.contextTokensAfter,
    retrievalMs: Math.max(acc.retrievalMs ?? 0, part.retrievalMs),
    consolidationMs: Math.max(acc.consolidationMs ?? 0, part.consolidationMs),
  }), {});
  return buildJevTelemetry(total);
}
