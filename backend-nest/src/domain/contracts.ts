/**
 * Contratti runtime condivisi del dominio. I tipi TypeScript da soli non sono
 * una frontiera: provider LLM, JSON e storage legacy entrano come `unknown`.
 */

export class DomainContractError extends Error {
  constructor(message: string) {
    super(`domain_contract_error: ${message}`);
    this.name = 'DomainContractError';
  }
}

export type OutcomeStatus = 'accepted' | 'partial' | 'rejected';
export type RuntimeOrderIntent = { id: string; text: string };
export type RuntimeActionOutcome = {
  actionId?: string;
  action?: string;
  status: OutcomeStatus;
  summary: string;
  expectedDate?: string;
  eventHeadlines: string[];
  completesProjectId?: string;
};
export type RuntimeProjectReference = {
  id: string;
  sourceActionId: string;
  title: string;
  summary: string;
  startedDate: string;
  expectedDate?: string;
};
export type RuntimeEventProposal = {
  headline: string;
  description: string;
  date: string;
  mapChanges: unknown[];
};

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 10_000;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainContractError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID.test(value)) {
    throw new DomainContractError(`${label} must be a canonical ID`);
  }
  return value;
}

function text(value: unknown, label: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new DomainContractError(`${label} must be non-empty text`);
  }
  return value;
}

function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new DomainContractError(`${label} must be a UTC YYYY-MM-DD date`);
  }
  // Date.parse normalizza 1951-02-30; confrontare il round-trip UTC.
  if (new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new DomainContractError(`${label} is not a real calendar date`);
  }
  return value;
}

export function parseOrderIntent(value: unknown): RuntimeOrderIntent {
  const raw = record(value, 'order');
  return { id: id(raw.id, 'order.id'), text: text(raw.text, 'order.text') };
}

export function parseActionOutcome(
  value: unknown,
  options: { allowLegacyText?: boolean } = {},
): RuntimeActionOutcome {
  const raw = record(value, 'action outcome');
  const actionId = typeof raw.actionId === 'undefined' ? undefined : id(raw.actionId, 'actionOutcome.actionId');
  const action = typeof raw.action === 'undefined' ? undefined : text(raw.action, 'actionOutcome.action', 2_000);
  if (!actionId && !(options.allowLegacyText && action)) {
    throw new DomainContractError('actionOutcome.actionId is required');
  }
  if (raw.status !== 'accepted' && raw.status !== 'partial' && raw.status !== 'rejected') {
    throw new DomainContractError('actionOutcome.status is invalid');
  }
  const eventHeadlines = typeof raw.eventHeadlines === 'undefined'
    ? []
    : Array.isArray(raw.eventHeadlines) && raw.eventHeadlines.every(item => typeof item === 'string' && item.length <= 500)
      ? raw.eventHeadlines as string[]
      : (() => { throw new DomainContractError('actionOutcome.eventHeadlines is invalid'); })();
  return {
    actionId,
    action,
    status: raw.status,
    summary: text(raw.summary, 'actionOutcome.summary', 4_000),
    expectedDate: typeof raw.expectedDate === 'undefined' ? undefined : date(raw.expectedDate, 'actionOutcome.expectedDate'),
    eventHeadlines,
    completesProjectId: typeof raw.completesProjectId === 'undefined'
      ? undefined
      : id(raw.completesProjectId, 'actionOutcome.completesProjectId'),
  };
}

export function parseActionOutcomeBatch(value: unknown, knownActionIds: readonly string[]): RuntimeActionOutcome[] {
  if (!Array.isArray(value)) throw new DomainContractError('actionOutcomes must be an array');
  const known = new Set(knownActionIds);
  const seen = new Set<string>();
  return value.map(item => {
    const outcome = parseActionOutcome(item);
    if (!outcome.actionId || !known.has(outcome.actionId) || seen.has(outcome.actionId)) {
      throw new DomainContractError('actionOutcome.actionId is unknown or duplicated');
    }
    seen.add(outcome.actionId);
    return outcome;
  });
}

export function parseProjectReference(value: unknown): RuntimeProjectReference {
  const raw = record(value, 'project');
  return {
    id: id(raw.id, 'project.id'),
    sourceActionId: id(raw.sourceActionId, 'project.sourceActionId'),
    title: text(raw.title, 'project.title', 500),
    summary: text(raw.summary, 'project.summary', 4_000),
    startedDate: date(raw.startedDate, 'project.startedDate'),
    expectedDate: typeof raw.expectedDate === 'undefined' || raw.expectedDate === null
      ? undefined
      : date(raw.expectedDate, 'project.expectedDate'),
  };
}

export function parseEventProposal(value: unknown): RuntimeEventProposal {
  const raw = record(value, 'event proposal');
  if (!Array.isArray(raw.mapChanges)) throw new DomainContractError('event.mapChanges must be an array');
  return {
    headline: text(raw.headline, 'event.headline', 500),
    description: text(raw.description, 'event.description', 8_000),
    date: date(raw.date, 'event.date'),
    mapChanges: raw.mapChanges,
  };
}
