# WS-GOVOFFICE-07 — La sedia del Tesoro come scena + la tela di destra

- **Base**: `main` @ `4a42e7f` (PR #142, WS-GOVOFFICE-06 mergiato).
- **Ramo**: `feat/ws-govoffice-07-scena-tesoro-e-tela`.
- **Freeze motore**: intatto. **Nessuna** riga sotto `backend-nest/src/**`,
  nessun tocco a `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
  `TurnPipelineService`, `SessionStateStore`, schema, DB, repository o pipeline
  di avanzamento del tempo. Tutto il lavoro è **frontend** (+ test E2E e questo
  report). Nessuna migrazione, nessun motore nuovo.
- **Classificazione**: A (CSS/layout) · B (harness visivo) · C (test) · D
  (report) · **E assente**.

## 1. Il problema trovato (causa reale)

L'autore osserva che la sedia del Ministro del Tesoro **dice** «ho 2 proposte»
ma **non porta nulla**: sono bullet, non una scena. La verifica sul codice reale
(FASE 1) ha confermato i punti di innesto e **la causa**:

- `opening` + `items` non vivono nel frontend: li compone il **backend**
  (`readCabinetSession` → `composeCabinet` da `GovernmentAgenda`) e li serve
  `GET /:id/government/cabinet` come `CabinetSessionView`. Il frontend li legge
  e li mostra — non li genera.
- Il **pannello destro** era `MinisterDossier` («Dati della sedia»): un
  contenitore a scomparsa (`minister-dossier-toggle`) alimentato da
  `nationalOperatingPicture` + `session.addresses[].items[].figures`. Era
  **un'etichetta con una X**, non una superficie viva: non ospitava grafici,
  piani, mappe o idee, e non era un aggancio per le altre sedie.
- Le «strade» della seduta erano un **menu di opzioni**: la strada d'opera
  esisteva solo dentro `item.paths` e non c'era un **atto** che portasse le
  cifre del motore (cassa, interessi/entrate, scadenza titoli, richiesta di un
  altro ministro) né un pulsante che ne firmasse l'esito.
- **Limite già noto e confermato**: il motore **non ha un'azione di rimborso
  titoli**. `NationResources.debts` (`SovereignDebtTranche` con `maturityDate`,
  `principal`, `annualRatePct`) esiste nel read model, ma le scadenze sono un
  **rollover automatico**: nessun endpoint le estingue. Questo fissa il confine
  della Parte D (vedi §7).

## 2. Correzioni e aggiunte (Parti B/C/D)

### Parte B — «Deve portare qualcosa»: l'atto concreto sul tavolo

`treasuryAct.ts` (puro) deriva dai read model un **atto** con cifre reali:

- **cassa disponibile**, **saldo di bilancio**, **debito/PIL**, **interessi /
  entrate** (`debtServicePct`), **interessi annui**, **cassa in mesi di spesa**
  (`economy.treasuryMonths`);
- la **richiesta di un altro ministro** (`worksRequestFrom` legge la sedia dei
  lavori dalla stessa `session`: opera, distinta, materiali mancanti secondo il
  server — non se li inventa);
- la **prossima scadenza** del portafoglio (`nextMaturityFrom`, dai `debts`);
- ogni cifra dichiara la sua provenienza (`misurato · conti nazionali`,
  `stimato · …`, `dato mancante · …`).

**Regola rispettata**: nessun numero nuovo. `treasuryAct` non ricalcola: legge
`account`, `resources`, `picture.economy` e formatta (riuso di `formatMoney` /
`formatPercent`, `MONEY_UNIT`).

### B2 — L'ordine firmabile che muove la cassa

Le due **strade** nascono dall'atto e sono **firmabili**:

- **Ammortamento del debito** → ordine in **testo** (`onQueueOrder`): dichiara
  il costo immediato (il titolo in scadenza) e il guadagno atteso (gli interessi
  risparmiati, calcolati come `principal × annualRatePct`, **dichiarato calcolo**,
  non un numero del motore).
- **Investimento** → **ordine d'opera reale** (`onQueueCabinetPath`): usa la
  dichiarazione del server (`cabinetDeclarationFor` + `composeCabinetOrderText`),
  il motore apre il cantiere e **addebita la cassa** all'esecuzione.

In entrambi i casi l'atto entra nel **registro/coda** (`OrderRegister`), non
resta una promessa. `TreasuryActPanel` è solo presentazione: riceve l'atto già
derivato e chiama `onSign`.

### B3 — Due strade raccontate, non elencate

Ogni strada ha **voce** (come la direbbe il ministro, con le cifre **dentro** la
frase), **costo immediato** e **guadagno atteso misurato**; non esiste una
scatola KPI separata. La richiesta dei lavori in attesa è mostrata con il suo
stato («in attesa» → «accolta»).

### Parte C — La tela (spazio di destra riutilizzabile)

`SeatCanvas.tsx` è un componente **generico**: riceve una lista di
`SeatCanvasBlock` e li rende. Non conosce il Tesoro, non legge lo stato.

Blocchi supportati (`seatCanvasModel.ts`, puro):

| `kind` | sorgente | regola |
|---|---|---|
| `metrics` | read model (quadro + `items[].figures`) | nessun numero nuovo; provenienza dichiarata |
| `chart` | `advisorCharts` (`budgetChart`, `trendChart`) | entra **solo** se la figura non è vuota |
| `strategy` | **contenuto autore** | piano a cascata (`strategicPlan.ts`) |
| `map` | regioni del giocatore (`zoneBoard`) | geometria da `Region.svgPath`, altrimenti lista; mai mappa vuota spacciata per dato |
| `ideas` | **contenuto autore** | le idee del ministro |

`deriveSeatCanvasBlocks` è **puro e deterministico**: stesso input ⇒ stessi
blocchi. I blocchi `metrics`/`chart`/`map` derivano dal read model per **ogni**
sedia (mappa `SEAT_DOMAINS`, trascrizione di `SEAT_READS`).

### C2 — Piano a cascata

`strategicPlan.ts` separa testo, struttura e geometria:

- `parseStrategicPlan` legge un formato minimo
  (`PIANO:` / `ESITO:` / `DATA | Titolo | Descrizione | deps`), risolve le
  dipendenze per slug e **scarta quelle ignote** (il nodo resta radice, non si
  inventa un arco);
- `cascadeLayout` calcola profondità, **rami** (nodi con più successori) e
  **ricongiungimenti** (nodi con più predecessori), con guardia anti-ciclo;
- `STABILIZATION_PLAN_TEXT` / `stabilizationPlan()` sono il **contenuto
  d'esempio** sanzionato dal task («Stabilizzazione e Influenza Regionale»).

`StrategicPlanDiagram.tsx` rende le corsie per livello, le etichette datate
(es. `GEN 2026`), i tag «si apre in rami» / «i rami si ricongiungono», l'esito e
l'**espansione a schermo pieno**.

### C3 — Mappa

`zoneBoard` prende le regioni del giocatore (owner = `account.polityId`),
le ordina per prodotto e le mappa; se il motore pubblica `svgPath` si disegna
l'SVG, altrimenti si mostra la lista (nome + prodotto + abitanti). L'obiettivo
della mappa è l'opera in attesa (parte del contenuto curato del Tesoro).

### C4 — La tela è di TUTTI i ministri: aggancio per sedia

Il punto di aggancio per-ministro è esplicito in **`seatCanvasConfig.ts`**:

```ts
SEAT_CANVAS_AUTHORING: Partial<Record<seat, SeatCanvasAuthoring>>
```

- una **mappa `sedia → configurazione della tela`**: ogni sedia dichiara il suo
  **contenuto curato** (`plan`, `ideas`, `target`), ricevendo un
  `SeatCanvasContext` (`picture`, `sources`, `act`);
- `seatCanvasAuthoring(seat, ctx)` è l'unica funzione che `GovernmentOffice`
  chiama: **non c'è più alcun `seat === 'tesoro'`** nel componente;
- i blocchi `metrics`/`chart`/`map` restano **derivati dal read model** per
  tutte le sedie: una sedia senza voce nel registro riceve comunque la tela
  derivata (non serve toccare `GovernmentOffice` per aggiungerne una).

**Primo inquilino**: `tesoro` (piano di stabilizzazione, idee dalle due strade,
obiettivo = opera in attesa). **Secondo esempio minimo**: `guerra` (Stato
maggiore) con un **piano militare a cascata** («Difesa e Deterrenza Regionale»,
ramo su `riarmo-ordinato`, ricongiungimento su `deterrenza-credibile`) e due
idee di deterrenza. Questo prova che `kind: strategy` **non è cablato al
Tesoro**: aggiungere una sedia = aggiungere una chiave alla mappa.

`SeatCanvas` è anche **innestabile**: la tela è generica, il Tesoro è il caso di
riferimento, l'aggancio per le altre sedie (Stato maggiore compreso) è pronto.

### Parte D — Conseguenze visibili

Ciò che si decide torna nel mondo, **senza effetti finti**:

- **Registro/coda**: l'atto firmato entra in `OrderRegister` (meccanismo reale
  `onQueueCabinetPath`/`onQueueOrder`). E2E P04b: `«Aprire il cantiere»` compare
  nel registro dopo la firma.
- **Reazione dei ministri**: la richiesta dei lavori passa da
  `data-state="pending"` / «in attesa» a `data-state="accepted"` / «accolta»
  quando si firma la strada d'investimento (E2E P04b).
- **Effetto nel mondo**: per la strada d'opera il motore apre il cantiere e
  **addebita la cassa** all'esecuzione; l'addebito entra nel feed/settlement
  esistenti (`OrderSettlementEntry` via `decisionImpact.ts`). I numeri
  (cassa, debito/PIL, servizio del debito) restano visibili in
  Situazione/Tesoro del Dossier Nazione, che **non è stato toccato**.

## 3. File modificati

Frontend — nuovi:

| File | Ruolo |
|---|---|
| `frontend/src/components/Game/treasuryAct.ts` | atto del Tesoro + strade firmabili (Parte B) |
| `frontend/src/components/Game/TreasuryActPanel.tsx` | presentazione dell'atto e firma |
| `frontend/src/components/Game/seatCanvasModel.ts` | blocchi tipizzati + derivazione (Parte C) |
| `frontend/src/components/Game/seatCanvasConfig.ts` | **mappa sedia → configurazione della tela** (C4) |
| `frontend/src/components/Game/SeatCanvas.tsx` | renderer generico dei blocchi |
| `frontend/src/components/Game/strategicPlan.ts` | parsing + layout a cascata + fixture |
| `frontend/src/components/Game/StrategicPlanDiagram.tsx` | diagramma a cascata (espandibile) |
| `frontend/src/components/Game/treasuryAct.test.ts` | test atto/ordine |
| `frontend/src/components/Game/seatCanvasModel.test.ts` | test blocchi/metriche/zone |
| `frontend/src/components/Game/seatCanvasConfig.test.ts` | test aggancio per sedia + secondo esempio |
| `frontend/src/components/Game/seatCanvasRender.test.tsx` | test render (atto, tela, diagramma) |
| `frontend/src/components/Game/strategicPlan.test.ts` | test parsing/cascata |

Frontend — modificati:

| File | Modifica |
|---|---|
| `frontend/src/components/Game/GovernmentOffice.tsx` | il pannello destro diventa `TreasuryActPanel` (Tesoro) + `SeatCanvas`; `act` derivato; `signTreasuryRoad`; contenuto curato dal registro per sedia |
| `frontend/src/editorial.css` | blocco WS-GOVOFFICE-07 (`.seat-canvas*`, `.treasury-act*`, `.plan-diagram*`, `.zone-map*`) |

E2E — modificati:

| File | Modifica |
|---|---|
| `e2e/tests/modules.spec.mjs` | P04 aggiornato alla tela; **nuovo P04b** (firma → registro + «accolta») |
| `e2e/a11y/a11y.spec.mjs` | la seduta audita `.seat-canvas` (non più `.minister-dossier`) |
| `e2e/govoffice-shot.mjs` | screenshot della tela al posto del vecchio pannello |

Documento: `docs/implementation/WS-GOVOFFICE-07-report.md` (questo).

`MinisterDossier.tsx` **non è stato rimosso**: resta con la sua unit test
(`governmentOfficeMobile.test.tsx`) e non è più montato nella seduta.

## 4. Conferma CORE ENGINE FREEZE

**Il freeze è intatto.** Non sono stati toccati `core/simulation/**`,
`GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`,
schema/DB, repository, semantica checkpoint/simulation run, pipeline di
avanzamento del tempo. Non è stato introdotto alcun motore nuovo né alcuna
dipendenza frontend nuova (grafici e diagrammi sono **SVG a mano**, come il
preesistente `AdvisorChart`: nessuna libreria di chart). Non è servita alcuna
migrazione: **nessun blocco**.

## 5. Test eseguiti (esito reale)

| Comando | Esito |
|---|---|
| Frontend `vitest run` | **110 file, 928 test, tutti verdi** (baseline `4a42e7f`: 105/898; +5 file, +30 test) |
| Frontend `npx tsc --noEmit` | pulito |
| Frontend `npm run build:frontend` | OK (bundle `index-*.js`, `index-*.css` rigenerati) |
| Backend `npm test` | **200 file, 2110 test, tutti verdi** (nessuna modifica; `dist/**/*.test.js` assenti) |
| Backend `npx tsc --noEmit` | pulito |
| E2E `modules.spec.mjs` (mock) | **7/7** (P04 aggiornato, **P04b nuovo**) |
| E2E `chat-order` + `decision-impact` + `country-clarity` (mock) | **8/8** |
| a11y `HUD di gioco: nessuna violazione di base` | **1/1** |
| Harness visivo `e2e/govoffice-shot.mjs` (tesoro + multi) | OK, screenshot in `/tmp/ws07-*` |

Nessun test è stato allentato o disabilitato. Le modifiche a `modules.spec.mjs`
e `a11y.spec.mjs` **seguono il cambiamento intenzionale** della superficie
(il pannello `MinisterDossier` → la tela `SeatCanvas`) e la nuova asserzione è
**più forte** della vecchia (verifica atto, cifre con provenienza, cinque tipi
di blocco, richiesta in attesa, firma → registro).

## 6. Risultati

- Il Ministro del Tesoro **porta un atto concreto** con cifre reali del motore,
  ciascuna con la sua provenienza.
- Esiste una **tela riutilizzabile** con, per il Tesoro: grafico del motore
  (bilancio/storico), piano strategico a cascata, mappa delle zone, idee e
  metriche del quadro.
- La **firma muove la cassa**: la strada d'investimento accoda l'ordine d'opera
  reale; l'atto entra nel registro; la richiesta dei lavori passa ad «accolta».
- Il **Dossier Nazione** (Situazione/Regno/Tesoro/Stato maggiore) e l'invariante
  **D01** non sono stati toccati (E2E U03 verde).
- La tela è **generica per tutte le sedie**: l'aggancio è la mappa
  `SEAT_CANVAS_AUTHORING`; il Tesoro è il primo inquilino, lo Stato maggiore il
  secondo esempio.

## 7. Limiti residui (dati non pubblicati dal motore)

1. **Nessuna azione di rimborso titoli nel motore.** Le scadenze sono un
   rollover automatico: la strada «Ammortamento del debito» produce un **ordine
   in testo** e **dichiara** il risparmio d'interessi atteso, ma il motore non
   applica il rimborso e non pubblica un `OrderSettlementEntry` per
   quell'effetto. Non è stato inventato nessun titolo di giornale né alcuna
   conseguenza contabile che il motore non produce.
2. **Nessun «notiziario» dedicato.** La conseguenza visibile per la strada
   d'opera è quella **esistente**: registro → cantiere → addebito in
   `decision-impact`/feed. Per il rimborso non c'è una voce di giornale perché
   il motore non ne pubblica una.
3. **Lo stato «accolta» della richiesta è di interfaccia**, derivato dall'esito
   dell'accodamento (`onSign` → `true`), non uno stato persistito dal motore.
   Il motore applica la richiesta quando esegue l'atto al turno.
4. **Il contenuto curato è statico.** Piano del Tesoro e piano militare sono
   fixture: la generazione dinamica di piani multipli è **fuori scope in 07**
   (dichiarato dal task).
5. **La mappa è di zone, non di opere.** Mostra le regioni del motore e
   l'opera-obiettivo; non colloca le singole opere su una mappa geografica
   (fuori scope).
6. **`MinisterDossier` resta codice non montato.** Non è stato rimosso per non
   rompere la sua unit test; è candidato a rimozione in una fase di pulizia.

## 8. Proposte per la fase successiva

1. **Un'azione di rimborso titoli nel motore** (o un esito `ledger` per le
   scadenze): darebbe alla strada di ammortamento una conseguenza contabile
   reale e un `OrderSettlementEntry` verificabile.
2. **Piani dinamici**: far derivare i nodi del piano dai processi/agende del
   motore (oggi contenuto curato), mantenendo i numeri dietro reali.
3. **Terzo inquilino della tela** (es. Esteri con una mappa delle relazioni, o
   Lavori con le opere del catalogo): la mappa `SEAT_CANVAS_AUTHORING` è già
   pronta.
4. **Mappa delle opere** sul territorio (collegare `w_*` alle regioni) invece
   della sola vista zone.
5. **Rimozione di `MinisterDossier`** una volta che la tela copre tutte le
   sedie, con migrazione del suo test.
6. **Notiziario** che citi l'atto firmato: richiede che il motore pubblichi la
   cronaca dell'atto (non un testo costruito nel frontend).
