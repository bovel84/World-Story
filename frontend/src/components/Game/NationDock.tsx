/**
 * World Story — Dossier Nazione (G5-A)
 * ====================================
 * Read model nazionale: espone solo dati già pubblicati dal motore o dalla
 * mappa autorevole; nessun valore economico, tecnologico o istituzionale è
 * stimato nel browser.
 *
 * Leggibilità (revisione): il dossier è organizzato in blocchi tematici con
 * etichette brevi, carte uniformi e numeri tabulari. Ogni cifra ha un tono
 * (positivo/attenzione/negativo) derivato dai valori del motore, così lo stato
 * della nazione si legge a colpo d'occhio.
 */

import React from 'react';
import {
  setSection,
  NATION_SECTIONS,
  NATION_SECTION_LABEL,
  type NationSection,
} from '../../stores/nationDock';
import { StrategicBriefingCard } from './StrategicBriefingCard';
import { formatMoney, formatNumber, formatPercent } from '../../utils/format';
import {
  pressureTone,
  satisfactionTone,
} from './governmentDossier';
import type { NationDockProps } from './NationDock/types';
import {
  DOMAIN_LABELS, RESOURCE_LABELS, TIER_LABEL, TIER_TONE,
  defenceTone, formatBillions, formatDate, plural, resourceTone,
  stabilityTone, tensionTone, warEffortTone,
} from './NationDock/format';
import {
  BudgetBreakdown, CrisisBlock, DebtPortfolio, DossierBlock, EmptyState,
  EquipmentSpecs, FactionCard, Footnote, Metric, MetricGrid, PressuresBlock,
  CommitmentsList, PowersAgendaList, ProgressRow, ResourceTradeRow, VerdictBanner,
} from './NationDock/widgets';
import { useNationDockModel } from './NationDock/useNationDockModel';
import { MaterialBalanceList } from './MaterialBalanceList';
import { ObjectsBoard } from './ObjectsBoard';
import { DomainOperatingBlock, OperatingPictureBoard } from './OperatingPictureBoard';
import { NationalSynthesisPanel } from './NationalSynthesisPanel';

// Ri-esportati per i consumatori storici (`DeskContent`, `nationDossier`).
export type { HistoryPoint, NationAccount, NationDockProps, NationResources, Tone } from './NationDock/types';

export const NationDock: React.FC<NationDockProps> = (props) => {
  // OP-OBJECTS: la creazione di reparti è un'azione del motore. Qui si tiene solo
  // lo stato «in corso» del pulsante, non i numeri.
  const [formationBusy, setFormationBusy] = React.useState(false);
  const raiseFormation = React.useCallback(async (options: { formations?: number; armyId?: string | null; name?: string } = {}) => {
    setFormationBusy(true);
    try {
      await props.onRaiseFormation?.(options);
    } finally {
      setFormationBusy(false);
    }
  }, [props.onRaiseFormation]);
  // MILITARY-UNITS: anche le azioni del reparto sono del motore. Qui si tiene
  // solo lo stato «in corso» del pannello, non i numeri.
  const [unitBusy, setUnitBusy] = React.useState(false);
  const unitAction = React.useCallback(async (request: import('../../services/api').UnitActionRequest) => {
    if (request.dryRun) return props.onUnitAction?.(request) as Promise<import('../../services/api').UnitActionImpactPayload>;
    setUnitBusy(true);
    try {
      return await (props.onUnitAction?.(request) as Promise<import('../../services/api').UnitActionImpactPayload>);
    } finally {
      setUnitBusy(false);
    }
  }, [props.onUnitAction]);
  // MILITARY-UNITS PR2: le mosse del fronte sono dello stesso motore degli NPC.
  const unitOrder = React.useCallback(async (request: import('../../services/api').UnitOrderRequest) => {
    if (request.dryRun) return props.onUnitOrder?.(request) as Promise<import('../../services/api').UnitOrderImpactPayload>;
    setUnitBusy(true);
    try {
      return await (props.onUnitOrder?.(request) as Promise<import('../../services/api').UnitOrderImpactPayload>);
    } finally {
      setUnitBusy(false);
    }
  }, [props.onUnitOrder]);
  const {
    governmentType, account, resources, arms, procure, trade,
    onPreviewFormation,
    ongoingProcesses, completedProcesses = [], mandateDecisions = [], maintenanceObligations = [], onAcknowledgeMandateDecision,
    government, onDraftOrder, governmentVoices, governmentVoicesLoading, governmentVoicesError,
    onBorrowDebt, fiscalPolicy, onSetFiscalPolicy, fiscalPolicyBusy,
    pressures, recentPressures, onResolvePressure, pressureBusy, crisis, briefing, strategicAgenda, commitments,
    today: worldDate,
    setState, active, trading, borrowing, borrowAmount, setBorrowAmount, borrowTerm, setBorrowTerm,
    taxDraft, setTaxDraft, effectiveTaxPct, runSetTax, runBorrow, runTrade,
    assets, projectGroups, financeAvailable, balance, stability, socialTension, warEffort, mobilized,
    defenceBurdenPct, growth, natural, market, treasury, debt, debtRatioPct, creditLimitValue,
    creditHeadroomValue, debtTranches, annualInterest, averageMaturity, marketRate, overdraft,
    budget, verdict, factions, modifiersActive, foodMonthly,
    clothingMonthly, weaponsMonthly, fuelMonthly, capacity, coverHint, matValue, provincesLabel,
    moneyDelta, pointDelta, countDelta, mkTrend,
    materialRows, weaponsRows, armsSummary, armsSplit, lineSummary, playerPolityId, operatingPicture, synthesis,
  } = useNationDockModel(props);

  // COUNTRY-CLARITY: dal quadro d'insieme si salta alla sezione di dettaglio.
  const openSection = (section: NationSection) => setState((prev) => setSection(prev, section));

  return (
    <div className="nation-dock">
      <nav className="nation-dock-tabs" aria-label="Sezioni del dossier">
        {NATION_SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            className={`nation-dock-tab${active === section ? ' active' : ''}`}
            aria-current={active === section ? 'page' : undefined}
            onClick={() => setState((prev) => setSection(prev, section))}
          >
            {NATION_SECTION_LABEL[section]}
          </button>
        ))}
      </nav>

      <div className="nation-dock-body">
        {active === 'situazione' && (
          <>
            {/* D03/I3: il dossier si apre sulla **sintesi** — giudizio, lista
                unica delle cose da fare, azione minima. Il quadro a sei aree
                che stava qui non sparisce: scende in fondo alla sezione come
                dettaglio (I6), e resta raggiungibile. */}
            <NationalSynthesisPanel synthesis={synthesis} onOpenSection={openSection} />

            {briefing && <StrategicBriefingCard briefing={briefing} />}

            <DossierBlock
              title="Sintesi"
              description="Tesoreria, bilancio e tenuta interna: lo stato della nazione a colpo d'occhio."
            >
              <MetricGrid>
                <Metric
                  label="Tesoreria"
                  value={formatMoney(treasury, { currency: 'mld', decimals: 2, sign: true })}
                  tone={treasury > 0 ? 'positive' : treasury < 0 ? 'negative' : 'warning'}
                  hint={debt > 0 ? `Debito ${formatMoney(debt, { currency: 'mld', decimals: 1 })}` : 'Riserva valutaria disponibile'}
                  trend={mkTrend((point) => point.account.money, moneyDelta, 'up')}
                  hero
                />
                <Metric
                  label="Saldo mensile"
                  value={formatMoney(balance, { currency: 'mld', decimals: 2, sign: true })}
                  tone={balance >= 0 ? 'positive' : 'negative'}
                  hint={financeAvailable ? 'Entrate meno uscite' : 'Bilancio non pubblicato'}
                  trend={mkTrend((point) => point.account.monthlyBalance, moneyDelta, 'up')}
                  hero
                />
                <Metric
                  label="Stabilità"
                  value={formatPercent(stability)}
                  tone={stabilityTone(stability)}
                  hint="Consenso e tenuta istituzionale"
                  trend={mkTrend((point) => point.account.stability, pointDelta, 'up')}
                  hero
                />
                <Metric
                  label="Tensione sociale"
                  value={formatPercent(socialTension)}
                  tone={tensionTone(socialTension)}
                  hint="Pressione interna su popolazione e governo"
                  trend={mkTrend((point) => point.account.socialTension, pointDelta, 'down')}
                  hero
                />
              </MetricGrid>
              <VerdictBanner verdict={verdict} />
            </DossierBlock>

            <DossierBlock
              title="Crisi della nazione"
              description="Le tre strade del collasso — rivolta, default, invasione — calcolate dagli indicatori reali. Se una resta critica per troppi turni, la partita finisce."
            >
              <CrisisBlock crisis={crisis} />
            </DossierBlock>

            <DossierBlock
              title="Sfide del momento"
              description="Pressioni interne ed esterne generate dal motore: ogni turno porta qualcosa da decidere. Ignorarle ha un costo."
            >
              <PressuresBlock
                pressures={pressures || []}
                recent={recentPressures || []}
                onResolve={onResolvePressure}
                busy={pressureBusy}
                money={account?.money}
              />
            </DossierBlock>

            <DossierBlock
              title="Impegni della partita"
              description="Trattati, promesse, garanzie e ultimatum registrati dal motore: stato, controparte, importanza e scadenza. La cronaca racconta, il registro ricorda."
            >
              <CommitmentsList commitments={commitments?.commitments || []} today={worldDate || ''} />
            </DossierBlock>

            <DossierBlock
              title="Strategie delle potenze"
              description="Che cosa stanno inseguendo le nazioni del teatro: obiettivi persistenti del motore, con la data di nascita, il motivo e il progresso misurato sugli indicatori del turno."
            >
              <PowersAgendaList powers={strategicAgenda?.powers || []} playerPolityId={playerPolityId} />
            </DossierBlock>

            <DossierBlock
              title="Decisioni richieste"
              description="Scorte sotto soglia e processi che attendono un'autorizzazione."
            >
              <div className="nation-decisions">
                {mandateDecisions.map((decision) => (
                  <div key={`${decision.mandateId}-${decision.kind}`} className="nation-decision-live">
                    <b>Scorta minima non coperta · {decision.resourceId}</b>
                    <span>Disponibile {decision.availableStock} su minimo {decision.minStock} · mancano {decision.shortfall} (mandato {decision.mandateId}).</span>
                    {onAcknowledgeMandateDecision && <button type="button" className="nation-decision-ack" onClick={() => void onAcknowledgeMandateDecision(decision.mandateId, decision.kind)}>Prendi atto</button>}
                  </div>
                ))}
                {maintenanceObligations.filter(item => !item.sufficient).map((item) => (
                  <div key={`maint-${item.facilityId}`} className="nation-decision-live">
                    <b>Manutenzione non coperta · {item.typeName}</b>
                    <span>
                      Serve {item.baseUnits} {item.resourceId} ogni {item.periodDays} giorni · disponibile {item.available}, mancano {item.shortfall}.
                    </span>
                  </div>
                ))}
                {mandateDecisions.length === 0 && !maintenanceObligations.some(item => !item.sufficient) && (ongoingProcesses.length > 0 ? (
                  <div className="nation-decision-live"><b>{ongoingProcesses.length} {ongoingProcesses.length === 1 ? 'processo richiede monitoraggio' : 'processi richiedono monitoraggio'}</b><span>Apri Progetti per vedere le prossime scadenze registrate.</span></div>
                ) : <EmptyState>Nessuna decisione richiede attenzione immediata.</EmptyState>)}
              </div>
            </DossierBlock>

            {/* Il quadro a sei aree: era l'apertura della sezione, ora è il
                **dettaglio** che la sintesi riassume (I5: una sola superficie
                per lo stato). Resta un blocco raggiungibile, non una seconda
                prima schermata. */}
            <details className="nation-synthesis-detail">
              <summary>Quadro d&apos;insieme per dominio</summary>
              <OperatingPictureBoard picture={operatingPicture} onOpenSection={openSection} />
            </details>
          </>
        )}

        {active === 'governo' && (
          <>
            <DossierBlock
              title="Quadro del governo"
              description="Sostegno, opposizione, promesse e tenuta: gli stessi numeri del quadro d'insieme, letti prima del dettaglio."
            >
              <DomainOperatingBlock picture={operatingPicture} id="governo" />
            </DossierBlock>

            <DossierBlock
              title="Consiglio dei ministri"
              description="Le anime del governo: chi ha più influenza, chi è soddisfatto e chi adesso preme per cambiare rotta."
            >
              {government ? (
                <>
                  <div className="nation-government-summary">
                    <p className="nation-government-headline">{governmentVoices?.council || government.headline}</p>
                    <MetricGrid>
                      <Metric
                        label="Coesione del governo"
                        value={formatPercent(government.cohesion, 0)}
                        tone={satisfactionTone(government.cohesion)}
                        hint="Soddisfazione media ponderata per influenza"
                      />
                      <Metric
                        label="Pressione politica"
                        value={formatPercent(government.pressureIndex, 0)}
                        tone={pressureTone(government.pressureIndex)}
                        hint="Quanto il consiglio preme sul governo"
                      />
                      <Metric
                        label="Fazioni attive"
                        value={formatNumber(factions.length)}
                        hint="Interessi rappresentati nel consiglio"
                      />
                    </MetricGrid>
                    {(governmentVoicesLoading || governmentVoicesError) && (
                      <p className={`nation-government-status${governmentVoicesError ? ' is-error' : ''}`} role="status">
                        {governmentVoicesError || 'Il consiglio sta discutendo…'}
                      </p>
                    )}
                  </div>
                  {factions.length > 0 ? (
                    <ul className="nation-faction-list">
                      {factions.map((faction) => (
                        <li key={faction.id}>
                          <FactionCard
                            faction={faction}
                            dominant={faction.id === government.dominantId}
                            angriest={faction.id === government.angriestId}
                            onDraftOrder={onDraftOrder}
                            voice={governmentVoices?.voices?.[faction.id]}
                            speaking={governmentVoicesLoading}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState>Nessuna fazione registrata per questo governo.</EmptyState>
                  )}
                  <Footnote><b>Come funziona</b> il motore calcola chi esiste, quanta influenza ha e che cosa chiede; il modello dà voce a ciascuna anima in una petizione breve, coerente con umore e pressione. Le cifre restano la fonte, mai il copione. Ogni richiesta può diventare un ordine reale: «Porta in consiglio» riempie la bozza e apre il compositore, senza spendere nulla finché l'ordine non è registrato e il tempo non avanza.</Footnote>
                </>
              ) : (
                <EmptyState>Le anime del governo non sono ancora pubblicate per questa partita.</EmptyState>
              )}
            </DossierBlock>
          </>
        )}

        {active === 'progetti' && (
          <DossierBlock
            title="Progetti e processi"
            description="Che cosa è avviato, in che ambito, a che punto è e quando è previsto l'esito."
          >
            {ongoingProcesses.length === 0 && completedProcesses.length === 0 ? (
              <EmptyState>Nessun progetto registrato alla data corrente.</EmptyState>
            ) : (
              <>
                {projectGroups.map((group) => (
                  <section key={group.category.key} className="nation-process-group">
                    <h4 className="nation-process-category">{group.category.label}</h4>
                    <ul className="nation-process-list">
                      {group.projects.map((process) => (
                        <li key={process.id}>
                          <b>{process.title}</b>
                          <span>{process.summary}</span>
                          <ProgressRow
                            label="Realizzazione"
                            percent={Number(process.progress ?? 0)}
                            note={process.expected_date
                              ? `Avviato ${formatDate(process.started_date)} · esito previsto ${formatDate(process.expected_date)}`
                              : `Avviato ${formatDate(process.started_date)} · nessuna scadenza dichiarata${process.progress_note ? ` · ${process.progress_note}` : ''}`}
                          />
                          {process.expected_date && process.progress_note && (
                            <small className="nation-process-note">{process.progress_note}</small>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}

                {completedProcesses.length > 0 && (
                  <section className="nation-process-group is-completed">
                    <h4 className="nation-process-category">Completati</h4>
                    <ul className="nation-process-list">
                      {completedProcesses.map((process) => (
                        <li key={process.id}>
                          <b>{process.title}</b>
                          <span>{process.summary}</span>
                          {/* Un processo concluso non è «in realizzazione»: la
                              percentuale è ferma a 100 e l'etichetta lo dice. */}
                          <ProgressRow
                            label="Completato"
                            percent={100}
                            note={process.completed_date
                              ? `Avviato ${formatDate(process.started_date)} · completato il ${formatDate(process.completed_date)}`
                              : `Avviato ${formatDate(process.started_date)} · completato entro la scadenza prevista`}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            <Footnote>I progetti sono raggruppati per ambito. L'avanzamento è calcolato dal motore tra la data di avvio e la scadenza dichiarata; alla scadenza il progetto è chiuso e passa in «Completati». Senza scadenza resta «in corso» finché il modello non ne dichiara l'esito.</Footnote>
          </DossierBlock>
        )}

        {active === 'bilancio' && (
          <>
            <DossierBlock
              title="Quadro economico"
              description="Avanzo o disavanzo, debito, interessi e cassa: la diagnosi prima delle voci di bilancio."
            >
              <DomainOperatingBlock picture={operatingPicture} id="economia" />
            </DossierBlock>

            <DossierBlock
              title="Tesoreria e debito"
              description="La valuta della nazione: ciò che è in cassa, ciò che si è preso a prestito e quanto credito resta."
            >
              <MetricGrid>
                <Metric
                  label="Tesoreria"
                  value={formatMoney(treasury, { currency: 'mld', decimals: 2, sign: true })}
                  tone={treasury > 0 ? 'positive' : treasury < 0 ? 'negative' : 'warning'}
                  hint={treasury < 0 ? 'Cassa negativa: il disavanzo è debito' : 'Riserva valutaria disponibile'}
                  trend={mkTrend((point) => point.account.money, moneyDelta, 'up')}
                  hero
                />
                <Metric
                  label="Debito pubblico"
                  value={formatMoney(debt, { currency: 'mld', decimals: 2 })}
                  tone={debt > 0 ? 'warning' : 'positive'}
                  hint={debt > 0
                    ? `${debtRatioPct !== 0 ? `Debito al ${formatPercent(debtRatioPct, 1)} del PIL` : 'Debito in essere'} · su un tetto di ${formatMoney(creditLimitValue, { currency: 'mld', decimals: 0 })}`
                    : 'Nessun debito: si può ancora andare a debito'}
                  trend={mkTrend((point) => point.account.debt, moneyDelta, 'down')}
                />
                <Metric
                  label="Credito residuo"
                  value={formatMoney(creditHeadroomValue, { currency: 'mld', decimals: 2 })}
                  tone={creditHeadroomValue > 0 ? 'positive' : 'negative'}
                  hint="Spazio per nuove spese a debito"
                />
                <Metric
                  label="Saldo mensile"
                  value={formatMoney(balance, { currency: 'mld', decimals: 2, sign: true })}
                  tone={balance >= 0 ? 'positive' : 'negative'}
                  hint="Entrate meno uscite: come cambia la cassa ogni mese"
                  trend={mkTrend((point) => point.account.monthlyBalance, moneyDelta, 'up')}
                  hero
                />
              </MetricGrid>
              {(debtTranches.length > 0 || debt > 0) && (
                <div className="nation-debt-block">
                  <h4 className="nation-subhead">Portafoglio del debito</h4>
                  <MetricGrid>
                    <Metric
                      label="Interessi annui"
                      value={formatMoney(annualInterest, { currency: 'mld', decimals: 2 })}
                      tone={annualInterest > 0 ? 'negative' : 'positive'}
                      hint="Costo del debito ogni anno"
                    />
                    <Metric
                      label="Scadenza media"
                      value={`${formatMoney(averageMaturity, { decimals: 1 })} anni`}
                      tone="neutral"
                      hint="Quanto in là torna il debito"
                    />
                    <Metric
                      label="Tasso di mercato"
                      value={formatPercent(marketRate, 1)}
                      tone={marketRate >= 8 ? 'negative' : marketRate >= 4 ? 'warning' : 'positive'}
                      hint="Tasso per una nuova emissione oggi"
                    />
                  </MetricGrid>
                  <DebtPortfolio tranches={debtTranches} total={debt} />
                  {overdraft > 0 && (
                    <p className="nation-debt-overdraft">
                      Scoperto di cassa: {formatMoney(overdraft, { currency: 'mld', decimals: 2 })} — cassa negativa, distinta dai titoli emessi.
                    </p>
                  )}
                  {onBorrowDebt && (
                    <form className="nation-borrow" onSubmit={(event) => { event.preventDefault(); void runBorrow(); }}>
                      <label>
                        <span>Nuova emissione</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          inputMode="decimal"
                          value={borrowAmount}
                          placeholder="mld"
                          onChange={(event) => setBorrowAmount(event.target.value)}
                          aria-label="Importo da prendere a prestito in miliardi"
                        />
                      </label>
                      <label>
                        <span>Durata</span>
                        <select value={borrowTerm} onChange={(event) => setBorrowTerm(Number(event.target.value))} aria-label="Durata del titolo">
                          {[2, 5, 10, 15, 30].map((term) => <option key={term} value={term}>{term} anni</option>)}
                        </select>
                      </label>
                      <button type="submit" disabled={borrowing || creditHeadroomValue <= 0}>
                        {borrowing ? 'Emissione…' : 'Emetti titoli'}
                      </button>
                      <span className="nation-borrow-hint">Spazio disponibile: {formatMoney(creditHeadroomValue, { currency: 'mld', decimals: 2 })}</span>
                    </form>
                  )}
                  <Footnote><b>Il debito ha un prezzo e una data</b> ogni titolo paga interessi ogni anno e torna a scadenza: alla maturità il motore lo rifinanzia al tasso di mercato del momento. Più la nazione è indebitata, più alti sono tasso e premio di rischio; un rapporto debito/PIL elevato alza la tensione sociale e logora la stabilità. La cassa negativa è scoperto, non un titolo: si paga al tasso di sconto.</Footnote>
                </div>
              )}
              <Footnote><b>Come si muove la cassa</b> ogni mese la tesoreria cambia del saldo mensile (entrate + reddito da risorse − uscite − interessi sul debito). Le scelte del giocatore la muovono subito: un ordine eseguito preleva una spesa una tantum, gli acquisti militari e le compravendite sul mercato si pagano al momento, i movimenti di truppe costano carburante e denaro. Un saldo negativo la riduce; sotto zero la differenza è debito pubblico.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Flussi mensili"
              description="Quanto entra, quanto esce e come cresce l'economia."
            >
              {financeAvailable ? (
                <MetricGrid>
                  <Metric label="Entrate mensili" value={formatMoney(Number(account?.monthlyRevenue ?? 0), { currency: 'mld', decimals: 2, sign: true })} tone="positive" trend={mkTrend((point) => point.account.monthlyRevenue, moneyDelta, 'up')} />
                  <Metric label="Uscite mensili" value={formatMoney(Number(account?.monthlyExpenses ?? 0), { currency: 'mld', decimals: 2, sign: true })} tone="neutral" trend={mkTrend((point) => point.account.monthlyExpenses, moneyDelta, 'down')} />
                  <Metric label="Crescita annua" value={formatPercent(growth * 100, 1)} tone={growth > 0 ? 'positive' : growth < 0 ? 'negative' : 'neutral'} trend={mkTrend((point) => Number(point.account.annualGrowthRate ?? 0) * 100, pointDelta, 'up')} />
                  <Metric label="PIL nominale" value={formatMoney(assets.gdpBillions, { currency: 'mld', decimals: 1 })} tone="neutral" hint="Prodotto interno lordo pubblicato dal motore" />
                </MetricGrid>
              ) : (
                <EmptyState>Questo scenario non pubblica ancora voci di bilancio nel conto nazionale.</EmptyState>
              )}
            </DossierBlock>

            {budget && (budget.revenue.length > 0 || budget.expense.length > 0) && (
              <DossierBlock
                title="Composizione del bilancio"
                description="Le voci dietro i due totali: da dove entrano le entrate, dove escono le uscite."
              >
                <div className="nation-budget-columns">
                  <BudgetBreakdown title="Entrate mensili" lines={budget.revenue} total={budget.revenueTotal} kind="revenue" />
                  <BudgetBreakdown title="Uscite mensili" lines={budget.expense} total={budget.expenseTotal} kind="expense" />
                </div>
                <MetricGrid>
                  <Metric label="Pressione fiscale effettiva" value={formatPercent(budget.effectiveTaxRatePct, 1)} tone="neutral" hint="Entrate annue sul PIL" />
                  <Metric label="Spesa sociale" value={`${formatPercent(budget.socialBurdenPct, 1)} del PIL`} tone="neutral" hint="Sanità e sostegno sociale" />
                  <Metric label="Istruzione e ricerca" value={`${formatPercent(budget.educationBurdenPct, 1)} del PIL`} tone="neutral" hint="Scuola, atenei e laboratori" />
                  {/* La quota di difesa è la **stessa** `defenceBurdenPct` letta in
                      «Pressione militare»: una cifra, un posto. Qui la ripartizione
                      delle uscite rimanda là, dove l'apparato si vede nel dettaglio. */}
                  <Metric
                    label="Difesa"
                    value={`${formatPercent(budget.defenceBurdenPct, 1)} del PIL`}
                    tone={defenceTone(budget.defenceBurdenPct)}
                    hint="Voce di spesa: dettaglio in Armamenti"
                    onClick={() => openSection('armamenti')}
                  />
                </MetricGrid>
                <Footnote><b>Come si legge</b> ogni voce è una ripartizione deterministica dei totali pubblicati dal motore, calcolata sui driver reali (fabbriche, porti, atenei, riserve, popolazione). La difesa è la quota esatta dichiarata dal conto; la somma delle voci è il totale. Nessun importo è stimato nel browser.</Footnote>
              </DossierBlock>
            )}

            <DossierBlock
              title="Pressione militare"
              description="Il costo dell'apparato militare e delle riserve richiamate."
            >
              <MetricGrid>
                <Metric
                  label="Spesa militare"
                  value={defenceBurdenPct > 0 ? `${formatPercent(defenceBurdenPct, 1)} del PIL` : '—'}
                  tone={defenceTone(defenceBurdenPct)}
                  hint="Quota del PIL destinata alla difesa"
                  trend={mkTrend((point) => point.account.defenceBurdenPct, pointDelta, 'down')}
                />
                <Metric
                  label="Riserve mobilitate"
                  value={formatNumber(mobilized)}
                  tone={mobilized > 0 ? 'warning' : 'positive'}
                  hint="Formazioni richiamate, non ancora operative"
                  trend={mkTrend((point) => point.account.mobilized, countDelta, 'down')}
                />
                <Metric
                  label="Sforzo bellico"
                  value={formatPercent(warEffort)}
                  tone={warEffortTone(warEffort)}
                  hint="Forze e riserve sul totale nazionale"
                  trend={mkTrend((point) => point.account.warEffort, pointDelta, 'down')}
                />
              </MetricGrid>
            </DossierBlock>

            <Footnote><b>Fonte</b> MaterialEconomy e WorldStateEngine.accounts · valori letti, non stimati dal client.</Footnote>
          </>
        )}

        {active === 'risorse' && (
          <>
            <DossierBlock
              title="Quadro di risorse e industria"
              description="Scorte, flussi e autonomia; stabilimenti, capacità usata e colli di bottiglia."
            >
              <DomainOperatingBlock picture={operatingPicture} id="risorse" onOpenSection={openSection} />
              <DomainOperatingBlock picture={operatingPicture} id="industria" onOpenSection={openSection} />
            </DossierBlock>

            <DossierBlock
              title="Magazzino materiale"
              description="Scorte reali del paese: cibo, vestiario, armi, carburante e ricerca. Ogni voce ha un tetto di stoccaggio."
            >
              {resources ? (
                <>
                  <MetricGrid>
                    <Metric
                      label="Cibo"
                      value={matValue(Number(resources.food ?? 0), capacity?.food)}
                      tone={resourceTone(Number(resources.food ?? 0), foodMonthly)}
                      hint={coverHint(Number(resources.food ?? 0), foodMonthly, capacity?.food)}
                    />
                    <Metric
                      label="Vestiario"
                      value={matValue(Number(resources.clothing ?? 0), capacity?.clothing)}
                      tone={resourceTone(Number(resources.clothing ?? 0), clothingMonthly)}
                      hint={coverHint(Number(resources.clothing ?? 0), clothingMonthly, capacity?.clothing)}
                    />
                    <Metric
                      label="Scorte armi"
                      value={matValue(Number(resources.weapons ?? 0), capacity?.weapons)}
                      tone={resourceTone(Number(resources.weapons ?? 0), weaponsMonthly)}
                      hint={coverHint(Number(resources.weapons ?? 0), weaponsMonthly, capacity?.weapons)}
                    />
                    <Metric
                      label="Carburante"
                      value={matValue(Number(resources.fuel ?? 0), capacity?.fuel)}
                      tone={resourceTone(Number(resources.fuel ?? 0), fuelMonthly)}
                      hint={coverHint(Number(resources.fuel ?? 0), fuelMonthly, capacity?.fuel)}
                    />
                    <Metric
                      label="Ricerca"
                      value={formatNumber(Number(resources.research ?? 0))}
                      tone="neutral"
                      hint="Punti non ancora spesi in tecnologie"
                    />
                  </MetricGrid>
                  {/* Sintesi prima del dettaglio: quanto entra, quanto esce. */}
                  <p className="material-balance-title">Ritmo del mese: quanto produci e quanto consumi</p>
                  <MaterialBalanceList rows={materialRows} showAvailability={false} />
                </>
              ) : (
                <EmptyState>Il magazzino materiale non è ancora pubblicato per questa partita.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MaterialEconomy · le scorte nascono da una quota della capacità reale (mesi di riserva secondo il PIL pro capite) e non possono superare il tetto: il surplus si perde. Una nazione fragile ha magazzini piccoli e resta in carenza se la produzione non copre il fabbisogno. La leva materiale del modello (aiuti, requisizioni, perdite) muove queste stesse scorte. Denaro, debito e credito sono nella sezione Cassa.</Footnote>
            </DossierBlock>

            {modifiersActive && (
              <DossierBlock
                title="Direttive attive"
                description="Effetti decisi dalla simulazione sulla vita della nazione: decadono se non rinnovati."
              >
                <MetricGrid>
                  {Number(resources?.modifiers?.stability ?? 0) !== 0 && (
                    <Metric label="Effetto sulla stabilità" value={`${Number(resources?.modifiers?.stability) > 0 ? '+' : ''}${formatNumber(Number(resources?.modifiers?.stability))}`} tone={Number(resources?.modifiers?.stability) > 0 ? 'positive' : 'negative'} hint="Effetto attivo sull'indice" />
                  )}
                  {Number(resources?.modifiers?.socialTension ?? 0) !== 0 && (
                    <Metric label="Effetto sulla tensione" value={`${Number(resources?.modifiers?.socialTension) > 0 ? '+' : ''}${formatNumber(Number(resources?.modifiers?.socialTension))}`} tone={Number(resources?.modifiers?.socialTension) > 0 ? 'negative' : 'positive'} hint="Effetto attivo sull'indice" />
                  )}
                  {Number(resources?.modifiers?.warEffort ?? 0) !== 0 && (
                    <Metric label="Effetto sullo sforzo bellico" value={`${Number(resources?.modifiers?.warEffort) > 0 ? '+' : ''}${formatNumber(Number(resources?.modifiers?.warEffort))}`} tone={Number(resources?.modifiers?.warEffort) > 0 ? 'warning' : 'neutral'} hint="Effetto attivo sull'indice" />
                  )}
                  {Number(resources?.modifiers?.revenueMultiplier ?? 1) !== 1 && (
                    <Metric label="Effetto sulle entrate" value={`×${formatMoney(Number(resources?.modifiers?.revenueMultiplier), { decimals: 2 })}`} tone={Number(resources?.modifiers?.revenueMultiplier) >= 1 ? 'positive' : 'negative'} hint="Moltiplicatore sulle entrate" />
                  )}
                  {Number(resources?.modifiers?.growthModifier ?? 0) !== 0 && (
                    <Metric label="Effetto sulla crescita" value={`${Number(resources?.modifiers?.growthModifier) > 0 ? '+' : ''}${formatPercent(Number(resources?.modifiers?.growthModifier) * 100, 1)}`} tone={Number(resources?.modifiers?.growthModifier) > 0 ? 'positive' : 'negative'} hint="Effetto attivo sulla crescita annua" />
                  )}
                </MetricGrid>
                <Footnote><b>Fonte</b> il motore valida e limita ogni effetto proposto dalla simulazione; qui si vede solo ciò che è stato applicato.</Footnote>
              </DossierBlock>
            )}

            <DossierBlock
              title="Risorse naturali"
              description="Giacimento reale, riserva residua, estrazione, magazzino e quotazioni di mercato."
            >
              {natural.length > 0 ? (
                <>
                  <ul className="resource-chips">
                    {natural.map((node) => (
                      <li key={node.kind} className={node.depleted ? 'resource-chip depleted' : 'resource-chip'}>
                        <b>{node.label}</b>
                        <span>{node.endowment}/5</span>
                        <em>
                          riserva {formatNumber(node.reserve)}/{formatNumber(node.maxReserve)}
                          {node.depleted ? ' · esaurita' : ` · ${node.depletionPct}% consumata`}
                          {node.renewable ? ' · rinnovabile' : ''}
                        </em>
                        <em>estrazione {formatNumber(node.extractionPerMonth)}/mese · magazzino {formatNumber(node.stockpile)}</em>
                      </li>
                    ))}
                  </ul>
                  {market.length > 0 && (
                    <div className="resource-market">
                      <p className="resource-market-head">Mercato mondiale · prezzo di vendita e di acquisto per unità</p>
                      {market.map((quote) => {
                        const node = natural.find((entry) => entry.kind === quote.kind);
                        return (
                          <div key={quote.kind} className="resource-market-row">
                            <div className="resource-market-name">
                              <b>{quote.label}</b>
                              <em>
                                vendi {formatMoney(quote.bid, { currency: 'mld', decimals: 3 })} ·
                                compra {formatMoney(quote.ask, { currency: 'mld', decimals: 3 })}
                                {quote.scarcityPct > 0 ? ` · scarsità ${quote.scarcityPct}%` : ''}
                              </em>
                            </div>
                            {node && trade && <ResourceTradeRow summary={node} trade={runTrade} busy={trading} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : arms && Object.keys(arms.naturalResources).length > 0 ? (
                <ul className="resource-chips">
                  {Object.entries(arms.naturalResources)
                    .filter(([, value]) => Number(value) > 0)
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .map(([kind, value]) => (
                      <li key={kind} className="resource-chip"><b>{RESOURCE_LABELS[kind] || kind}</b><span>{value}/5</span></li>
                    ))}
                </ul>
              ) : (
                <EmptyState>Nessuna risorsa naturale registrata per questa nazione.</EmptyState>
              )}
              <Footnote><b>Fonte</b> dotazioni nazionali reali · l'estrazione consuma la riserva (le rinnovabili si rigenerano); vendere e comprare muove denaro e magazzino.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Capacità produttive e territoriali"
              description="Che cosa il paese è in grado di fare: la disponibilità dipende dal profilo della nazione, non solo da ciò che è disegnato sulla mappa."
            >
              <MetricGrid>
                {/* Provinciali e città sono **fatti del territorio**: non hanno un
                    bene/male, ma senza un rapporto la cifra non si interpreta. Il
                    rapporto è ciò che la rende leggibile. */}
                <Metric label="Province" value={formatNumber(assets.provinces)} hint={assets.cities > 0 ? `${formatNumber(assets.cities)} città e capitali` : 'territorio amministrato'} />
                <Metric label="Fabbriche" value={formatNumber(assets.factories)} hint={assets.baseFactories > 0 ? `${formatNumber(assets.baseFactories)} dal profilo del paese, ${formatNumber(Math.max(0, assets.factories - assets.baseFactories))} costruite sulla mappa` : undefined} />
                <Metric label="Porti e cantieri" value={formatNumber(assets.ports)} hint={assets.basePorts > 0 ? `${formatNumber(assets.basePorts)} dalla costa, ${formatNumber(Math.max(0, assets.ports - assets.basePorts))} costruiti sulla mappa` : 'nessuno sbocco al mare'} />
                <Metric label="Città e capitali" value={formatNumber(assets.cities)} hint={assets.provinces > 0 ? `su ${formatNumber(assets.provinces)} province` : 'centri abitati mappati'} />
              </MetricGrid>
              <p className="nation-capacity-source">
                <b>Da dove viene la disponibilità</b>{' '}
                {assets.capacitySources
                  ? `${assets.capacitySources}.`
                  : 'profilo della nazione ricavato dal conto nazionale.'}{' '}
                La base è il profilo reale del paese (PIL, abitanti, costa, forze): {plural(assets.baseFactories, 'fabbrica', 'fabbriche')},
                {' '}{plural(assets.basePorts, 'porto', 'porti')}, {plural(assets.baseUniversities, 'università', 'università')},
                {' '}{plural(assets.baseForces, 'reparto', 'reparti')}. Ciò che si costruisce nel gioco si somma a questa base.
              </p>
              <Footnote><b>Fonte</b> conto nazionale quando disponibile; altrimenti oggetti delle regioni possedute. Università e personale sono nella sezione Conoscenze.</Footnote>
            </DossierBlock>
          </>
        )}

        {active === 'armamenti' && (
          <>
            {arms?.objects && (
              <DossierBlock
                title="Sala di governo"
                description="Gli oggetti concreti del paese: esercito, impianti, cantieri, marina. Clicca un settore per aprire i singoli oggetti e le loro azioni."
              >
                <ObjectsBoard
                  arsenal={arms}
                  onPreviewFormation={onPreviewFormation}
                  onRaiseFormation={raiseFormation}
                  onUnitAction={unitAction}
                  onUnitOrder={unitOrder}
                  snapshotKey={props.snapshotKey}
                  busy={formationBusy || unitBusy}
                />
                <Footnote><b>Da dove vengono le cifre</b> ogni riga è un fatto pubblicato dal motore (arsenale, capacità industriale, prontezza, manpower). Le attribuzioni che il motore non conosce — quali reparti in una armata, quali navi in una flotta — sono convenzioni dichiarate sotto «Catene e convenzioni»: la somma delle parti è il totale nazionale.</Footnote>
              </DossierBlock>
            )}

            <DossierBlock
              title="Quadro delle forze armate"
              description="Reparti in armi, copertura per categoria, prontezza operativa e dipendenze dall'estero."
            >
              <DomainOperatingBlock picture={operatingPicture} id="militare" />
            </DossierBlock>

            <DossierBlock
              title="Quanto hai e quanto produci"
              description="La sintesi che serve a decidere: disponibilità, produzione, consumo e saldo delle scorte che alimentano l'arsenale."
            >
              <MaterialBalanceList
                rows={weaponsRows}
                emptyText="Il motore non pubblica il bilancio delle scorte di armamenti per questa partita."
              />
              <p className="material-balance-title">Armamenti in servizio</p>
              <p className="arms-summary-line">{armsSummary}</p>
              {armsSplit ? <p className="arms-summary-line obj-note">{armsSplit}</p> : null}
              <Footnote><b>Da dove vengono le cifre</b> scorte, fabbisogno e produzione mensile sono del motore (MaterialEconomy), non una stima del Dossier; cibo, vestiario e carburante sono nella sezione Risorse e industria. La produzione di un mezzo è la somma degli ordini aperti qui sotto, con la data prevista dal ritmo reale della linea.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Forza dell'arsenale"
              description="Quanto vale l'apparato militare: quantità, qualità e potenza effettiva sui combattimenti."
            >
              {arms ? (
                <MetricGrid>
                  <Metric label="Forza militare" value={formatMoney(arms.strength, { decimals: 1 })} tone="neutral" hint="Quantità × qualità × dominio" />
                  <Metric label="Potenza effettiva" value={formatNumber(arms.effectiveMilitaryPower)} tone={arms.combatFactor >= 1 ? 'positive' : 'warning'} hint={`Base ${formatNumber(arms.baseMilitaryPower)} × fattore arsenale ${arms.combatFactor}`} />
                  <Metric label="Qualità media armi" value={`${formatNumber(arms.qualityIndex)}/100`} tone={arms.qualityIndex >= 60 ? 'positive' : arms.qualityIndex >= 30 ? 'warning' : 'negative'} hint="Pesa sui combattimenti" />
                  {/* `arms.capacity.weapons` è il **tetto** del magazzino, non le
                      scorte attuali: si chiamava «Scorte armi» come la metrica di
                      Risorse, ma è un altro numero. */}
                  <Metric label="Capacità armamenti" value={formatNumber(arms.capacity.weapons)} hint="Tetto del magazzino: input per la produzione" />
                </MetricGrid>
              ) : (
                <EmptyState>Arsenale non ancora pubblicato per questa partita.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MilitaryIndustry · budget e industrie sono in Cassa e Risorse; qui solo ciò che combatte.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Come si legge l'arsenale"
              description="Le cifre dell'arsenale hanno una formula precisa: qui cosa significano."
            >
              <div className="arms-legend">
                <p><b>Quantità</b> — quante unità sono in servizio: «×37» significa 37 mezzi di quel tipo operativi adesso.</p>
                <p><b>Forza</b> — <i>quantità × qualità × peso del dominio ÷ 100</i>. Un caccia pesa più di un fucile: il peso è nella tabella qui sotto.</p>
                <p><b>Qualità</b> — valore 0–100 del singolo mezzo: obsoleto sotto 26, datato 26–45, moderno 46–65, avanzato 66–85, nuova generazione da 86.</p>
                <p><b>Potenza effettiva</b> — potenza nominale della nazione × fattore di arsenale (0,6–1,6). Il fattore sale con la qualità media e con la copertura delle forze schierate: un esercito senza mezzi combatte al 60% della sua potenza.</p>
              </div>
              {arms && arms.domains && arms.domains.length > 0 && (
                <ul className="arms-domains">
                  {arms.domains.map(domain => (
                    <li key={domain.domain}>
                      <b>{domain.label}</b>
                      <span>peso {formatMoney(domain.weight, { decimals: 1 })}×</span>
                      <em>{domain.description}</em>
                    </li>
                  ))}
                </ul>
              )}
              <Footnote><b>Perché conta</b> l'arsenale non è un punteggio: decide la potenza effettiva usata nei combattimenti e si consuma quando una nazione conquista una provincia.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Arsenale"
              description="Equipaggiamento in servizio: che cos'è, a cosa serve e quanto pesa sulla forza."
            >
              {arms && arms.lines.length > 0 ? (
                <ul className="arms-list">
                  {arms.lines.map((line) => (
                    <li key={line.id} className="arms-line-card">
                      <div className="arms-line-head">
                        <div>
                          <b>{line.name}</b>
                          <span>{line.domainLabel || DOMAIN_LABELS[line.domain] || line.domain} · {line.category}</span>
                        </div>
                        <div className="arms-line-meta">
                          <em>×{formatNumber(line.quantity)} in servizio</em>
                          <span className={`arms-tier tone-${TIER_TONE[line.tier] || 'neutral'}`}>{TIER_LABEL(line.tier)} · qualità {line.quality}/100</span>
                        </div>
                      </div>
                      {/* Sintesi prima del dettaglio: quanto ho e quanto produco. */}
                      <p className="arms-line-summary">{lineSummary(line)}</p>
                      <details className="arms-line-detail">
                        <summary>Dettaglio tecnico: che cos'è, a cosa serve, caratteristiche</summary>
                        <p className="arms-line-role">{line.role}</p>
                        <p className="arms-line-desc">{line.description}</p>
                        <EquipmentSpecs specs={line.specs} />
                      </details>
                      <div className="arms-line-share">
                        <span>Forza {formatMoney(line.strength, { decimals: 1 })} · {formatMoney(line.sharePct, { decimals: 1 })}% dell'arsenale</span>
                        <i aria-hidden="true"><em style={{ width: `${Math.max(0, Math.min(100, line.sharePct))}%` }} /></i>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessun equipaggiamento in servizio: costruisci o importa dal catalogo qui sotto.</EmptyState>
              )}
            </DossierBlock>

            <DossierBlock
              title="Produzione in corso"
              description="Percentuale di completamento degli ordini: la consegna non è istantanea e può subire ritardi o difetti."
            >
              {arms && arms.production && arms.production.orders.length > 0 ? (
                <ul className="arms-production">
                  {arms.production.orders.map((order) => (
                    <li key={order.id} className={`arms-production-item status-${order.status}`}>
                      <ProgressRow
                        label={`${order.name} ×${formatNumber(order.quantity)}`}
                        percent={order.status === 'failed' ? 0 : Number(order.progress)}
                        status={order.status === 'failed' ? 'failed' : 'ongoing'}
                        note={order.status === 'failed'
                          ? `Ordine fallito${order.note ? ` · ${order.note}` : ''} · la spesa sostenuta non è recuperabile`
                          : `Avviata il ${formatDate(order.startedDate)}${order.expectedDate ? ` · consegna prevista ${formatDate(order.expectedDate)}` : ''}${order.qualityLoss > 0 ? ` · ${Math.round(order.qualityLoss)}% dei pezzi difettosi` : ''}${order.note ? ` · ${order.note}` : ''}`}
                      />
                      <em className="arms-production-meta">{DOMAIN_LABELS[order.domain] || order.domain}</em>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessun ordine in corso: le costruzioni avviate compariranno qui con la percentuale di completamento.</EmptyState>
              )}
            </DossierBlock>

            <DossierBlock
              title="Produzione e acquisti"
              description="Costruisci con tecnologia, industria e risorse proprie, oppure importa pagando un sovrapprezzo. Ogni voce spiega che cos'è e a cosa serve."
            >
              {arms ? (
                <div className="arms-catalog">
                  {['terra', 'aria', 'mare', 'missili', 'droni'].map((domain) => (
                    <div key={domain} className="arms-domain">
                      <h4>{arms.domains?.find(item => item.domain === domain)?.label || DOMAIN_LABELS[domain] || domain}</h4>
                      <ul>
                        {arms.catalog.filter((item) => item.domain === domain).map((item) => (
                          <li key={item.id}>
                            <div className="arms-item-head">
                              <b>{item.name}</b>
                              <span className={`arms-tier tone-${TIER_TONE[item.tier] || 'neutral'}`}>{TIER_LABEL(item.tier)} · qualità {item.quality}/100</span>
                            </div>
                            <p className="arms-item-role">{item.role}</p>
                            <details className="arms-item-details">
                              <summary>Che cos'è e cosa sa fare</summary>
                              <p>{item.description}</p>
                              <EquipmentSpecs specs={item.specs} />
                            </details>
                            <div className="arms-item-cost">
                              Costruzione {formatBillions(item.buildCostMln)}
                              {' · '}Importazione {formatBillions(item.buyCostMln)}
                              {' · '}Scorte armi {formatNumber(item.weaponsCost)}/unità
                            </div>
                            {!item.canBuild && item.reasons.length > 0 && (
                              <div className="arms-reasons">Requisiti non soddisfatti: {item.reasons.join('; ')}.</div>
                            )}
                            <div className="arms-actions">
                              <button type="button" disabled={!item.canBuild || !procure} onClick={() => void procure?.('build', item.id, 1)}>Costruisci</button>
                              <button type="button" className="secondary" disabled={!item.canBuy || !procure} onClick={() => void procure?.('buy', item.id, 1)}>Importa</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState>Catalogo militare non disponibile.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MilitaryIndustry · la costruzione apre un ordine di produzione con percentuale di completamento; l'importazione consegna subito al prezzo maggiorato.</Footnote>
            </DossierBlock>
          </>
        )}

        {active === 'conoscenze' && (
          <>
            <DossierBlock
              title="Tecnologie sbloccate"
              description="Progresso materiale finanziato dai punti ricerca nazionali."
            >
              {resources?.technologies && resources.technologies.length > 0 ? (
                <ul className="nation-tech-list">
                  {resources.technologies.map((tech) => (
                    <li key={tech}><b>{tech.replace(/_/g, ' ')}</b><span>Disponibile per economia e forze armate.</span></li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nessuna tecnologia sbloccata: accumula punti ricerca con università e popolazione.</EmptyState>
              )}
              <Footnote><b>Fonte</b> Catalogo tecnologie del motore · la ricerca si accumula a ogni tick del mondo.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Capitale umano"
              description="Popolazione, formazione e forze disponibili."
            >
              <MetricGrid>
                <Metric label="Popolazione" value={formatNumber(assets.population)} hint={`${formatNumber(assets.population / 1_000_000)} milioni di abitanti`} />
                <Metric label="Università" value={formatNumber(assets.universities)} hint={assets.baseUniversities > 0 ? `${formatNumber(assets.baseUniversities)} dal profilo del paese, ${formatNumber(Math.max(0, assets.universities - assets.baseUniversities))} costruite: producono ricerca` : 'Producono punti ricerca'} />
                <Metric label="Unità e forze" value={formatNumber(assets.forces)} hint={assets.baseForces > 0 ? `${formatNumber(assets.baseForces)} dal profilo del paese, ${formatNumber(Math.max(0, assets.forces - assets.baseForces))} dal mondo` : 'Reparti in servizio (dettaglio in Armamenti)'} />
              </MetricGrid>
              <Footnote><b>Fonte</b> conto nazionale; in mancanza, oggetti delle regioni possedute. Il PIL pro capite è nelle Politiche.</Footnote>
            </DossierBlock>
          </>
        )}

        {active === 'politiche' && (
          <>
            <DossierBlock
              title="Assetto istituzionale"
              description="Chi governa, su quale territorio e con quali processi aperti."
            >
              <MetricGrid>
                <Metric label="Forma di governo" value={governmentType} hint="Assetto registrato per questo paese" />
                <Metric label="Territorio amministrato" value={provincesLabel(assets.provinces)} hint="Unità amministrative sotto il governo" />
                <Metric label="Processi attivi" value={formatNumber(ongoingProcesses.length)} hint={ongoingProcesses.length > 0 ? 'In corso: dettaglio in Progetti' : 'Nessun processo in corso'} />
              </MetricGrid>
            </DossierBlock>

            <DossierBlock
              title="Politica fiscale"
              description="Quanto lo Stato preleva dal PIL. Decidi tu: più entrate oggi, meno consenso e crescita domani."
            >
              {effectiveTaxPct === null ? (
                <Footnote>Il conto nazionale non è ancora disponibile: l'aliquota si potrà scegliere appena il motore pubblica le entrate.</Footnote>
              ) : (
                <>
                  <div className="nation-tax-control">
                    <label htmlFor="nation-tax-rate">
                      <span>Pressione fiscale</span>
                      <b>{formatPercent(taxDraft ?? effectiveTaxPct, 1)}</b>
                    </label>
                    <input
                      id="nation-tax-rate"
                      type="range"
                      min={fiscalPolicy?.minPct ?? 4}
                      max={fiscalPolicy?.maxPct ?? 45}
                      step={0.5}
                      value={taxDraft ?? effectiveTaxPct}
                      disabled={!onSetFiscalPolicy || fiscalPolicyBusy}
                      aria-label="Pressione fiscale in percentuale del PIL"
                      onChange={(event) => setTaxDraft(Number(event.target.value))}
                    />
                    <div className="nation-tax-scale">
                      <span>{fiscalPolicy?.minPct ?? 4}%</span>
                      <em>{fiscalPolicy?.label ?? '—'}</em>
                      <span>{fiscalPolicy?.maxPct ?? 45}%</span>
                    </div>
                  </div>
                  {(fiscalPolicy?.effects?.length ?? 0) > 0 && (
                    <ul className="nation-tax-effects">
                      {fiscalPolicy!.effects.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  )}
                  <div className="nation-tax-actions">
                    <button
                      type="button"
                      onClick={runSetTax}
                      disabled={taxDraft === null || fiscalPolicyBusy || !onSetFiscalPolicy}
                    >{fiscalPolicyBusy ? 'Applico…' : 'Applica aliquota'}</button>
                    <em>
                      {fiscalPolicy?.configured
                        ? `Scelta dal governo · profilo ${formatPercent(fiscalPolicy.defaultPct, 1)}`
                        : `Predefinita dal profilo ${formatPercent(fiscalPolicy?.defaultPct ?? effectiveTaxPct, 1)}`}
                    </em>
                  </div>
                </>
              )}
            </DossierBlock>

            <DossierBlock
              title="Coesione interna"
              description="Il consenso e la pressione sociale sul governo."
            >
              <MetricGrid>
                {/* Stabilità e tensione sono gli stessi indicatori letti in
                    «Situazione»: qui restano come rimando, non come copia. */}
                <Metric
                  label="Stabilità"
                  value={formatPercent(stability)}
                  tone={stabilityTone(stability)}
                  hint="Dettaglio in Situazione"
                  onClick={() => openSection('situazione')}
                />
                <Metric
                  label="Tensione sociale"
                  value={formatPercent(socialTension)}
                  tone={tensionTone(socialTension)}
                  hint="Dettaglio in Situazione"
                  onClick={() => openSection('situazione')}
                />
                <Metric label="PIL pro capite" value={account?.gdpPerCapitaUsd != null ? formatMoney(Number(account.gdpPerCapitaUsd), { currency: '$', decimals: 0 }) : '—'} hint="Tenore di vita medio pubblicato dal motore" />
              </MetricGrid>
              <Footnote><b>Fonte</b> conto nazionale e modificatori attivi (sezione Risorse). Nessuna decisione viene presa da questa schermata.</Footnote>
            </DossierBlock>
          </>
        )}
      </div>
    </div>
  );
};

export default NationDock;
