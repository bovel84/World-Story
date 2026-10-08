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
import { worldEpoch } from './worldEpoch';
import { doctrineView } from './militaryDoctrine';
import { formatNumber, formatPercent } from '../../utils/format';
import {
  pressureTone,
  satisfactionTone,
} from './governmentDossier';
import type { NationDockProps } from './NationDock/types';
import {
  DOMAIN_LABELS, MONEY_UNIT_NOTE, RESOURCE_LABELS, TIER_LABEL, TIER_TONE,
  defenceTone, formatBillions, formatDate, index, money, plural, warEffortTone,
} from './NationDock/format';
import {
  BudgetBreakdown, CrisisBlock, DebtPortfolio, DeepDive, DossierBlock, EmptyState,
  EquipmentSpecs, FactionCard, Footnote, Metric, MetricGrid,
  CommitmentsList, PowersAgendaList, ProgressRow, ResourceTradeRow, VerdictBanner, StorylinesList,
} from './NationDock/widgets';
import { useNationDockModel } from './NationDock/useNationDockModel';
import { MaterialBalanceList } from './MaterialBalanceList';
import { DomainOperatingBlock, OperatingPictureBoard } from './OperatingPictureBoard';
import { NationalSynthesisPanel } from './NationalSynthesisPanel';
import { NationalDossierLive } from './LiveNationalDossier';

// Ri-esportati per i consumatori storici (`DeskContent`, `nationDossier`).
export type { HistoryPoint, NationAccount, NationDockProps, NationResources, Tone } from './NationDock/types';

export const NationDock: React.FC<NationDockProps> = (props) => {
  // D-1 — la sala operativa è uscita dal dossier: la creazione di reparti e le
  // azioni di reparto vivono ora in `ForcesPanel`. Qui non serve più nessuno
  // stato «in corso»: il dossier non esegue azioni.
  const {
    governmentType, account, resources, arms, procure, trade,
    ongoingProcesses, completedProcesses = [], mandateDecisions = [], maintenanceObligations = [], onAcknowledgeMandateDecision,
    government, governmentVoices, governmentVoicesLoading, governmentVoicesError,
    onBorrowDebt, fiscalPolicy, onSetFiscalPolicy, fiscalPolicyBusy,
    crisis, briefing, strategicAgenda, commitments,
    today: worldDate,
    setState, active, trading, borrowing, borrowAmount, setBorrowAmount, borrowTerm, setBorrowTerm,
    taxDraft, setTaxDraft, effectiveTaxPct, runSetTax, runBorrow, runTrade,
    assets, projectGroups, warEffort, defenceBurdenPct,
    natural, market, debt, creditHeadroomValue, debtTranches, averageMaturity, marketRate, overdraft,
    budget, verdict, factions, modifiersActive, provincesLabel,
    pointDelta, mkTrend,
    materialRows, weaponsRows, armsSplit, playerPolityId, operatingPicture, synthesis, people,
    live,
  } = useNationDockModel(props);

  // COUNTRY-CLARITY: dal quadro d'insieme si salta alla sezione di dettaglio.
  const openSection = (section: NationSection) => setState((prev) => setSection(prev, section));
  // N02 — l'anno e l'epoca del mondo, da un'unica fonte (la data del mondo che
  // il dossier già riceve). Il contesto della card lo usa, e le fasi successive
  // (N03–N06) leggono da qui invece di riesaminare la data per conto proprio.
  const epochView = worldEpoch(worldDate);
  // N05 — la dottrina che il motore pubblica (epoca, categorie previste, motivo).
  // Il dossier la **mostra**; non filtra il catalogo, perché il predicato
  // categoria↔epoca non è pubblicato (vedi `militaryDoctrine.ts`).
  const doctrine = doctrineView(arms?.establishment, arms?.epochLabel);
  // I domini del catalogo si leggono dal motore, non da una lista scritta qui:
  // l'ordine è quello che il motore pubblica, con le sue etichette.
  const catalogDomains = arms?.domains?.length
    ? arms.domains.map(domain => domain.domain)
    : Array.from(new Set(arms?.catalog?.map(item => item.domain) ?? []));

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
            {/* COUNTRY-CLARITY: lo stato canonico apre la sezione. Dati letti dal
                motore e confrontati col Turno 0 — popolazione, PIL, stabilità,
                tensione. Il resto è interpretazione o approfondimento. */}
            <NationalDossierLive live={live} part="stato" />

            {/* D03/I3: il dossier si apre sulla **sintesi** — giudizio, lista
                unica delle cose da fare, azione minima. Il quadro a sei aree
                che stava qui non sparisce: scende in fondo alla sezione come
                dettaglio (I6), e resta raggiungibile. */}
            <NationalSynthesisPanel synthesis={synthesis} onOpenSection={openSection} onOpenQuestions={props.onOpenQuestions} />

            {/* N02: la card dichiara il proprio contesto temporale — «Italia — 14
                marzo 1951» — che è la sua prop `context` già prevista e finora
                mai passata dal dossier. Prima riga del dossier in cui l'anno del
                mondo compare come informazione, non solo come data di un evento. */}
            {briefing && (
              <StrategicBriefingCard
                briefing={briefing}
                context={epochView.epochLabel ? `${epochView.epochLabel} · ${formatDate(worldDate)}` : undefined}
              />
            )}

            {/* H11 — i filoni del mondo che toccano questa nazione: nodi storici
                dichiarati dal preset. Significato, non fatti: nessuna cifra. */}
            {props.storylines && props.storylines.length > 0 && (
              <DossierBlock
                title="Filoni del mondo"
                description="Le questioni storiche aperte attorno a questa nazione, dichiarate dallo scenario. Non sono dati del motore: sono il contesto in cui i numeri esistono."
              >
                <StorylinesList storylines={props.storylines} />
              </DossierBlock>
            )}

            {/* Una sola rappresentazione per fatto: tesoreria, saldo, stabilità e
                tensione vivono nelle schede vive («Stato nazionale» e «Finanze»),
                dove sono confrontate col Turno 0. Qui resta il **giudizio**, che è
                un'altra cosa dai numeri che lo sostengono. */}
            <DossierBlock
              title="Indicatori di tenuta"
              description="Il giudizio su come sta andando la nazione. Le cifre che lo sostengono — tesoreria, bilancio, stabilità, tensione — sono nelle schede «Stato nazionale» e «Finanze»."
            >
              <VerdictBanner verdict={verdict} />
            </DossierBlock>

            {/* V02 — le tre strade del collasso **non sono dettaglio**: sono lo
                stato. Escono dal richiudibile e stanno sotto gli indicatori che
                le determinano: chi legge «stabilità 30%» vede subito quanto
                pesa. Prima erano chiuse dietro un `<summary>`, cioè la cosa
                più grave della partita era la meno visibile. */}
            <DossierBlock
              title="Crisi della nazione"
              description="Le tre strade del collasso — rivolta, default, invasione — calcolate dagli indicatori reali. Se una resta critica per troppi turni, la partita finisce."
            >
              <CrisisBlock crisis={crisis} />
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
                  <div className="nation-decision-live"><b>{ongoingProcesses.length} {ongoingProcesses.length === 1 ? 'processo richiede monitoraggio' : 'processi richiedono monitoraggio'}</b><span>Apri Tesoro per vedere le prossime scadenze registrate.</span></div>
                ) : <EmptyState>Nessuna decisione richiede attenzione immediata.</EmptyState>)}
              </div>
            </DossierBlock>

            {/* D05/I4: gli impegni **duplicavano** la lista unica qui sopra. La
                lista è una sola; il registro resta raggiungibile, richiudibile,
                e non contiene azioni (è cronaca, non decisione). V01 ha tolto le
                sfide, V02 la crisi: qui restano solo gli impegni, che V03
                portano in Stato maggiore. */}

            {/* Il quadro a sei aree: era l'apertura della sezione, ora è il
                **dettaglio** che la sintesi riassume (I5: una sola superficie
                per lo stato). Resta un blocco raggiungibile, non una seconda
                prima schermata. */}
            <details className="nation-synthesis-detail">
              <summary>Approfondimenti: quadro d&apos;insieme per dominio</summary>
              <OperatingPictureBoard picture={operatingPicture} onOpenSection={openSection} />
            </details>
          </>
        )}

{active === 'regno' && (
          <>
            <p className="nation-section-voice">La dimensione civile della nazione: chi la governa, con quali istituzioni e quanto investe nel suo popolo. Qui non si contano soldati: si contano consenso, competenze e coesione.</p>

            {/* Stato canonico: ricerca e tecnologie attuali vs Turno 0. */}
            <NationalDossierLive live={live} part="tecnologia" />
            {epochView.epoch && (
              <Footnote>
                Il motore non dichiara un&apos;epoca delle tecnologie: in uno scenario del
                {' '}{epochView.year} ({epochView.epochLabel}) alcune voci possono appartenere a
                secoli successivi, e la ricerca non è ancora filtrata per epoca.
              </Footnote>
            )}

            <DeepDive>
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
                          {/* WS-GOVOFFICE-03: la fazione non «porta in consiglio»
                              da sola — è uscito il compositore dove la richiesta
                              diventava una bozza visibile. La richiesta resta in
                              lettura; a portarla al ministro va il giocatore. */}
                          <FactionCard
                            faction={faction}
                            dominant={faction.id === government.dominantId}
                            angriest={faction.id === government.angriestId}
                            voice={governmentVoices?.voices?.[faction.id]}
                            speaking={governmentVoicesLoading}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState>Nessuna fazione registrata per questo governo.</EmptyState>
                  )}
                  <Footnote><b>Come funziona</b> il motore calcola chi esiste, quanta influenza ha e che cosa chiede; il modello dà voce a ciascuna anima in una petizione breve, coerente con umore e pressione. Le cifre restano la fonte, mai il copione. Qui le richieste si leggono: a portarle al ministro di competenza è il giocatore, nella seduta dell'Ufficio del Governo.</Footnote>
                </>
              ) : (
                <EmptyState>Le anime del governo non sono ancora pubblicate per questa partita.</EmptyState>
              )}
            </DossierBlock>


            <DossierBlock
              title="Assetto istituzionale"
              description="Chi governa, su quale territorio e con quali processi aperti."
            >
              <MetricGrid>
                <Metric label="Forma di governo" value={governmentType} hint="Assetto registrato per questo paese" />
                <Metric label="Territorio amministrato" value={provincesLabel(assets.provinces)} hint="Unità amministrative sotto il governo" />
                <Metric label="Processi attivi" value={formatNumber(ongoingProcesses.length)} hint={ongoingProcesses.length > 0 ? 'In corso: dettaglio in Tesoro' : 'Nessun processo in corso'} />
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

            {/* M03 — la dimensione civile aveva una metrica dove l'arsenale ne ha
                otto blocchi. Qui ha il suo blocco: le voci che il motore pubblica
                nel bilancio (istruzione e ricerca, sanità e sostegno) lette come
                quello che sono — l'investimento nel popolo, non un residuo dopo
                le armi. */}
            <DossierBlock
              title="Investimento nel popolo"
              description={`Quanto lo Stato destina a istruzione, sanità e sostegno, e quanto alla difesa: due scelte dello stesso bilancio. ${MONEY_UNIT_NOTE}`}
            >
              {budget ? (
                <>
                  <MetricGrid>
                    <Metric
                      label="Istruzione e ricerca"
                      value={`${formatPercent(budget.educationBurdenPct, 1)} del PIL`}
                      tone={budget.educationBurdenPct >= 3 ? 'positive' : budget.educationBurdenPct > 0 ? 'neutral' : 'warning'}
                      hint="Scuola, atenei e laboratori: è la via civile alla conoscenza"
                    />
                    <Metric
                      label="Sanità e sostegno"
                      value={`${formatPercent(budget.socialBurdenPct, 1)} del PIL`}
                      tone={budget.socialBurdenPct >= 6 ? 'positive' : budget.socialBurdenPct > 0 ? 'neutral' : 'warning'}
                      hint="Salute e sostegno sociale: è il tenore di vita che si può misurare"
                    />
                    {/* La spesa militare è la **stessa** cifra letta in «Spesa
                        militare» (Cassa, dove è canonica) e nella ripartizione del
                        bilancio. Una cifra, un posto: qui è il termine di paragone
                        del confronto, e il rimando porta alla voce canonica. */}
                    <Metric
                      label="Quanto alle armi"
                      value={`${formatPercent(budget.defenceBurdenPct, 1)} del PIL`}
                      tone={budget.defenceBurdenPct >= 8 ? 'warning' : 'neutral'}
                      hint="La voce canonica è in Tesoro: qui è il termine di paragone"
                      onClick={() => openSection('tesoro')}
                    />
                    <Metric
                      label="Quota al civile"
                      value={people.civilianShareOfSpendingPct === null ? '—' : formatPercent(people.civilianShareOfSpendingPct, 0)}
                      tone={people.civilianShareOfSpendingPct === null ? 'neutral' : people.civilianShareOfSpendingPct >= 60 ? 'positive' : people.civilianShareOfSpendingPct >= 40 ? 'warning' : 'negative'}
                      hint={people.civilianShareOfSpendingPct === null
                        ? 'Il motore non pubblica insieme spesa civile e difesa'
                        : 'Della spesa dichiarata, quanta va al popolo invece che alle armi'}
                    />
                  </MetricGrid>
                  <ul className="nation-civil-lines">
                    {budget.expense
                      .filter(line => line.id === 'education' || line.id === 'health' || line.id === 'social' || line.id === 'infrastructure')
                      .map(line => (
                        <li key={line.id}>
                          <span>{line.label}</span>
                          <b>{formatBillions(line.amount)}</b>
                        </li>
                      ))}
                  </ul>
                </>
              ) : (
                <EmptyState>Questo scenario non pubblica il dettaglio del bilancio: l&apos;investimento nel popolo non è misurabile.</EmptyState>
              )}
              <Footnote><b>Come si legge</b> non è una classifica morale: sono le due scelte che lo stesso bilancio deve fare. Una nazione che arma e non istruisce non è più forte — è più fragile, perché la ricerca cresce solo con gli atenei.</Footnote>
            </DossierBlock>
            </DeepDive>

          </>
        )}

{active === 'tesoro' && (
          <>
            <p className="nation-section-voice">Tutta la materia economica: denaro, debito, scorte, industria e i cantieri. Dove entra il gettito, dove esce, e che cosa il paese sa produrre.</p>

            {/* Stato canonico: finanze pubbliche, risorse strategiche e capacità
                nazionale, attuali vs Turno 0. */}
            <NationalDossierLive live={live} part="finanze" />
            <NationalDossierLive live={live} part="risorse" />
            <NationalDossierLive live={live} part="capacita" />

            <DeepDive>
            <h3 className="nation-group-head">Denaro</h3>

            <DossierBlock
              title="Quadro economico"
              description="Avanzo o disavanzo, debito, interessi e cassa: la diagnosi prima delle voci di bilancio."
            >
              <DomainOperatingBlock picture={operatingPicture} id="economia" />
            </DossierBlock>

            {/* Una sola rappresentazione per fatto: tesoreria, saldo, debito,
                debito/PIL e credito residuo sono nella scheda «Finanze pubbliche».
                Qui resta il **portafoglio dei titoli** e ciò che si può fare:
                scadenze, tasso di mercato, nuove emissioni. */}
            <DossierBlock
              title="Debito pubblico: scadenze e nuove emissioni"
              description={`Il portafoglio dei titoli e lo spazio per una nuova emissione. Tesoreria, saldo, debito e credito residuo sono nella scheda «Finanze pubbliche». ${MONEY_UNIT_NOTE}`}
            >
              {(debtTranches.length > 0 || debt > 0) && (
                <div className="nation-debt-block">
                  <h4 className="nation-subhead">Portafoglio del debito</h4>
                  <MetricGrid>
                    <Metric
                      label="Scadenza media"
                      value={`${index(averageMaturity, 1)} anni`}
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
                      Scoperto di cassa: {money(overdraft, 2)} — cassa negativa, distinta dai titoli emessi.
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
                      <span className="nation-borrow-hint">Spazio disponibile: {money(creditHeadroomValue, 2)}</span>
                    </form>
                  )}
                  <Footnote><b>Il debito ha un prezzo e una data</b> ogni titolo paga interessi ogni anno e torna a scadenza: alla maturità il motore lo rifinanzia al tasso di mercato del momento. Più la nazione è indebitata, più alti sono tasso e premio di rischio; un rapporto debito/PIL elevato alza la tensione sociale e logora la stabilità. La cassa negativa è scoperto, non un titolo: si paga al tasso di sconto.</Footnote>
                </div>
              )}
              <Footnote><b>Come si muove la cassa</b> ogni mese la tesoreria cambia del saldo mensile (entrate + reddito da risorse − uscite − interessi sul debito). Le scelte del giocatore la muovono subito: un ordine eseguito preleva una spesa una tantum, gli acquisti militari e le compravendite sul mercato si pagano al momento, i movimenti di truppe costano carburante e denaro. Un saldo negativo la riduce; sotto zero la differenza è debito pubblico.</Footnote>
            </DossierBlock>

            {/* Entrate, uscite, saldo, PIL e crescita sono nella scheda viva
                «Stato nazionale»/«Finanze pubbliche». Qui resta la **scomposizione
                delle voci**, che è l'informazione in più. */}
            {budget && (budget.revenue.length > 0 || budget.expense.length > 0) && (
              <DossierBlock
                title="Composizione del bilancio"
                description={`Le voci dietro i due totali: da dove entrano le entrate, dove escono le uscite. ${MONEY_UNIT_NOTE}`}
              >
                <div className="nation-budget-columns">
                  <BudgetBreakdown title="Entrate mensili" lines={budget.revenue} total={budget.revenueTotal} kind="revenue" />
                  <BudgetBreakdown title="Uscite mensili" lines={budget.expense} total={budget.expenseTotal} kind="expense" />
                </div>
                <Footnote><b>Come si legge</b> ogni voce è una ripartizione deterministica dei totali pubblicati dal motore, calcolata sui driver reali (fabbriche, porti, atenei, riserve, popolazione). La difesa è la quota esatta dichiarata dal conto; la somma delle voci è il totale. Nessun importo è stimato nel browser. Pressione fiscale, spesa sociale e istruzione sono in «Politica fiscale» e «Investimento nel popolo».</Footnote>
              </DossierBlock>
            )}


            <Footnote><b>Fonte</b> MaterialEconomy e WorldStateEngine.accounts · valori letti, non stimati dal client.</Footnote>


            <h3 className="nation-group-head">Materie, industria e cantieri</h3>

            <DossierBlock
              title="Quadro di risorse e industria"
              description="Scorte, flussi e autonomia; stabilimenti, capacità usata e colli di bottiglia."
            >
              <DomainOperatingBlock picture={operatingPicture} id="risorse" onOpenSection={openSection} />
              <DomainOperatingBlock picture={operatingPicture} id="industria" onOpenSection={openSection} />
            </DossierBlock>

            <DossierBlock
              title="Ritmo del mese: produzione e consumo"
              description="Quanto entra e quanto esce dal magazzino, voce per voce. Le scorte correnti, la capacità e il riempimento sono nella scheda «Risorse strategiche»."
            >
              {resources ? (
                <MaterialBalanceList rows={materialRows} showAvailability={false} />
              ) : (
                <EmptyState>Il magazzino materiale non è ancora pubblicato per questa partita.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MaterialEconomy · produzione, consumo, saldo e materiale perso al tetto sono calcolati dal motore per il mese corrente. Le scorte e la capacità di stoccaggio sono nella scheda «Risorse strategiche».</Footnote>
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
                    <Metric label="Effetto sulle entrate" value={`×${index(Number(resources?.modifiers?.revenueMultiplier), 2)}`} tone={Number(resources?.modifiers?.revenueMultiplier) >= 1 ? 'positive' : 'negative'} hint="Moltiplicatore sulle entrate" />
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
              description={`Giacimento reale, riserva residua, estrazione, magazzino e quotazioni di mercato. ${MONEY_UNIT_NOTE}`}
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
                                vendi {money(quote.bid, 3)} ·
                                compra {money(quote.ask, 3)}
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

            {/* Fabbriche e porti sono nella scheda «Capacità nazionale»; qui resta
                il **territorio** e la spiegazione delle fonti. */}
            <DossierBlock
              title="Territorio e fonti della capacità"
              description="Il territorio amministrato e da dove viene la disponibilità: il profilo della nazione, non solo ciò che è disegnato sulla mappa."
            >
              <MetricGrid>
                {/* Provinciali e città sono **fatti del territorio**: non hanno un
                    bene/male, ma senza un rapporto la cifra non si interpreta. Il
                    rapporto è ciò che la rende leggibile. */}
                <Metric label="Province" value={formatNumber(assets.provinces)} hint={assets.cities > 0 ? `${formatNumber(assets.cities)} città e capitali` : 'territorio amministrato'} />
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
              <Footnote><b>Fonte</b> conto nazionale quando disponibile; altrimenti oggetti delle regioni possedute. Fabbriche, porti e università sono nella scheda «Capacità nazionale».</Footnote>
            </DossierBlock>

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

            </DeepDive>

          </>
        )}

{active === 'statoMaggiore' && (
          <>
            <p className="nation-section-voice">La forza e l’estero: arsenale e produzione militare, gli impegni presi con le altre nazioni e che cosa inseguono le potenze del teatro.</p>

            {/* Stato canonico: forze armate ed equipaggiamento attuali vs Turno 0. */}
            <NationalDossierLive live={live} part="militare" />

            <DeepDive>

            {/* D-1 — la sala operativa (`ObjectsBoard`) è uscita dal dossier: è
                un blocco che **agisce** (crea reparti, compra, impartisce
                ordini), e da V01–V05 il dossier è un documento di stato. Vive
                nel pannello «Forze» della barra comandi, come le sfide in
                «Questioni». Lo stesso principio: il dossier si legge, le azioni
                si fanno in una superficie dedicata. */}

            <DossierBlock
              title="Quadro delle forze armate"
              description="Reparti in armi, copertura per categoria, prontezza operativa e dipendenze dall'estero."
            >
              <DomainOperatingBlock picture={operatingPicture} id="militare" />
            </DossierBlock>

            <DossierBlock
              title="Pressione militare"
              description={`Il costo dell'apparato militare e delle riserve richiamate. ${MONEY_UNIT_NOTE}`}
            >
              <MetricGrid>
                <Metric
                  label="Spesa militare"
                  value={defenceBurdenPct > 0 ? `${formatPercent(defenceBurdenPct, 1)} del PIL` : '—'}
                  tone={defenceTone(defenceBurdenPct)}
                  hint="Quota del PIL destinata alla difesa"
                  trend={mkTrend((point) => point.account.defenceBurdenPct, pointDelta, 'down')}
                />
                {/* Mobilitati e formazioni sono nella scheda «Forze armate». */}
                <Metric
                  label="Sforzo bellico"
                  value={formatPercent(warEffort)}
                  tone={warEffortTone(warEffort)}
                  hint="Forze e riserve sul totale nazionale"
                  trend={mkTrend((point) => point.account.warEffort, pointDelta, 'down')}
                />
              </MetricGrid>
            </DossierBlock>

            <DossierBlock
              title="Quanto produci e quanto consumi"
              description="Flussi che alimentano l'arsenale: scorte, fabbisogno, produzione mensile e dove si trovano i mezzi. L'equipaggiamento in servizio è nella scheda «Forze armate»."
            >
              <MaterialBalanceList
                rows={weaponsRows}
                emptyText="Il motore non pubblica il bilancio delle scorte di armamenti per questa partita."
              />
              {armsSplit ? <p className="arms-summary-line obj-note">{armsSplit}</p> : null}
              <Footnote><b>Da dove vengono le cifre</b> scorte, fabbisogno e produzione mensile sono del motore (MaterialEconomy), non una stima del Dossier; cibo, vestiario e carburante sono nella sezione Tesoro. La produzione di un mezzo è la somma degli ordini aperti qui sotto, con la data prevista dal ritmo reale della linea.</Footnote>
            </DossierBlock>

            <DossierBlock
              title="Forza dell'arsenale"
              description="Quanto vale l'apparato militare: quantità e potenza effettiva sui combattimenti."
            >
              {arms ? (
                <MetricGrid>
                  <Metric label="Forza militare" value={index(arms.strength, 1)} tone="neutral" hint="Quantità × qualità × dominio" />
                  <Metric label="Potenza effettiva" value={formatNumber(arms.effectiveMilitaryPower)} tone={arms.combatFactor >= 1 ? 'positive' : 'warning'} hint={`Base ${formatNumber(arms.baseMilitaryPower)} × fattore arsenale ${arms.combatFactor}`} />
                  {/* La qualità media è nella scheda «Forze armate» (attuale vs inizio). */}
                  {/* `arms.capacity.weapons` è il **tetto** del magazzino, non le
                      scorte attuali: si chiamava «Scorte armi» come la metrica di
                      Risorse, ma è un altro numero. */}
                  <Metric label="Capacità armamenti" value={formatNumber(arms.capacity.weapons)} hint="Tetto del magazzino: input per la produzione" />
                </MetricGrid>
              ) : (
                <EmptyState>Arsenale non ancora pubblicato per questa partita.</EmptyState>
              )}
              <Footnote><b>Fonte</b> MilitaryIndustry · budget e industrie sono in Tesoro; qui solo ciò che combatte.</Footnote>
            </DossierBlock>

            {/* D07: era una card di **spiegazioni** che occupava la schermata a
                ogni apertura («Come si legge l'arsenale»). I pesi di dominio
                restano visibili — sono **dati**, non spiegazioni, e servono a
                leggere le cifre qui sopra; il resto è una spiegazione, e sta
                dove serve: nel rapporto che accompagna la cifra (I2) e in un
                richiudibile per chi vuole il dettaglio della formula. */}
            {arms && arms.domains && arms.domains.length > 0 && (
              <DossierBlock
                title="Peso dei domini"
                description="Quanto conta un mezzo secondo il dominio: entra nella forza dell'arsenale."
              >
                <ul className="arms-domains">
                  {arms.domains.map(domain => (
                    <li key={domain.domain}>
                      <b>{domain.label}</b>
                      <span>peso {index(domain.weight, 1)}×</span>
                      <em>{domain.description}</em>
                    </li>
                  ))}
                </ul>
              </DossierBlock>
            )}

            <details className="nation-synthesis-detail">
              <summary>Come si legge l&apos;arsenale</summary>
              <div className="arms-legend">
                <p><b>Quantità</b> — quante unità sono in servizio: «×37» significa 37 mezzi di quel tipo operativi adesso.</p>
                <p><b>Forza</b> — <i>quantità × qualità × peso del dominio ÷ 100</i>. Un caccia pesa più di un fucile: il peso è nella tabella qui sopra.</p>
                <p><b>Qualità</b> — valore 0–100 del singolo mezzo: obsoleto sotto 26, datato 26–45, moderno 46–65, avanzato 66–85, nuova generazione da 86.</p>
                <p><b>Potenza effettiva</b> — potenza nominale della nazione × fattore di arsenale (0,6–1,6). Il fattore sale con la qualità media e con la copertura delle forze schierate: un esercito senza mezzi combatte al 60% della sua potenza.</p>
                <p><b>Perché conta</b> — l&apos;arsenale non è un punteggio: decide la potenza effettiva usata nei combattimenti e si consuma quando una nazione conquista una provincia.</p>
              </div>
            </details>

            {/* Una sola rappresentazione per fatto: l'equipaggiamento corrente vs
                iniziale è nella scheda «Forze armate»; ruolo, descrizione e
                caratteristiche di ogni voce sono nel catalogo qui sotto. */}
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
              description={`Catalogo completo del motore: le voci che l'epoca non prevede restano consultabili ma non sono la dotazione di questo scenario. ${doctrine.summary ? `L'epoca prevede: ${doctrine.summary}.` : ''} ${MONEY_UNIT_NOTE}`}
            >
              {arms ? (
                <div className="arms-catalog">
                  {catalogDomains.map((domain) => (
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

            <DossierBlock
              title="Strategie delle potenze"
              description="Che cosa stanno inseguendo le nazioni del teatro: obiettivi persistenti del motore, con la data di nascita, il motivo e il progresso misurato sugli indicatori del turno."
            >
              <PowersAgendaList powers={strategicAgenda?.powers || []} playerPolityId={playerPolityId} />
            </DossierBlock>

<details className="nation-synthesis-detail">
              <summary>Registro completo: impegni</summary>

              <DossierBlock
                title="Impegni della partita"
                description="Trattati, promesse, garanzie e ultimatum registrati dal motore: stato, controparte, importanza e scadenza. La cronaca racconta, il registro ricorda."
              >
                <CommitmentsList commitments={commitments?.commitments || []} today={worldDate || ''} />
              </DossierBlock>
            </details>
            </DeepDive>
          </>
        )}
      </div>
    </div>
  );
};

export default NationDock;
