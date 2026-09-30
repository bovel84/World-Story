/**
 * World Story — WS-GOVOFFICE-07: l'atto concreto del Ministro del Tesoro
 * =====================================================================
 * Il difetto osservato dall'autore: il Ministro del Tesoro dice «ho 2 proposte»
 * ma non porta nulla — sono bullet, non una scena. Questo modulo è la **Parte B**
 * del task: derivare, dai read model del motore, un **atto concreto** con cifre
 * reali, e le **strade firmabili** che da quell'atto nascono.
 *
 * Tre regole, le stesse del resto del progetto:
 *  - **nessun numero inventato**: ogni cifra viene dai conti nazionali
 *    (`account`, `resources`) o dal quadro economia già calcolato, e dichiara la
 *    sua provenienza (`misurato · conti nazionali`);
 *  - **l'atto ha le cifre nella voce**, non in una scatola KPI separata: il
 *    ministro le dice parlando;
 *  - **l'ordine è reale**: la strada d'investimento accoda l'ordine d'opera che
 *    il motore esegue (apre il cantiere e addebita la cassa); la strada
 *    d'ammortamento accoda un ordine in testo. In entrambi i casi l'atto entra
 *    nel registro, non resta una promessa.
 *
 * Limite dichiarato (vedi report): il motore **non ha** un'azione di rimborso
 * titoli dedicata — la scadenza è un rollover automatico. L'atto quindi
 * **dichiara** la scadenza e il risparmio d'interessi atteso come conseguenza
 * misurata del rimborso, ma non finge che il motore applichi il rimborso: il
 * costo immediato dichiarato è l'impegno dell'atto, l'effetto sul debito lo
 * applica il motore al turno.
 */

import type { CabinetItemView, CabinetPathView, CabinetSessionView } from '../../services/api';
import type { NationalOperatingPicture } from './nationalOperatingPicture';
import type { NationOperatingPictureSources } from './nationOperatingPictureInput';
import { formatMoney, formatPercent } from '../../utils/format';
import { MONEY_UNIT } from './NationDock/format';
import type { CanvasTone } from './seatCanvasModel';

/** Provenienza dichiarata di ogni cifra dell'atto. */
export const ACT_BASIS = 'misurato · conti nazionali';

export interface TreasuryActFigure {
  label: string;
  display: string;
  basis: string;
  tone: CanvasTone;
}

export interface TreasuryWorksRequest {
  workId: string;
  workName: string;
  need: string;
  /** Cosa manca alla distinta, secondo il server (`declaration.missingMaterials`). */
  missing: string[];
  figures: TreasuryActFigure[];
  /** La voce dei Lavori e la strada da accodare: il motore apre il cantiere. */
  item: CabinetItemView;
  path: CabinetPathView;
}

export interface TreasuryMaturity {
  label: string;
  principal: number;
  annualRatePct: number;
  maturityDate: string;
  /** Giorni alla scadenza, `null` se la data di gioco non è pubblicata. */
  daysToMaturity: number | null;
}

/** L'ordine firmabile che nasce da una strada. */
export type TreasuryRoadOrder =
  | { kind: 'work'; item: CabinetItemView; path: CabinetPathView }
  | { kind: 'text'; text: string };

export interface TreasuryRoad {
  id: string;
  title: string;
  /** Come la direbbe il ministro: le cifre stanno **dentro** la frase. */
  voice: string;
  declaredCost: string;
  expectedGain: string;
  recommended: boolean;
  order: TreasuryRoadOrder;
}

export interface TreasuryAct {
  seatLabel: string;
  /** La voce con cui il ministro apre: contiene le cifre del motore. */
  voice: string;
  figures: TreasuryActFigure[];
  worksRequest: TreasuryWorksRequest | null;
  nextMaturity: TreasuryMaturity | null;
  roads: TreasuryRoad[];
}

export interface TreasuryActInput {
  session: CabinetSessionView | null;
  /** Il quadro operativo nazionale (contiene già `economy`). */
  picture: NationalOperatingPicture | null;
  sources: NationOperatingPictureSources;
}

const money = (value: number | null, decimals = 2): string =>
  value === null ? '—' : formatMoney(value, { currency: MONEY_UNIT, decimals, sign: true });

const level = (value: number | null, decimals = 0): string =>
  value === null ? '—' : formatMoney(value, { currency: MONEY_UNIT, decimals });

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function daysBetween(fromISO: string | null | undefined, toISO: string): number | null {
  if (!fromISO) return null;
  const from = new Date(`${String(fromISO).slice(0, 10)}T00:00:00Z`).getTime();
  const to = new Date(`${String(toISO).slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/**
 * La richiesta di un altro ministro: il primo **cantiere** che i Lavori portano
 * in seduta, con la sua distinta. Il Tesoro non la inventa — la legge dalla
 * seduta che il server compone per la sedia dei Lavori.
 */
export function worksRequestFrom(session: CabinetSessionView | null): TreasuryWorksRequest | null {
  const lavori = session?.addresses.find(address => address.seat === 'lavori');
  if (!lavori) return null;
  const candidate = lavori.items.find(item => Boolean(item.work));
  if (!candidate?.work) return null;

  const path = candidate.paths.find(candidatePath => candidatePath.id === 'build_now')
    ?? candidate.paths[0];
  if (!path) return null;

  const missing = candidate.declaration?.missingMaterials?.map(
    material => `${material.resourceId} (${material.missing})`,
  ) ?? [];

  return {
    workId: candidate.work.workId,
    workName: candidate.work.name,
    need: candidate.need,
    missing,
    figures: candidate.figures.map(figure => ({
      label: figure.label,
      display: `${figure.value} ${figure.unit}`.trim(),
      basis: figure.basis.kind === 'measured'
        ? `misurato · ${figure.basis.source}`
        : figure.basis.kind === 'estimated'
          ? `stimato · ${figure.basis.method}`
          : `dato mancante · ${figure.basis.missing}`,
      tone: figure.basis.kind === 'unknown' ? 'warning' : 'neutral',
    })),
    item: candidate,
    path,
  };
}

/** La scadenza più vicina nel portafoglio titoli, con i giorni che mancano. */
export function nextMaturityFrom(
  sources: NationOperatingPictureSources,
): TreasuryMaturity | null {
  const tranches = sources.resources?.debts ?? [];
  if (tranches.length === 0) return null;
  const withDate = tranches
    .filter(tranche => Boolean(tranche.maturityDate))
    .map(tranche => ({
      label: tranche.label || tranche.id,
      principal: finite(tranche.principal) ?? 0,
      annualRatePct: finite(tranche.annualRatePct) ?? 0,
      maturityDate: String(tranche.maturityDate).slice(0, 10),
    }))
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
  if (withDate.length === 0) return null;

  const today = String(sources.today ?? '').slice(0, 10);
  const next = (today
    ? withDate.find(tranche => tranche.maturityDate >= today)
    : undefined) ?? withDate[0];

  return { ...next, daysToMaturity: daysBetween(today || null, next.maturityDate) };
}

/**
 * L'atto del Tesoro e le sue strade. `picture` fornisce `economy` (servizio del
 * debito, mesi di cassa) già calcolato: qui non si ricalcola nulla.
 */
export function treasuryAct(input: TreasuryActInput): TreasuryAct {
  const { session, picture, sources } = input;
  const account = sources.account ?? null;
  const resources = sources.resources ?? null;
  const economy = picture?.economy ?? null;

  const tesoro = session?.addresses.find(address => address.seat === 'tesoro') ?? null;
  const seatLabel = tesoro?.label ?? 'Ministro del Tesoro';

  const cash = finite(resources?.money) ?? finite(account?.money);
  const balance = finite(account?.monthlyBalance);
  const debtRatioPct = finite(account?.debtRatioPct) ?? finite(resources?.debtRatioPct);
  const debtServicePct = finite(account?.debtServicePct) ?? economy?.debtServicePct ?? null;
  const annualInterest = finite(resources?.annualInterest);
  const treasuryMonths = economy?.treasuryMonths ?? null;

  const figures: TreasuryActFigure[] = [
    { label: 'Cassa disponibile', display: level(cash), basis: ACT_BASIS, tone: cash !== null && cash < 0 ? 'critical' : 'neutral' },
    { label: 'Saldo di bilancio', display: money(balance), basis: ACT_BASIS, tone: balance === null ? 'neutral' : balance >= 0 ? 'positive' : 'warning' },
    { label: 'Debito / PIL', display: debtRatioPct === null ? '—' : formatPercent(debtRatioPct, 0), basis: ACT_BASIS, tone: debtRatioPct === null ? 'neutral' : debtRatioPct >= 100 ? 'critical' : debtRatioPct >= 60 ? 'warning' : 'positive' },
    { label: 'Interessi / entrate', display: debtServicePct === null ? '—' : formatPercent(debtServicePct, 1), basis: ACT_BASIS, tone: debtServicePct === null ? 'neutral' : debtServicePct >= 20 ? 'critical' : debtServicePct >= 8 ? 'warning' : 'positive' },
    { label: 'Interessi annui', display: level(annualInterest, 2), basis: ACT_BASIS, tone: annualInterest !== null && annualInterest > 0 ? 'warning' : 'neutral' },
    { label: 'Cassa in mesi di spesa', display: treasuryMonths === null ? '—' : `${treasuryMonths} mesi`, basis: 'stimato · cassa divisa per la spesa mensile del motore', tone: treasuryMonths === null ? 'neutral' : treasuryMonths < 1 ? 'critical' : treasuryMonths < 3 ? 'warning' : 'positive' },
  ];

  const worksRequest = worksRequestFrom(session);
  const nextMaturity = nextMaturityFrom(sources);

  // ── La voce dell'atto: le cifre dentro la frase, non in una scatola ────────
  const openingBits: string[] = [];
  if (cash !== null) openingBits.push(`in cassa ci sono ${level(cash)}`);
  if (balance !== null) {
    openingBits.push(balance >= 0
      ? `il bilancio chiude in avanzo di ${money(balance)} al mese`
      : `il bilancio chiude in disavanzo di ${money(balance)} al mese`);
  }
  if (debtServicePct !== null) openingBits.push(`gli interessi assorbono il ${formatPercent(debtServicePct, 1)} delle entrate`);
  if (nextMaturity) {
    openingBits.push(`${level(nextMaturity.principal)} di titoli scadono il ${nextMaturity.maturityDate}${nextMaturity.daysToMaturity !== null ? ` (fra ${nextMaturity.daysToMaturity} giorni)` : ''}`);
  }
  if (worksRequest) openingBits.push(`il collega dei Lavori chiede fondi per «${worksRequest.workName}»`);
  const voice = openingBits.length > 0
    ? `Signor Presidente, ${openingBits.join(', ')}.`
    : 'Signor Presidente, i conti di questa nazione non sono ancora pubblicati: non porto cifre che non esistono.';

  // ── Le due strade: ammortamento del debito / investimento ─────────────────
  const roads: TreasuryRoad[] = [];

  if (nextMaturity) {
    const savedInterest = Math.round(nextMaturity.principal * nextMaturity.annualRatePct) / 100;
    const repayText = [
      `Rimborso titoli: ${level(nextMaturity.principal)} in scadenza il ${nextMaturity.maturityDate}`,
      `— Il Tesoro impegna ${level(nextMaturity.principal)} per estinguere anziché rifinanziare il titolo «${nextMaturity.label}» (${nextMaturity.annualRatePct}% annuo).`,
      `Costo immediato: ${level(nextMaturity.principal)} di cassa.`,
      `Effetto futuro misurato: ${level(savedInterest, 2)} di interessi in meno all'anno.`,
    ].join('\n');
    roads.push({
      id: 'repay',
      title: 'Ammortamento del debito',
      voice: `Rimborsare i ${level(nextMaturity.principal)} che scadono il ${nextMaturity.maturityDate} toglie dal bilancio ${level(savedInterest, 2)} di interessi l'anno.`,
      declaredCost: level(nextMaturity.principal),
      expectedGain: `${level(savedInterest, 2)} di interessi in meno all'anno`,
      recommended: (debtServicePct ?? 0) >= 10,
      order: { kind: 'text', text: repayText },
    });
  }

  if (worksRequest) {
    const missingText = worksRequest.missing.length > 0
      ? `mancano ${worksRequest.missing.join(', ')}`
      : 'la distinta è coperta';
    const investText = [
      `Fondo per le opere: ${worksRequest.workName}`,
      `— Trasferire al Ministro dei Lavori i fondi per «${worksRequest.workName}» (${missingText}).`,
      `Costo immediato: lo liquida il motore sul conto della nazione all'esecuzione dell'atto.`,
      `Effetto futuro: l'opera consegna il suo effetto dichiarato nel catalogo al completamento.`,
    ].join('\n');
    roads.push({
      id: 'invest',
      title: 'Investimento',
      voice: `Aprire il cantiere per «${worksRequest.workName}»: ${missingText}. L'opera consegna il suo effetto al completamento.`,
      declaredCost: worksRequest.missing.length > 0 ? `distinta scoperta: ${worksRequest.missing.join(', ')}` : 'distinta coperta',
      expectedGain: 'l’opera consegna il suo effetto dichiarato nel catalogo',
      recommended: (debtServicePct ?? 0) < 10 && worksRequest.missing.length === 0,
      order: { kind: 'work', item: worksRequest.item, path: worksRequest.path },
    });
  }

  return { seatLabel, voice, figures, worksRequest, nextMaturity, roads };
}
