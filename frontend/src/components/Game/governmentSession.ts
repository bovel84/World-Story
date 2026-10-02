/**
 * WS-GOV-TURN-SESSIONS — La seduta del Governo appartiene al turno (A1–A3)
 * =======================================================================
 * Il difetto osservato: lo stato operativo della seduta era indicizzato per
 * **sedia** soltanto (`workspaces[tesoro]`, `canvases[lavori]`, la bozza…).
 * Avanzando il turno, la proposta, la tela e la bozza del turno precedente
 * restavano sul tavolo: si decideva il turno nuovo con i numeri del vecchio.
 *
 * Qui si introduce l'**identità della seduta**:
 *
 *   game + branch + turn + kind (+ seat)
 *
 * e la regola che ne discende: **il passato diventa memoria, non resta stato
 * operativo**. Al cambio di turno lo stato della seduta precedente si consolida
 * in ricordi narrativi (`MinisterMemory`) e la nuova seduta riparte da
 * `revision = 0`.
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata al modello.
 */
import { activeProposal, measureSummary, type DecisionWorkspace } from './decisionWorkspace';
import { openQuestion, queuedDecision, type MinisterMemoryRecord, type MinisterMemoryRef } from './ministerMemory';
import type { CabinetSeat } from './seatDecisionBoards';

/** L'identità di una seduta del Governo (A1). */
export interface GovernmentSessionKey {
  readonly gameId: string;
  readonly branchId: string | null;
  readonly turn: number;
  readonly kind: 'minister' | 'council';
  readonly seat?: CabinetSeat;
}

/**
 * L'identificatore stabile di una seduta. Il solo `seat` non basta: due turni
 * diversi sono due sedute diverse, anche per la stessa sedia.
 */
export function governmentSessionId(key: GovernmentSessionKey): string {
  return [key.gameId, key.branchId ?? 'main', key.turn, key.kind, key.seat ?? '-'].join('|');
}

/** La chiave dello stato di una sedia **dentro** una seduta. */
export function sessionSeatKey(sessionId: string, seat: CabinetSeat): string {
  return `${sessionId}::${seat}`;
}

/** La sedia di una chiave `sessionId::seat`, o `null`. */
export function seatFromSessionSeatKey(key: string): string | null {
  const index = key.lastIndexOf('::');
  return index >= 0 ? key.slice(index + 2) : null;
}

/** L'identità storica di un atto (A6): da quale seduta e revisione nasce. */
export interface SessionActIdentity {
  readonly sourceTurn: number;
  readonly sourceRevision: number;
  readonly sourceSeat: CabinetSeat;
  readonly sourceSessionId: string;
}

/** L'identità d'atto di una seduta: `sourceTurn` distingue Atto A da Atto B. */
export function actIdentity(
  sessionId: string,
  turn: number,
  seat: CabinetSeat,
  revision: number,
): SessionActIdentity {
  return { sourceTurn: turn, sourceRevision: revision, sourceSeat: seat, sourceSessionId: sessionId };
}

/**
 * Consolida la seduta precedente in memoria (A3): si estraggono **solo fatti
 * narrativamente utili**. Non si salva il workspace come stato attivo futuro.
 *
 *  - la decisione/proposta confermata → un ricordo `queued-decision`;
 *  - le questioni rimaste aperte → un ricordo `open-question`.
 */
export function consolidateSessionMemory(
  workspace: DecisionWorkspace,
  seat: CabinetSeat,
  ref: MinisterMemoryRef,
): MinisterMemoryRecord[] {
  const proposal = activeProposal(workspace);
  const records: MinisterMemoryRecord[] = [];
  const confirmed = proposal
    ? proposal.measures.filter(measure => measure.status !== 'rejected').map(measureSummary).join(' / ')
    : '';
  const summary = confirmed || workspace.objective || '';
  if (summary) records.push(queuedDecision(seat, summary, ref));
  const open = proposal?.unresolvedQuestions ?? [];
  if (open.length > 0) records.push(openQuestion(seat, open.join('; '), ref));
  return records;
}

/**
 * WS-GOV-COUNCIL-HARDENING — La provenienza temporale della seduta precedente.
 *
 * Il difetto osservato: al cambio `turno 5 → turno 6`, l'effetto di reset leggeva
 * `currentTurn`/`currentDate` **già aggiornati a 6**, e salvava la decisione del
 * turno 5 con il tempo del turno 6. La memoria perdeva la sua origine.
 *
 * Qui l'origine è esplicita: chi consolida porta con sé la seduta di partenza,
 * così i ricordi conservano il turno e la data in cui la decisione è nata.
 */
export interface PreviousGovernmentSessionRef {
  readonly sessionId: string;
  readonly turn: number;
  readonly date: string | null;
}

/** La provenienza (`gameDate`, `turn`) di una seduta: l'origine, non il tempo attuale. */
export function originMemoryRef(previous: PreviousGovernmentSessionRef): MinisterMemoryRef {
  return {
    gameDate: previous.date ?? '',
    ...(previous.turn != null ? { turn: previous.turn } : {}),
  };
}

/**
 * Consolida la seduta **precedente** in memoria, usando la sua origine reale.
 * È il pezzo puro che il cambio di turno invoca: i workspace vecchi diventano
 * ricordi con il turno e la data di origine, mai con quelli del turno nuovo.
 */
export function previousSessionMemory(input: {
  readonly previous: PreviousGovernmentSessionRef;
  readonly workspaces: Readonly<Record<string, DecisionWorkspace | null | undefined>>;
  readonly seatOf: (key: string) => CabinetSeat | null;
}): { readonly seat: CabinetSeat; readonly records: MinisterMemoryRecord[] }[] {
  const ref = originMemoryRef(input.previous);
  const consolidated: { seat: CabinetSeat; records: MinisterMemoryRecord[] }[] = [];
  for (const [key, workspace] of Object.entries(input.workspaces)) {
    if (!workspace) continue;
    const seat = input.seatOf(key);
    if (!seat) continue;
    consolidated.push({ seat, records: consolidateSessionMemory(workspace, seat, ref) });
  }
  return consolidated;
}

/**
 * Una seduta vuota è ripartita da zero? La verifica usata dall'E2E e dai test:
 * revisione 0 e nessuna proposta attiva.
 */
export function isFreshSession(workspace: DecisionWorkspace): boolean {
  return workspace.revision === 0 && workspace.proposals.length === 0;
}
