/**
 * World Story — Dossier Nazione: logica derivata
 * =============================================
 * Estratto da `NationDock.tsx` (blocco 2, punto 4): comportamento invariato.
 * Stato locale del dossier, valori derivati dai numeri del motore e azioni
 * economiche. Il componente resta presentazionale.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  initialNationDockState,
} from '../../../stores/nationDock';
import { formatNumber } from '../../../utils/format';
import { deltaTone, trendFrom } from '../accountTrend';
import {
  financeBalance,
  hasNationalFinance,
  summarizeNationalAssets,
} from '../nationDossier';
import { groupProjectsByCategory } from '../projectCategory';
import { nationalVerdict } from '../governmentDossier';
import { deriveMaterialRows, materialRowsOf } from '../materialBalance';
import { arsenalBrief, arsenalBriefText, arsenalLineSummary, arsenalProductionFor, arsenalSplit, arsenalSplitText } from '../arsenalSummary';
import { index, money, resourceMonths } from './format';
import { nationalOperatingPicture } from '../nationalOperatingPicture';
import type { HistoryPoint, MetricTrend, NationDockProps } from './types';
import { nationalSynthesis } from '../nationalSynthesis';

export function useNationDockModel(props: NationDockProps) {
  const {
    account,
    resources,
    arms,
    trade,
    accountHistory = [],
    regions = [],
    ongoingProcesses = [],
    government,
    governmentVoices,
    governmentVoicesLoading = false,
    onLoadGovernmentVoices,
    onBorrowDebt,
    fiscalPolicy,
    onSetFiscalPolicy,
    fiscalPolicyBusy = false,
    commitments,
    crisis,
    pressures,
  } = props;

  const [state, setState] = useState(initialNationDockState);
  const [trading, setTrading] = useState(false);
  const [borrowing, setBorrowing] = useState(false);
  const [borrowAmount, setBorrowAmount] = useState('');
  const [borrowTerm, setBorrowTerm] = useState(10);
  // Aliquota in corso di modifica: parte dal valore pubblicato dal motore.
  const [taxDraft, setTaxDraft] = useState<number | null>(null);
  const effectiveTaxPct = fiscalPolicy?.taxRatePct ?? account?.taxRatePct ?? null;
  const runSetTax = async () => {
    if (!onSetFiscalPolicy || fiscalPolicyBusy || taxDraft === null) return;
    await onSetFiscalPolicy(taxDraft);
    setTaxDraft(null);
  };
  const runBorrow = async () => {
    if (!onBorrowDebt || borrowing) return;
    const amount = Number(borrowAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBorrowing(true);
    try {
      await onBorrowDebt(amount, borrowTerm);
      setBorrowAmount('');
    } finally {
      setBorrowing(false);
    }
  };
  const runTrade = async (mode: 'sell' | 'buy', resourceId: string, quantity: number) => {
    if (!trade || trading) return;
    setTrading(true);
    try {
      await trade(mode, resourceId, quantity);
    } finally {
      setTrading(false);
    }
  };
  const active = state.activeSection;
  const assets = useMemo(() => summarizeNationalAssets(regions, account), [regions, account]);
  // COUNTRY-CLARITY: quadro d'insieme. È un read model puro sui numeri già
  // pubblicati (conto, magazzino, arsenale, governo, storico): nessuna nuova
  // chiamata al motore, nessun valore stimato nel browser.
  const operatingPicture = useMemo(() => nationalOperatingPicture({
    account,
    resources,
    arsenal: arms,
    assets: { capacityBase: { forces: assets.baseForces } },
    government,
    budget: government?.budget ?? null,
    commitments,
    history: accountHistory,
    processes: ongoingProcesses,
    maintenance: props.maintenanceObligations ?? null,
    crisis,
    pressures,
    today: props.today ?? null,
  }), [account, resources, arms, assets.baseForces, government, commitments, accountHistory, ongoingProcesses, props.maintenanceObligations, crisis, pressures, props.today]);
  // I progetti in corso sono raggruppati per ambito (Difesa, Infrastrutture…).
  const projectGroups = useMemo(() => groupProjectsByCategory(ongoingProcesses), [ongoingProcesses]);
  const financeAvailable = hasNationalFinance(account);
  const balance = financeBalance(account);
  const stability = Number(account?.stability ?? 0);
  const socialTension = Number(account?.socialTension ?? 0);
  const warEffort = Number(account?.warEffort ?? 0);
  const mobilized = Number(account?.mobilized ?? 0);
  const defenceBurdenPct = Number(account?.defenceBurdenPct ?? 0);
  const growth = Number(account?.annualGrowthRate ?? 0);
  const natural = resources?.natural ?? [];
  const market = resources?.market ?? [];
  // La valuta è la cifra centrale del dossier: tesoreria, debito e credito
  // residuo vivono nella sezione «Cassa» e nella sintesi.
  const treasury = Number(resources?.money ?? 0);
  const debt = Number(resources?.debt ?? 0);
  const debtRatioPct = Number(resources?.debtRatioPct ?? account?.debtRatioPct ?? account?.debtBurdenPct ?? 0);
  const creditLimitValue = Number(resources?.creditLimit ?? 0);
  const creditHeadroomValue = Number(resources?.creditHeadroom ?? 0);
  // Portafoglio del debito: titoli con tasso e scadenza, interessi e rollover.
  const debtTranches = resources?.debts ?? [];
  const annualInterest = Number(resources?.annualInterest ?? 0);
  const averageMaturity = Number(resources?.averageMaturityYears ?? 0);
  const marketRate = Number(resources?.marketRatePct ?? 0);
  const overdraft = Number(resources?.overdraft ?? 0);
  const activeModifiers = resources?.modifiers;
  // Bilancio dettagliato e giudizio complessivo: entrambi derivano dalle cifre
  // del motore; il verdetto è una soglia applicata ai numeri, non una stima.
  const budget = government?.budget ?? null;
  const verdict = useMemo(() => nationalVerdict(account, budget, government?.debt), [account, budget, government?.debt]);
  const factions = government?.factions ?? [];

  // Le voci del consiglio si chiedono al motore solo quando la scheda Governo
  // è aperta: una chiamata on-demand, non un costo a ogni apertura del dossier.
  useEffect(() => {
    if (active !== 'governo') return;
    if (!onLoadGovernmentVoices) return;
    if (governmentVoices || governmentVoicesLoading) return;
    onLoadGovernmentVoices();
  }, [active, onLoadGovernmentVoices, governmentVoices, governmentVoicesLoading]);
  const modifiersActive = Boolean(activeModifiers && (
    Number(activeModifiers.stability ?? 0) !== 0
    || Number(activeModifiers.socialTension ?? 0) !== 0
    || Number(activeModifiers.warEffort ?? 0) !== 0
    || Number(activeModifiers.revenueMultiplier ?? 1) !== 1
    || Number(activeModifiers.growthModifier ?? 0) !== 0
  ));

  // Fabbisogno mensile e capacità di stoccaggio: il motore li pubblica; se
  // mancano si ricade sulla formula del conto, mai su un valore inventato.
  const popM = Number(account?.population ?? 0) / 1_000_000;
  const troops = Number(account?.forces ?? 0) + Number(account?.mobilized ?? 0);
  const foodMonthly = Number(resources?.needs?.food ?? (popM * 0.02 + troops * 0.06));
  const clothingMonthly = Number(resources?.needs?.clothing ?? (popM * 0.008 + troops * 0.01));
  const weaponsMonthly = Number(resources?.needs?.weapons ?? troops * 0.004);
  const fuelMonthly = Number(resources?.needs?.fuel ?? (Number(account?.forces ?? 0) * 0.03 + Number(account?.factories ?? 0) * 0.05));
  const capacity = resources?.capacity;
  // Sintesi materiale (MATERIEL-CLARITY): righe del motore → righe leggibili.
  // Se il motore non pubblica il bilancio, la lista è vuota e la scheda lo dice.
  const materialRows = useMemo(() => deriveMaterialRows(resources?.balance), [resources?.balance]);
  const weaponsRows = useMemo(() => materialRowsOf(materialRows, ['weapons']), [materialRows]);
  // Arsenale: quanti mezzi sono in servizio e quanti in produzione, per riga.
  const armsOrders = arms?.production?.orders ?? [];
  const armsSummary = useMemo(() => arsenalBriefText(arsenalBrief(arms?.lines, armsOrders)), [arms?.lines, armsOrders]);
  // OP-OBJECTS PERSISTENT: dove sono i pezzi — deposito o assegnati a un oggetto.
  const armsSplit = useMemo(
    () => arsenalSplitText(arsenalSplit(arms?.units, arms?.stockpile, arms?.assigned)),
    [arms?.units, arms?.stockpile, arms?.assigned],
  );
  const lineSummary = (line: { id: string; quantity: number; name: string; strength?: number; sharePct?: number }) =>
    arsenalLineSummary(line, arsenalProductionFor(armsOrders, line.id));
  const coverHint = (value: number, monthly: number, cap?: number) => {
    const capText = cap && cap > 0 ? ` · capacità ${formatNumber(cap)}` : '';
    const months = resourceMonths(value, monthly);
    if (!Number.isFinite(months)) return `nessun consumo registrato${capText}`;
    // Niente falsa precisione: oltre un anno si parla in anni, oltre dieci di
    // «oltre 10 anni». Una scorta enorme non diventa «8000,0 mesi».
    if (months >= 120) return `oltre 10 anni di copertura${capText}`;
    if (months >= 24) return `${Math.round(months / 12)} anni di copertura${capText}`;
    if (months >= 10) return `${Math.round(months)} mesi di copertura${capText}`;
    return `${index(months, 1)} mesi di copertura${capText}`;
  };
  /** Con la capacità nota le scorte si leggono come «quanto / tetto». */
  const matValue = (value: number, cap?: number) => (cap && cap > 0 ? `${formatNumber(value)} / ${formatNumber(cap)}` : formatNumber(value));
  const provincesLabel = (value: number) => `${formatNumber(value)} ${value === 1 ? 'provincia' : 'province'}`;

  // Le tendenze derivano dallo storico pubblicato dal motore: se la serie ha
  // meno di due punti la variazione non viene mostrata (mai inventata).
  const moneyDelta = (delta: number) => money(delta, 2, { sign: true });
  const pointDelta = (delta: number) => `${index(delta, 1, { sign: true })} pt`;
  const countDelta = (delta: number) => index(delta, 0, { sign: true });
  const mkTrend = useMemo(() => (
    pick: (point: HistoryPoint) => number | undefined | null,
    formatDelta: (delta: number) => string,
    goodDirection: 'up' | 'down',
  ): MetricTrend | undefined => {
    const trend = trendFrom(accountHistory, pick);
    if (!trend) return undefined;
    const flat = Math.abs(trend.delta) < 1e-9;
    return { trend, deltaText: flat ? 'stabile' : formatDelta(trend.delta), tone: deltaTone(trend.delta, goodDirection) };
  }, [accountHistory]);


  return {
    ...props,
    account, resources, trade, accountHistory, regions, ongoingProcesses,
    // GAMEPLAY-LONG: identità della nazione giocata, per ordinare le strategie.
    playerPolityId: props.playerPolityId,
    state, setState, trading, borrowing, borrowAmount, setBorrowAmount, borrowTerm, setBorrowTerm,
    taxDraft, setTaxDraft, effectiveTaxPct, runSetTax, runBorrow, runTrade,
    active, assets, projectGroups, financeAvailable, balance, stability, socialTension, warEffort,
    mobilized, defenceBurdenPct, growth, natural, market, treasury, debt, debtRatioPct,
    creditLimitValue, creditHeadroomValue, debtTranches, annualInterest, averageMaturity, marketRate,
    overdraft, activeModifiers, budget, verdict, factions, modifiersActive, popM, troops,
    foodMonthly, clothingMonthly, weaponsMonthly, fuelMonthly, capacity, coverHint, matValue,
    provincesLabel, moneyDelta, pointDelta, countDelta, mkTrend,
    materialRows, weaponsRows, armsSummary, armsSplit, lineSummary, operatingPicture,
    // M03 — l'area «Popolo» letta una volta sola, condivisa da sintesi e dossier.
    people: operatingPicture.people,
    // D03: la sintesi che apre il dossier. Composta dai read model già qui —
    // nessuna cifra nuova, nessuna chiamata in più.
    synthesis: nationalSynthesis({
      picture: operatingPicture,
      crisis: props.crisis,
      pressures: props.pressures,
      commitments: props.commitments,
      processes: props.ongoingProcesses,
      account,
      today: props.today,
    }),
  };
}
