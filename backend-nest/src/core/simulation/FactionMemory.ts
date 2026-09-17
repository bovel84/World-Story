/**
 * World Story — Memoria politica delle fazioni
 * ============================================
 * `GovernmentFactions` dice **come sta** una fazione guardando i numeri di oggi
 * (spesa, tasse, stabilità, fabbriche). Non dice **come è stata trattata**: dopo
 * trenta turni il governo può aver promesso, concesso, rotto o ignorato, e senza
 * memoria ogni fazione tornerebbe neutrale appena i numeri migliorano.
 *
 * Questo modulo è puro e deterministico: prende gli eventi registrati dal
 * motore (una decisione risolta, una sfida scaduta, un impegno onorato o
 * tradito) e ne ricava fiducia, risentimento, tendenza e l'ultima decisione
 * significativa. **La memoria non sostituisce i dati**: la soddisfazione resta
 * derivata dal bilancio, la memoria spiega la politica e pesa sulla pressione.
 *
 * La memoria **decade**: un torto di dieci anni fa pesa meno di uno di ieri.
 */

/** Che cosa ha fatto il governo, dal punto di vista della fazione. */
export type FactionMemoryKind =
  | 'favor'      // una decisione che la fazione ha gradito
  | 'grievance'  // una decisione che l'ha danneggiata
  | 'ignored'    // la sua richiesta è scaduta senza risposta
  | 'promise'    // impegno preso (peso positivo finché è aperto)
  | 'kept'       // impegno mantenuto
  | 'broken';    // impegno tradito

export interface FactionMemoryEvent {
  factionId: string;
  kind: FactionMemoryKind;
  /** Leva politica toccata dalla decisione (tasse, difesa, welfare…). */
  lever?: string | null;
  /** Peso politico firmato: positivo = favore, negativo = torto (-100…100). */
  weight: number;
  turn: number;
  gameDate: string;
  text: string;
  sourceEventId?: string | null;
}

export interface FactionMemoryLastEvent {
  kind: FactionMemoryKind;
  turn: number;
  gameDate: string;
  text: string;
  weight: number;
}

export interface FactionMemoryState {
  /** Fiducia politica verso il governo (0-100, 50 = neutrale). */
  trust: number;
  /** Risentimento accumulato e non ancora decantato (0-100). */
  resentment: number;
  /** Come sta cambiando la relazione: in ripresa, stabile o in calo. */
  trend: 'in ripresa' | 'stabile' | 'in calo';
  /** Ultima decisione significativa che l'ha riguardata. */
  lastEvent: FactionMemoryLastEvent | null;
  /** Quante volte è stata favorita e quante danneggiata (dato storico, non decade). */
  favors: number;
  grievances: number;
  /** Peso politico complessivo già decaduto: usato dalla pressione. */
  pressure: number;
}

export const FACTION_MEMORY_HALF_LIFE_DAYS = 180;
/** Quanto la memoria può spostare la pressione di una fazione (punti 0-100). */
export const FACTION_MEMORY_MAX_PRESSURE = 18;
/** Quanto la memoria può spostare la fiducia iniziale (punti). */
const TRUST_SCALE = 0.6;
const RESENTMENT_SCALE = 0.8;

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round1 = (value: number): number => Math.round(value * 10) / 10;
const round0 = (value: number): number => Math.round(value);

/** Giorni fra due date ISO: 0 se la seconda precede o non è leggibile. */
function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Fattore di decadimento: 1 oggi, 0.5 dopo una semivita, mai zero. */
export function memoryDecay(gameDate: string, today: string, halfLifeDays = FACTION_MEMORY_HALF_LIFE_DAYS): number {
  if (halfLifeDays <= 0) return 1;
  return Math.pow(0.5, daysBetweenIso(gameDate, today) / halfLifeDays);
}

/** Ordina gli eventi dal più vecchio al più recente (data, poi turno, poi testo). */
function chronological(events: readonly FactionMemoryEvent[]): FactionMemoryEvent[] {
  return [...events].sort((a, b) => {
    const dateA = String(a.gameDate ?? '').slice(0, 10);
    const dateB = String(b.gameDate ?? '').slice(0, 10);
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    if (a.turn !== b.turn) return a.turn - b.turn;
    return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
  });
}

/**
 * Stato della memoria politica di UNA fazione. Puro: nessuna scrittura.
 * `today` è la data del mondo, non quella di sistema.
 */
export function factionMemoryState(
  events: readonly FactionMemoryEvent[] | null | undefined,
  options: { today: string; halfLifeDays?: number },
): FactionMemoryState {
  const list = chronological(Array.isArray(events) ? events.filter(Boolean) : []);
  if (list.length === 0) {
    return { trust: 50, resentment: 0, trend: 'stabile', lastEvent: null, favors: 0, grievances: 0, pressure: 0 };
  }
  const halfLife = options.halfLifeDays ?? FACTION_MEMORY_HALF_LIFE_DAYS;
  let weighted = 0;
  let negativeWeighted = 0;
  let favors = 0;
  let grievances = 0;
  for (const event of list) {
    const decay = memoryDecay(event.gameDate, options.today, halfLife);
    const weight = Number(event.weight) || 0;
    weighted += weight * decay;
    if (weight < 0) {
      negativeWeighted += Math.abs(weight) * decay;
      grievances += 1;
    } else if (weight > 0) {
      favors += 1;
    }
  }
  const trust = clamp(round1(50 + weighted * TRUST_SCALE));
  const resentment = clamp(round1(negativeWeighted * RESENTMENT_SCALE));
  // Tendenza: il segno delle ultime tre decisioni, non dell'intera storia.
  const recent = list.slice(-3);
  const recentNet = recent.reduce((sum, event) => sum + (Number(event.weight) || 0), 0);
  // Soglia volutamente larga: una storia mista (un favore e un torto) è
  // «stabile», non un'inversione di rotta.
  const trend: FactionMemoryState['trend'] = recentNet >= 6 ? 'in ripresa' : recentNet <= -6 ? 'in calo' : 'stabile';
  const last = list[list.length - 1];
  const pressure = clamp(round0(-weighted * 0.5), -FACTION_MEMORY_MAX_PRESSURE, FACTION_MEMORY_MAX_PRESSURE);
  return {
    trust, resentment, trend,
    lastEvent: { kind: last.kind, turn: last.turn, gameDate: last.gameDate, text: last.text, weight: last.weight },
    favors, grievances,
    // Segno positivo = la memoria spinge la fazione a premere di più.
    pressure,
  };
}

/**
 * Le fazioni toccate da una sfida di pace: chi porta la richiesta al governo.
 * È una lettura **politica** del tema, non un dato inventato: la fonte della
 * sfida e la leva in gioco sono già nel record pubblicato dal motore.
 */
export const PRESSURE_INTEREST_FACTION: Record<string, string> = {
  'strike-wave': 'lavoratori',
  'corruption-scandal': 'tecnocrati',
  'harvest-failure': 'opinione',
  'emigration-wave': 'province',
  'separatist-movement': 'province',
  'inflation-spiral': 'finanza',
  'veterans-unrest': 'militari',
  'neighbour-buildup': 'militari',
  'border-incident': 'militari',
  'alliance-offer': 'industriali',
  'trade-dispute': 'industriali',
  'sanctions-threat': 'industriali',
  'refugee-flow': 'opinione',
  'public-opinion': 'opinione',
  'diplomatic-feeler': 'industriali',
};

/** Chi porta la richiesta: il tema della sfida, con fallback per tipo. */
export function pressureInterestFaction(template: string, kind: string): string {
  return PRESSURE_INTEREST_FACTION[template] ?? (kind === 'external' ? 'industriali' : 'opinione');
}

export interface PressureMemoryInput {
  pressureId: string;
  template: string;
  kind: string;
  title: string;
  severity: number;
  gameDate: string;
  turn: number;
  /** Opzione scelta dal giocatore; `null` = la sfida è scaduta senza risposta. */
  optionId: string | null;
  optionLabel?: string | null;
  effect?: {
    stability?: number;
    socialTension?: number;
    growthModifier?: number;
    revenueMultiplierDelta?: number;
    moneyDeltaMld?: number;
    relationship?: { target: string; direction: 'improve' | 'degrade' };
  } | null;
}

/**
 * Traduce una decisione (o un silenzio) in memoria politica. Deterministico:
 * legge l'effetto già applicato dal motore e ne ricava chi ne esce favorito e
 * chi danneggiato. Ogni evento resta ≤ 25 punti, così nessuna singola mossa
 * riscrive la storia di una fazione.
 */
export function factionMemoryFromPressure(input: PressureMemoryInput): FactionMemoryEvent[] {
  const primary = pressureInterestFaction(input.template, input.kind);
  const effect = input.effect ?? {};
  const relief = -(Number(effect.socialTension) || 0);      // > 0 = tensione calata
  const order = Number(effect.stability) || 0;
  const funding = (Number(effect.moneyDeltaMld) || 0) < 0;  // il governo ha speso
  const getty = Number(effect.revenueMultiplierDelta) || 0; // < 0 = meno gettito
  const growth = Number(effect.growthModifier) || 0;
  const diplomacy = effect.relationship?.direction ?? null;
  const events: FactionMemoryEvent[] = [];
  const sourceEventId = `pressure:${input.pressureId}`;
  const base = { turn: input.turn, gameDate: input.gameDate, sourceEventId };

  // --- La fazione che portava la richiesta ---------------------------------
  if (input.optionId === null) {
    events.push({
      ...base, factionId: primary, kind: 'ignored', lever: null,
      weight: -(8 + Math.max(0, Number(input.severity) || 0) * 3),
      text: `«${input.title}» è scaduta senza risposta: l'ha presa come un tradimento.`,
    });
  } else {
    let weight = 0;
    let text = '';
    switch (primary) {
      case 'finanza':
        weight = (funding ? -7 : 0) + (getty < 0 ? -8 : 0) + (growth < 0 ? -6 : 0) + (order > 0 ? 4 : 0) + relief * 0.5;
        text = weight >= 0
          ? `Conti tenuti in ordine su «${input.title}».`
          : `Su «${input.title}» il governo ha speso e indebolito le entrate.`;
        break;
      case 'industriali':
        weight = (getty < 0 ? -7 : 0) + (growth < 0 ? -6 : 0) + (diplomacy === 'degrade' ? -5 : 0)
          + (diplomacy === 'improve' ? 6 : 0) + (funding ? -2 : 0) + relief * 0.4;
        text = weight >= 0
          ? `Decisione gradita all'industria su «${input.title}».`
          : `L'industria paga «${input.title}»: nuovi oneri sulle imprese.`;
        break;
      case 'militari':
        weight = (order > 0 ? 5 : 0) + (order < 0 ? -6 : 0) + (diplomacy === 'degrade' ? 4 : 0)
          + (diplomacy === 'improve' ? -2 : 0) + (funding ? 3 : 0);
        text = weight >= 0
          ? `Ordine e fermezza su «${input.title}»: i comandi approvano.`
          : `I comandi non gradiscono «${input.title}»: l'ordine ne esce indebolito.`;
        break;
      case 'lavoratori':
        weight = relief * 2 + (funding ? 4 : 0) + (getty < 0 ? 3 : 0) + (order < 0 ? -2 : 0);
        text = weight >= 0
          ? `Il lavoro ha ottenuto risposte su «${input.title}».`
          : `Il lavoro non ha ottenuto nulla su «${input.title}».`;
        break;
      case 'tecnocrati':
        weight = (funding ? 5 : 0) + (growth > 0 ? 4 : 0) + (growth < 0 ? -5 : 0) + relief * 0.5;
        text = weight >= 0
          ? `Competenza e investimenti premiati su «${input.title}».`
          : `Su «${input.title}» si è scelto di non investire.`;
        break;
      case 'province':
        weight = (funding ? 4 : 0) + (order > 0 ? 2 : 0) + (order < -2 ? -6 : 0) + relief * 0.5;
        text = weight >= 0
          ? `Il territorio ha avuto risposta su «${input.title}».`
          : `Le province restano sole su «${input.title}».`;
        break;
      default: // opinione pubblica
        weight = relief * 2 + (order > 0 ? 3 : 0) + (order < 0 ? -5 : 0);
        text = weight >= 0
          ? `Il paese si è disteso su «${input.title}».`
          : `Il paese rumoreggia: «${input.title}» non è piaciuta.`;
        break;
    }
    const clamped = Math.max(-25, Math.min(25, round0(weight)));
    events.push({
      ...base, factionId: primary, kind: clamped < 0 ? 'grievance' : 'favor', lever: null,
      weight: clamped,
      text: input.optionLabel ? `${text} (${input.optionLabel})` : text,
    });
  }

  // --- Chi guarda dai lati -------------------------------------------------
  const secondary: FactionMemoryEvent[] = [];
  if ((funding || getty < 0) && primary !== 'finanza') {
    secondary.push({
      ...base, factionId: 'finanza', kind: 'grievance',
      weight: funding ? -5 : -4, lever: 'debito',
      text: funding
        ? `Nuova spesa per «${input.title}»: i creditori prendono nota.`
        : `Meno gettito per «${input.title}»: i creditori prendono nota.`,
    });
  }
  if (order < 0 && primary !== 'opinione') {
    secondary.push({ ...base, factionId: 'opinione', kind: 'grievance', weight: Math.max(-10, round0(order * 1.5)), lever: 'ordine', text: `Stabilità in calo per «${input.title}»: il consenso si logora.` });
  }
  if (order > 0 && primary !== 'militari') {
    secondary.push({ ...base, factionId: 'militari', kind: 'favor', weight: 4, lever: 'ordine', text: `Ordine ristabilito su «${input.title}»: i comandi approvano.` });
  }
  if (relief > 0 && primary !== 'opinione') {
    secondary.push({ ...base, factionId: 'opinione', kind: 'favor', weight: Math.min(8, round0(relief * 0.8)), lever: 'ordine', text: `Tensione in calo per «${input.title}»: la piazza si quieta.` });
  }
  return [...events, ...secondary].filter(event => event.weight !== 0);
}

/** Riga pronta per il repository: identifica la partita e la nazione. */
export interface FactionMemoryRow extends FactionMemoryEvent {
  id: string;
  gameId: string;
  branchId: string;
  polityId: string;
}

/**
 * Le stesse funzioni pure della UI: un read model unico per fazioni e briefing.
 */
export function factionMemoryByFaction(
  events: readonly FactionMemoryEvent[] | null | undefined,
  options: { today: string; halfLifeDays?: number },
): Record<string, FactionMemoryState> {
  const grouped: Record<string, FactionMemoryEvent[]> = {};
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.factionId) continue;
    (grouped[event.factionId] ??= []).push(event);
  }
  const result: Record<string, FactionMemoryState> = {};
  for (const [factionId, list] of Object.entries(grouped)) {
    result[factionId] = factionMemoryState(list, options);
  }
  return result;
}
