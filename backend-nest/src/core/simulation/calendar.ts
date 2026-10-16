/** One UTC calendar for live ticks, explicit jumps and interrupted turns. */
export const MAX_JUMP_DAYS = 36_500;
const DAY_MS = 86_400_000;
const MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function timestamp(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const value = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : NaN;
}

export function jumpHorizon(days: number): number {
  if (!Number.isFinite(days) || !Number.isInteger(days) || days > MAX_JUMP_DAYS) {
    throw new Error(`Invalid time jump: expected integer days up to ${MAX_JUMP_DAYS}`);
  }
  return days <= 0 ? 365 : days;
}

/**
 * The automatic action is a search for the next meaningful development, not
 * permission to write a full year of history in one turn.
 * Active domestic pressures narrow the window; explicit jumps are untouched.
 * This is a time horizon, NEVER a cap on the number of valid world events.
 */
export function adaptiveAutoHorizon(input: {
  currentDate: string;
  hasOrders: boolean;
  crisisLevel?: 'calm' | 'watch' | 'critical' | null;
  pressures?: readonly { severity: number; deadlineDate?: string | null }[];
}): number {
  const pending = input.pressures || [];
  const high = input.crisisLevel === 'critical' || pending.some(p => Number(p.severity) >= 3);
  const elevated = input.crisisLevel === 'watch' || pending.some(p => Number(p.severity) >= 2);
  const base = high ? 14 : elevated ? 30 : input.hasOrders ? 90 : 60;
  const upcoming = pending
    .map(p => p.deadlineDate ? daysBetween(input.currentDate, p.deadlineDate) : 0)
    .filter(days => days > 0);
  return upcoming.length ? Math.max(1, Math.min(base, ...upcoming)) : base;
}

/** Strictly positive, bounded period for explicit calendar advancement. */
export function explicitDays(days: number): number {
  if (!Number.isInteger(days) || days <= 0 || days > MAX_JUMP_DAYS) {
    throw new Error(`Invalid explicit period: expected integer days in [1, ${MAX_JUMP_DAYS}]`);
  }
  return days;
}

export function addDays(date: string, days: number): string {
  const start = timestamp(date);
  if (!Number.isFinite(start) || !Number.isInteger(days)) throw new Error('Invalid game date');
  const result = new Date(start + days * DAY_MS).toISOString().slice(0, 10);
  if (!Number.isFinite(timestamp(result))) throw new Error('Game date outside supported calendar');
  return result;
}

export function dateInPeriod(date: unknown, start: string, end: string): date is string {
  return typeof date === 'string' && Number.isFinite(timestamp(date)) && date >= start && date <= end;
}

/**
 * Giorni di calendario fra due date di gioco (`to - from`).
 *
 * GAMEPLAY-LONG: è la misura con cui il motore fa progredire crisi e pressioni
 * — un salto di 7 giorni e uno di 365 non possono pesare uguale. Restituisce 0
 * quando una delle due date non è valida o quando l'ordine è invertito, così
 * nessun consumatore può accumulare tempo che non è stato simulato.
 */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number {
  const start = timestamp(String(from || ''));
  const end = timestamp(String(to || ''));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const days = Math.round((end - start) / DAY_MS);
  return days > 0 ? days : 0;
}

/** Grammatical Italian date ("12 gennaio 1951"), independent of host timezone. */
export function formatItalianDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS_IT[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : date;
}

export function resolvePeriod(input: {
  start: string; days: number; auto: boolean; interrupted: boolean;
  target?: string; eventDates: string[];
}): { end: string; elapsedDays: number } {
  const horizon = addDays(input.start, jumpHorizon(input.days));
  const dates = input.eventDates.filter(date => dateInPeriod(date, input.start, horizon)).sort();
  const last = dates.at(-1);
  // Never simulate unseen time after Intervene. In auto-jump the accepted
  // events (one per queued order) are the hard stop; an LLM-provided
  // targetDate must never move the clock beyond the last accepted event.
  const end = input.interrupted ? last || input.start
    : input.auto ? last || input.start
    : horizon;
  return { end, elapsedDays: (timestamp(end) - timestamp(input.start)) / DAY_MS };
}
