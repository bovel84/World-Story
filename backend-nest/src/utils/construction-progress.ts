/** Qualitative construction reports, not economic effects or invented percentages. */
const PHASES = new Set(['preparation', 'foundations', 'structure', 'installation', 'testing']);

export function constructionProgressPatch(value: unknown): Record<string, string | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const patch: Record<string, string | null> = {};
  if (typeof raw.phase === 'string' && PHASES.has(raw.phase)) patch.phase = raw.phase;
  if (raw.status === 'under_construction' || raw.status === 'paused') patch.status = raw.status;
  for (const key of ['nextStep', 'blocker']) {
    if (typeof raw[key] === 'string') patch[key] = raw[key].trim().slice(0, 280);
  }
  if (raw.expectedDate === null) patch.expectedDate = null;
  else if (typeof raw.expectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.expectedDate)) {
    const date = new Date(`${raw.expectedDate}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw.expectedDate) patch.expectedDate = raw.expectedDate;
  }
  return patch;
}
