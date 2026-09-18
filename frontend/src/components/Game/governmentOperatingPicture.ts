/**
 * World Story — COUNTRY-CLARITY: scheda Governo e società
 * ======================================================
 * «Chi mi sostiene, chi è arrabbiato e perché, quali promesse sto mantenendo».
 * Il motore calcola fazioni, influenza, soddisfazione, memoria politica e
 * registro degli impegni: qui si mettono in fila per una lettura immediata,
 * senza aggiungere nessun giudizio che non derivi da quei numeri.
 */
import { formatPercent } from '../../utils/format';
import type { Commitment, GovernmentSnapshot, GovernmentFaction } from '../../services/api';
import { stanceTone } from './governmentDossier';
import { finiteOrNull, round1, type DomainDriver, type DomainStatus, type DriverTone } from './domainStatus';

export interface FactionView {
  id: string;
  name: string;
  interest: string;
  satisfaction: number;
  powerPct: number;
  stance: string;
  /** Che cosa chiede adesso, in una riga. */
  demand: string;
  /** Perché è insoddisfatta: rimproveri registrati dalla memoria politica. */
  grievance: string | null;
  /** Fiducia accumulata (memoria politica), `null` se non c'è memoria. */
  trust: number | null;
  tone: DriverTone;
}

export interface PromiseSummary {
  /** Impegni chiusi in positivo (mantenuti). */
  kept: number;
  /** Impegni traditi o scaduti senza esito. */
  broken: number;
  /** Impegni ancora aperti. */
  open: number;
  /** In scadenza entro 30 giorni (solo se la data è nota). */
  dueSoon: number;
  /** Elenco ridotto degli impegni che pesano di più. */
  highlights: Array<{ id: string; label: string; status: string; counterparty: string | null; deadline: string | null; importance: number }>;
}

export interface GovernmentPicture extends DomainStatus {
  cohesion: number | null;
  pressureIndex: number | null;
  trustIndex: number | null;
  stability: number | null;
  socialTension: number | null;
  dominant: FactionView | null;
  angriest: FactionView | null;
  supporting: FactionView[];
  unsatisfied: FactionView[];
  promises: PromiseSummary;
}

export interface GovernmentInput {
  government?: Partial<GovernmentSnapshot> | null;
  commitments?: { commitments: Commitment[]; attention: Commitment[] } | null;
  stability?: number | null;
  socialTension?: number | null;
  today?: string | null;
}

function daysUntil(today: string | null | undefined, deadline: string | null): number | null {
  if (!today || !deadline) return null;
  const from = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${deadline.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function factionView(faction: GovernmentFaction): FactionView {
  const memory = faction.politicalMemory;
  return {
    id: faction.id,
    name: faction.name,
    interest: faction.interest,
    satisfaction: round1(Number(faction.satisfaction) || 0),
    powerPct: round1(Number(faction.powerPct) || 0),
    stance: faction.stance,
    demand: faction.demand?.title || faction.demand?.detail || faction.interest,
    grievance: memory?.lastEvent?.text ?? null,
    trust: finiteOrNull(memory?.trust),
    tone: stanceTone(faction.stance) as DriverTone,
  };
}

/** Promesse/impegni: il registro del motore, contato per stato. */
export function promiseSummary(commitments: Commitment[] | undefined, today?: string | null): PromiseSummary {
  const list = commitments ?? [];
  const kept = list.filter(item => item.status === 'fulfilled').length;
  const broken = list.filter(item => item.status === 'broken').length;
  const open = list.filter(item => item.status === 'active').length;
  const dueSoon = list.filter(item => {
    if (item.status !== 'active') return false;
    const days = daysUntil(today, item.deadline);
    return days !== null && days <= 30;
  }).length;
  const highlights = [...list]
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, 3)
    .map(item => ({
      id: item.id,
      label: item.description,
      status: item.status,
      counterparty: item.counterparty,
      deadline: item.deadline,
      importance: item.importance,
    }));
  return { kept, broken, open, dueSoon, highlights };
}

export function governmentOperatingPicture(input: GovernmentInput): GovernmentPicture {
  const government = input.government ?? null;
  const factions = (government?.factions ?? []).map(factionView);
  const cohesion = finiteOrNull(government?.cohesion);
  const pressureIndex = finiteOrNull(government?.pressureIndex);
  const trustIndex = finiteOrNull(government?.trustIndex);
  const stability = finiteOrNull(input.stability);
  const socialTension = finiteOrNull(input.socialTension);
  const promises = promiseSummary(input.commitments?.commitments, input.today);

  const dominant = factions.find(faction => faction.id === government?.dominantId)
    ?? [...factions].sort((a, b) => b.powerPct - a.powerPct)[0]
    ?? null;
  const angriest = factions.find(faction => faction.id === government?.angriestId)
    ?? [...factions].sort((a, b) => a.satisfaction - b.satisfaction)[0]
    ?? null;

  const supporting = factions.filter(faction => faction.satisfaction >= 62).sort((a, b) => b.satisfaction - a.satisfaction);
  const unsatisfied = factions.filter(faction => faction.satisfaction < 45).sort((a, b) => a.satisfaction - b.satisfaction);

  const drivers: DomainDriver[] = [];
  if (factions.length === 0) {
    drivers.push({ tone: 'neutral', label: 'Fazioni non pubblicate', detail: 'Questo scenario non espone le anime del governo.' });
  }
  if (dominant) {
    drivers.push({
      tone: dominant.satisfaction >= 62 ? 'positive' : dominant.satisfaction < 45 ? 'critical' : 'neutral',
      label: `${dominant.name}: ${formatPercent(dominant.satisfaction, 0)} di soddisfazione`,
      detail: `Fazione più influente (${formatPercent(dominant.powerPct, 0)} del consiglio). Chiede: ${dominant.demand}.`,
    });
  }
  if (angriest && angriest.satisfaction < 62) {
    drivers.push({
      tone: angriest.satisfaction < 30 ? 'critical' : 'warning',
      label: `${angriest.name} è insoddisfatta (${formatPercent(angriest.satisfaction, 0)})`,
      detail: angriest.grievance ? `Motivo registrato: ${angriest.grievance}` : `Chiede: ${angriest.demand}.`,
    });
  }
  if (supporting.length > 0) {
    drivers.push({
      tone: 'positive',
      label: `${supporting.length} ${supporting.length === 1 ? 'fazione sostiene' : 'fazioni sostengono'} il governo`,
      detail: supporting.map(faction => `${faction.name} ${formatPercent(faction.satisfaction, 0)}`).join(' · ') + '.',
    });
  }
  if (socialTension !== null) {
    drivers.push({
      tone: socialTension >= 55 ? 'critical' : socialTension >= 35 ? 'warning' : 'positive',
      label: `Tensione sociale ${formatPercent(socialTension, 0)}`,
      detail: socialTension >= 55 ? 'La piazza pesa sulla tenuta del governo.' : 'Pressione interna sotto controllo.',
    });
  }
  if (stability !== null) {
    drivers.push({
      tone: stability >= 55 ? 'positive' : stability >= 40 ? 'warning' : 'critical',
      label: `Stabilità ${formatPercent(stability, 0)}`,
      detail: 'Consenso e tenuta istituzionale.',
    });
  }
  if (cohesion !== null) {
    drivers.push({
      tone: cohesion >= 60 ? 'positive' : cohesion >= 45 ? 'neutral' : 'warning',
      label: `Coesione del consiglio ${formatPercent(cohesion, 0)}`,
      detail: trustIndex !== null ? `Fiducia media verso il governo ${formatPercent(trustIndex, 0)}.` : undefined,
    });
  }
  if (promises.kept + promises.broken + promises.open > 0) {
    drivers.push({
      tone: promises.broken > promises.kept ? 'warning' : 'neutral',
      label: `${promises.kept} promesse mantenute · ${promises.open} aperte${promises.broken > 0 ? ` · ${promises.broken} tradite` : ''}`,
      detail: promises.dueSoon > 0 ? `${promises.dueSoon} in scadenza entro 30 giorni.` : 'Nessuna scadenza imminente.',
    });
  }

  let status: GovernmentPicture['status'] = 'stable';
  const strain = Math.max(...[socialTension, pressureIndex].filter((value): value is number => value !== null), 0);
  if (strain >= 70) status = 'critical';
  else if (strain >= 55) status = 'fragile';
  else if (strain >= 35) status = 'pressure';
  else if (cohesion !== null && cohesion >= 60 && stability !== null && stability >= 55) status = 'healthy';
  if (unsatisfied.length >= Math.max(2, factions.length - 1)) status = status === 'critical' ? status : 'fragile';
  if (promises.broken > promises.kept + 1) status = status === 'critical' ? status : 'fragile';

  const headline = factions.length === 0
    ? 'Il governo non pubblica le sue fazioni per questa partita.'
    : pressureIndex !== null
      ? `Pressione politica al ${formatPercent(pressureIndex, 0)}: ${supporting.length} fazioni sostengono, ${unsatisfied.length} premono.`
      : `${supporting.length} fazioni sostengono il governo, ${unsatisfied.length} sono insoddisfatte.`;

  return {
    status,
    headline,
    drivers,
    cohesion,
    pressureIndex,
    trustIndex,
    stability,
    socialTension,
    dominant,
    angriest,
    supporting,
    unsatisfied,
    promises,
  };
}
