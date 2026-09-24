/**
 * Debito sovrano — titoli con tasso e scadenza.
 * =============================================
 * Il debito pubblico non è un numero unico: è un portafoglio di emissioni, ognuna
 * con il suo tasso e la sua scadenza. Da qui derivano tre fatti che il motore
 * calcola in modo deterministico, senza l'LLM:
 *
 *   - **interessi passivi**: ogni mese si paga `capitale × tasso / 12`;
 *   - **scadenza (rollover)**: alla maturità il titolo va rimborsato o
 *     rifinanziato al tasso di mercato corrente; se il mercato non presta
 *     più (debito oltre il tetto), si entra in crisi;
 *   - **costo del denaro**: il tasso sale con la durata e con il rapporto
 *     debito/PIL — più una nazione è indebitata, più le costa indebitarsi.
 *
 * La nazione **può** fare debito: emette un titolo, incassa cassa oggi e si
 * assume interessi e scadenza domani. Ogni cosa ha un riflesso sociale calcolato
 * da `tensionFromDebtRatio`.
 */

export interface SovereignDebt {
  id: string;
  label: string;
  /** Capitale residuo in miliardi USD. */
  principal: number;
  /** Tasso annuo nominale (es. 3.4 = 3,4%). */
  annualRatePct: number;
  /** Data di emissione (YYYY-MM-DD). */
  issuedDate: string;
  /** Data di scadenza (YYYY-MM-DD). */
  maturityDate: string;
  termYears: number;
}

export interface DebtIssueOptions {
  amountMld: number;
  termYears: number;
  /** Data di emissione (YYYY-MM-DD). */
  date: string;
  /** Rapporto debito/PIL corrente in % (decide il premio di rischio). */
  debtRatioPct: number;
  id?: string;
  label?: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Somma dei capitali residui (mld). */
export function debtPrincipal(debts: readonly SovereignDebt[] | undefined): number {
  const list = Array.isArray(debts) ? debts : [];
  return round3(list.reduce((total, debt) => total + Math.max(0, Number(debt?.principal) || 0), 0));
}

/** Interessi passivi annui del portafoglio (mld). */
export function annualInterestMld(debts: readonly SovereignDebt[] | undefined): number {
  const list = Array.isArray(debts) ? debts : [];
  const total = list.reduce(
    (sum, debt) => sum + Math.max(0, Number(debt?.principal) || 0) * Math.max(0, Number(debt?.annualRatePct) || 0) / 100,
    0,
  );
  return round3(total);
}

/** Scadenza media ponderata residua, in anni (0 se il portafoglio è vuoto). */
export function averageMaturityYears(debts: readonly SovereignDebt[] | undefined, asOfDate: string): number {
  const list = Array.isArray(debts) ? debts : [];
  const principal = debtPrincipal(list);
  if (principal <= 0) return 0;
  const years = list.reduce((sum, debt) => {
    const months = monthsBetween(asOfDate, debt.maturityDate);
    return sum + (Math.max(0, debt.principal) / principal) * Math.max(0, months) / 12;
  }, 0);
  return round1(years);
}

/** Tasso base per durata: il mercato chiede di più per prestare a lungo. */
export function baseRatePct(termYears: number): number {
  const term = Math.max(0, Number(termYears) || 0);
  return round1(Math.min(6, 2.4 + term * 0.07));
}

/**
 * Premio di rischio legato al rapporto debito/PIL. Sotto il 60% è nullo; poi
 * cresce: oltre il 150% il mercato chiede tassi da crisi.
 */
export function riskPremiumPct(debtRatioPct: number): number {
  const ratio = Math.max(0, Number(debtRatioPct) || 0);
  if (ratio <= 60) return 0;
  if (ratio <= 90) return round1((ratio - 60) * 0.06);
  if (ratio <= 150) return round1(1.8 + (ratio - 90) * 0.08);
  return round1(Math.min(12, 6.6 + (ratio - 150) * 0.05));
}

/** Tasso di mercato per una nuova emissione: base per durata + premio di rischio. */
export function marketRatePct(debtRatioPct: number, termYears: number): number {
  return round1(Math.min(18, baseRatePct(termYears) + riskPremiumPct(debtRatioPct)));
}

/**
 * Quota di rifinanziamento annua dello stock ereditato. Con una vita media di
 * ~10 anni, ogni anno scade circa un decimo del portafoglio e si rifinanzia al
 * prezzo di oggi; il resto resta al tasso a cui fu emesso.
 */
export const INHERITED_REFINANCE_SHARE = 0.1;
/**
 * Cedola media del portafoglio già in essere, in % annuo. È il tasso a cui una
 * nazione si è davvero indebitata nei decenni precedenti: basso in termini
 * nominali correnti, che è esattamente il motivo per cui il Giappone paga
 * pochissimo su un debito del 214% del PIL.
 */
export const INHERITED_LEGACY_COUPON_PCT = 1;
/** Tetto del tasso effettivo: uno stock a tassi storici non è mai a tasso di crisi. */
export const INHERITED_EFFECTIVE_CAP_PCT = 5;

/**
 * **Tasso effettivo di carry** di uno stock di debito ereditato.
 *
 * Il debito pubblico di un paese non è emesso al tasso di mercato di oggi: è un
 * portafoglio costruito in decenni, e solo la quota che scade si rifinanzia al
 * prezzo corrente. Caricare tutto lo stock al tasso di mercato — premio di
 * rischio compreso — produceva un costo che nessuno Stato paga: il Giappone
 * arrivava al 275% delle entrate in interessi, l'Italia al 113%, e la crisi di
 * insolvenza scattava prima che il giocatore potesse fare qualunque cosa.
 *
 * Il tasso effettivo è quindi la cedola media storica più il contributo della
 * sola quota rifinanziata (`INHERITED_REFINANCE_SHARE`) al premio di rischio
 * corrente. Il debito **nuovo** continua a costare il prezzo di mercato pieno
 * (`marketRatePct`): è quello che il giocatore sceglie di fare, e lo paga.
 */
export function inheritedCarryRatePct(debtRatioPct: number): number {
  const premium = riskPremiumPct(debtRatioPct) * INHERITED_REFINANCE_SHARE;
  return round1(Math.min(
    INHERITED_EFFECTIVE_CAP_PCT,
    Math.max(0.5, INHERITED_LEGACY_COUPON_PCT + premium),
  ));
}

function parseDate(date: string): Date {
  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? new Date('1970-01-01T00:00:00Z') : parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Data di scadenza a `years` anni da `date`. */
export function addYears(date: string, years: number): string {
  const base = parseDate(date);
  const day = base.getUTCDate();
  const target = new Date(base.getTime());
  target.setUTCDate(1);
  target.setUTCFullYear(base.getUTCFullYear() + Math.max(0, Math.round(years)));
  // Convenzione di fine mese: il 29 febbraio scade il 28 febbraio, non il 1° marzo.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return formatDate(target);
}

function monthsBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * Emette un nuovo titolo: il motore incassa `amountMld` di cassa e registra la
 * passività con tasso di mercato e scadenza. Funzione pura.
 */
export function issueDebtTranche(
  debts: readonly SovereignDebt[],
  options: DebtIssueOptions,
): { debts: SovereignDebt[]; tranche: SovereignDebt } {
  const amount = Math.max(0, Number(options.amountMld) || 0);
  const termYears = Math.max(1, Math.round(Number(options.termYears) || 10));
  const rate = marketRatePct(options.debtRatioPct, termYears);
  const tranche: SovereignDebt = {
    id: options.id || `debt-${String(options.date).slice(0, 10)}-${debts.length + 1}`,
    label: options.label || `Titolo ${termYears} anni`,
    principal: round3(amount),
    annualRatePct: rate,
    issuedDate: String(options.date).slice(0, 10),
    maturityDate: addYears(options.date, termYears),
    termYears,
  };
  return { debts: [...debts, tranche], tranche };
}

/** Titoli giunti a scadenza entro `date` (inclusa). */
export function maturedDebts(debts: readonly SovereignDebt[] | undefined, date: string): SovereignDebt[] {
  const list = Array.isArray(debts) ? debts : [];
  const at = parseDate(date).getTime();
  return list.filter(debt => debt.maturityDate && parseDate(debt.maturityDate).getTime() <= at);
}

/**
 * Rifinanzia un titolo giunto a scadenza: stesso capitale, tasso di mercato
 * corrente, nuova scadenza. È il rollover, il momento in cui il debito "torna".
 */
export function rolloverTranche(
  tranche: SovereignDebt,
  date: string,
  debtRatioPct: number,
  termYears = tranche.termYears,
): SovereignDebt {
  const term = Math.max(1, Math.round(Number(termYears) || tranche.termYears || 10));
  return {
    ...tranche,
    annualRatePct: marketRatePct(debtRatioPct, term),
    issuedDate: String(date).slice(0, 10),
    maturityDate: addYears(date, term),
    termYears: term,
    label: tranche.label.replace(/\d+\s*anni/, `${term} anni`),
  };
}

/**
 * Riflessi sociali del debito: un rapporto debito/PIL molto alto alimenta
 * tensione e logora la stabilità. Deterministico e limitato.
 */
export function tensionFromDebtRatio(debtRatioPct: number, serviceRatioPct = 0): { socialTension: number; stability: number } {
  const ratio = Math.max(0, Number(debtRatioPct) || 0);
  const service = Math.max(0, Number(serviceRatioPct) || 0);
  let tension = 0;
  if (ratio > 60) tension += Math.min(14, (ratio - 60) * 0.12);
  if (ratio > 120) tension += Math.min(12, (ratio - 120) * 0.1);
  // Un servizio del debito che mangia le entrate pesa anche a debito moderato.
  tension += Math.min(16, Math.max(0, service - 8) * 0.6);
  tension = Math.min(38, tension);
  return { socialTension: round1(tension), stability: tension === 0 ? 0 : round1(-tension * 0.5) };
}

/**
 * Bonifica lo **stock di debito ereditato** portandolo a un tasso effettivo di
 * carry invece del tasso di mercato pieno, e riporta le etichette alla ragione
 * vera. È idempotente: applicandola due volte il risultato non cambia, quindi
 * vale anche per i salvataggi scritti prima della correzione (il chiamante
 * riscrive la riga).
 *
 * Tocca **solo** le tranche marcate `debt-inherited-` (o etichettate «Debito
 * ereditato»): il debito emesso dal giocatore resta al suo tasso di mercato,
 * perché quello è davvero il prezzo a cui si è indebitato.
 */
export function normalizeInheritedDebtRates(
  debts: readonly SovereignDebt[] | undefined,
  debtRatioPct: number,
): { debts: SovereignDebt[]; changed: boolean } {
  const list = Array.isArray(debts) ? debts : [];
  const carry = inheritedCarryRatePct(debtRatioPct);
  let changed = false;
  const next = list.map(debt => {
    const isInherited = String(debt?.id || '').startsWith('debt-inherited-')
      || /debito ereditato/i.test(String(debt?.label || ''));
    if (!isInherited) return debt;
    const rate = round1(debt.annualRatePct);
    const label = `Debito ereditato ${debt.termYears} anni`;
    if (rate === carry && debt.label === label) return debt;
    changed = true;
    return { ...debt, annualRatePct: carry, label };
  });
  return { debts: next, changed };
}

/**
 * Bonifica le **date** dello stock di debito ereditato: la semina avveniva
 * prima che la sessione conoscesse la data del mondo, quindi i titoli nascevano
 * con il default dello stato (`1951-01-01`). In un mondo del 2000 significava
 * titoli emessi nel 1951 e **scaduti da decenni**, con la scadenza media del
 * dossier a zero perché ogni titolo era già oltre la maturità.
 *
 * La data corretta è quella di partenza del mondo: le tranche ereditate sono per
 * costruzione il portafoglio con cui la nazione entra in scena. Una tranche la
 * cui data di emissione **coincide con l'anno di partenza** è già corretta (o è
 * stata rifinanziata al tasso giusto) e viene lasciata intatta.
 *
 * Idempotente; tocca solo le tranche `debt-inherited-*`.
 */
export function normalizeInheritedDebtDates(
  debts: readonly SovereignDebt[] | undefined,
  worldStartDate: string,
): { debts: SovereignDebt[]; changed: boolean } {
  const list = Array.isArray(debts) ? debts : [];
  const start = String(worldStartDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { debts: [...list], changed: false };
  const startYear = start.slice(0, 4);
  let changed = false;
  const next = list.map(debt => {
    const isInherited = String(debt?.id || '').startsWith('debt-inherited-')
      || /debito ereditato/i.test(String(debt?.label || ''));
    if (!isInherited) return debt;
    const issued = String(debt.issuedDate || '').slice(0, 10);
    // Già sulla scala del mondo (emessa o rifinanziata): niente da fare.
    if (issued.slice(0, 4) === startYear) return debt;
    const termYears = Math.max(1, Math.round(Number(debt.termYears) || 10));
    changed = true;
    return {
      ...debt,
      issuedDate: start,
      maturityDate: addYears(start, termYears),
      termYears,
    };
  });
  return { debts: next, changed };
}

/** Riga leggibile di un titolo, per il dossier e la cronaca. */
export function describeDebtTranche(tranche: SovereignDebt): string {
  return `${tranche.label}: ${round1(tranche.principal)} mld al ${tranche.annualRatePct}% (scadenza ${tranche.maturityDate})`;
}
