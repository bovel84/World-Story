/**
 * WS-GAME-OPENING — Il read model puro dell'apertura
 * ==================================================
 * Proiezione **di sola lettura** delle fonti già esistenti: quando una partita
 * inizia, risponde a cinque domande — dove sono, chi governo, cosa è successo
 * finora, quali problemi/opportunità ho davanti, cosa posso fare adesso — senza
 * diventare una nuova fonte di stato e senza inventare fatti.
 *
 * Gerarchia (§23): MOTORE CORRENTE > STATO INIZIALE > PRESET/LORE > LLM.
 * Qui non c'è LLM: il mondo viene dal preset (`world.basePrompt`), il paese dai
 * read model del motore (`NationalContext`, conti, crisi, risorse, forze), le
 * questioni dallo **stesso** `StrategicBriefing` della HUD (`deriveStrategicBriefing`).
 * Deterministica: stesso input → stesso output.
 */
import type { CrisisSnapshot, GovernmentSnapshot, PowerAgenda } from '../../services/api';
import type { NationResources } from './NationDock/types';
import type { WorldFact } from './worldPresence';

/** Simbolo del quadro: problema, opportunità o neutro (§26). */
export type OpeningSymbol = 'problem' | 'opportunity' | 'neutral';
export type OpeningTone = 'warning' | 'neutral' | 'positive';

export interface OpeningSituationItem {
  id: string;
  symbol: OpeningSymbol;
  label: string;
  detail?: string;
}

/** Presentation adapter del `StrategicBriefing`: cambia **solo la forma** (§13). */
export interface OpeningSituationCard {
  id: string;
  symbol: OpeningSymbol;
  /** Titolo breve, es. «FORZE ARMATE». */
  title: string;
  /** Frase discorsiva, dal detail del motore. */
  body: string;
  /** Preservata intatta dal briefing. */
  severity: string;
}

/** Il prologo **semantico** dal backend (`OpeningWorldNarrative`). */
export interface OpeningWorldNarrative {
  headline?: string;
  worldOrder: string;
  regionalSituation?: string;
  stakesForNation: string;
}

export interface OpeningWorldItem {
  id: string;
  name: string;
  relation: string;
  tone: OpeningTone;
}

export interface OpeningQuestion {
  id: string;
  label: string;
  detail?: string;
}

export interface OpeningReading {
  key: string;
  label: string;
  value: string;
  tone: OpeningTone;
}

export interface OpeningCouncilVoice {
  seat: string;
  label: string;
  line: string;
}

export interface OpeningEntryPoint {
  id: 'orders' | 'map' | 'advisor';
  label: string;
  icon: string;
}

export interface GameOpeningBriefing {
  world: {
    name: string;
    date: string;
    /** «1 GENNAIO 2000», per l'intestazione. */
    dateLabel: string;
    /** La premessa grezza del preset (`world.basePrompt`) — solo per il fallback locale. */
    premise: string;
    /** Le regole di simulazione dello stesso record canonico, se presenti. */
    simulationRules?: string | null;
    /** Il prologo semantico: dal backend, o fallback locale se l'endpoint fallisce. */
    narrative: OpeningWorldNarrative;
  };
  nation: {
    name: string;
    identity: string;
    /** Le questioni del paese dallo stato canonico: il numero è quello reale (WS-CONSULENTE-SITUAZIONI). */
    questions: string[];
    readings: OpeningReading[];
    neighbors: OpeningWorldItem[];
  };
  inheritedSituation: OpeningSituationItem[];
  worldAroundYou: OpeningWorldItem[];
  /** I 2–3 fatti del mondo scelti dal ranking deterministico (§12). */
  worldFactCards: OpeningSituationCard[];
  /** Le priorità dal `StrategicBriefing`, in forma di card (§13). */
  situationCards: OpeningSituationCard[];
  firstQuestions: OpeningQuestion[];
  council: OpeningCouncilVoice[];
  entryPoints: OpeningEntryPoint[];
}

export interface OpeningBriefingInput {
  world: { name?: string | null; basePrompt?: string | null; simulationRules?: string | null } | null | undefined;
  currentDate?: string | null;
  nationalName: string;
  nationalAccount: Record<string, any> | null | undefined;
  crisis?: CrisisSnapshot | null;
  government?: GovernmentSnapshot | null;
  relationships?: Record<string, Record<string, string>> | null;
  relationshipNames?: Record<string, string> | null;
  strategicAgenda?: { powers?: PowerAgenda[] | null } | null;
  worldFacts?: readonly WorldFact[] | null;
  resources?: NationResources | null;
  arms?: { power?: number | null; objects?: readonly unknown[] | null } | null;
  playerPolityId: string;
  /** Prologo semantico dal backend (`opening-narrative`). Fonte primaria (§2–§3). */
  narrative?: OpeningWorldNarrative | null;
  /** Quadro del paese dal backend. */
  nationFraming?: string | null;
  /** Questioni del paese dal backend: la UI le mostra (§3C). */
  nationQuestions?: readonly string[] | null;
  /** Voci del consiglio dal server (`opening-narrative`), se disponibili. */
  council?: readonly OpeningCouncilVoice[] | null;
  /** Fallback locale: le sedie già lette dal motore. */
  cabinetAddresses?: readonly { seat: string; label: string; opening: string }[] | null;
  /** Briefing già derivato: **una sola** fonte di priorità. */
  items: readonly { id: string; severity: string; label: string; detail?: string }[];
}

const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** «2000-01-01» → «1 GENNAIO 2000». Vuoto se la data manca (mai una data finta). */
export function formatOpeningDate(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!match) return '';
  const day = Number(match[3]);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '';
  return `${day} ${month.toUpperCase()} ${match[1]}`;
}

const clean = (value: string): string => String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/^#{1,6}\s*/gm, '')
  .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
  .replace(/\*\*|__|`/g, '')
  .trim();

/**
 * Estrae 2–4 paragrafi brevi dal preset (`world.basePrompt`): niente lore
 * completo, solo il senso d'apertura. Deterministica.
 */
export function extractOpeningParagraphs(premise: string, maxParagraphs = 4, maxWords = 190): string[] {
  const text = clean(premise);
  if (!text) return [];
  const blocks = text.split(/\n\s*\n+/).map(b => b.replace(/\s*\n\s*/g, ' ').trim()).filter(b => b.length >= 24);
  const source = blocks.length > 0 ? blocks : [text.replace(/\s+/g, ' ')];
  const out: string[] = [];
  let used = 0;
  for (const block of source) {
    if (out.length >= maxParagraphs || used >= maxWords) break;
    const kept = block.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(' ');
    const tokens = kept.split(/\s+/).filter(Boolean);
    const clipped = tokens.length <= maxWords - used
      ? kept
      : `${tokens.slice(0, Math.max(24, maxWords - used)).join(' ').replace(/[,;:]$/, '')}…`;
    if (!clipped) continue;
    out.push(clipped);
    used += clipped.split(/\s+/).filter(Boolean).length;
  }
  return out;
}

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatPopulation(population: number | null): string | null {
  if (population === null || population <= 0) return null;
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1).replace('.', ',')} milioni`;
  if (population >= 1_000) return `${(population / 1_000).toFixed(0)} mila`;
  return String(population);
}

/** Le letture del paese (§7–§8): 4–6 righe qualitative, non un dashboard. */
export function deriveNationReadings(input: OpeningBriefingInput): OpeningReading[] {
  const account = input.nationalAccount ?? null;
  const readings: OpeningReading[] = [];

  const population = formatPopulation(num(account?.population));
  if (population) readings.push({ key: 'population', label: 'Popolazione', value: population, tone: 'neutral' });

  const growth = num(account?.annualGrowthRate);
  const balance = num(account?.monthlyBalance);
  const gdp = num(account?.nominalGdpUsdBillions) ?? num(account?.gdp);
  if (growth !== null || balance !== null || gdp !== null) {
    const fragile = (balance !== null && balance < -0.5) || (growth !== null && growth < 0.5);
    readings.push({
      key: 'economy', label: 'Economia', tone: fragile ? 'warning' : (growth !== null && growth >= 3 ? 'positive' : 'neutral'),
      value: fragile ? 'Fragile, con i conti da riequilibrare' : (growth !== null && growth >= 3 ? 'In crescita' : 'Stabile, senza slancio'),
    });
  }

  const stability = num(account?.stability);
  const tension = num(account?.socialTension);
  if (stability !== null || tension !== null) {
    const tense = (tension !== null && tension >= 65) || (stability !== null && stability > 0 && stability <= 40);
    readings.push({
      key: 'society', label: 'Società', tone: tense ? 'warning' : 'neutral',
      value: tense ? 'Stabilità sotto pressione, tensioni aperte' : 'La stabilità regge',
    });
  }

  // §7 — il governo che si eredita: coesione e pressione del consiglio.
  const government = input.government;
  if (government) {
    const cohesion = num(government.cohesion);
    const pressure = num(government.pressureIndex);
    const unstable = (cohesion !== null && cohesion > 0 && cohesion <= 45) || (pressure !== null && pressure >= 60);
    readings.push({
      key: 'government', label: 'Governo', tone: unstable ? 'warning' : 'neutral',
      value: unstable
        ? (pressure !== null && pressure >= 60 ? 'Il consiglio preme: priorità da ricomporre' : 'Coalizione instabile')
        : 'Assetto di governo coeso',
    });
  }

  const money = num(input.resources?.money) ?? num(account?.money);
  const debtRatio = num(account?.debtRatioPct) ?? num(account?.debtBurdenPct);
  if (money !== null || debtRatio !== null || balance !== null) {
    const tight = (money !== null && money < 0.5) || (debtRatio !== null && debtRatio >= 45) || (balance !== null && balance < -0.5);
    readings.push({
      key: 'finances', label: 'Finanze', tone: tight ? 'warning' : 'neutral',
      value: tight ? 'Il margine fiscale è ristretto' : 'Margine di manovra disponibile',
    });
  }

  const relationships = input.relationships?.[input.playerPolityId];
  if (relationships) {
    const values = Object.values(relationships);
    const allies = values.filter(v => v === 'ally').length;
    const hostiles = values.filter(v => v === 'hostile').length;
    readings.push({
      key: 'diplomacy', label: 'Diplomazia', tone: hostiles > allies ? 'warning' : (allies > 0 ? 'positive' : 'neutral'),
      value: hostiles > allies ? 'Relazioni regionali da consolidare' : (allies > 0 ? 'Rete di rapporti da coltivare' : 'Posizione da definire'),
    });
  }

  // La difesa resta in coda: il §7 chiede 4–6 letture e la diplomazia è più
  // pertinente all'apertura di una stima di capacità militare.
  const forces = num(account?.militaryPower) ?? num(account?.defenceBurdenPct);
  if (forces !== null) {
    readings.push({
      key: 'forces', label: 'Difesa', tone: forces > 0 && forces < 20 ? 'warning' : 'neutral',
      value: forces > 0 && forces < 20 ? 'Una difesa da costruire' : 'Capacità di difesa presente',
    });
  }

  return readings.slice(0, 6);
}

const RELATION_LABEL: Record<string, string> = {
  ally: 'Rapporto solido',
  hostile: 'Rapporto teso',
  neutral: 'Rapporto aperto',
};

/** 3–5 vicini rilevanti dal motore: relazioni + agende delle potenze (§11). */
export function deriveNeighbors(input: OpeningBriefingInput): OpeningWorldItem[] {
  const names = input.relationshipNames ?? {};
  const out: OpeningWorldItem[] = [];
  const seen = new Set<string>();

  const row = input.relationships?.[input.playerPolityId];
  if (row) {
    const entries = Object.entries(row)
      .filter(([polityId]) => polityId && polityId !== input.playerPolityId)
      .sort((a, b) => (a[1] === 'hostile' ? 0 : b[1] === 'hostile' ? 1 : 0));
    for (const [polityId, relation] of entries) {
      if (out.length >= 5) break;
      const name = names[polityId] || polityId;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({
        id: `rel-${polityId}`,
        name,
        relation: RELATION_LABEL[relation] ?? 'Rapporto da definire',
        tone: relation === 'hostile' ? 'warning' : relation === 'ally' ? 'positive' : 'neutral',
      });
    }
  }

  for (const power of input.strategicAgenda?.powers ?? []) {
    if (out.length >= 5) break;
    if (!power?.name || seen.has(power.name) || power.polityId === input.playerPolityId) continue;
    seen.add(power.name);
    const objective = power.objectives?.[0]?.description;
    out.push({ id: `power-${power.polityId}`, name: power.name, relation: objective || 'Punta a una propria agenda', tone: 'neutral' });
  }

  return out;
}

function symbolFor(severity: string): OpeningSymbol {
  if (severity === 'critical' || severity === 'warning') return 'problem';
  if (severity === 'opportunity' || severity === 'positive') return 'opportunity';
  return 'neutral';
}

/**
 * Le "prime questioni" dal **solo** `StrategicBriefing` già derivato (§9–§10):
 * problemi e opportunità, max 5. Nessun secondo sistema di priorità.
 */
export function deriveFirstQuestions(items: OpeningBriefingInput['items']): OpeningSituationItem[] {
  return items
    .slice(0, 5)
    .map(item => ({ id: item.id, symbol: symbolFor(item.severity), label: item.label, ...(item.detail ? { detail: item.detail } : {}) }));
}

/** Una riga d'identità dal livello del briefing: interpretazione, non un fatto nuovo. */
function deriveIdentity(input: OpeningBriefingInput): string {
  const hasProblem = input.items.some(i => i.severity === 'critical' || i.severity === 'warning');
  const hasOpportunity = input.items.some(i => i.severity === 'opportunity' || i.severity === 'positive');
  if (hasProblem && hasOpportunity) return 'Il paese eredita problemi aperti e occasioni da cogliere.';
  if (hasProblem) return 'Il paese eredita una situazione che richiede attenzione immediata.';
  if (hasOpportunity) return 'Il paese è stabile, con margini per scegliere una direzione.';
  return 'Il paese è nelle tue mani: tocca a te decidere da dove partire.';
}

/** Fallback locale per il consiglio: le sedie già lette dal motore. */
function deriveCouncil(input: OpeningBriefingInput): OpeningCouncilVoice[] {
  if (input.council && input.council.length > 0) {
    return input.council.slice(0, 3).map(v => ({ seat: v.seat, label: v.label, line: v.line }));
  }
  return (input.cabinetAddresses ?? [])
    .filter(a => a.opening?.trim())
    .slice(0, 3)
    .map(a => ({ seat: a.seat, label: a.label, line: a.opening.trim().split(/(?<=[.!?])\s+/)[0] }));
}

/** Fallback locale del prologo: usato SOLO se l'endpoint backend fallisce (§3). */
export function fallbackWorldNarrative(premise: string, nationName: string, maxWords = 220): OpeningWorldNarrative {
  const paragraphs = extractOpeningParagraphs(premise, 3, maxWords);
  const nation = nationName && !/^[A-Z0-9_-]{2,5}$/.test(nationName) ? nationName : 'il tuo paese';
  return {
    worldOrder: paragraphs[0] ?? '',
    ...(paragraphs[1] ? { regionalSituation: paragraphs[1] } : {}),
    stakesForNation: `Per ${nation}, le scelte interne saranno inseparabili dalla posizione che saprà costruirsi in questo ordine.`,
  };
}

const FACT_SEVERITY_RANK: Record<string, number> = {
  critical: 0, warning: 1, opportunity: 2, positive: 3, info: 4,
};

/**
 * Ranking **deterministico** dei fatti del mondo (§12): prima i problemi
 * (critical/warning), poi le opportunità, poi il resto; a parità, l'ordine di
 * arrivo. Mostra al massimo 2–3 fatti: non un feed di notizie.
 */
export function rankWorldFacts(
  facts: readonly WorldFact[] | null | undefined,
  max = 3,
): OpeningSituationCard[] {
  return [...(facts ?? [])]
    .map((fact, index) => ({ fact, index, rank: FACT_SEVERITY_RANK[fact.severity] ?? 5 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, Math.max(0, max))
    .map(({ fact }) => ({
      id: fact.id,
      symbol: symbolFor(fact.severity),
      title: titleCase(fact.label),
      body: fact.detail || fact.label,
      severity: fact.severity,
    }));
}

/** Presentation adapter del `StrategicBriefing` (§13): **solo la forma**. */
export function toOpeningSituationCards(items: OpeningBriefingInput['items']): OpeningSituationCard[] {
  return items.slice(0, 5).map(item => {
    const colon = item.label.indexOf(':');
    const rawTitle = colon >= 0 ? item.label.slice(colon + 1) : item.label;
    return {
      id: item.id,
      symbol: symbolFor(item.severity),
      title: titleCase(rawTitle.trim()),
      body: item.detail || rawTitle.trim(),
      severity: item.severity,
    };
  });
}

function titleCase(value: string): string {
  const text = String(value ?? '').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Il read model completo. Puro, deterministico, read-only. */
export function deriveGameOpening(input: OpeningBriefingInput, options: { compact?: boolean } = {}): GameOpeningBriefing {
  const readings = deriveNationReadings(input);
  const neighbors = deriveNeighbors(input);
  const firstQuestions = deriveFirstQuestions(input.items);
  const maxWords = options.compact ? 160 : 220;
  const premise = String(input.world?.basePrompt ?? '').trim();
  // I2 — il backend è la fonte primaria; il fallback locale scatta solo senza risposta.
  const narrative = input.narrative && input.narrative.worldOrder
    ? input.narrative
    : fallbackWorldNarrative(premise, input.nationalName, maxWords);

  return {
    world: {
      name: String(input.world?.name ?? '').trim(),
      date: String(input.currentDate ?? '').trim(),
      dateLabel: formatOpeningDate(input.currentDate),
      premise,
      simulationRules: input.world?.simulationRules ?? null,
      narrative,
    },
    nation: {
      // WS-CONSULENTE-SITUAZIONI — Il numero di situazioni è quello reale del
      // paese: la lista non viene più troncata a 3.
      questions: (input.nationQuestions ?? []).map(value => String(value).trim()).filter(Boolean),
      name: input.nationalName,
      identity: input.nationFraming && input.nationFraming.trim() ? input.nationFraming.trim() : deriveIdentity(input),
      readings,
      neighbors,
    },
    inheritedSituation: firstQuestions.map(item => ({ ...item })),
    worldAroundYou: neighbors,
    worldFactCards: rankWorldFacts(input.worldFacts),
    situationCards: toOpeningSituationCards(input.items),
    firstQuestions,
    council: deriveCouncil(input),
    entryPoints: [
      { id: 'orders', label: 'Governo', icon: '🏛' },
      { id: 'map', label: 'Mappa', icon: '🗺' },
      { id: 'advisor', label: 'Consigliere', icon: '✦' },
    ],
  };
}
