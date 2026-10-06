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
  summarizeNationalAssets,
} from '../nationDossier';
import { groupProjectsByCategory } from '../projectCategory';
import { nationalVerdict } from '../governmentDossier';
import { deriveMaterialRows, materialRowsOf } from '../materialBalance';
import { arsenalBrief, arsenalBriefText, arsenalSplit, arsenalSplitText } from '../arsenalSummary';
import { index } from './format';
import { nationalOperatingPicture } from '../nationalOperatingPicture';
import { nationOperatingPictureInput } from '../nationOperatingPictureInput';
import type { HistoryPoint, MetricTrend, NationDockProps } from './types';
import { nationalSynthesis } from '../nationalSynthesis';
import { buildNationalDossierLive } from '../nationalDossierLive';

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
  // Dossier Nazionale vivo: baseline del Turno 0 + stato corrente del motore.
  // Read model puro — nessuna chiamata, nessuna cifra ricalcolata a mano.
  const live = useMemo(
    () => buildNationalDossierLive({ account, resources, arms, initialProfile: props.initialProfile }),
    [account, resources, arms, props.initialProfile],
  );
  const assets = useMemo(() => summarizeNationalAssets(regions, account), [regions, account]);
  // COUNTRY-CLARITY: quadro d'insieme. È un read model puro sui numeri già
  // pubblicati (conto, magazzino, arsenale, governo, storico): nessuna nuova
  // chiamata al motore, nessun valore stimato nel browser.
  const operatingPicture = useMemo(() => nationalOperatingPicture(nationOperatingPictureInput({
    regions,
    account,
    resources,
    arms,
    government,
    commitments,
    accountHistory,
    ongoingProcesses,
    maintenanceObligations: props.maintenanceObligations,
    crisis,
    pressures,
    today: props.today,
  })), [regions, account, resources, arms, government, commitments, accountHistory, ongoingProcesses, props.maintenanceObligations, crisis, pressures, props.today]);
  // I progetti in corso sono raggruppati per ambito (Difesa, Infrastrutture…).
  const projectGroups = useMemo(() => groupProjectsByCategory(ongoingProcesses), [ongoingProcesses]);
  // `warEffort` e `defenceBurdenPct` hanno ancora una superficie nel dossier;
  // gli altri indicatori del conto vivono nelle schede vive (`nationalDossier-
  // Live`), che li leggono direttamente da `account`/`resources`.
  const warEffort = Number(account?.warEffort ?? 0);
  const defenceBurdenPct = Number(account?.defenceBurdenPct ?? 0);
  const natural = resources?.natural ?? [];
  const market = resources?.market ?? [];
  const debt = Number(resources?.debt ?? 0);
  const creditHeadroomValue = Number(resources?.creditHeadroom ?? 0);
  // Portafoglio del debito: titoli con tasso e scadenza, interessi e rollover.
  const debtTranches = resources?.debts ?? [];
  const averageMaturity = Number(resources?.averageMaturityYears ?? 0);
  const marketRate = Number(resources?.marketRatePct ?? 0);
  const overdraft = Number(resources?.overdraft ?? 0);
  const activeModifiers = resources?.modifiers;
  // Bilancio dettagliato e giudizio complessivo: entrambi derivano dalle cifre
  // del motore; il verdetto è una soglia applicata ai numeri, non una stima.
  const budget = government?.budget ?? null;
  const verdict = useMemo(() => nationalVerdict(account, budget, government?.debt), [account, budget, government?.debt]);
  const factions = government?.factions ?? [];

  // Le voci del consiglio si chiedono al motore solo quando la sezione che le
  // mostra è aperta: V03 ha fuso Governo in «Regno», quindi la voce si apre
  // qui. Una chiamata on-demand, non un costo a ogni apertura del dossier.
  useEffect(() => {
    if (active !== 'regno') return;
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

  const provincesLabel = (value: number) => `${formatNumber(value)} ${value === 1 ? 'provincia' : 'province'}`;

  // Sintesi materiale (MATERIEL-CLARITY): righe del motore → righe leggibili.
  // Se il motore non pubblica il bilancio, la lista è vuota e la scheda lo dice.
  const materialRows = useMemo(() => deriveMaterialRows(resources?.balance), [resources?.balance]);
  const weaponsRows = useMemo(() => materialRowsOf(materialRows, ['weapons']), [materialRows]);
  // Arsenale: quanti mezzi sono in servizio e quanti in produzione, in sintesi.
  const armsOrders = arms?.production?.orders ?? [];
  const armsSummary = useMemo(() => arsenalBriefText(arsenalBrief(arms?.lines, armsOrders)), [arms?.lines, armsOrders]);
  // OP-OBJECTS PERSISTENT: dove sono i pezzi — deposito o assegnati a un oggetto.
  const armsSplit = useMemo(
    () => arsenalSplitText(arsenalSplit(arms?.units, arms?.stockpile, arms?.assigned)),
    [arms?.units, arms?.stockpile, arms?.assigned],
  );

  // Le tendenze derivano dallo storico pubblicato dal motore: se la serie ha
  // meno di due punti la variazione non viene mostrata (mai inventata).
  const pointDelta = (delta: number) => `${index(delta, 1, { sign: true })} pt`;
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
    active, assets, projectGroups, warEffort,
    defenceBurdenPct, natural, market, debt,
    creditHeadroomValue, debtTranches, averageMaturity, marketRate,
    overdraft, activeModifiers, budget, verdict, factions, modifiersActive,
    provincesLabel, pointDelta, mkTrend,
    materialRows, weaponsRows, armsSummary, armsSplit, operatingPicture,
    // M03 — l'area «Popolo» letta una volta sola, condivisa da sintesi e dossier.
    people: operatingPicture.people,
    // D03: la sintesi che apre il dossier. Composta dai read model già qui —
    // nessuna cifra nuova, nessuna chiamata in più.
    live,
    synthesis: nationalSynthesis({
      picture: operatingPicture,
      crisis: props.crisis,
      // Internal detectors are not player quests; the Advisor reads canonical facts.
      pressures: [],
      commitments: props.commitments,
      processes: props.ongoingProcesses,
      account,
      today: props.today,
    }),
  };
}
