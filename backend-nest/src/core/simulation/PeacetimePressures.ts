/**
 * World Story — Pressioni di pace
 * ===============================
 * «Dai vita al gioco»: anche una nazione in pace, con i conti in ordine, deve
 * avere ogni turno qualcosa da decidere. Qui nascono le **sfide** interne ed
 * esterne a partire dagli indicatori reali della nazione (tensione, stabilità,
 * crescita, debito, carestia, vicini più armati) — mai inventate dal modello,
 * mai casuali senza motivo.
 *
 * Il modulo è **puro e deterministico**: a parità di partita, turno e indicatori
 * produce le stesse pressioni, nello stesso ordine. Ogni pressione ha opzioni
 * pesate e un costo per l'inerzia: ignorarla non è gratis.
 *
 * Il giocatore sceglie; il motore applica modificatori, cassa e relazioni con
 * gli stessi tetti degli altri effetti nazionali.
 */

import { addDays } from './calendar';

export type PressureKind = 'internal' | 'external';

export type RelationStance = 'ally' | 'neutral' | 'hostile';

/** Conseguenza di una scelta (o dell'inerzia). */
export interface PressureEffect {
  /** Delta sul modificatore di stabilità (punti 0-100). */
  stability?: number;
  /** Delta sul modificatore di tensione sociale (punti 0-100). */
  socialTension?: number;
  /** Delta sul modificatore di crescita annua (frazione, es. -0.004). */
  growthModifier?: number;
  /** Delta sul moltiplicatore delle entrate (es. -0.05 = -5% di gettito). */
  revenueMultiplierDelta?: number;
  /** Cassa immediata in mld: negativo = spesa, positivo = incasso. */
  moneyDeltaMld?: number;
  /** Effetto diplomatico su un vicino. */
  relationship?: { target: string; direction: 'improve' | 'degrade' };
  /** Riga leggibile restituita al giocatore e usata dai prompt. */
  note: string;
}

export interface PressureOption {
  id: string;
  label: string;
  detail: string;
  effect: PressureEffect;
}

export interface Pressure {
  /** Stabile: stesse condizioni → stesso id (chiave di risoluzione). */
  id: string;
  kind: PressureKind;
  template: string;
  title: string;
  detail: string;
  severity: 1 | 2 | 3;
  /** Chi preme: sindacati, un vicino, il mercato… */
  source: string;
  options: PressureOption[];
  /** Conseguenza se il turno passa senza una scelta. */
  inaction: PressureEffect;
  /**
   * GAMEPLAY-LONG: finestra di decisione in GIORNI DI CALENDARIO. Una sfida non
   * dura «un turno»: resta aperta finché il tempo trascorso non supera la
   * finestra, poi l'inerzia presenta il conto. Più grave = finestra più corta.
   */
  durationDays: number;
}

/* ------------------------------------------------------------------ *
 * Finestra temporale delle sfide (tempo di calendario)
 * ------------------------------------------------------------------ */

/** Giorni di decisione concessi per gravità: una sfida grave non aspetta. */
export const PRESSURE_DURATION_DAYS: Record<1 | 2 | 3, number> = { 1: 120, 2: 90, 3: 60 };
/** Frazione della finestra oltre la quale una sfida grave peggiora da sola. */
export const PRESSURE_ESCALATION_AT = 0.6;
/** Quanto dell'effetto di inazione si paga nell'escalation (mezza dose). */
export const PRESSURE_ESCALATION_SHARE = 0.5;
/** Quante sfide possono restare aperte insieme: oltre, il dossier basta. */
export const PRESSURE_MAX_ACTIVE = 3;
/** Fino a quante sfide meritano un posto in evidenza (P2: meno micro-management). */
export const PRESSURE_MAX_HIGHLIGHTED = 2;

/**
 * Data di scadenza di una sfida: apertura + finestra in giorni di calendario.
 * Deterministica e senza fuso orario (usa il calendario di gioco).
 */
export function pressureDeadline(createdDate: string, durationDays: number): string {
  const duration = Math.max(1, Math.floor(Number(durationDays) || 0)) || 1;
  try {
    return addDays(createdDate, duration);
  } catch {
    return createdDate;
  }
}

/** Finestra di decisione di una sfida, dalla sua gravità. */
export function pressureDurationDays(severity: number): number {
  const level = (severity >= 3 ? 3 : severity === 2 ? 2 : 1) as 1 | 2 | 3;
  return PRESSURE_DURATION_DAYS[level];
}

/**
 * Stato della finestra di una sfida rispetto alla data corrente: quanto tempo
 * è passato, quanto ne resta, se è scaduta e se una sfida grave deve già
 * peggiorare prima della scadenza.
 */
export interface PressureWindow {
  /** Giorni trascorsi dall'apertura. */
  daysElapsed: number;
  /** Giorni che restano prima della scadenza (0 se scaduta). */
  daysLeft: number;
  /** Oltre la scadenza: l'inerzia presenta il conto. */
  expired: boolean;
  /** Una sfida grave peggiora prima della scadenza se il tempo trascorso è molto. */
  escalationDue: boolean;
  /** Leggibilità per UI e prompt. */
  urgency: 'scaduta' | 'imminente' | 'prossima' | 'aperta';
}

/**
 * Valuta la finestra di una sfida. `daysElapsed` è calcolato sulla data di
 * apertura, quindi un salto di 7 giorni e uno di 365 danno risposte diverse.
 * `escalated` evita di applicare due volte il peggioramento.
 */
export function pressureWindow(
  pressure: { createdDate: string; durationDays?: number | null; severity?: number; escalated?: boolean },
  currentDate: string,
  daysElapsedInput?: number,
): PressureWindow {
  const duration = Math.max(1, Math.floor(Number(pressure.durationDays) || pressureDurationDays(Number(pressure.severity) || 1)));
  const elapsed = Math.max(0, Math.floor(Number(daysElapsedInput) || 0));
  const left = Math.max(0, duration - elapsed);
  const expired = elapsed > duration;
  const escalationDue = !expired
    && !pressure.escalated
    && Number(pressure.severity) >= 2
    && elapsed >= Math.round(duration * PRESSURE_ESCALATION_AT);
  const urgency: PressureWindow['urgency'] = expired
    ? 'scaduta'
    : left <= 15
      ? 'imminente'
      // Metà finestra consumata: la scadenza si avvicina.
      : elapsed * 2 >= duration
        ? 'prossima'
        : 'aperta';
  return { daysElapsed: elapsed, daysLeft: left, expired, escalationDue, urgency };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
/** I modificatori di crescita/gettito sono frazioni piccole: servono più decimali. */
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * Riduce un effetto a una frazione: serve all'escalation, che è **metà**
 * dell'effetto di inazione — mai un numero inventato, solo la stessa
 * conseguenza applicata in anticipo e più leggera.
 */
export function scalePressureEffect(effect: PressureEffect, share = PRESSURE_ESCALATION_SHARE): PressureEffect {
  const factor = Math.max(0, Math.min(1, Number(share) || 0));
  const scaled: PressureEffect = { note: effect.note };
  for (const key of ['stability', 'socialTension'] as const) {
    const value = Number(effect[key]);
    if (Number.isFinite(value) && value !== 0) scaled[key] = Math.round(value * factor);
  }
  for (const key of ['growthModifier', 'revenueMultiplierDelta'] as const) {
    const value = Number(effect[key]);
    if (Number.isFinite(value) && value !== 0) scaled[key] = round4(value * factor);
  }
  {
    const value = Number(effect.moneyDeltaMld);
    if (Number.isFinite(value) && value !== 0) scaled.moneyDeltaMld = round2(value * factor);
  }
  if (effect.relationship) scaled.relationship = { ...effect.relationship };
  return scaled;
}

/**
 * Priorità di una sfida per il briefing (P2): non tutte le questioni hanno lo
 * stesso peso. `critica` = gravità 3 o scadenza imminente; `rilevante` =
 * gravità 2 o finestra oltre metà; `ordinaria` = il resto, che resta nel
 * dossier senza interrompere il giocatore.
 */
export type PressurePriority = 'critica' | 'rilevante' | 'ordinaria';

export function pressurePriority(
  pressure: { severity?: number },
  window: Pick<PressureWindow, 'expired' | 'urgency' | 'daysElapsed' | 'daysLeft'>,
): PressurePriority {
  const severity = Number(pressure.severity) || 1;
  if (window.expired || severity >= 3 || window.urgency === 'imminente') return 'critica';
  if (severity === 2 || window.daysElapsed > window.daysLeft) return 'rilevante';
  return 'ordinaria';
}

/**
 * Sceglie quali sfide meritano di essere evidenziate: al massimo
 * `PRESSURE_MAX_HIGHLIGHTED`, le più urgenti. Le altre restano attive nella
 * lista completa — visibili, ma senza chiedere attenzione.
 */
export function highlightPressures<T extends { id: string; severity?: number }>(
  pressures: T[],
  windows: Record<string, Pick<PressureWindow, 'expired' | 'urgency' | 'daysElapsed' | 'daysLeft'>>,
  max = PRESSURE_MAX_HIGHLIGHTED,
): Set<string> {
  const rank: Record<PressurePriority, number> = { critica: 0, rilevante: 1, ordinaria: 2 };
  const ordered = [...pressures].sort((left, right) => {
    const a = rank[pressurePriority(left, windows[left.id])];
    const b = rank[pressurePriority(right, windows[right.id])];
    if (a !== b) return a - b;
    const severityDiff = (Number(right.severity) || 1) - (Number(left.severity) || 1);
    if (severityDiff !== 0) return severityDiff;
    return left.id.localeCompare(right.id);
  });
  return new Set(ordered.slice(0, Math.max(0, max)).map(item => item.id));
}

export interface PressureNeighbour {
  polityId: string;
  name: string;
  militaryPower: number;
  stance: RelationStance;
}

export interface PressureSnapshot {
  polityId: string;
  name: string;
  turn: number;
  date: string;
  /** Identificativo stabile della partita (seme del PRNG). */
  seed: string;
  atWar: boolean;
  stability: number;
  socialTension: number;
  annualGrowthRate: number;
  /** Disavanzo annuo in % del PIL (positivo = deficit). */
  deficitRatioPct: number;
  debtRatioPct: number;
  taxRatePct: number;
  militaryPower: number;
  provinces: number;
  mobilized: number;
  /** Mesi di cibo in magazzino; `null` quando il magazzino non è noto. */
  foodCoverageMonths: number | null;
  neighbours: PressureNeighbour[];
}

export interface GenerateOptions {
  /** Massimo numero di pressioni restituite (default 3). */
  maxPressures?: number;
}

/* ------------------------------------------------------------------ *
 * Seme deterministico
 * ------------------------------------------------------------------ */

function hashString(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** PRNG veloce e riproducibile (mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (value: number) => `${Math.round(value * 10) / 10}%`;

function pickNeighbour(
  neighbours: PressureNeighbour[],
  rng: () => number,
  filter: (neighbour: PressureNeighbour) => boolean,
): PressureNeighbour | null {
  const pool = neighbours.filter(filter);
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

function severityFor(score: number): 1 | 2 | 3 {
  if (score >= 2.2) return 3;
  if (score >= 1.4) return 2;
  return 1;
}

/* ------------------------------------------------------------------ *
 * Modelli di pressione
 * ------------------------------------------------------------------ */

/** Bozza di sfida: gravità e finestra sono decise dal generatore. */
type PressureDraft = Omit<Pressure, 'severity' | 'durationDays'>;

interface Candidate {
  pressure: PressureDraft & { severity: 1 | 2 | 3 };
  score: number;
}

/** Valuta un modello: `null` = non applicabile in questo momento. */
type Builder = (snapshot: PressureSnapshot, rng: () => number) => Candidate | null;

const MAX_SCORE = 3;

function candidate(pressure: PressureDraft, score: number): Candidate {
  const bounded = Math.max(0, Math.min(MAX_SCORE, score));
  return { pressure: { ...pressure, severity: severityFor(bounded) }, score: bounded };
}

const INTERNAL_TEMPLATES: Builder[] = [
  // Ondata di scioperi: la piazza chiede salari e tutele.
  (snapshot, rng) => {
    const pressure = snapshot.socialTension;
    if (pressure < 38) return null;
    const score = (pressure - 38) / 22 + (snapshot.taxRatePct >= 20 ? 0.6 : 0);
    const sectors = ['metalmeccanici', 'portuali', 'ferrovieri', 'tessili', 'minatori'];
    const sector = sectors[Math.floor(rng() * sectors.length) % sectors.length];
    return candidate({
      id: 'internal:strike-wave',
      kind: 'internal',
      template: 'strike-wave',
      title: `Scioperi dei ${sector}`,
      detail: `I ${sector} incrociano le braccia: tensione sociale al ${Math.round(pressure)}/100`
        + (snapshot.taxRatePct >= 20 ? ` e pressione fiscale al ${pct(snapshot.taxRatePct)}` : '')
        + '. La produzione si ferma e il governo deve rispondere.',
      source: `Sindacati dei ${sector}`,
      options: [
        {
          id: 'negotiate', label: 'Aprire il tavolo', detail: 'Concessioni limitate: la tensione cala senza svuotare le casse.',
          effect: { socialTension: -8, stability: 2, note: 'Tavolo aperto con i sindacati: tensione in calo.' },
        },
        {
          id: 'concede', label: 'Concedere aumenti', detail: 'Salari più alti: pace sociale, ma gettito e crescita ne soffrono.',
          effect: { socialTension: -14, revenueMultiplierDelta: -0.06, growthModifier: -0.002, note: 'Aumenti concessi: pace sociale pagata con gettito e crescita.' },
        },
        {
          id: 'break', label: 'Rompere lo sciopero', detail: 'Requìsizione e precettazione: ordine subito, rancore duraturo.',
          effect: { stability: -6, socialTension: 9, note: 'Sciopero rotto d’autorità: ordine apparente, rancore reale.' },
        },
      ],
      inaction: { socialTension: 7, stability: -3, note: 'Scioperi ignorati: la protesta si allarga.' },
    }, score);
  },

  // Scandalo di corruzione: l'apparato mangia risorse.
  (snapshot, rng) => {
    const drain = snapshot.deficitRatioPct + (snapshot.militaryPower > 0 ? 1 : 0);
    if (snapshot.taxRatePct < 9 && snapshot.deficitRatioPct < 2) return null;
    const score = Math.min(2.6, 0.5 + drain / 5);
    const bodies = ['commissariato agli approvvigionamenti', 'genio civile', 'dogane', 'azienda statale dei trasporti'];
    const body = bodies[Math.floor(rng() * bodies.length) % bodies.length];
    return candidate({
      id: 'internal:corruption-scandal',
      kind: 'internal',
      template: 'corruption-scandal',
      title: 'Scandalo di corruzione',
      detail: `Un'inchiesta giornalistica smaschera tangenti nel ${body}. L'opposizione chiede un dibattito parlamentare.`,
      source: 'Stampa e opposizione',
      options: [
        {
          id: 'purge', label: 'Epurare e processare', detail: 'Mani pulite: consenso in salita, apparato scosso.',
          effect: { stability: 5, socialTension: -3, revenueMultiplierDelta: 0.02, note: 'Epurazione completata: apparato scosso, ma credibilità in salita.' },
        },
        {
          id: 'cover', label: 'Insabbiare', detail: 'Nessun costo immediato, ma il sospetto resta.',
          effect: { socialTension: 8, stability: -4, note: 'Inchiesta insabbiata: il sospetto resta nell’aria.' },
        },
        {
          id: 'reform', label: 'Riforma degli appalti', detail: 'Regole nuove e controlli: costo immediato, meno sprechi.',
          effect: { moneyDeltaMld: -0.4, revenueMultiplierDelta: 0.03, socialTension: -2, note: 'Nuova legge sugli appalti: meno sprechi, cassa subito più leggera.' },
        },
      ],
      inaction: { socialTension: 6, stability: -3, note: 'Scandalo senza risposta: il malcontento monta.' },
    }, score);
  },

  // Carestia: il magazzino alimentare non copre i mesi necessari.
  (snapshot) => {
    const coverage = snapshot.foodCoverageMonths;
    if (coverage === null || coverage >= 2) return null;
    const score = (2 - coverage) / 0.8;
    return candidate({
      id: 'internal:harvest-failure',
      kind: 'internal',
      template: 'harvest-failure',
      title: 'Carestia incombente',
      detail: `Il grano in magazzino copre ${coverage.toFixed(1)} mesi. I prezzi del pane salgono nei mercati cittadini.`,
      source: 'Contadini e mercati urbani',
      options: [
        {
          id: 'import', label: 'Importare grano', detail: 'Cassa subito, tavole apparecchiate.',
          effect: { moneyDeltaMld: -0.8, socialTension: -8, note: 'Grano importato: la carestia è evitata, la cassa ne risente.' },
        },
        {
          id: 'ration', label: 'Razionare', detail: 'Nessuna spesa, ma il paese stringe la cinghia.',
          effect: { socialTension: 10, stability: -5, note: 'Tessera annonaria: nessuna spesa, molto malcontento.' },
        },
        {
          id: 'appeal', label: 'Chiedere aiuti', detail: 'Appello internazionale: cibo in arrivo, prestigio in gioco.',
          effect: { socialTension: -4, stability: -2, note: 'Appello internazionale: aiuti in arrivo, immagine in bilico.' },
        },
      ],
      inaction: { socialTension: 12, stability: -6, note: 'Carestia ignorata: fame e rivolte del pane.' },
    }, score);
  },

  // Emigrazione: chi può parte.
  (snapshot) => {
    if (snapshot.annualGrowthRate > 0.012 && snapshot.socialTension < 35) return null;
    const score = Math.max(0, (0.012 - snapshot.annualGrowthRate) / 0.012) + Math.max(0, (snapshot.socialTension - 35) / 40);
    if (score < 0.4) return null;
    return candidate({
      id: 'internal:emigration-wave',
      kind: 'internal',
      template: 'emigration-wave',
      title: 'Emigrazione di massa',
      detail: `Interi paesi si svuotano: crescita al ${pct(snapshot.annualGrowthRate * 100)} e tensione al ${Math.round(snapshot.socialTension)}/100 spingono i giovani oltre confine.`,
      source: 'Comuni rurali e porti',
      options: [
        {
          id: 'incentives', label: 'Incentivi al ritorno', detail: 'Terra e crediti a chi resta: crescita in ripresa.',
          effect: { moneyDeltaMld: -0.5, growthModifier: 0.004, socialTension: -4, note: 'Incentivi varati: meno partenze, crescita in ripresa.' },
        },
        {
          id: 'controls', label: 'Chiudere i confini', detail: 'Divieti e permessi: meno partenze, più rabbia.',
          effect: { stability: -5, socialTension: 6, note: 'Confini chiusi: partenze frenate, libertà compressa.' },
        },
        {
          id: 'accept', label: 'Lasciar partire', detail: 'Nessun costo oggi, ma il paese perde braccia e cervelli.',
          effect: { growthModifier: -0.004, socialTension: -2, note: 'Nessun freno all’emigrazione: il paese si spopola.' },
        },
      ],
      inaction: { growthModifier: -0.003, socialTension: 3, note: 'Emigrazione senza risposta: manodopera perduta.' },
    }, score);
  },

  // Spinte separatiste: periferie che non si sentono rappresentate.
  (snapshot) => {
    if (snapshot.stability >= 46 || snapshot.provinces < 3) return null;
    const score = (46 - snapshot.stability) / 18 + Math.min(1, snapshot.provinces / 8);
    return candidate({
      id: 'internal:separatist-movement',
      kind: 'internal',
      template: 'separatist-movement',
      title: 'Spinte separatiste',
      detail: `Con la stabilità al ${Math.round(snapshot.stability)}/100, alcune province periferiche chiedono l'autogoverno.`,
      source: 'Comitati provinciali',
      options: [
        {
          id: 'autonomy', label: 'Concedere autonomia', detail: 'Poteri locali: il paese tiene insieme il tessuto, a costo di gettito.',
          effect: { stability: 8, revenueMultiplierDelta: -0.05, note: 'Autonomia concessa: le province restano, il gettito centrale cala.' },
        },
        {
          id: 'dialogue', label: 'Tavolo con i comitati', detail: 'Promesse e mediazione: tensione in calo, nessuna concessione formale.',
          effect: { socialTension: -7, stability: 2, note: 'Mediazione in corso: la tensione cala senza cambiare lo statuto.' },
        },
        {
          id: 'crackdown', label: 'Mano ferma', detail: 'Presidi e arresti: ordine imposto, frattura aperta.',
          effect: { stability: -3, socialTension: 11, note: 'Repressione delle spinte autonomiste: ordine imposto, frattura aperta.' },
        },
      ],
      inaction: { stability: -5, socialTension: 8, note: 'Periferie ignorate: la protesta diventa organizzazione.' },
    }, score);
  },

  // Inflazione: stampa e disavanzo bruciano il valore della moneta.
  (snapshot) => {
    if (snapshot.deficitRatioPct < 4.5) return null;
    const score = (snapshot.deficitRatioPct - 4.5) / 3.5;
    return candidate({
      id: 'internal:inflation-spiral',
      kind: 'internal',
      template: 'inflation-spiral',
      title: 'Spirale inflazionistica',
      detail: `Il disavanzo è al ${pct(snapshot.deficitRatioPct)} del PIL: i prezzi al dettaglio corrono e il risparmio si erode.`,
      source: 'Banca centrale e mercati',
      options: [
        {
          id: 'tighten', label: 'Stringere la politica', detail: 'Tassi e tagli: prezzi frenati, crescita sacrificata.',
          effect: { stability: 5, growthModifier: -0.006, socialTension: 3, note: 'Politica monetaria stretta: prezzi frenati, crescita sacrificata.' },
        },
        {
          id: 'price-controls', label: 'Calmiere dei prezzi', detail: 'Prezzi bloccati: sollievo immediato, penuria in arrivo.',
          effect: { socialTension: -5, revenueMultiplierDelta: -0.07, note: 'Calmiere imposto: prezzi fermi, scaffali sempre più vuoti.' },
        },
        {
          id: 'accept-inflation', label: 'Lasciar correre', detail: 'Nessuna stretta: il disavanzo resta e i prezzi continuano.',
          effect: { socialTension: 7, note: 'Inflazione tollerata: il disavanzo resta, i prezzi corrono.' },
        },
      ],
      inaction: { socialTension: 9, stability: -4, note: 'Inflazione ignorata: il potere d’acquisto si dissolve.' },
    }, score);
  },

  // Veterani e riserve richiamate: chi ha combattuto pretende tutele.
  (snapshot) => {
    if (snapshot.mobilized < 2 && snapshot.socialTension < 45) return null;
    const score = Math.min(2.6, snapshot.mobilized / 4 + (snapshot.socialTension - 40) / 30);
    if (score < 0.4) return null;
    return candidate({
      id: 'internal:veterans-unrest',
      kind: 'internal',
      template: 'veterans-unrest',
      title: 'Veterani in fermento',
      detail: `Con ${snapshot.mobilized} riserve richiamate, reduci e famiglie chiedono pensioni, terre e lavoro.`,
      source: 'Associazioni dei reduci',
      options: [
        {
          id: 'pensions', label: 'Pensioni di guerra', detail: 'Cassa subito, consenso solido.',
          effect: { moneyDeltaMld: -0.6, stability: 7, socialTension: -6, note: 'Pensioni ai reduci: consenso solido, cassa più leggera.' },
        },
        {
          id: 'jobs', label: 'Programma di lavori pubblici', detail: 'Cantieri e impieghi: costo alto, tensione giù.',
          effect: { moneyDeltaMld: -1, socialTension: -9, growthModifier: 0.003, note: 'Cantieri per i reduci: meno tensione e un po’ di crescita.' },
        },
        {
          id: 'ignore-veterans', label: 'Rimandare', detail: 'Nessuna spesa, ma la piazza dei reduci cresce.',
          effect: { socialTension: 9, stability: -5, note: 'Richieste dei reduci rimandate: la protesta cresce.' },
        },
      ],
      inaction: { socialTension: 8, stability: -4, note: 'Veterani ignorati: cortei e scioperi della fame.' },
    }, score);
  },
];

const EXTERNAL_TEMPLATES: Builder[] = [
  // Un vicino si arma più di noi.
  (snapshot, rng) => {
    const own = Math.max(1, snapshot.militaryPower);
    const neighbour = pickNeighbour(snapshot.neighbours, rng,
      item => item.stance !== 'ally' && item.militaryPower > own * 1.1);
    if (!neighbour) return null;
    const ratio = neighbour.militaryPower / own;
    const score = Math.min(2.8, Math.min(3, ratio - 1.1) * 1.6 + 0.6);
    const ratioText = ratio >= 10 ? 'oltre dieci volte' : `${ratio.toFixed(1)} volte`;
    return candidate({
      id: 'external:neighbour-buildup',
      kind: 'external',
      template: 'neighbour-buildup',
      title: `${neighbour.name} si riarma`,
      detail: `Il potenziale militare di ${neighbour.name} è ${ratioText} il nostro: nuove divisioni ai confini.`,
      source: `Stato maggiore e governo di ${neighbour.name}`,
      options: [
        {
          id: 'arm', label: 'Rinforzare l’esercito', detail: 'Cassa e consenso in gioco: si compra sicurezza.',
          effect: { moneyDeltaMld: -1.2, stability: 4, socialTension: -3, note: 'Piano di riarmo avviato: più sicurezza, meno cassa.' },
        },
        {
          id: 'protest-buildup', label: 'Protesta diplomatica', detail: 'Nota formale e appello alle potenze: nessun costo, rapporti tesi.',
          effect: { relationship: { target: neighbour.polityId, direction: 'degrade' }, stability: -2, note: `Nota di protesta a ${neighbour.name}: rapporti più tesi.` },
        },
        {
          id: 'reassure', label: 'Aprire un canale', detail: 'Colloqui e garanzie: si abbassa la tensione, si concede tempo.',
          effect: { relationship: { target: neighbour.polityId, direction: 'improve' }, socialTension: -4, note: `Canale aperto con ${neighbour.name}: tensioni ai confini in calo.` },
        },
      ],
      inaction: { socialTension: 5, stability: -3, note: 'Riarmo del vicino ignorato: il paese si sente indifeso.' },
    }, score);
  },

  // Incidente di frontiera.
  (snapshot, rng) => {
    const neighbour = pickNeighbour(snapshot.neighbours, rng, item => item.stance === 'hostile');
    if (!neighbour || snapshot.socialTension < 40) return null;
    const score = 1.2 + (snapshot.socialTension - 40) / 25;
    return candidate({
      id: 'external:border-incident',
      kind: 'external',
      template: 'border-incident',
      title: `Incidente di frontiera con ${neighbour.name}`,
      detail: `Un posto di guardia è stato attaccato: due morti e accuse incrociate con ${neighbour.name}. La stampa chiede una risposta.`,
      source: `Comando di frontiera e stampa`,
      options: [
        {
          id: 'retaliate', label: 'Rispondere con la forza', detail: 'Colpo di mano: orgoglio nazionale, rischio di escalation.',
          effect: { relationship: { target: neighbour.polityId, direction: 'degrade' }, stability: 4, socialTension: 6, note: `Rappresaglia contro ${neighbour.name}: orgoglio nazionale, escalation possibile.` },
        },
        {
          id: 'de-escalate', label: 'De-escalation', detail: 'Commissione d’inchiesta congiunta: tensione ai minimi, critiche in patria.',
          effect: { relationship: { target: neighbour.polityId, direction: 'improve' }, stability: -3, socialTension: -4, note: `De-escalation con ${neighbour.name}: nessuna escalation, accuse di debolezza.` },
        },
        {
          id: 'internationalize', label: 'Portare il caso all’ONU', detail: 'Tribuna internazionale: si guadagna tempo e legittimità.',
          effect: { socialTension: -3, stability: 2, note: 'Caso portato alla tribuna internazionale: tempo guadagnato.' },
        },
      ],
      inaction: { socialTension: 7, stability: -4, note: 'Incidente senza risposta: la stampa parla di governo assente.' },
    }, score);
  },

  // Offerta di alleanza.
  (snapshot, rng) => {
    const neighbour = pickNeighbour(snapshot.neighbours, rng, item => item.stance !== 'hostile' && item.militaryPower >= snapshot.militaryPower * 0.8);
    if (!neighbour) return null;
    const score = 0.9;
    return candidate({
      id: 'external:alliance-offer',
      kind: 'external',
      template: 'alliance-offer',
      title: `${neighbour.name} propone un patto`,
      detail: `${neighbour.name} offre un patto di mutua assistenza: basi, transito e garanzie in cambio di protezione.`,
      source: `Ambasciata di ${neighbour.name}`,
      options: [
        {
          id: 'accept-alliance', label: 'Firmare il patto', detail: 'Protezione e prestigio, ma si entra nella sua orbita.',
          effect: { relationship: { target: neighbour.polityId, direction: 'improve' }, stability: 5, socialTension: -3, note: `Patto firmato con ${neighbour.name}: protezione e prestigio.` },
        },
        {
          id: 'decline-alliance', label: 'Rifiutare', detail: 'Nessun vincolo, ma il vicino se ne ricorderà.',
          effect: { relationship: { target: neighbour.polityId, direction: 'degrade' }, stability: -2, note: `Patto rifiutato a ${neighbour.name}: nessun vincolo, rapporti freddi.` },
        },
        {
          id: 'stall-alliance', label: 'Prendere tempo', detail: 'Trattative aperte: si tiene aperta la porta senza firmare.',
          effect: { note: `Trattative con ${neighbour.name} lasciate aperte: nessun impegno, nessun rifiuto.` },
        },
      ],
      inaction: { note: `Nessuna risposta a ${neighbour.name}: l’offerta resta sul tavolo, ma la fiducia cala.` },
    }, score);
  },

  // Disputa commerciale.
  (snapshot, rng) => {
    const neighbour = pickNeighbour(snapshot.neighbours, rng, item => item.stance === 'neutral');
    if (!neighbour) return null;
    const score = 1 + (snapshot.taxRatePct >= 18 ? 0.5 : 0) + (snapshot.deficitRatioPct > 2 ? 0.4 : 0);
    return candidate({
      id: 'external:trade-dispute',
      kind: 'external',
      template: 'trade-dispute',
      title: `Dazi e dispute con ${neighbour.name}`,
      detail: `${neighbour.name} ha alzato i dazi sulle nostre merci: le industrie esportatrici chiedono una risposta.`,
      source: `Camere di commercio e ${neighbour.name}`,
      options: [
        {
          id: 'retaliate-trade', label: 'Ritorsione doganale', detail: 'Dazi di risposta: orgoglio e consenso, commercio in calo.',
          effect: { relationship: { target: neighbour.polityId, direction: 'degrade' }, stability: 3, revenueMultiplierDelta: -0.05, note: `Ritorsione contro ${neighbour.name}: consenso, commercio in calo.` },
        },
        {
          id: 'negotiate-trade', label: 'Trattare un accordo', detail: 'Mediazione e concessioni reciproche: gettito in lieve calo.',
          effect: { relationship: { target: neighbour.polityId, direction: 'improve' }, revenueMultiplierDelta: -0.01, socialTension: -2, note: `Accordo commerciale con ${neighbour.name}: dispute rientrate.` },
        },
        {
          id: 'absorb-trade', label: 'Assorbire il colpo', detail: 'Nessuna ritorsione: industrie esposte, rapporti intatti.',
          effect: { revenueMultiplierDelta: -0.03, socialTension: 4, note: `Dazi di ${neighbour.name} assorbiti: industrie esposte, rapporti intatti.` },
        },
      ],
      inaction: { revenueMultiplierDelta: -0.04, socialTension: 4, note: 'Disputa commerciale ignorata: le esportazioni ne soffrono.' },
    }, score);
  },

  // Minaccia di sanzioni.
  (snapshot, rng) => {
    if (snapshot.socialTension < 50 && !snapshot.atWar) return null;
    const neighbour = pickNeighbour(snapshot.neighbours, rng, item => item.stance === 'hostile');
    if (!neighbour) return null;
    const score = 1.3 + (snapshot.atWar ? 0.7 : 0);
    return candidate({
      id: 'external:sanctions-threat',
      kind: 'external',
      template: 'sanctions-threat',
      title: `${neighbour.name} minaccia sanzioni`,
      detail: `${neighbour.name} prepara embarghi su merci e capitali: banche e industrie chiedono certezze.`,
      source: `Tesoro e ambasciata di ${neighbour.name}`,
      options: [
        {
          id: 'diversify', label: 'Diversificare i mercati', detail: 'Nuovi partner e scorte strategiche: costo alto, resilienza in salita.',
          effect: { moneyDeltaMld: -1, revenueMultiplierDelta: -0.03, growthModifier: -0.002, note: 'Mercati diversificati: resilienza comprata a caro prezzo.' },
        },
        {
          id: 'comply', label: 'Venire a patti', detail: 'Concessioni per evitare l’embargo: cassa salva, immagine in calo.',
          effect: { relationship: { target: neighbour.polityId, direction: 'improve' }, stability: -5, socialTension: 3, note: `Accordo con ${neighbour.name}: embargo evitato, immagine appannata.` },
        },
        {
          id: 'defy', label: 'Sfidare le sanzioni', detail: 'Risposta orgogliosa: il paese si stringe, il prezzo economico arriva.',
          effect: { stability: 5, socialTension: 5, growthModifier: -0.004, note: `Sanzioni di ${neighbour.name} sfidate: compattezza nazionale, prezzo economico.` },
        },
      ],
      inaction: { growthModifier: -0.003, revenueMultiplierDelta: -0.03, note: 'Sanzioni senza risposta: l’economia ne paga il conto.' },
    }, score);
  },

  // Flusso di profughi da un vicino in crisi.
  (snapshot, rng) => {
    const neighbour = pickNeighbour(snapshot.neighbours, rng, item => item.stance === 'hostile' || item.militaryPower > snapshot.militaryPower * 1.3);
    if (!neighbour) return null;
    const score = 1 + (snapshot.atWar ? 0.8 : 0);
    return candidate({
      id: 'external:refugee-flow',
      kind: 'external',
      template: 'refugee-flow',
      title: `Profughi da ${neighbour.name}`,
      detail: `Migliaia di civili fuggono dalla crisi di ${neighbour.name} e si accalcano al confine meridionale.`,
      source: `Prefetture di frontiera`,
      options: [
        {
          id: 'accept-refugees', label: 'Accogliere', detail: 'Campi e sussidi: costo immediato, prestigio internazionale.',
          effect: { moneyDeltaMld: -0.7, socialTension: 5, stability: 3, note: `Profughi da ${neighbour.name} accolti: prestigio, tensione interna.` },
        },
        {
          id: 'camps', label: 'Campi controllati', detail: 'Accoglienza limitata ai valichi: costo minore, controlli stretti.',
          effect: { moneyDeltaMld: -0.35, socialTension: 2, note: 'Campi allestiti ai valichi: accoglienza controllata.' },
        },
        {
          id: 'close-border', label: 'Chiudere il confine', detail: 'Nessuna spesa, frontiera blindata: immagine internazionale in calo.',
          effect: { relationship: { target: neighbour.polityId, direction: 'degrade' }, socialTension: -3, stability: -2, note: `Confine chiuso ai profughi di ${neighbour.name}: immagine in calo.` },
        },
      ],
      inaction: { socialTension: 6, stability: -3, note: 'Flusso di profughi senza risposta: caos ai valichi.' },
    }, score);
  },
];

/** Pressioni di fondo: garantiscono che una nazione in pace abbia sempre voce. */
const BASELINE_INTERNAL: Builder = (snapshot) => candidate({
  id: 'internal:public-opinion',
  kind: 'internal',
  template: 'public-opinion',
  title: 'L’opinione pubblica chiede attenzione',
  detail: `Stabilità al ${Math.round(snapshot.stability)}/100 e tensione al ${Math.round(snapshot.socialTension)}/100: il paese è tranquillo, ma la stampa vuole un segnale di governo.`,
  source: 'Stampa nazionale',
  options: [
    {
      id: 'tour', label: 'Giro del paese', detail: 'Comizi e inaugurazioni: consenso immediato, nessuna spesa.',
      effect: { stability: 3, socialTension: -3, note: 'Giro del paese: l’opinione pubblica si distende.' },
    },
    {
      id: 'reform', label: 'Annunciare una riforma', detail: 'Un piano di spesa mirato: costo contenuto, tensione in calo.',
      effect: { moneyDeltaMld: -0.3, stability: 2, socialTension: -6, growthModifier: 0.001, note: 'Riforma annunciata: fiducia in ripresa.' },
    },
    {
      id: 'silent', label: 'Nessun segnale', detail: 'Il governo tace: nessun costo, nessun guadagno.',
      effect: { socialTension: 2, note: 'Silenzio del governo: nessun costo, nessuna spinta.' },
    },
  ],
  inaction: { socialTension: 2, note: 'Nessun segnale pubblico: l’attenzione cala.' },
}, 0.8);

const BASELINE_EXTERNAL: Builder = (snapshot, rng) => {
  const neighbour = pickNeighbour(snapshot.neighbours, rng, item => item.stance !== 'hostile');
  if (!neighbour) return null;
  return candidate({
    id: 'external:diplomatic-feeler',
    kind: 'external',
    template: 'diplomatic-feeler',
    title: `${neighbour.name} manda un emissario`,
    detail: `Un emissario di ${neighbour.name} propone consultazioni regolari su commercio e confini.`,
    source: `Ambasciata di ${neighbour.name}`,
    options: [
      {
        id: 'receive', label: 'Ricevere l’emissario', detail: 'Un gesto di cortesia: rapporti più caldi, nessuna spesa.',
        effect: { relationship: { target: neighbour.polityId, direction: 'improve' }, stability: 2, note: `Emissario di ${neighbour.name} ricevuto: rapporti più caldi.` },
      },
      {
        id: 'defer', label: 'Rimandare a data da destinarsi', detail: 'Nessun impegno e nessun costo.',
        effect: { note: `Consultazioni con ${neighbour.name} rimandate: nessun impegno.` },
      },
    ],
    inaction: { note: `Emissario di ${neighbour.name} lasciato in anticamera: cortesia mancata.` },
  }, 0.7);
};

/* ------------------------------------------------------------------ *
 * Generazione
 * ------------------------------------------------------------------ */

/**
 * Genera le pressioni del turno. Deterministica: stesso seme, stesse sfide.
 * Garantisce almeno una sfida interna e una esterna, e al massimo
 * `maxPressures` (default 3), scegliendo le più urgenti.
 */
export function generatePressures(snapshot: PressureSnapshot, options: GenerateOptions = {}): Pressure[] {
  const maxPressures = Math.max(1, Math.min(4, options.maxPressures ?? 3));
  const rng = mulberry32(hashString(`${snapshot.seed}|${snapshot.polityId}|${snapshot.turn}`));

  const evaluated: Candidate[] = [];
  for (const builder of INTERNAL_TEMPLATES) {
    const result = builder(snapshot, rng);
    if (result) evaluated.push(result);
  }
  for (const builder of EXTERNAL_TEMPLATES) {
    const result = builder(snapshot, rng);
    if (result) evaluated.push(result);
  }

  const bestInternal = bestOf(evaluated, 'internal', rng) ?? BASELINE_INTERNAL(snapshot, rng)!;
  const bestExternal = bestOf(evaluated, 'external', rng) ?? BASELINE_EXTERNAL(snapshot, rng);

  const chosen: Candidate[] = [bestInternal];
  if (bestExternal) chosen.push(bestExternal);

  // Terza sfida: la più urgente tra le rimanenti, se davvero sentita.
  const remaining = evaluated
    .filter(item => !chosen.some(picked => picked.pressure.id === item.pressure.id))
    .sort((left, right) => right.score - left.score);
  if (remaining.length > 0 && chosen.length < maxPressures && remaining[0].score >= 1) {
    chosen.push(remaining[0]);
  }

  // L'id è unico per turno: la stessa sfida può tornare in turni diversi senza
  // collidere con la versione già chiusa (che resta nella memoria del dossier).
  // GAMEPLAY-LONG: ogni sfida nasce con la propria finestra di calendario.
  const withTurn = (pressure: PressureDraft & { severity: 1 | 2 | 3 }): Pressure => ({
    ...pressure,
    id: `${pressure.id}#t${snapshot.turn}`,
    durationDays: pressureDurationDays(pressure.severity),
  });
  return dedupe(chosen.map(item => withTurn(item.pressure)));
}

function bestOf(candidates: Candidate[], kind: PressureKind, rng: () => number): Candidate | null {
  const pool = candidates.filter(item => item.pressure.kind === kind);
  if (pool.length === 0) return null;
  // Jitter deterministico: a parità di urgenza, l'ordine cambia tra i turni.
  return pool
    .map(item => ({ item, key: item.score + rng() * 0.15 }))
    .sort((left, right) => right.key - left.key || left.item.pressure.template.localeCompare(right.item.pressure.template))[0].item;
}

function dedupe(pressures: Pressure[]): Pressure[] {
  const seen = new Set<string>();
  const out: Pressure[] = [];
  for (const pressure of pressures) {
    if (seen.has(pressure.id)) continue;
    seen.add(pressure.id);
    out.push(pressure);
  }
  return out;
}

/** Riepilogo compatto per prompt e bollettino. */
export function describePressure(pressure: Pressure, window?: PressureWindow): string {
  const base = `${pressure.title} (${pressure.kind === 'internal' ? 'interna' : 'esterna'}, gravità ${pressure.severity}/3): ${pressure.detail}`;
  if (!window) return base;
  if (window.expired) return `${base} — scaduta: la conseguenza dell'inazione è già arrivata.`;
  return `${base} — aperta da ${window.daysElapsed} giorni, ne restano ${window.daysLeft} prima che l'inerzia presenti il conto.`;
}
