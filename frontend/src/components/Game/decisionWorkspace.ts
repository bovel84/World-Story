/**
 * WS-GOV-DIALOGUE-TO-ACT — Il Decision Workspace (difetto 2)
 * =========================================================
 * Il difetto osservato: si discute e si modifica verbalmente, ma la proposta
 * strutturata e l'atto restano quelli iniziali. Qui la conversazione diventa
 * **stato strutturato e revisionabile**: obiettivo, misure con la loro
 * provenienza, vincoli, rischi, domande aperte, revisioni. La **proposta
 * corrente** è il centro della tavola, e — quando concordata — è la sorgente
 * esatta dell'atto.
 *
 * Tre regole non negoziabili, le stesse del progetto:
 *  - il modello **non è un database**: ogni valore numerico entra solo se viene
 *    dal motore (`engine`), da una scelta esplicita del Presidente (`president`)
 *    o da una proposta del ministro etichettata come tale (`minister`, che resta
 *    `proposed` finché il Presidente non l’accetta). Altrimenti l’update è
 *    ignorato o resta `unresolved`;
 *  - ogni **modifica sostanziale** porta a `revision + 1`, con una piccola
 *    cronologia; un no-op **non** produce revisione;
 *  - il modulo è **puro**: nessun I/O, nessuno stato, nessuna chiamata.
 *
 * Il parser del blocco ```` ```decision ```` vive qui perché è lo stesso
 * contratto: valida alla lettera e scarta ciò che non è autorizzato, come fa
 * `parsePresentation` per la tela.
 */

export type DecisionWorkspaceStatus =
  | 'exploring' | 'shaping' | 'negotiating' | 'ready-for-act' | 'act-prepared';

export type DecisionMeasureStatus = 'proposed' | 'accepted' | 'rejected' | 'unresolved';

export type DecisionMeasureKind =
  | 'allocation' | 'priority' | 'target' | 'region' | 'work' | 'constraint' | 'other';

export type DecisionMeasureSource = 'engine' | 'president' | 'minister';

export const DECISION_MEASURE_KINDS: readonly DecisionMeasureKind[] = [
  'allocation', 'priority', 'target', 'region', 'work', 'constraint', 'other',
];

export const DECISION_OPS = [
  'set-objective', 'update-proposal', 'accept-proposal', 'resolve-question', 'reject-measure',
] as const;
export type DecisionOp = typeof DECISION_OPS[number];

export const MEASURE_STATUS_LABEL: Record<DecisionMeasureStatus, string> = {
  proposed: 'proposta',
  accepted: 'concordata',
  rejected: 'esclusa',
  unresolved: 'da definire',
};

export const MEASURE_SOURCE_LABEL: Record<DecisionMeasureSource, string> = {
  engine: 'dato del motore',
  president: 'scelta del Presidente',
  minister: 'proposta del ministro',
};

export const WORKSPACE_STATUS_LABEL: Record<DecisionWorkspaceStatus, string> = {
  exploring: 'in esplorazione',
  shaping: 'in costruzione',
  negotiating: 'in negoziazione',
  'ready-for-act': 'pronta per l’atto',
  'act-prepared': 'atto preparato',
};

/** Una misura della proposta: un valore con la sua provenienza. */
export interface DecisionMeasure {
  readonly id: string;
  readonly label: string;
  readonly kind: DecisionMeasureKind;
  readonly value?: string;
  readonly amount?: number;
  readonly unit?: string;
  readonly sharePct?: number;
  readonly status: DecisionMeasureStatus;
  readonly source: DecisionMeasureSource;
}

/** Una proposta negoziata: lo stato strutturato che la conversazione costruisce. */
export interface NegotiatedProposal {
  id: string;
  revision: number;
  objective: string | null;
  measures: DecisionMeasure[];
  constraints: string[];
  assumptions: string[];
  risks: string[];
  expectedEffects: string[];
  unresolvedQuestions: string[];
  sourceMessageIds: string[];
  status: 'draft' | 'negotiating' | 'agreed';
}

/** Una riga della cronologia delle revisioni. */
export interface RevisionEntry {
  readonly revision: number;
  readonly summary: string;
}

/** Lo stato della decisione in corso per una sedia: un read model, non gioco. */
export interface DecisionWorkspace {
  readonly seat: string;
  readonly status: DecisionWorkspaceStatus;
  readonly problem: string | null;
  readonly objective: string | null;
  readonly proposals: readonly NegotiatedProposal[];
  readonly activeProposalId: string | null;
  readonly evidenceIds: readonly string[];
  readonly revision: number;
  readonly history: readonly RevisionEntry[];
}

/** Il workspace vuoto di una sedia: nessuna decisione, revisione 0. */
export function emptyWorkspace(seat: string): DecisionWorkspace {
  return {
    seat,
    status: 'exploring',
    problem: null,
    objective: null,
    proposals: [],
    activeProposalId: null,
    evidenceIds: [],
    revision: 0,
    history: [],
  };
}

/** La proposta corrente, o `null` se non ne esiste ancora una. */
export function activeProposal(workspace: DecisionWorkspace): NegotiatedProposal | null {
  return workspace.proposals.find(proposal => proposal.id === workspace.activeProposalId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Azioni strutturate: ciò che il modello può chiedere alla tavola.
// ─────────────────────────────────────────────────────────────────────────────

export interface MeasureInput {
  readonly label: string;
  readonly kind?: DecisionMeasureKind;
  readonly value?: string;
  readonly unit?: string;
  readonly amount?: number;
  readonly sharePct?: number;
  readonly source: DecisionMeasureSource;
  readonly status?: DecisionMeasureStatus;
}

export interface UpdateProposalAction {
  readonly op: 'update-proposal';
  readonly proposalId?: string;
  readonly objective?: string;
  readonly changes?: readonly MeasureInput[];
  readonly constraints?: readonly string[];
  readonly assumptions?: readonly string[];
  readonly risks?: readonly string[];
  readonly expectedEffects?: readonly string[];
  readonly unresolvedQuestions?: readonly string[];
}

export interface SetObjectiveAction {
  readonly op: 'set-objective';
  readonly objective: string;
  readonly source: DecisionMeasureSource;
}

export interface AcceptProposalAction {
  readonly op: 'accept-proposal';
  readonly proposalId?: string;
}

export interface ResolveQuestionAction {
  readonly op: 'resolve-question';
  readonly question: string;
}

export interface RejectMeasureAction {
  readonly op: 'reject-measure';
  readonly label: string;
}

export type DecisionAction =
  | UpdateProposalAction
  | SetObjectiveAction
  | AcceptProposalAction
  | ResolveQuestionAction
  | RejectMeasureAction;

export interface DecisionMeta {
  /** L'identificatore stabile del messaggio: `<sedia>#<indice>`. */
  readonly messageId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser del blocco `decision`: validazione alla lettera.
// ─────────────────────────────────────────────────────────────────────────────

const SAFE_TEXT = /^[^<>\n]{1,240}$/;
const SOURCES: readonly DecisionMeasureSource[] = ['engine', 'president', 'minister'];
const MEASURE_STATUSES: readonly DecisionMeasureStatus[] = ['proposed', 'accepted', 'rejected', 'unresolved'];

function safeText(value: unknown, max = 240): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  if (!SAFE_TEXT.test(trimmed)) return null;
  return trimmed;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = safeText(entry);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Un cambio di misura: scartato se manca una provenienza valida o un numero sano. */
export function validateMeasureChange(raw: unknown): MeasureInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const label = safeText(candidate.label, 120);
  if (!label) return null;
  const source = typeof candidate.source === 'string' ? candidate.source.toLowerCase() : '';
  if (!(SOURCES as readonly string[]).includes(source)) return null;
  const kindRaw = typeof candidate.kind === 'string' ? candidate.kind.toLowerCase() : '';
  const kind = (DECISION_MEASURE_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as DecisionMeasureKind)
    : undefined;
  let sharePct: number | undefined;
  if (candidate.sharePct !== undefined) {
    const parsed = finiteNumber(candidate.sharePct);
    if (parsed === null || parsed < 0 || parsed > 100) return null;
    sharePct = parsed;
  }
  let amount: number | undefined;
  if (candidate.amount !== undefined) {
    const parsed = finiteNumber(candidate.amount);
    if (parsed === null) return null;
    amount = parsed;
  }
  const value = candidate.value === undefined ? undefined : safeText(candidate.value, 120);
  if (candidate.value !== undefined && value === null) return null;
  const unit = candidate.unit === undefined ? undefined : safeText(candidate.unit, 40);
  if (candidate.unit !== undefined && unit === null) return null;
  const statusRaw = typeof candidate.status === 'string' ? candidate.status.toLowerCase() : '';
  const status = (MEASURE_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as DecisionMeasureStatus)
    : undefined;
  return {
    label,
    ...(kind ? { kind } : {}),
    ...(value ? { value } : {}),
    ...(unit ? { unit } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(sharePct !== undefined ? { sharePct } : {}),
    ...(status ? { status } : {}),
    source: source as DecisionMeasureSource,
  };
}

/** Un blocco `decision` valido, o `null`. Campi extra ignorati, markup respinto. */
export function validateDecisionAction(raw: string): DecisionAction | null {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned) return null;
  if (/[<>]|javascript:|on\w+\s*=/i.test(cleaned)) return null;
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  let candidate: Record<string, unknown>;
  try {
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    candidate = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const op = typeof candidate.op === 'string' ? candidate.op.toLowerCase() : '';
  if (!(DECISION_OPS as readonly string[]).includes(op)) return null;

  if (op === 'set-objective') {
    const objective = safeText(candidate.objective);
    const source = typeof candidate.source === 'string' ? candidate.source.toLowerCase() : '';
    if (!objective || !(SOURCES as readonly string[]).includes(source)) return null;
    return { op: 'set-objective', objective, source: source as DecisionMeasureSource };
  }
  if (op === 'accept-proposal') {
    const proposalId = safeText(candidate.proposalId, 60);
    return { op: 'accept-proposal', ...(proposalId ? { proposalId } : {}) };
  }
  if (op === 'resolve-question') {
    const question = safeText(candidate.question);
    return question ? { op: 'resolve-question', question } : null;
  }
  if (op === 'reject-measure') {
    const label = safeText(candidate.label, 120);
    return label ? { op: 'reject-measure', label } : null;
  }
  // update-proposal
  const objective = safeText(candidate.objective);
  const changes = Array.isArray(candidate.changes)
    ? candidate.changes.map(validateMeasureChange).filter((change): change is MeasureInput => change !== null).slice(0, 12)
    : [];
  const action: UpdateProposalAction = {
    op: 'update-proposal',
    ...(objective ? { objective } : {}),
    ...(changes.length > 0 ? { changes } : {}),
    ...(stringList(candidate.constraints).length ? { constraints: stringList(candidate.constraints) } : {}),
    ...(stringList(candidate.assumptions).length ? { assumptions: stringList(candidate.assumptions) } : {}),
    ...(stringList(candidate.risks).length ? { risks: stringList(candidate.risks) } : {}),
    ...(stringList(candidate.expectedEffects).length ? { expectedEffects: stringList(candidate.expectedEffects) } : {}),
    ...(stringList(candidate.unresolvedQuestions).length ? { unresolvedQuestions: stringList(candidate.unresolvedQuestions) } : {}),
  };
  return (action.objective || action.changes || action.constraints || action.assumptions
    || action.risks || action.expectedEffects || action.unresolvedQuestions) ? action : null;
}

function decisionBlockPattern(): RegExp {
  return /```\s*decision\s*([\s\S]*?)```/gi;
}

/** Le azioni `decision` di una risposta: massimo otto, le ultime. */
export function parseDecisionActions(text: string): DecisionAction[] {
  if (!text) return [];
  const found: DecisionAction[] = [];
  for (const match of text.matchAll(decisionBlockPattern())) {
    const action = validateDecisionAction(match[1] ?? '');
    if (action) found.push(action);
  }
  return found.slice(-8);
}

/** Toglie i blocchi `decision` dal testo visibile (anche uno aperto in streaming). */
export function stripDecisionFences(text: string): string {
  if (!text) return text;
  let visible = text.replace(decisionBlockPattern(), '');
  const open = visible.search(/```\s*decision\b/i);
  if (open >= 0) visible = visible.slice(0, open);
  return visible;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutazioni pure
// ─────────────────────────────────────────────────────────────────────────────

function slug(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'misura';
}

function fingerprint(workspace: DecisionWorkspace): string {
  const proposal = activeProposal(workspace);
  return JSON.stringify({
    objective: workspace.objective,
    problem: workspace.problem,
    evidenceIds: workspace.evidenceIds,
    active: proposal ? {
      objective: proposal.objective,
      measures: proposal.measures,
      constraints: proposal.constraints,
      assumptions: proposal.assumptions,
      risks: proposal.risks,
      expectedEffects: proposal.expectedEffects,
      unresolvedQuestions: proposal.unresolvedQuestions,
    } : null,
  });
}

function measureFromInput(input: MeasureInput, existing?: DecisionMeasure): DecisionMeasure {
  return {
    id: existing?.id ?? slug(input.label),
    label: input.label,
    kind: input.kind ?? existing?.kind ?? 'other',
    ...(input.value !== undefined ? { value: input.value } : existing?.value !== undefined ? { value: existing.value } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : existing?.amount !== undefined ? { amount: existing.amount } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : existing?.unit !== undefined ? { unit: existing.unit } : {}),
    ...(input.sharePct !== undefined ? { sharePct: input.sharePct } : existing?.sharePct !== undefined ? { sharePct: existing.sharePct } : {}),
    status: input.status ?? (input.source === 'minister' ? 'proposed' : 'accepted'),
    source: input.source,
  };
}

function sameMeasure(a: DecisionMeasure, b: DecisionMeasure): boolean {
  return a.label === b.label && a.kind === b.kind && a.value === b.value && a.amount === b.amount
    && a.unit === b.unit && a.sharePct === b.sharePct && a.status === b.status && a.source === b.source;
}

function appendUnique(target: string[], values?: readonly string[]): boolean {
  let changed = false;
  for (const value of values ?? []) {
    if (!target.includes(value)) {
      target.push(value);
      changed = true;
    }
  }
  return changed;
}

/** Garantisce una proposta corrente **clonata**: le mutazioni restano pure. */
function ensureActive(workspace: DecisionWorkspace): { workspace: DecisionWorkspace; proposal: NegotiatedProposal } {
  const existing = activeProposal(workspace);
  if (existing) {
    const clone: NegotiatedProposal = {
      ...existing,
      measures: existing.measures.map(measure => ({ ...measure })),
      constraints: [...existing.constraints],
      assumptions: [...existing.assumptions],
      risks: [...existing.risks],
      expectedEffects: [...existing.expectedEffects],
      unresolvedQuestions: [...existing.unresolvedQuestions],
      sourceMessageIds: [...existing.sourceMessageIds],
    };
    return {
      workspace: { ...workspace, proposals: workspace.proposals.map(p => (p.id === clone.id ? clone : p)) },
      proposal: clone,
    };
  }
  const created: NegotiatedProposal = {
    id: `proposta-${workspace.proposals.length + 1}`,
    revision: workspace.revision,
    objective: workspace.objective,
    measures: [],
    constraints: [],
    assumptions: [],
    risks: [],
    expectedEffects: [],
    unresolvedQuestions: [],
    sourceMessageIds: [],
    status: 'draft',
  };
  return {
    workspace: { ...workspace, proposals: [...workspace.proposals, created], activeProposalId: created.id },
    proposal: created,
  };
}

function reduceAction(workspace: DecisionWorkspace, action: DecisionAction): DecisionWorkspace {
  if (action.op === 'set-objective') {
    if (workspace.objective === action.objective) return workspace;
    const { workspace: base, proposal } = ensureActive(workspace);
    proposal.objective = action.objective;
    return { ...base, objective: action.objective };
  }

  if (action.op === 'accept-proposal') {
    const { workspace: base, proposal } = ensureActive(workspace);
    let changed = false;
    proposal.measures = proposal.measures.map(measure => {
      if (measure.status === 'proposed') { changed = true; return { ...measure, status: 'accepted' }; }
      return measure;
    });
    if (proposal.unresolvedQuestions.length > 0) { proposal.unresolvedQuestions = []; changed = true; }
    return changed ? base : workspace;
  }

  if (action.op === 'resolve-question') {
    const { workspace: base, proposal } = ensureActive(workspace);
    const needle = action.question.toLowerCase();
    const next = proposal.unresolvedQuestions.filter(question => !question.toLowerCase().includes(needle));
    if (next.length === proposal.unresolvedQuestions.length) return workspace;
    proposal.unresolvedQuestions = next;
    return base;
  }

  if (action.op === 'reject-measure') {
    const { workspace: base, proposal } = ensureActive(workspace);
    const index = proposal.measures.findIndex(measure => measure.label.toLowerCase() === action.label.toLowerCase());
    if (index >= 0) {
      if (proposal.measures[index].status === 'rejected') return workspace;
      proposal.measures[index] = { ...proposal.measures[index], status: 'rejected' };
    } else {
      proposal.measures.push({ id: slug(action.label), label: action.label, kind: 'other', status: 'rejected', source: 'president' });
    }
    return base;
  }

  // update-proposal
  const { workspace: base, proposal } = ensureActive(workspace);
  let changed = false;
  if (action.objective !== undefined && action.objective !== base.objective) {
    proposal.objective = action.objective;
    changed = true;
  }
  if (action.changes) {
    for (const input of action.changes) {
      const index = proposal.measures.findIndex(measure => measure.label.toLowerCase() === input.label.toLowerCase());
      if (index >= 0) {
        const merged = measureFromInput(input, proposal.measures[index]);
        if (!sameMeasure(merged, proposal.measures[index])) { proposal.measures[index] = merged; changed = true; }
      } else {
        proposal.measures.push(measureFromInput(input));
        changed = true;
      }
    }
  }
  if (appendUnique(proposal.constraints, action.constraints)) changed = true;
  if (appendUnique(proposal.assumptions, action.assumptions)) changed = true;
  if (appendUnique(proposal.risks, action.risks)) changed = true;
  if (appendUnique(proposal.expectedEffects, action.expectedEffects)) changed = true;
  if (appendUnique(proposal.unresolvedQuestions, action.unresolvedQuestions)) changed = true;
  if (!changed) return workspace;
  return action.objective !== undefined && action.objective !== workspace.objective
    ? { ...base, objective: action.objective }
    : base;
}

function deriveProposalStatus(proposal: NegotiatedProposal): NegotiatedProposal['status'] {
  if (proposal.measures.length === 0 && !proposal.objective) return 'draft';
  const settled = proposal.measures.every(measure => measure.status === 'accepted' || measure.status === 'rejected');
  const hasAccepted = proposal.measures.some(measure => measure.status === 'accepted');
  if (settled && hasAccepted && proposal.unresolvedQuestions.length === 0) return 'agreed';
  return 'negotiating';
}

/** Il riassunto leggibile di una misura: «80% Infrastrutture». */
export function measureSummary(measure: DecisionMeasure): string {
  if (measure.status === 'rejected') return `${measure.label} (esclusa)`;
  if (measure.sharePct !== undefined) return `${measure.sharePct}% ${measure.label}`;
  if (measure.value !== undefined) return `${measure.label}: ${measure.value}${measure.unit ? ` ${measure.unit}` : ''}`;
  return measure.label;
}

/** Il riassunto della proposta corrente: le sue misure, in ordine. */
export function proposalSummary(proposal: NegotiatedProposal | null): string {
  if (!proposal) return '';
  return proposal.measures.map(measureSummary).join(' / ');
}

function revisionSummary(before: DecisionWorkspace, after: DecisionWorkspace): string {
  if (before.objective !== after.objective && after.objective) return `obiettivo: ${after.objective}`;
  const previous = activeProposal(before);
  const current = activeProposal(after);
  const added = (current?.measures ?? []).filter(measure => !(previous?.measures ?? []).some(old => old.id === measure.id));
  if (added.length > 0) return added.map(measureSummary).join(' / ').slice(0, 160);
  const changed = (current?.measures ?? []).filter(measure => {
    const old = (previous?.measures ?? []).find(candidate => candidate.id === measure.id);
    return old && !sameMeasure(old, measure);
  });
  if (changed.length > 0) return changed.map(measureSummary).join(' / ').slice(0, 160);
  return proposalSummary(current).slice(0, 160) || 'revisione';
}

function finalize(workspace: DecisionWorkspace, before: DecisionWorkspace, messageId: string): DecisionWorkspace {
  if (fingerprint(workspace) === fingerprint(before)) return before;
  const revision = before.revision + 1;
  const activeId = workspace.activeProposalId;
  const proposals = workspace.proposals.map(proposal => (proposal.id === activeId
    ? {
      ...proposal,
      revision,
      status: deriveProposalStatus(proposal),
      sourceMessageIds: proposal.sourceMessageIds.includes(messageId)
        ? proposal.sourceMessageIds
        : [...proposal.sourceMessageIds, messageId],
    }
    : proposal));
  const next: DecisionWorkspace = {
    ...workspace,
    proposals,
    revision,
    history: [...workspace.history, { revision, summary: revisionSummary(before, workspace) }],
  };
  return { ...next, status: deriveWorkspaceStatus(next) };
}

/**
 * Collega al workspace i **riferimenti** alle evidenze mostrate sulla tela
 * (`PresentationCanvas`). Non è una decisione: non apre una revisione e non
 * duplica il dato — la tela resta l'unica sorgente dell'evidenza.
 */
export function withEvidenceRefs(
  workspace: DecisionWorkspace,
  evidenceIds: readonly string[],
): DecisionWorkspace {
  const next = [...new Set(evidenceIds)];
  if (next.length === workspace.evidenceIds.length && next.every((id, index) => id === workspace.evidenceIds[index])) {
    return workspace;
  }
  return { ...workspace, evidenceIds: next };
}

/** Applica **una** azione: `revision + 1` solo se qualcosa è davvero cambiato. */
export function applyDecisionAction(
  workspace: DecisionWorkspace,
  action: DecisionAction,
  meta: DecisionMeta,
): DecisionWorkspace {
  return finalize(reduceAction(workspace, action), workspace, meta.messageId);
}

/** Applica un lotto di azioni come **una sola** revisione (una risposta = una revisione). */
export function applyDecisionBatch(
  workspace: DecisionWorkspace,
  actions: readonly DecisionAction[],
  meta: DecisionMeta,
): DecisionWorkspace {
  if (actions.length === 0) return workspace;
  const next = actions.reduce((acc, action) => reduceAction(acc, action), workspace);
  return finalize(next, workspace, meta.messageId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivazioni
// ─────────────────────────────────────────────────────────────────────────────

function deriveWorkspaceStatus(workspace: DecisionWorkspace): DecisionWorkspaceStatus {
  const proposal = activeProposal(workspace);
  if (!workspace.objective && !proposal) return 'exploring';
  if (proposal && proposal.measures.length > 0 && isReadyForAct(workspace)) return 'ready-for-act';
  if (proposal && (proposal.measures.some(measure => measure.status === 'proposed' || measure.status === 'unresolved')
    || proposal.unresolvedQuestions.length > 0)) return 'negotiating';
  if (proposal?.status === 'agreed') return 'ready-for-act';
  return 'shaping';
}

/**
 * La proposta è sufficientemente definita per l'atto? Serve almeno una misura
 * **accettata**, nessuna misura `unresolved` e nessuna domanda aperta. Una
 * proposta del ministro ancora `proposed` non basta.
 */
export function isReadyForAct(workspace: DecisionWorkspace): boolean {
  const proposal = activeProposal(workspace);
  if (!proposal) return false;
  if (proposal.measures.length === 0) return false;
  if (proposal.measures.some(measure => measure.status === 'unresolved')) return false;
  if (proposal.unresolvedQuestions.length > 0) return false;
  return proposal.measures.some(measure => measure.status === 'accepted');
}

/**
 * Lo stato **effettivo** della tavola, tenendo conto dell'atto preparato:
 * `act-prepared` solo quando l'atto poggia sulla revisione corrente.
 */
export function workspaceStatus(
  workspace: DecisionWorkspace,
  actRevision?: number | null,
): DecisionWorkspaceStatus {
  if (actRevision !== undefined && actRevision !== null && actRevision === workspace.revision) return 'act-prepared';
  return deriveWorkspaceStatus(workspace);
}

/**
 * L'atto preparato è più vecchio della proposta? `null` quando non c'è atto o
 * quando è allineato. Serve a PARTE J: mai mostrare la vecchia proposta come se
 * l'atto la rappresentasse.
 */
export function actStaleness(
  workspace: DecisionWorkspace,
  actRevision: number | null | undefined,
): { from: number; to: number } | null {
  if (actRevision === undefined || actRevision === null) return null;
  if (actRevision === workspace.revision) return null;
  return { from: actRevision, to: workspace.revision };
}
