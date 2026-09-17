/**
 * World Story — Crisi nazionale e fine partita
 * ============================================
 * La nazione non è invincibile: se il giocatore governa contro la realtà —
 * spesa insostenibile, tasse che non bastano, un esercito più debole dei
 * vicini — lo Stato può cadere. Qui vivono le tre strade del collasso, tutte
 * calcolate dagli indicatori reali del motore, mai decise dal modello:
 *
 *   - **rivolta**: legittimità consumata e tensione sociale alta → il governo
 *     viene rovesciato;
 *   - **default**: debito e servizio oltre ogni ragione, cassa scoperta → lo
 *     Stato non onora più i suoi titoli;
 *   - **invasione**: un vicino ostile molto più forte e un paese già fragile →
 *     il territorio viene occupato.
 *
 * Il crollo non è un fulmine a ciel sereno: ogni dimensione attraversa una
 * scala (calma → allarme → critica) e la progressione verso il collasso è
 * misurata in **giorni di calendario**, non in turni. Il giocatore può avanzare
 * di 7, 30, 90, 180 o 365 giorni: una settimana di criticità non pesa come un
 * anno, e un salto lungo non può far cadere la nazione senza che il pericolo sia
 * stato prima visibile.
 *
 * Regole della progressione (tutte deterministiche):
 *   - criticità piena → si accumula un giorno per giorno trascorso;
 *   - allarme → si accumula più lentamente (`CRISIS_WATCH_RATE`);
 *   - calma → l'arretrato si riduce (`CRISIS_RECOVERY_RATE`) e la crisi
 *     dimentica gli avvertimenti precedenti.
 *
 * Il collasso scatta solo quando la dimensione **è critica adesso** e
 * l'arretrato ha superato `CRISIS_COLLAPSE_DAYS`, e in ogni caso dopo almeno
 * `CRISIS_MIN_EPISODES` avanzamenti osservati — a meno che la criticità non sia
 * durata da sola più di `CRISIS_ABRUPT_DAYS` (in quel caso la nazione non si è
 * più rialzata). Chi reagisce in tempo riporta la crisi sotto controllo; chi
 * ignora gli avvertimenti perde.
 *
 * Il modulo è **puro e deterministico**: stessi indicatori, stessi giorni,
 * stesso esito.
 */

export type CrisisDimension = 'revolt' | 'insolvency' | 'invasion';
export type CrisisLevel = 'calm' | 'watch' | 'critical';
export type EndingKind = 'revolution' | 'default' | 'invasion';

/** Soglie dichiarate della scala di crisi. */
export const CRISIS_WATCH_SCORE = 45;
export const CRISIS_CRITICAL_SCORE = 70;
/** Giorni di criticità piena che mettono la nazione a un passo dal collasso. */
export const CRISIS_COLLAPSE_DAYS = 90;
/** Criticità piena durata così tanto, in un solo avanzamento, da non lasciare scampo. */
export const CRISIS_ABRUPT_DAYS = 180;
/** Quanto pesa un giorno di allarme nell'arretrato (0.3 = tre giorni di allarme ≈ un giorno critico). */
export const CRISIS_WATCH_RATE = 0.3;
/** Quanto recupera un giorno di calma sull'arretrato critico. */
export const CRISIS_RECOVERY_RATE = 1.2;
/** Avanzamenti critici osservati prima che il collasso possa scattare (avvertimento obbligatorio). */
export const CRISIS_MIN_EPISODES = 2;
/** Tetto di sicurezza dell'arretrato (dieci anni): evita numeri senza senso nei salvataggi lunghi. */
export const CRISIS_MAX_DAYS = 3650;

export interface CrisisNeighbour {
  polityId: string;
  name: string;
  militaryPower: number;
}

export interface CrisisInput {
  stability: number;
  socialTension: number;
  annualGrowthRate: number;
  monthlyBalance: number;
  nominalGdpUsdBillions: number;
  debtRatioPct: number;
  /** Servizio annuo del debito in % delle entrate. */
  debtServicePct: number;
  /**
   * Rapporto debito/PIL di partenza (ereditato dalla storia). Un debito alto
   * ereditato è una condizione, non un collasso: il default si misura sulla
   * DETERIORAMENTO rispetto a questa soglia, non sulla fotografia iniziale.
   */
  baselineDebtRatioPct: number;
  /** Scoperto di cassa puro (mld). */
  overdraftMld: number;
  foodCoverageMonths: number | null;
  /** Pressione fiscale effettiva (% del PIL): estrarre troppo alimenta la rivolta. */
  taxRatePct: number;
  /** Potenza militare effettiva del giocatore. */
  militaryPower: number;
  hostileNeighbours: CrisisNeighbour[];
  atWar: boolean;
}

export interface CrisisRisk {
  dimension: CrisisDimension;
  level: CrisisLevel;
  /** Punteggio 0-100, deterministico e leggibile (include la persistenza). */
  score: number;
  title: string;
  detail: string;
  /** Fattori che hanno portato al punteggio: numeri reali, non giudizi. */
  drivers: string[];
}

export interface CrisisEnding {
  kind: EndingKind;
  dimension: CrisisDimension;
  title: string;
  summary: string;
  /** Data e turno di gioco in cui la nazione è caduta. */
  date: string;
  turn: number;
  /** Rischi che avevano raggiunto la soglia critica. */
  criticalDimensions: CrisisDimension[];
}

/** Arretrato di criticità già accumulato (persistito fra i turni). */
export interface CrisisPersistence {
  /** Giorni di criticità piena (o equivalenti in allarme) per dimensione. */
  criticalDays?: Partial<Record<CrisisDimension, number>>;
  /** Quanti avanzamenti hanno visto la dimensione critica. */
  episodes?: Partial<Record<CrisisDimension, number>>;
}

export interface CrisisState {
  level: CrisisLevel;
  risks: CrisisRisk[];
  /** Riga breve per l'HUD. */
  headline: string;
  summary: string;
  /** Giorni di criticità accumulati per dimensione (0 se mai stata critica). */
  criticalDays: Record<CrisisDimension, number>;
  /** Avanzamenti in cui la dimensione è stata vista critica. */
  episodes: Record<CrisisDimension, number>;
  /** Giorni di criticità piena che portano al collasso (per UI e prompt). */
  collapseDays: number;
  /** Collasso raggiunto: la partita è finita. */
  ending: CrisisEnding | null;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

function levelFor(score: number): CrisisLevel {
  if (score >= CRISIS_CRITICAL_SCORE) return 'critical';
  if (score >= CRISIS_WATCH_SCORE) return 'watch';
  return 'calm';
}

const DIMENSION_INFO: Record<CrisisDimension, { title: string; detail: string; kind: EndingKind; endingTitle: string; endingSummary: string }> = {
  revolt: {
    title: 'Rischio di rivolta',
    detail: 'Consenso consumato e tensione sociale: la piazza può rovesciare il governo.',
    kind: 'revolution',
    endingTitle: 'Il governo è caduto',
    endingSummary: 'La piazza ha travolto il governo: le istituzioni non tengono più e la nazione è nelle mani della rivolta.',
  },
  insolvency: {
    title: 'Rischio di default',
    detail: 'Debito, interessi e cassa scoperta: lo Stato può non onorare più i suoi titoli.',
    kind: 'default',
    endingTitle: 'Default sovrano',
    endingSummary: 'Il tesoro non riesce più a rifinanziare il debito: lo Stato dichiara il default e perde credito internazionale.',
  },
  invasion: {
    title: 'Rischio di invasione',
    detail: 'Vicini ostili più forti e paese fragile: un’aggressione può spezzare la difesa.',
    kind: 'invasion',
    endingTitle: 'Il paese è occupato',
    endingSummary: 'Le forze ostili hanno sfondato le difese: il governo non controlla più il territorio nazionale.',
  },
};

function scoreRevolt(input: CrisisInput): { score: number; drivers: string[] } {
  const legitimacyGap = 100 - clamp(input.stability);
  const unrest = clamp(input.socialTension);
  const drivers: string[] = [
    `stabilità ${Math.round(input.stability)}/100`,
    `tensione sociale ${Math.round(input.socialTension)}/100`,
  ];
  let hardship = 0;
  // Un prelievo oltre il 28% del PIL è insostenibile per la società: la
  // ricchezza che resta alle famiglie non basta più a vivere.
  const overtax = Math.max(0, Number(input.taxRatePct) - 28);
  if (overtax > 0) {
    hardship += Math.min(30, overtax * 1.6);
    drivers.push(`pressione fiscale ${round1(input.taxRatePct)}% del PIL`);
  }
  if (input.foodCoverageMonths !== null && input.foodCoverageMonths < 2) {
    hardship += Math.min(25, (2 - input.foodCoverageMonths) * 14);
    drivers.push(`cibo per ${round1(input.foodCoverageMonths)} mesi`);
  }
  if (input.annualGrowthRate < 0) {
    hardship += Math.min(15, -input.annualGrowthRate * 100 * 0.6);
    drivers.push(`crescita ${round1(input.annualGrowthRate * 100)}%`);
  }
  const gdp = Math.max(1, input.nominalGdpUsdBillions);
  if (input.monthlyBalance < 0) {
    const deficitPct = (-input.monthlyBalance * 12) / gdp * 100;
    hardship += Math.min(12, deficitPct * 0.9);
    drivers.push(`disavanzo ${round1(deficitPct)}% del PIL`);
  }
  return { score: round1(clamp(0.45 * legitimacyGap + 0.40 * unrest + hardship)), drivers };
}

function scoreInsolvency(input: CrisisInput): { score: number; drivers: string[] } {
  const debt = Math.max(0, input.debtRatioPct);
  const service = Math.max(0, input.debtServicePct);
  const gdp = Math.max(1, input.nominalGdpUsdBillions);
  const baseline = Math.max(0, Number(input.baselineDebtRatioPct) || 0);
  const overdraftRatio = Math.max(0, input.overdraftMld) / gdp * 100;
  const drivers: string[] = [
    `debito ${round1(debt)}% del PIL`,
    `servizio del debito ${round1(service)}% delle entrate`,
  ];
  if (baseline > 0) drivers.push(`debito di partenza ${round1(baseline)}%`);
  // Il debito ereditato non è una colpa del giocatore: la soglia di guardia
  // parte dal rapporto iniziale. È l'indebitamento NUOVO a essere pericoloso.
  const debtFloor = Math.max(70, baseline + 20);
  const serviceFloor = Math.max(45, baseline * 0.27 + 8);
  let score = Math.max(0, debt - debtFloor) + Math.max(0, (service - serviceFloor) * 2);
  if (overdraftRatio > 0) {
    score += Math.min(20, overdraftRatio * 1.2);
    drivers.push(`scoperto di cassa ${round1(input.overdraftMld)} mld`);
  }
  return { score: round1(clamp(score)), drivers };
}

function scoreInvasion(input: CrisisInput): { score: number; drivers: string[] } {
  const own = Math.max(1, input.militaryPower);
  const strongest = input.hostileNeighbours.reduce(
    (best, neighbour) => (neighbour.militaryPower > best.militaryPower ? neighbour : best),
    { polityId: '', name: '', militaryPower: 0 } as CrisisNeighbour,
  );
  const threat = strongest.militaryPower / own;
  const stabilityGap = 100 - clamp(input.stability);
  const drivers: string[] = [
    `potenza militare propria ${round1(own)}`,
  ];
  if (strongest.polityId) {
    drivers.push(`vicino ostile ${strongest.name}: ${round1(strongest.militaryPower)} (${round1(threat)}× la nostra)`);
  } else {
    drivers.push('nessun vicino ostile rilevante');
  }
  drivers.push(`stabilità ${Math.round(input.stability)}/100`);
  // La sproporzione conta, ma è limitata: vivere accanto a un gigante ostile
  // è un pericolo, non una condanna. Senza un conflitto in corso la crisi non
  // può diventare critica: l'invasione richiede una guerra, non la geografia.
  const threatTerm = Math.min(40, Math.max(0, (threat - 1.2) * 8));
  let score = 0.30 * stabilityGap + threatTerm;
  if (input.atWar) {
    score += 35;
    drivers.push('conflitto in corso');
  }
  return { score: round1(clamp(score)), drivers };
}

const SCORERS: Record<CrisisDimension, (input: CrisisInput) => { score: number; drivers: string[] }> = {
  revolt: scoreRevolt,
  insolvency: scoreInsolvency,
  invasion: scoreInvasion,
};

/**
 * Bonus di persistenza: una crisi che dura non è uguale a una crisi appena
 * iniziata. Dopo ~90 giorni di arretrato il punteggio guadagna fino a 12 punti
 * — abbastanza per rendere visibile la deriva, mai per inventare un collasso.
 */
export function persistenceBonus(days: number): number {
  const safe = Math.max(0, Number(days) || 0);
  if (safe <= 0) return 0;
  return Math.min(12, round1(safe / 7.5));
}

/**
 * Valuta le tre dimensioni di crisi. Non modifica lo stato: restituisce solo
 * punteggi, livelli e spiegazioni. La progressione verso il collasso è gestita
 * da `advanceCrisis`, che ha bisogno anche dell'arretrato precedente e dei
 * giorni di calendario trascorsi.
 */
export function assessCrisis(
  input: CrisisInput,
  options: { persistence?: Partial<Record<CrisisDimension, number>> } = {},
): {
  risks: CrisisRisk[];
  level: CrisisLevel;
  levels: Record<CrisisDimension, CrisisLevel>;
} {
  const risks = (Object.keys(SCORERS) as CrisisDimension[]).map(dimension => {
    const { score, drivers } = SCORERS[dimension](input);
    const days = Math.max(0, Math.floor(Number(options.persistence?.[dimension] || 0)));
    const bonus = persistenceBonus(days);
    const total = round1(clamp(score + bonus));
    const allDrivers = days > 0
      ? [...drivers, `criticità da ${days} ${days === 1 ? 'giorno' : 'giorni'}`]
      : [...drivers];
    return {
      dimension,
      score: total,
      level: levelFor(total),
      title: DIMENSION_INFO[dimension].title,
      detail: DIMENSION_INFO[dimension].detail,
      drivers: allDrivers,
    } satisfies CrisisRisk;
  });
  const levels = risks.reduce((out, risk) => {
    out[risk.dimension] = risk.level;
    return out;
  }, {} as Record<CrisisDimension, CrisisLevel>);
  const rank: Record<CrisisLevel, number> = { calm: 0, watch: 1, critical: 2 };
  const level = risks.reduce<CrisisLevel>(
    (worst, risk) => (rank[risk.level] > rank[worst] ? risk.level : worst),
    'calm',
  );
  return { risks, level, levels };
}

function headlineFor(level: CrisisLevel, risks: CrisisRisk[]): string {
  if (level === 'calm') return 'Situazione sotto controllo';
  const critical = risks.filter(risk => risk.level === 'critical');
  const focus = (critical.length > 0 ? critical : risks.filter(risk => risk.level === 'watch'))
    .sort((left, right) => right.score - left.score);
  const label = focus.map(risk => risk.title.replace('Rischio di ', '')).join(' e ');
  return level === 'critical' ? `Crisi: ${label}` : `Allarme: ${label}`;
}

function summaryFor(
  level: CrisisLevel,
  risks: CrisisRisk[],
  criticalDays: Record<CrisisDimension, number>,
): string {
  if (level === 'calm') {
    return 'Nessuna delle tre strade del collasso è vicina: consenso, conti e difese reggono.';
  }
  const worst = [...risks].sort((left, right) => right.score - left.score)[0];
  const days = Math.max(0, Math.floor(Number(criticalDays[worst.dimension] || 0)));
  if (level === 'critical') {
    const prefix = days >= CRISIS_COLLAPSE_DAYS
      ? `Criticità da ${days} giorni: la nazione è a un passo dal collasso.`
      : days > 0
        ? `Criticità da ${days} giorni: la crisi va interrotta prima che diventi irreversibile.`
        : `Situazione critica: se la criticità dura, la nazione rischia il collasso.`;
    return `${prefix} ${worst.detail}`;
  }
  return days > 0
    ? `Attenzione: allarme da ${days} giorni, va corretto prima che diventi critico. ${worst.detail}`
    : `Attenzione: la deriva va corretta prima che diventi critica. ${worst.detail}`;
}

function clampDays(value: unknown): number {
  return Math.max(0, Math.min(CRISIS_MAX_DAYS, Math.floor(Number(value) || 0)));
}

/**
 * Fa scorrere la scala di crisi del **tempo di calendario** trascorso.
 *
 * - `options.days` = giorni di calendario effettivamente simulati in questo
 *   avanzamento (7, 30, 90, 365…): è la misura della progressione;
 * - `previous` = arretrato e avvertimenti già accumulati (persistiti);
 * - `advance: false` = lettura pura (dossier): non cambia nulla e non può
 *   chiudere la partita.
 *
 * Il collasso scatta solo se la dimensione è critica adesso e l'arretrato ha
 * superato `CRISIS_COLLAPSE_DAYS`, con almeno `CRISIS_MIN_EPISODES` avanzamenti
 * osservati oppure con una criticità ininterrotta oltre `CRISIS_ABRUPT_DAYS`.
 */
export function advanceCrisis(
  input: CrisisInput,
  previous: CrisisPersistence = {},
  options: { turn?: number; date?: string; advance?: boolean; days?: number } = {},
): CrisisState {
  const advance = options.advance !== false;
  const elapsed = advance ? Math.max(0, Math.floor(Number(options.days) || 0)) : 0;

  const priorDays = {} as Record<CrisisDimension, number>;
  const priorEpisodes = {} as Record<CrisisDimension, number>;
  for (const dimension of Object.keys(SCORERS) as CrisisDimension[]) {
    priorDays[dimension] = clampDays(previous.criticalDays?.[dimension]);
    priorEpisodes[dimension] = Math.max(0, Math.floor(Number(previous.episodes?.[dimension]) || 0));
  }

  const { levels } = assessCrisis(input);
  const criticalDays = { ...priorDays };
  const episodes = { ...priorEpisodes };
  for (const dimension of Object.keys(SCORERS) as CrisisDimension[]) {
    const days = priorDays[dimension];
    const seen = priorEpisodes[dimension];
    if (!advance || elapsed <= 0) {
      criticalDays[dimension] = days;
      episodes[dimension] = seen;
      continue;
    }
    if (levels[dimension] === 'critical') {
      criticalDays[dimension] = clampDays(days + elapsed);
      episodes[dimension] = seen + 1;
    } else if (levels[dimension] === 'watch') {
      // L'allarme logora più lentamente, ma non è gratis.
      criticalDays[dimension] = clampDays(days + Math.round(elapsed * CRISIS_WATCH_RATE));
      episodes[dimension] = seen;
    } else {
      // La calma consuma l'arretrato e fa dimenticare gli avvertimenti.
      criticalDays[dimension] = clampDays(days - Math.round(elapsed * CRISIS_RECOVERY_RATE));
      episodes[dimension] = 0;
    }
  }

  // I punteggi e i livelli finali tengono conto dell'arretrato: la stessa crisi
  // che dura da mesi pesa più di una appena iniziata.
  const { risks, level } = assessCrisis(input, { persistence: criticalDays });

  let ending: CrisisEnding | null = null;
  const collapsed = risks
    .filter(risk => risk.level === 'critical'
      && criticalDays[risk.dimension] >= CRISIS_COLLAPSE_DAYS
      && (episodes[risk.dimension] >= CRISIS_MIN_EPISODES
        || criticalDays[risk.dimension] >= CRISIS_ABRUPT_DAYS))
    .sort((left, right) => right.score - left.score);
  // Senza tempo trascorso non può scattare nulla: il collasso richiede sempre
  // giorni di calendario simulati in questo avanzamento.
  if (advance && elapsed > 0 && collapsed.length > 0) {
    const worst = collapsed[0];
    const info = DIMENSION_INFO[worst.dimension];
    const days = criticalDays[worst.dimension];
    ending = {
      kind: info.kind,
      dimension: worst.dimension,
      title: info.endingTitle,
      summary: days >= CRISIS_ABRUPT_DAYS
        ? `${info.endingSummary} La criticità durava da ${days} giorni senza interruzioni.`
        : info.endingSummary,
      date: String(options.date || ''),
      turn: Math.max(0, Math.floor(Number(options.turn) || 0)),
      criticalDimensions: collapsed.map(risk => risk.dimension),
    };
  }

  return {
    level,
    risks,
    headline: headlineFor(level, risks),
    summary: summaryFor(level, risks, criticalDays),
    criticalDays,
    episodes,
    collapseDays: CRISIS_COLLAPSE_DAYS,
    ending,
  };
}

/** Riga compatta per il prompt: la nazione conosce la propria crisi. */
export function describeCrisis(state: CrisisState): string {
  const parts = state.risks.map(risk => {
    const days = Math.max(0, Math.floor(Number(state.criticalDays?.[risk.dimension] || 0)));
    return `${risk.title}: ${risk.level} (${risk.score}/100, ${days}/${CRISIS_COLLAPSE_DAYS} giorni di criticità)`;
  });
  return `${state.headline}. ${parts.join(' · ')}`;
}
