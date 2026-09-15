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
 * scala (calma → allarme → critica) e solo dopo `CRISIS_COLLAPSE_STREAK`
 * turni consecutivi di criticità si arriva alla fine. Chi reagisce in tempo
 * riporta la crisi sotto controllo; chi ignora gli avvertimenti perde.
 *
 * Il modulo è **puro e deterministico**: stessi indicatori, stesso esito.
 */

export type CrisisDimension = 'revolt' | 'insolvency' | 'invasion';
export type CrisisLevel = 'calm' | 'watch' | 'critical';
export type EndingKind = 'revolution' | 'default' | 'invasion';

/** Soglie dichiarate della scala di crisi. */
export const CRISIS_WATCH_SCORE = 45;
export const CRISIS_CRITICAL_SCORE = 70;
/** Turni consecutivi di criticità prima del collasso. */
export const CRISIS_COLLAPSE_STREAK = 3;

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
  /** Punteggio 0-100, deterministico e leggibile. */
  score: number;
  title: string;
  detail: string;
  /** Fattori che hanno portato il punteggio: numeri reali, non giudizi. */
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

export interface CrisisState {
  level: CrisisLevel;
  risks: CrisisRisk[];
  /** Riga breve per l'HUD. */
  headline: string;
  summary: string;
  /** Turni consecutivi di criticità per dimensione (0 se non critica). */
  streaks: Record<CrisisDimension, number>;
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
 * Valuta le tre dimensioni di crisi. Non modifica lo stato: restituisce solo
 * punteggi, livelli e spiegazioni. La progressione verso il collasso è gestita
 * da `advanceCrisis`, che ha bisogno anche dei turni precedenti.
 */
export function assessCrisis(input: CrisisInput): {
  risks: CrisisRisk[];
  level: CrisisLevel;
  levels: Record<CrisisDimension, CrisisLevel>;
} {
  const risks = (Object.keys(SCORERS) as CrisisDimension[]).map(dimension => {
    const { score, drivers } = SCORERS[dimension](input);
    return {
      dimension,
      score,
      level: levelFor(score),
      title: DIMENSION_INFO[dimension].title,
      detail: DIMENSION_INFO[dimension].detail,
      drivers,
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

function summaryFor(level: CrisisLevel, risks: CrisisRisk[]): string {
  if (level === 'calm') {
    return 'Nessuna delle tre strade del collasso è vicina: consenso, conti e difese reggono.';
  }
  const worst = [...risks].sort((left, right) => right.score - left.score)[0];
  const prefix = level === 'critical'
    ? `Situazione critica: al prossimo turno di stallo la nazione rischia il collasso.`
    : `Attenzione: la deriva va corretta prima che diventi critica.`;
  return `${prefix} ${worst.detail}`;
}

/**
 * Avanza la scala di crisi di un turno. Una dimensione critica accumula un
 * turno di stallo; se torna sotto controllo la sua serie si azzera. Al
 * raggiungimento di `CRISIS_COLLAPSE_STREAK` turni critici la partita finisce.
 *
 * `advance` è false quando si valuta soltanto (lettura del dossier): in quel
 * caso le serie non cambiano e non può scattare un collasso.
 */
export function advanceCrisis(
  input: CrisisInput,
  previousStreaks: Partial<Record<CrisisDimension, number>> = {},
  options: { turn?: number; date?: string; advance?: boolean } = {},
): CrisisState {
  const { risks, level } = assessCrisis(input);
  const advance = options.advance !== false;
  const streaks = { ...previousStreaks } as Record<CrisisDimension, number>;
  for (const risk of risks) {
    const prior = Math.max(0, Number(streaks[risk.dimension] || 0));
    streaks[risk.dimension] = !advance
      ? prior
      : risk.level === 'critical'
        ? Math.min(CRISIS_COLLAPSE_STREAK, prior + 1)
        : 0;
  }

  let ending: CrisisEnding | null = null;
  const collapsed = risks
    .filter(risk => streaks[risk.dimension] >= CRISIS_COLLAPSE_STREAK)
    .sort((left, right) => right.score - left.score);
  if (advance && collapsed.length > 0) {
    const worst = collapsed[0];
    const info = DIMENSION_INFO[worst.dimension];
    ending = {
      kind: info.kind,
      dimension: worst.dimension,
      title: info.endingTitle,
      summary: info.endingSummary,
      date: String(options.date || ''),
      turn: Math.max(0, Math.floor(Number(options.turn) || 0)),
      criticalDimensions: collapsed.map(risk => risk.dimension),
    };
  }

  return {
    level,
    risks,
    headline: headlineFor(level, risks),
    summary: summaryFor(level, risks),
    streaks,
    ending,
  };
}

/** Riga compatta per il prompt: la nazione conosce la propria crisi. */
export function describeCrisis(state: CrisisState): string {
  const parts = state.risks.map(risk => `${risk.title}: ${risk.level} (${risk.score}/100, serie ${state.streaks[risk.dimension]}/${CRISIS_COLLAPSE_STREAK})`);
  return `${state.headline}. ${parts.join(' · ')}`;
}
