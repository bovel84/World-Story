/**
 * World Story — Agenda strategica degli NPC (motore)
 * ==================================================
 * `NPC_STRATEGIC_PROFILES` dice **chi è** una polity (personalità, dottrina,
 * linee rosse) e `currentStrategicPriorities` dice **cosa guarda adesso**. Manca
 * la continuità: senza agenda ogni chiamata LLM ripartiva da zero e la stessa
 * nazione sembrava cambiare strategia a ogni turno.
 *
 * Qui gli obiettivi sono **derivati dallo stato** (relazioni, economia, forze,
 * minacce, memoria recente) e poi **mantenuti dal motore**: un obiettivo dura
 * più turni, ha una data di revisione, un progresso misurabile con gli
 * indicatori già pubblicati e un motivo leggibile. Il modello può raccontarlo e
 * aggiornarlo, ma non può inventarlo né cancellarlo: l'autorità resta qui.
 *
 * Nessun numero nuovo, nessuna simulazione parallela: si leggono gli stessi
 * indicatori del turno.
 */

export type NpcObjectiveType =
  | 'contain-hostile'      // contenere l'ostilità di una polity
  | 'preserve-alliance'    // preservare un'alleanza registrata
  | 'trade-access'         // ottenere accesso commerciale
  | 'build-capability'     // aumentare la capacità militare
  | 'stabilize-economy'    // stabilizzare l'economia
  | 'reduce-dependency'    // ridurre la dipendenza strategica
  | 'isolate-rival';       // isolare diplomaticamente un rivale

export type NpcObjectiveStatus = 'active' | 'achieved' | 'abandoned' | 'superseded';
export type NpcObjectiveMeasure = 'hostile-actors' | 'alliance' | 'balance' | 'military' | 'events';

export interface NpcObjective {
  /** Identità stabile dell'obiettivo: sopravvive alle revisioni. */
  id: string;
  polityId: string;
  type: NpcObjectiveType;
  targetPolityId: string | null;
  targetRegionId: string | null;
  description: string;
  /** 1 = di contorno, 2 = rilevante, 3 = decisivo. */
  priority: number;
  status: NpcObjectiveStatus;
  progress: number;
  measure: NpcObjectiveMeasure;
  /** Valore misurato al momento della nascita: serve al progresso. */
  baseline: number | null;
  /** Perché esiste, con i numeri che l'hanno giustificato. */
  reason: string;
  createdDate: string;
  createdTurn: number;
  /** Prima data in cui il motore può rivederlo o abbandonarlo. */
  reviewDate: string;
  /** Data dell'ultima revisione registrata. */
  reviewedDate: string;
  reviewedTurn: number;
}

/** Stato del mondo visto da una polity non giocante. */
export interface NpcAgendaContext {
  relationshipToPlayer?: string;
  hostileNeighbours?: number;
  hostileActors?: number;
  alliedActors?: number;
  militaryPower?: number;
  playerMilitaryPower?: number;
  monthlyBalance?: number;
  stability?: number;
  socialTension?: number;
  warEffort?: number;
  /** Polity più ostile registrata (bersaglio di contenimento/isolamento). */
  hostileTarget?: string | null;
  /** Alleato più solido registrato (bersaglio di alleanza/commercio). */
  allyTarget?: string | null;
  /** Nome pubblico del bersaglio ostile, per il racconto. */
  hostileTargetName?: string | null;
  /** Nome pubblico dell'alleato, per il racconto. */
  allyTargetName?: string | null;
  /**
   * Quante volte la partita recente ha toccato ogni bersaglio, per polity
   * bersaglio: è l'evidenza degli obiettivi che si vedono solo in cronaca.
   */
  targetEvidence?: Record<string, number>;
  /** Evidenza per gli obiettivi senza bersaglio esterno (dipendenze, economia). */
  selfEvidence?: number;
}

export interface NpcAgendaProfile {
  personality?: string;
  economicFocus?: number;
  sovereigntySensitivity?: number;
}

/** Massimo di obiettivi attivi per polity: una strategia, non un elenco. */
export const AGENDA_MAX_OBJECTIVES = 3;
/** Un obiettivo non viene abbandonato prima di questa finestra. */
export const AGENDA_REVIEW_DAYS = 120;
/** Crescita di progresso che vale una nuova revisione registrata. */
export const AGENDA_PROGRESS_STEP = 10;

export const OBJECTIVE_LABEL: Record<NpcObjectiveType, string> = {
  'contain-hostile': 'contenere l’ostilità',
  'preserve-alliance': 'preservare l’alleanza',
  'trade-access': 'ottenere accesso commerciale',
  'build-capability': 'rafforzare la capacità militare',
  'stabilize-economy': 'stabilizzare l’economia',
  'reduce-dependency': 'ridurre la dipendenza strategica',
  'isolate-rival': 'isolare il rivale',
};

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round0 = (value: number): number => Math.round(value);
const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Giorni fra due date ISO: 0 se la seconda precede o non è leggibile. */
export function agendaDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function addDaysIso(date: string, days: number): string {
  const base = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(base)) return String(date).slice(0, 10);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** Chiave stabile di un obiettivo: polity + tipo + bersaglio + turno di nascita. */
export function objectiveKey(input: {
  polityId: string; type: NpcObjectiveType; targetPolityId?: string | null; createdTurn: number;
}): string {
  return `${input.polityId}:${input.type}:${input.targetPolityId ?? '-'}:${input.createdTurn}`;
}

interface ObjectiveSeed {
  type: NpcObjectiveType;
  targetPolityId?: string | null;
  priority: number;
  description: string;
  measure: NpcObjectiveMeasure;
  baseline: number | null;
  reason: string;
}

/**
 * Che cosa sta inseguendo questa polity **adesso**, secondo lo stato del mondo.
 * Ordine deterministico: prima le questioni decisive, poi le rilevanti.
 */
export function deriveObjectiveSeeds(
  profile: NpcAgendaProfile | null | undefined,
  context: NpcAgendaContext,
): ObjectiveSeed[] {
  const seeds: ObjectiveSeed[] = [];
  const hostile = num(context.hostileActors);
  const hostileNeighbours = num(context.hostileNeighbours);
  const allies = num(context.alliedActors);
  const balance = num(context.monthlyBalance);
  const stability = num(context.stability);
  const military = num(context.militaryPower);
  const playerMilitary = num(context.playerMilitaryPower);
  const warEffort = num(context.warEffort);
  const hostileName = context.hostileTargetName || context.hostileTarget || 'la polity ostile';
  const allyName = context.allyTargetName || context.allyTarget || 'l’alleato';

  if (hostile > 0) {
    seeds.push({
      type: 'contain-hostile',
      targetPolityId: context.hostileTarget ?? null,
      priority: hostileNeighbours > 0 ? 3 : 2,
      description: `Contenere l’ostilità di ${hostileName} senza aprire un conflitto gratuito.`,
      measure: 'hostile-actors',
      baseline: hostile,
      reason: `${hostile} relazioni ostili registrate (${hostileNeighbours} sulla frontiera).`,
    });
  }
  if (allies > 0) {
    seeds.push({
      type: 'preserve-alliance',
      targetPolityId: context.allyTarget ?? null,
      priority: context.relationshipToPlayer === 'hostile' ? 2 : 3,
      description: `Preservare l’intesa con ${allyName} chiedendo reciprocità.`,
      measure: 'alliance',
      baseline: allies,
      reason: `${allies} alleanze registrate.`,
    });
  }
  if (balance < 0 || stability < 45) {
    seeds.push({
      type: 'stabilize-economy',
      priority: balance < -1 || stability < 35 ? 3 : 2,
      description: 'Rimettere in ordine i conti prima di nuovi impegni costosi.',
      measure: 'balance',
      baseline: balance,
      reason: `saldo mensile ${round0(balance * 10) / 10} mld, stabilità ${round0(stability)}/100.`,
    });
  }
  if ((playerMilitary > 0 && military < playerMilitary * 0.8 && context.relationshipToPlayer === 'hostile') || warEffort >= 60) {
    seeds.push({
      type: 'build-capability',
      priority: warEffort >= 60 ? 3 : 2,
      description: 'Aumentare la capacità militare per non restare scoperti.',
      measure: 'military',
      baseline: military,
      reason: `forza ${round0(military)} contro ${round0(playerMilitary)}${warEffort >= 60 ? `, sforzo bellico ${round0(warEffort)}/100` : ''}.`,
    });
  }
  if (num(profile?.economicFocus) >= 65 && allies >= 1) {
    seeds.push({
      type: 'trade-access',
      targetPolityId: context.allyTarget ?? null,
      priority: 2,
      description: `Ottenere accesso commerciale attraverso ${allyName}.`,
      measure: 'events',
      baseline: 0,
      reason: `focus economico ${round0(num(profile?.economicFocus))}/100 con ${allies} alleanze disponibili.`,
    });
  }
  if (num(profile?.sovereigntySensitivity) >= 80 || profile?.personality === 'isolationist') {
    seeds.push({
      type: 'reduce-dependency',
      priority: 2,
      description: 'Ridurre la dipendenza strategica dall’esterno.',
      measure: 'events',
      baseline: 0,
      reason: `sensibilità alla sovranità ${round0(num(profile?.sovereigntySensitivity))}/100.`,
    });
  }
  if (hostile >= 2) {
    seeds.push({
      type: 'isolate-rival',
      targetPolityId: context.hostileTarget ?? null,
      priority: 1,
      description: `Isolare diplomaticamente ${hostileName}.`,
      measure: 'events',
      baseline: 0,
      reason: `${hostile} attori ostili: conviene dividerli.`,
    });
  }
  return seeds
    .filter(seed => seed.priority >= 1)
    .sort((a, b) => b.priority - a.priority || a.type.localeCompare(b.type));
}

/**
 * Progresso misurato con gli indicatori correnti. Non è una previsione: è la
 * distanza fra il valore di nascita e quello di oggi (o l'evidenza registrata
 * in partita per gli obiettivi che si vedono solo in cronaca).
 */
/** Evidenza pertinente a un obiettivo: cronaca recente sul bersaglio, o interna. */
export function evidenceFor(
  objective: Pick<NpcObjective, 'targetPolityId'>,
  context: NpcAgendaContext,
): number {
  return objective.targetPolityId
    ? num(context.targetEvidence?.[objective.targetPolityId])
    : num(context.selfEvidence);
}

export function objectiveProgress(objective: Pick<NpcObjective, 'measure' | 'baseline' | 'type' | 'targetPolityId'>,
  context: NpcAgendaContext): number {
  switch (objective.measure) {
    case 'hostile-actors':
      return clamp(round0(100 - 25 * num(context.hostileActors)));
    case 'alliance':
      return clamp(round0(30 + 15 * num(context.alliedActors)));
    case 'balance': {
      const baseline = objective.baseline ?? 0;
      return clamp(round0(50 + (num(context.monthlyBalance) - baseline) * 25));
    }
    case 'military': {
      const baseline = Math.max(1, objective.baseline ?? 1);
      return clamp(round0(50 + ((num(context.militaryPower) - baseline) / baseline) * 100));
    }
    case 'events':
    default:
      return clamp(round0(20 + 20 * evidenceFor(objective, context)));
  }
}

/**
 * L'obiettivo è raggiunto? Solo con una condizione verificabile sullo stato, non
 * con un'impressione del modello.
 */
export function objectiveAchieved(objective: Pick<NpcObjective, 'type' | 'measure' | 'baseline' | 'targetPolityId'>, context: NpcAgendaContext): boolean {
  switch (objective.type) {
    case 'contain-hostile':
      return num(context.hostileActors) === 0;
    case 'stabilize-economy':
      return num(context.monthlyBalance) >= 0 && num(context.stability) >= 50;
    case 'build-capability':
      return num(context.militaryPower) >= Math.max(1, objective.baseline ?? 1) * 1.25;
    case 'trade-access':
    case 'reduce-dependency':
    case 'isolate-rival':
      // Obiettivi che si vedono solo in cronaca: bastano mosse coerenti registrate.
      return evidenceFor(objective, context) >= 4;
    case 'preserve-alliance':
    default:
      return false;
  }
}

/** Prima revisione possibile: prima di allora l'obiettivo non si abbandona. */
export function agendaReviewDate(createdDate: string): string {
  return addDaysIso(createdDate, AGENDA_REVIEW_DAYS);
}

/** Il tipo è ancora giustificato dallo stato attuale? */
function seedStillSupported(type: NpcObjectiveType, seeds: readonly ObjectiveSeed[]): boolean {
  return seeds.some(seed => seed.type === type);
}

export interface AgendaReview {
  /** Obiettivi attivi dopo la revisione (solo quelli che vivono). */
  active: NpcObjective[];
  /** Nuovi obiettivi aperti in questa revisione. */
  opened: NpcObjective[];
  /** Obiettivi chiusi (raggiunti o abbandonati). */
  closed: NpcObjective[];
  /** Vero se qualcosa è cambiato: solo allora vale la pena scrivere. */
  changed: boolean;
}

function materializeObjective(
  seed: ObjectiveSeed,
  input: { polityId: string; date: string; turn: number; context: NpcAgendaContext },
): NpcObjective {
  const key = objectiveKey({ polityId: input.polityId, type: seed.type, targetPolityId: seed.targetPolityId, createdTurn: input.turn });
  const base: NpcObjective = {
    id: key,
    polityId: input.polityId,
    type: seed.type,
    targetPolityId: seed.targetPolityId ?? null,
    targetRegionId: null,
    description: seed.description,
    priority: seed.priority,
    status: 'active',
    progress: 0,
    measure: seed.measure,
    baseline: seed.baseline,
    reason: seed.reason,
    createdDate: input.date,
    createdTurn: input.turn,
    reviewDate: agendaReviewDate(input.date),
    reviewedDate: input.date,
    reviewedTurn: input.turn,
  };
  return { ...base, progress: objectiveProgress(base, input.context) };
}

/**
 * Revisione dell'agenda: mantiene gli obiettivi finché hanno senso, ne apre di
 * nuovi solo se c'è spazio (o se uno è decisivo e il più vecchio ha già avuto la
 * sua finestra) e li chiude quando sono raggiunti o quando la situazione è
 * cambiata da almeno una finestra di revisione.
 */
export function reviewAgenda(
  active: readonly NpcObjective[],
  seeds: readonly ObjectiveSeed[],
  context: NpcAgendaContext,
  input: { polityId: string; date: string; turn: number },
): AgendaReview {
  const kept: NpcObjective[] = [];
  const closed: NpcObjective[] = [];
  const opened: NpcObjective[] = [];
  let changed = false;
  const current = active.filter(objective => objective.polityId === input.polityId && objective.status === 'active');

  for (const objective of current) {
    const support = seeds.find(seed => seed.type === objective.type);
    const progress = objectiveProgress(objective, context);
    if (objectiveAchieved(objective, context)) {
      closed.push({ ...objective, progress: 100, status: 'achieved', reviewedDate: input.date, reviewedTurn: input.turn });
      changed = true;
      continue;
    }
    const pastReview = agendaDaysBetween(objective.createdDate, input.date) >= AGENDA_REVIEW_DAYS;
    if (!support && pastReview) {
      closed.push({ ...objective, status: 'abandoned', reviewedDate: input.date, reviewedTurn: input.turn });
      changed = true;
      continue;
    }
    // La descrizione e il motivo seguono lo stato: la strategia resta, il
    // contesto si aggiorna. Si scrive solo se è cambiato qualcosa di visibile.
    const next: NpcObjective = {
      ...objective,
      description: support?.description ?? objective.description,
      priority: support?.priority ?? objective.priority,
      progress,
      reason: support?.reason ?? objective.reason,
      reviewedDate: input.date,
      reviewedTurn: input.turn,
    };
    const visibleChange = Math.abs(progress - objective.progress) >= AGENDA_PROGRESS_STEP
      || next.priority !== objective.priority
      || next.description !== objective.description;
    if (visibleChange) changed = true;
    kept.push(visibleChange ? next : objective);
  }

  const openTypes = new Set(kept.map(objective => objective.type));
  const candidates = seeds.filter(seed => !openTypes.has(seed.type));
  for (const seed of candidates) {
    const urgent = seed.priority >= 3;
    if (kept.length >= AGENDA_MAX_OBJECTIVES) {
      if (!urgent) break;
      // Un obiettivo decisivo può sostituire il più debole, ma solo se quello
      // ha già avuto la sua finestra di revisione: niente colpi di testa.
      const replaceable = kept
        .filter(objective => agendaDaysBetween(objective.createdDate, input.date) >= AGENDA_REVIEW_DAYS)
        .sort((a, b) => a.priority - b.priority || a.createdTurn - b.createdTurn)[0];
      if (!replaceable) break;
      kept.splice(kept.indexOf(replaceable), 1);
      closed.push({ ...replaceable, status: 'superseded', reviewedDate: input.date, reviewedTurn: input.turn });
      changed = true;
    }
    const objective = materializeObjective(seed, { ...input, context });
    opened.push(objective);
    kept.push(objective);
    changed = true;
  }

  return { active: kept, opened, closed, changed };
}

/** Riga leggibile per prompt e UI: identità, priorità, età, progresso, motivo. */
export function describeObjective(objective: NpcObjective): string {
  const target = objective.targetPolityId ? ` → ${objective.targetPolityId}` : '';
  const age = `${objective.createdDate}${objective.reviewDate !== objective.createdDate ? `, revisione ${objective.reviewDate}` : ''}`;
  return `${objective.description}${target} [${objective.id}] · priorità ${objective.priority}/3 · dal ${age} · progresso ${round0(objective.progress)}% · motivo: ${objective.reason}`;
}

/** Blocco pronto per il dossier NPC: strategia, non elenco di intenzioni. */
export function describeAgenda(objectives: readonly NpcObjective[] | null | undefined): string {
  const active = (objectives ?? []).filter(objective => objective.status === 'active');
  if (active.length === 0) return 'nessun obiettivo attivo registrato: non inventarne uno';
  return [...active]
    .sort((a, b) => b.priority - a.priority || a.createdTurn - b.createdTurn || a.type.localeCompare(b.type))
    .map(objective => describeObjective(objective))
    .join(' | ');
}
