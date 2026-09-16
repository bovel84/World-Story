# Living World incrementale — piano operativo

> **Regola madre: ENGINE FIRST — PRESENTATION LAYER SECOND.**
> Il motore esistente resta la fonte autorevole dello stato del mondo. Nessun
> nuovo motore, nessuna seconda verità, nessuna migrazione se il dato è
> derivabile. Ordine di preferenza: **RIUTILIZZA → DERIVA → ESTENDI MINIMAMENTE**.

Riferimenti nel repository:

- Backend: `backend-nest/src` (`core/simulation`, `core/economy`, `core/mandates`,
  `core/projects`, `game`, `services`, `routes/games`, `repositories`).
- Frontend: `frontend/src` (`components/Game`, `components/Shell`, `hooks`,
  `stores`, `services/api.ts`).
- Read model puri già esistenti in `frontend/src/components/Game/`:
  `accountTrend.ts`, `crisisPanel.ts`, `nationDossier.ts`, `governmentDossier.ts`,
  `projectCategory.ts`, `causalEvents.ts`, `nationalContext.ts`,
  `dispatchCategory.ts`, `feasibilityChain.ts`, `chatTimeline.ts`, `feedUnread.ts`.

---

## 4. MAPPATURA DEL MOTORE (tabella richiesta)

| Funzione Living World | Dato già disponibile | Origine (classe/modulo backend) | Riutilizzabile? | Modifica minima necessaria |
|---|---|---|---|---|
| Briefing — bilancio | `monthlyRevenue/Expenses/Balance`, `money`, `debt` | `core/simulation/WorldStateEngine.NationalAccount`, `NationalBudget` | Sì | **A** — derivare frontend |
| Briefing — debito | `debtRatioPct`, `creditLimit`, `creditHeadroom`, `annualInterest`, `debts[]` | `core/simulation/SovereignDebt`, `MaterialEconomy` (`debtOf`, `creditLimit`) | Sì | **A** |
| Briefing — fisco | `taxRatePct`, `fiscalEffects`, etichetta/livello | `core/simulation/FiscalPolicy` | Sì | **A** |
| Briefing — crisi | `CrisisState` (3 rischi + streak), `CrisisEnding` | `core/simulation/NationCrisis` (`assessCrisis`, `advanceCrisis`) | Sì | **A** |
| Briefing — sfide | `Pressure[]` attive + recenti | `core/simulation/PeacetimePressures` (`generatePressures`) | Sì | **A** |
| Briefing — scorte/magazzino | `ResourceStock` (food/clothing/weapons/fuel + `needs`/`capacity`) | `core/simulation/MaterialEconomy` (`materialNeeds`, `capStock`) | Sì | **A** |
| Briefing — processi/progetti | processi ongoing + progress + `expected_date` | `game/TimelineService`, `core/projects/ProjectEngine` | Sì | **A** |
| Briefing — mandati | `mandateDecisions` (shortfall) | `core/mandates/MandateStockEngine` + `MandateEngine` | Sì | **A** |
| Briefing — manutenzione | `maintenanceObligations` (sufficient/shortfall) | `core/maintenance` + read model `mandateDecisions` | Sì | **A** |
| Briefing — governo/fazioni | `GovernmentSnapshot` (cohesion, pressureIndex, factions, dominant/angriest) | `core/simulation/GovernmentFactions.governmentSnapshot` | Sì | **A** |
| Briefing — diplomazia | matrice relazioni per polity | `game/DiplomacyService` + `GET /:id/relationships` | Sì | **A/B** |
| Impatto evento — before/after conti | storico conti per turno/data | `nationalAccountRepository.list` → `GET /:id/national-state` (`history`) | Sì | **A** — deriva `deriveCheckpointImpact` |
| Impatto evento — risorse | magazzino al punto storico (`resources` + `money`/`debt`) | `NationStateService`, `recordAccountSnapshot` | Sì | **A** |
| Impatto evento — regioni cambiate | `changedRegions`, `changedRegionIds` | `gameStore`, `WorldStateEngine` | Sì | **A** |
| Impatto evento — crisi | `CrisisSnapshot` al turno corrente | `GET /:id/crisis`, `GET /:id/national-state` | Sì | **A** |
| Evento ↔ run ↔ checkpoint | `timelineEvents[].simulationId`, `sourceActionIds`, `chatId` | `game/TimelineService.TimelineEventRecord`, `repositories` simulation runs | Sì | **A** |
| Ordini → avanza | `pendingActions`, `ongoingProcesses`, `onTimeSkip(days)` | `game/OrderExecutionService`, `routes/games/playback.routes.ts` (`/time-skip`) | Sì | **A** (solo UX) |
| Checkpoint/lettore | `pausedReader`, `revision`, `simulationId` | `useSimulationPlayback`, `simulationStore` | Sì | **A** — non toccare |
| Governo — voci LLM | `GovernmentVoicesResponse` (per turno, on-demand) | `GameSession.getGovernmentVoices` + `gameController` | Sì | **A** |
| Mondo autonomo | `changedRegions`, feed eventi, conti esteri | `core/simulation/WorldStateEngine`, `game/WorldIntelService`, `game/NationStateService` | Sì | **A/B** |
| Diplomazia | relazioni + chat + eventi diplomatici in timeline | `game/DiplomacyService`, `routes/games/advisor.routes.ts` (`/relationships`) | Sì | **A/B** |
| Feed / dispacci | `feedItems`, categorie, unread | `useFeed`, `dispatchCategory.ts`, worker eventi | Sì | **A** |
| Map state | `selectedRegion`, `changedRegions`, `MapFilters/Layer` | `gameStore`, `mapModel.ts` | Sì | **A** |
| Arsenale / militare | `ArsenalResponse`, `production`, forza derivata | `core/simulation/MilitaryIndustry`, `MilitaryProduction` | Sì | **A** |
| Simulation playback | `temporalScars`, `pausedReader`, `handleContinueNext` | `useSimulationPlayback`, `simulationRuntime` | Sì | **A** — non toccare |

**Esito della mappatura:** quasi tutto ciò che serve al Living World è già
prodotto dal motore ed esposto da endpoint esistenti. I pacchetti LW01–LW06
sono quindi **read model puri + presentazione** (classi **A/B**), con al più una
piccola estensione di props frontend. **Nessuna modifica di tipo D/E** e
**nessuna migrazione DB**.

---

## 21A. COMPONENTI ESISTENTI RIUTILIZZATI

- Motore di simulazione: `core/simulation/*` (WorldStateEngine, NationCrisis,
  NationalBudget, SovereignDebt, MaterialEconomy, FiscalPolicy,
  GovernmentFactions, PeacetimePressures, MilitaryIndustry, MilitaryProduction).
- Persistenza/read model: `game/TimelineService`, `game/NationStateService`,
  `game/WorldIntelService`, `game/DiplomacyService`,
  `repositories/*` (account storico, ongoing processes, simulation runs).
- Endpoint esistenti: `GET /:id/national-state`, `/crisis`, `/pressures`,
  `/resources`, `/arsenal`, `/production`, `/ongoing-processes`,
  `/government/voices`, `/:id/relationships`, `/:id/timeline`, `/:id/events`.
- Hook: `useNationSnapshot`, `useWorldTimeline`, `useFeed`, `useOrderQueue`,
  `useSimulationPlayback`, `useWorldAdvance`, `useShellState`.
- Store: `gameStore`, `actionsStore`, `orderDraftStore`, `moduleState`, `uiStore`.
- Read model puri frontend: `accountTrend.ts`, `crisisPanel.ts`,
  `governmentDossier.ts`, `nationDossier.ts`, `nationalContext.ts`,
  `dispatchCategory.ts`, `projectCategory.ts`, `causalEvents.ts`, `feedUnread.ts`.
- Componenti: `NationDock`, `HudBar`/`TimelinePanel`, `TimeDesk`, `EventFeed`,
  `DiplomacyPanel`, `NewsFlash`, `SimulationEventReader`, `ProvinceInspector`.

## 21B. DATI GIÀ PRODOTTI DAL MOTORE

Conti nazionali e storico per turno; crisi (3 dimensioni + streak); pressioni
interne/esterne; politica fiscale ed effetti; magazzino materiale e risorse
naturali; debito sovrano per tranche con tasso e scadenza; processi/progetti con
avanzamento e scadenza; mandati e obblighi di manutenzione; governo con fazioni,
influenza, soddisfazione, pressione e richieste; relazioni diplomatiche; eventi
di timeline con `simulationId`; checkpoint/run di simulazione; feed dei dispacci;
arsenale e produzione militare.

## 21C. GAP REALI (verificati)

1. **Nessun briefing compatto**: i dati esistono sparsi in schede diverse del
   Dossier; manca una lettura unica «che cosa richiede attenzione».
2. **Conseguenze non leggibili**: gli eventi di timeline mostrano narrazione ma
   non il **delta** reale tra due punti storici, benché lo storico conti esista.
3. **Attrito Piano→Avanza**: il desk del tempo mostra il *numero* di ordini ma
   non il *piano*; il giocatore non vede cosa sta per essere eseguito.
4. **Presenza del governo limitata alla scheda**: la pressione politica non
   emerge fuori dal tab Governo.
5. **Mondo autonomo poco visibile**: le variazioni estere già simulate
   (`changedRegions`, feed) non sono riassunte.
6. **Diplomazia isolata**: la matrice relazioni è in un pannello a sé e non
   dialoga con briefing/eventi.

Nessuno di questi gap richiede nuova simulazione: sono tutti problemi di
**esposizione e presentazione**.

## 21D. MODIFICHE MINIME NECESSARIE

Tutte le modifiche sono di classe **A/B**:

- **LW01**: nuovo modulo puro `strategicBriefing.ts` + card in NationDock.
- **LW02**: nuovo modulo puro `checkpointImpact.ts` + delta per turno in
  `TimelinePanel` (usa lo storico conti già presente).
- **LW03**: props `pendingOrders` in `TimeDesk` + sezione «Piano» e CTA
  «Esegui piano e avanza» che chiama **lo stesso** `onTimeSkip`.
- **LW04**: riga di presenza del consiglio derivata da `GovernmentSnapshot`
  (`governmentDossier.ts`) mostrata nel briefing.
- **LW05**: blocco «Mondo» derivato da `changedRegions` + conti esteri +
  feed (nessun endpoint nuovo).
- **LW06**: riepilogo diplomatico nel briefing (alleati/ostili) dal risultato
  già restituito da `GET /:id/relationships`.

Nessun campo nuovo persistito. Nessun endpoint nuovo. Nessuna migrazione.

## 21E. PACCHETTI INCREMENTALI

| Pacchetto | Obiettivo | Tipo |
|---|---|---|
| **LW01 Strategic Briefing** | «Che cosa richiede attenzione» in una card compatta | A |
| **LW02 Event Impact** | Mostrare i delta reali motore per turno (`before → after`) | A |
| **LW03 Orders UX** | Piano visibile + «Esegui piano e avanza» senza cambiare il turn engine | A |
| **LW04 Government Presence** | La pressione politica emerge anche fuori dal tab Governo | A |
| **LW05 World Presence** | Rendere visibili le variazioni estere già simulate | A/B |
| **LW06 Diplomacy Presence** | Alleati/ostili e variazioni nel briefing e nel contesto | A/B |

## 21F. FILE DA MODIFICARE PER OGNI PACCHETTO

**LW01**
- `frontend/src/components/Game/strategicBriefing.ts` (nuovo, puro)
- `frontend/src/components/Game/strategicBriefing.test.ts` (nuovo)
- `frontend/src/components/Game/StrategicBriefingCard.tsx` (nuovo)
- `frontend/src/components/Game/NationDock.tsx` (blocco in cima a «situazione»)
- `frontend/src/index.css` (stili)

**LW02**
- `frontend/src/components/Game/checkpointImpact.ts` (nuovo, puro)
- `frontend/src/components/Game/checkpointImpact.test.ts` (nuovo)
- `frontend/src/components/Game/HudBar.tsx` (delta per turno in `TimelinePanel`)
- `frontend/src/components/Game/GameScreen.tsx` (passa lo storico a `HudBar`)
- `frontend/src/index.css`

**LW03**
- `frontend/src/components/Game/TimeDesk.tsx` (sezione «Piano»)
- `frontend/src/components/Game/HudBar.tsx` (prop `pendingOrders`)
- `frontend/src/components/Game/GameScreen.tsx` (passa `pendingActions`)
- `frontend/src/components/Game/timeDeskPlan.test.ts` (nuovo)
- `frontend/src/index.css`

**LW04**
- `frontend/src/components/Game/governmentDossier.ts` (helper `councilPresence`)
- `frontend/src/components/Game/governmentDossier.test.ts` (test aggiunti)
- `frontend/src/components/Game/strategicBriefing.ts` (usa l'helper)

**LW05**
- `frontend/src/components/Game/worldPresence.ts` (nuovo, puro)
- `frontend/src/components/Game/worldPresence.test.ts` (nuovo)
- `frontend/src/components/Game/strategicBriefing.ts` (usa il deriver)

**LW06**
- `frontend/src/components/Game/diplomacyPresence.ts` (nuovo, puro)
- `frontend/src/components/Game/diplomacyPresence.test.ts` (nuovo)
- `frontend/src/components/Game/DiplomacyPanel.tsx` (riepilogo + toni)
- `frontend/src/components/Game/strategicBriefing.ts` (usa il deriver)

## 21G. FILE CHE NON DEVONO ESSERE TOCCATI (CORE ENGINE FREEZE)

Vedi sezione dedicata sotto. In sintesi: nessun file in `backend-nest/src/core`,
`backend-nest/src/game/GameSession.ts`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, `repositories/*`, `stores/gameStore.ts`,
`stores/simulationStore.ts`, `useSimulationPlayback`, `SimulationEventReader`
(semantica checkpoint).

## 21H. RISCHI DI REGRESSIONE

| Rischio | Mitigazione |
|---|---|
| Il briefing duplica logica del motore e diverge | Solo lettura di campi già pubblicati; nessuna formula di simulazione ricreata; test puri |
| Delta impatto interpretati come causalità | Etichette «variazione nel turno», non «causa»; distinzione diretta/correlata nei testi |
| Il piano in TimeDesk cambia la semantica registra/avanza | La CTA chiama lo stesso `onTimeSkip`; nessuna nuova pipeline |
| Props aggiunte rompono i test di struttura | Estensioni additive con default (`pendingOrders = []`) |
| Performance HUD | Derivation memoizzate con `useMemo`, liste brevi |

## 21I. TEST

- Puri e deterministici, **senza avviare l'LLM**: `deriveStrategicBriefing`,
  `deriveCheckpointImpact`, `linkEventsToImpact`, `deriveWorldPresence`,
  `deriveDiplomacyPresence`, `councilPresence`.
- Test di struttura (come `timeDeskSeparation.test.ts`) per le nuove superfici.
- Ogni pacchetto mantiene verdi i test esistenti (backend + frontend) e la
  build (`tsc && vite build`). Il check `test-build` della CI resta il gate.

---

## CORE ENGINE FREEZE

I seguenti componenti sono **congelati**: non vanno rifattorizzati, sostituiti o
duplicati in questa iniziativa. Qualsiasi modifica qui richiede un pacchetto
dedicato, giustificazione da bug critico e classificazione **E** esplicita.

**Simulazione e turno**
- `backend-nest/src/core/simulation/**` (WorldStateEngine, TurnOrchestrator,
  NationCrisis, NationalBudget, NationalEffects, FiscalPolicy,
  GovernmentFactions, PeacetimePressures, ResourceMarket, SovereignDebt,
  MilitaryIndustry, MilitaryProduction, ReactionDecisions, ReactionContext).
- `backend-nest/src/game/GameSession.ts`, `game/TurnPipelineService.ts`,
  `game/SessionStateStore.ts`, `game/OrderExecutionService.ts`.
- `backend-nest/src/core/economy/**`, `core/mandates/**`, `core/projects/**`,
  `core/feasibility/**`, `core/maintenance/**`.

**Persistenza**
- `backend-nest/src/repositories/**` e lo schema SQLite (nessuna migrazione).

**Frontend — stato e playback**
- `frontend/src/stores/gameStore.ts`, `stores/simulationStore.ts`,
  `stores/simulationRuntime.ts`, `stores/actionsStore.ts`,
  `stores/orderDraftStore.ts`.
- `frontend/src/hooks/useSimulationPlayback.ts`, `hooks/useSimulationStream.ts`.
- `frontend/src/components/Game/SimulationEventReader.tsx` (semantica checkpoint).
- `frontend/src/services/api.ts` (solo tipi/aggiunte additive, nessuna rottura).

**Regola LLM (invariata)**
`ENGINE DATA → STRUCTURED CONTEXT → LLM NARRATIVE → UI`. Mai `LLM → nuova verità`.

---

## STATO DI AVANZAMENTO

- [x] LW01 — Strategic Briefing
- [x] LW02 — Event Impact
- [x] LW03 — Orders UX
- [x] LW04 — Government Presence
- [x] LW05 — World Presence
- [x] LW06 — Diplomacy Presence
