# WS-MINISTER-UX-08 — Correzione dell'esperienza richiesta

**Repo**: `/Users/bovel/Desktop/World Story`
**Branch**: `feat/ws-minister-ux-08-correzione-tavola`
**Base dichiarata**: `main` @ `6d42ab3` (PR #150 — UX-07 — mergiata)
**Task**: `docs/roadmaps/task-ws-minister-ux-08-correzione.md`
**Natura**: correzione di ciò che UX-01…UX-07 hanno consegnato. **Solo frontend**
(più il contratto della memoria nel client). **Nessun tocco al motore.**

---

## 1. Problemi trovati (causa reale, file e riga)

Le sei correzioni partono da difetti **verificati sul codice reale**
(base `750d8b0`), non da ipotesi.

| # | Difetto | Causa reale (file:riga) |
|---|---------|--------------------------|
| 1 | L'atto del Tesoro precede **sempre** grafici e mappe, anche quando la conversazione ha chiesto un grafico o una mappa. | `frontend/src/components/Game/SeatTable.tsx`: il pannello dell'atto è reso prima della visualizzazione principale — `TreasuryActPanel` a riga 158, `.seat-table-main` a riga 193; l'atto non era condizionato alla pertinenza. |
| 2 | Un confronto alla Sanità mostra le strade del **Tesoro**: `act.roads` è la sorgente unica per tutte le sedie. | `frontend/src/components/Game/GovernmentOffice.tsx`: `resolvePresentation(activePresentation, canvasBlocks, act.roads)` (righe 307-308), `roadStates` e la memoria del confronto su `act.roads` (righe 274-279, 321-323). `onCompare` in `SeatTable.tsx:167` era legato ad `act.roads`. |
| 3 | Nella presentazione ordinaria compaiono **piani dimostrativi con date fisse** («GEN 2026», «1° gennaio»), non legati alla partita. | `frontend/src/components/Game/strategicPlan.ts`: fixture `STABILIZATION_PLAN_TEXT` (riga 188) e `stabilizationPlan()` (riga 199); `frontend/src/components/Game/seatCanvasConfig.ts`: `MILITARY_PLAN_TEXT` (riga 47) usato da `guerra: () => ({ plan: militaryPlan(), … })` (riga 109). |
| 4 | La cache client della memoria è indicizzata **solo per `gameId`**: ramo e mandato non entrano nella chiave. | `frontend/src/components/Game/ministerMemory.ts`: `STORAGE_PREFIX + gameId` in `loadMemory` (righe 209-212) e `saveMemory` (righe 222-229); nessun `branchId`, nessun `mandate`. |
| 5 | Grafica sovraccarica: l'atto è in primo piano con tutte le fonti; l'ordine nasce dalla **singola domanda** («↳ Concludi con un ordine da questo problema»). | `frontend/src/components/Game/MinisterChat.tsx`: pulsante per messaggio utente (righe 241-250, prop `onOrderFromUserMessage` riga 65); le fonti erano inline — `TreasuryActPanel.tsx:55,68`, `SeatCanvas.tsx:151,177`. |
| 6 | La conversazione completa col **provider reale** non era mai stata verificata dall'inizio alla fine con screenshot dell'evidenza richiesta. | Mancava un harness che percorresse obiettivo → chiarimento → grafico → territorio → alternative → proposta modificata → decisione → riapertura con memoria contro il backend reale. |

---

## 2. Correzioni applicate (i sei punti)

### 1. L'evidenza richiesta occupa subito la parte principale

`SeatTable.tsx` ora distingue **pertinenza dell'atto** e **ordine**:

- con una direttiva attiva, la visualizzazione principale (`.seat-table-main`) e i
  suoi supporti vengono resi **prima**; l'atto del Tesoro viene **dopo**;
- l'atto è «pertinente alla decisione» quando la conversazione chiede `spesa`,
  `cifre`, `piano` o il **confronto** (`ACT_EVIDENCE`); per `mappa`/`trend`/`idee`
  resta in pagina ma **dopo** l'evidenza richiesta;
- senza direttiva resta il comportamento di sicurezza di UX-01 (atto in cima).

`ResolvedPresentation` porta ora anche `evidence` (`presentation.ts`), così la
pertinenza è un dato, non una stringa indovinata.

**Test**: `seatTablePresentation.test.tsx` › «l'atto non precede l'evidenza
richiesta; senza direttiva resta prima (UX-01)». Con `focus mappa` il
`data-kind="map"` è in `.seat-table-main` e `.treasury-act` viene **dopo**.

### 2. Confronti e proposte legati al ministro aperto e alla conversazione

Nuovo modulo puro `frontend/src/components/Game/seatProposals.ts`:

- `seatRoads(address, act)` deriva le proposte dalla **sedia aperta**: per il
  Tesoro unisce le strade dell'atto (scadenze/opere reali) ai percorsi gemelli
  dell'agenda, deduplicati per `id`; per le altre sedie dai `items[].paths`.
  **Niente `act.roads` globale.**
- `focusedProposals(roads, discussion)` mette in testa la proposta **nominata**
  nella conversazione (aggancio locale e deterministico, come `spendingFocus`).

`GovernmentOffice.tsx` usa `seatRoads(address, act)` per `resolvedPresentation`,
`roadStates`, la memoria del confronto e `compareFromTable`. `SeatTable` riceve
`proposals` e mostra il confronto/`Confronta le strade` solo con ≥ 2 proposte.

**Test**: `seatProposals.test.ts` (Sanità ≠ Tesoro; menzione; dedup); 
`seatTablePresentation.test.tsx` › «un confronto alla Sanità non mostra strade del
Tesoro»; E2E mock `P04c` (il confronto del Tesoro resta coerente).

### 3. Niente piani dimostrativi con date fisse

- Rimossi `STABILIZATION_PLAN_TEXT`/`stabilizationPlan()` da `strategicPlan.ts` e
  `MILITARY_PLAN_TEXT`/`militaryPlan()`/`MILITARY_IDEAS` da `seatCanvasConfig.ts`.
- Nuova funzione pura `planFromProposal(proposal)`: costruisce il piano dalle
  **strade/prerequisiti della proposta concreta** e ancora i nodi alla **data di
  gioco corrente** (`formatDateOr`, es. `1 FEB 2026`). Senza data di gioco o senza
  strade restituisce `null`: la tela **non mostra** un piano, non ne inventa uno.
- `seatCanvasConfig.ts` è ora generico e puro: deriva piano/idee/obiettivo dai
  dati della sedia; il Tesoro aggiunge solo l'obiettivo della mappa (opera in
  attesa, dato del motore).

**Test**: `strategicPlan.test.ts` › `planFromProposal` (data di gioco diversa ⇒
piano diverso; niente date fisse; dato mancante ⇒ `null`); `seatCanvasConfig.test.ts`
(derivazione dalla proposta, niente fixture) e `seatCanvasModel.test.ts`,
`seatCanvasRender.test.tsx`, `ministerUx01Render.test.tsx` aggiornati ai nuovi
fixture senza date fisse.

### 4. Scope della memoria anche nel client

`ministerMemory.ts`:

- nuovo `MinisterMemoryScope { gameId, branchId, mandate }` e `memoryScopeKey()`
  (chiave `gameId::branch::mandate`);
- `loadMemory(scope)` / `saveMemory(scope, store)` usano lo scope;
- `clientMandate(government, polityId)` è la gemella client di `mandateFor`
  server-side (`polityId:dominantId`);
- `GovernmentOffice` legge `branchId` da `useSimulationStore` (cambia al fork) e
  il mandato dal governo, e ricarica/salva per scope.

La potatura per data (`pruneMemoryByDate`/`seatRecords`) scarta già i ricordi
**futuri** al rewind.

**Test**: `ministerMemory.test.ts` › «un ricordo di un altro ramo non riappare»,
«cambiando mandato cambia lo scope», «il mandato è polity + fazione dominante»,
rewind/futuro; `clientMandate`.

### 5. Grafica alleggerita e ordine dalla proposta concreta

- **Fonti nei dettagli**: nuova resa `Provenance` (`<details>`) in `SeatCanvas.tsx`
  per le cifre e la mappa, e in `TreasuryActPanel.tsx` per le cifre dell'atto e
  della richiesta. I numeri restano leggibili, le provenienze si aprono a
  richiesta.
- **Ordine dalla proposta concreta**: rimosso il pulsante per-messaggio
  `.minister-draft-order` da `MinisterChat.tsx` e la prop `onOrderFromUserMessage`.
  L'ordine nasce dalla **proposta concreta** sul tavolo: nuovo `SeatProposalPanel`
  (con la resa condivisa `ProposalRoadList`) per le sedie non-Tesoro; l'atto del
  Tesoro conserva le sue strade. Preparare ⇒ bozza correggibile ⇒ firma nel
  registro. CSS morto `.minister-draft-order` rimosso.

**Test**: `seatTablePresentation.test.tsx` › «le fonti stanno nei dettagli e
l'ordine nasce dalla proposta concreta»; E2E `modules.spec.mjs` U02/P04 aggiornati
al nuovo flusso (prepara + firma), `govoffice-shot.mjs`/`ux01-shot.mjs`/a11y
aggiornati; `cssDiscipline` verde.

### 6. Verifica della conversazione completa col provider reale

Nuovo harness `e2e/ux08-real-provider.mjs` contro il backend reale `localhost:8000`
(LLM di produzione da `llm.config.json`, non lo stub). Percorre:

> obiettivo → chiarimento → grafico → territorio → alternative →
> proposta modificata → decisione → riapertura con memoria (con reload del browser)

Misura a ogni passo se l'evidenza richiesta è nella parte **visibile**
(`.seat-table-main`) e se l'atto non la precede; salva 8 screenshot e un log JSON.
Per l'evidenza richiesta il modello reale non è deterministico: l'harness
**richiede** l'evidenza con un massimo di 3 rilanci espliciti, così la prova
dimostra che la tavola mostra davvero ciò che il Presidente chiede.

---

## 3. File modificati

**Nuovi**
- `frontend/src/components/Game/seatProposals.ts` (+ `.test.ts`)
- `frontend/src/components/Game/SeatProposalPanel.tsx`
- `e2e/ux08-real-provider.mjs`
- `docs/implementation/assets/ws-minister-ux-08/real/` (8 screenshot + `real-provider-log.json`)

**Modificati (frontend)**
- `GovernmentOffice.tsx` (memoria su scope; `seatRoads`; confronto dalla sedia)
- `SeatTable.tsx` (ordine evidenza/atto; `proposals`; bozza per ogni sedia)
- `SeatCanvas.tsx` (fonti nei dettagli)
- `TreasuryActPanel.tsx` (resa strade condivisa; fonti nei dettagli)
- `MinisterChat.tsx` (rimosso l'ordine dalla singola domanda)
- `ministerMemory.ts` (scope partita+ramo+mandato)
- `presentation.ts` (`evidence` risolta; confronto ordinato dal discorso)
- `strategicPlan.ts` (`planFromProposal`; rimossi i piani dimostrativi)
- `seatCanvasConfig.ts` (generico, dalla proposta concreta)
- `editorial.css` (`.seat-sources`, `.seat-proposal`; rimosso `.minister-draft-order`)
- test aggiornati/aggiunti: `ministerMemory`, `strategicPlan`, `seatCanvasConfig`,
  `seatCanvasModel`, `seatCanvasRender`, `ministerUx01Render`, `presentation`,
  `seatTablePresentation`, `seatProposals`

**Modificati (E2E)**
- `e2e/tests/modules.spec.mjs`, `e2e/a11y/a11y.spec.mjs`, `e2e/govoffice-shot.mjs`,
  `e2e/ux01-shot.mjs` (nuovo flusso ordine: prepara + firma)

Nessun file del motore, dello schema, dei repository o di `backend-nest` è stato toccato.

---

## 4. CORE ENGINE FREEZE — intatto

`git diff` non tocca: `backend-nest/src/core/simulation/**`, `GameSession`,
`TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema o
repository. Tutte le modifiche sono in `frontend/src/**`, `e2e/**` e
`docs/implementation/**`. La verifica del freeze è nella sezione 5.

---

## 5. Test eseguiti (esito reale)

| Ambito | Comando | Esito |
|--------|---------|-------|
| Frontend `tsc` | `cd frontend && ../node_modules/.bin/tsc --noEmit` | **0 errori** |
| Frontend test | `cd frontend && ../node_modules/.bin/vitest run` | **122 file / 1028 test passati** |
| Frontend build | `cd frontend && npm run build` | **ok** |
| Backend `tsc` | `cd backend-nest && npx tsc --noEmit` | **0 errori** |
| Backend test | `cd backend-nest && npx vitest run` | **206 file / 2158 test passati** |
| Backend build | `cd backend-nest && npm run build` | **ok** |
| E2E mock | `playwright test` (config mock) | **155 passati** |
| E2E a11y | `playwright test --config=playwright.a11y.config.mjs` | **4 passati** |
| Provider reale | `node e2e/ux08-real-provider.mjs` | **completato** (8 screenshot + log) |

Freeze verificato: `git status`/`git diff` mostrano solo frontend, E2E e docs; nessun
percorso del motore.

Nessun test è stato allentato o disattivato. Le soglie non sono state alzate. I test
modificati lo sono solo per il **comportamento intenzionalmente nuovo** (piani
derivati, proposte per sedia, ordine dalla proposta, scope memoria); i test dei
difetti sono **nuovi**.

---

## 6. Risultati — mock vs provider reale · completato vs aperto

### Mock (deterministico)

- `P04c` (UX-03): «Mi mostri dove va la spesa?» ⇒ il grafico in
  `.seat-table-main`; «Confronta le due strade» ⇒ `.proposal-comparison`.
- `P04d` (UX-04): mappa focalizzata con `regionIds` e limiti delle conseguenze.
- `P07` (UX-07): voce di spesa in evidenza e evidenza fissata.
- `P04b`/`P06`: dalla proposta alla decisione (prepara, firma, stato reale).
- Nuovi unit test per i sei punti (frontend puro/read model).

### Provider reale (`e2e/ux08-real-provider.mjs`)

Log `docs/implementation/assets/ws-minister-ux-08/real/real-provider-log.json`:

| Passo | Tavola (main) | Confronto | Atto prima della main? |
|-------|---------------|-----------|------------------------|
| obiettivo | `strategy` (piano dalla proposta) | no | sì (default UX-01) |
| chiarimento | `metrics` | no | no |
| **grafico richiesto** | **`chart`** | no | **no** |
| **territorio richiesto** | **`map`** | no | **no** |
| **alternative** | — | **sì** | no |
| proposta modificata | — | sì | no |
| decisione | — | sì | no |
| riapertura con memoria | `strategy` | no | sì |

Screenshot consegnati (provider reale):
`01-obiettivo.png`, `02-chiarimento.png`, `03-grafico-richiesto.png`,
`04-mappa-richiesta.png`, `05-alternative.png`, `06-proposta-modificata.png`,
`07-decisione.png`, `08-riapertura-memoria.png`. Il grafico e la mappa **richiesti**
compaiono nella parte **visibile** della tavola (`.seat-table-main`) e l'atto del
Tesoro non li precede.

### Completato

- Difetti **1, 2, 3, 4, 5**: corretti e provati (unit + render + E2E mock).
- Difetto **6**: conversazione completa col provider reale, demo + screenshot.
- Memoria client su scope **partita + ramo + mandato**, con scarto del futuro:
  il ricordo sopravvive a chiusura sedia e **ricarica del browser** (log
  `riapertura-memoria`).
- Freeze del motore intatto; nessun test allentato; suite verdi.

### Aperto (dichiarato)

- **Il provider reale non è deterministico** nel rispettare il blocco `tavola`:
  talvolta sceglie un'evidenza diversa da quella richiesta. L'harness lo gestisce
  con rilanci espliciti; un'affidabilità piena richiederebbe structured output o un
  tool-call dedicato (fuori scope, lato provider).
- **Doppia rappresentazione del Tesoro**: `TreasuryActPanel` mostra le strade
  dell'atto, mentre il confronto generico può includere anche i percorsi gemelli
  dell'agenda della sedia. Sono entrambi proposte legittime della stessa sedia, ma
  una consolidazione in un'unica lista è materia della fase successiva.
- **Orizzonte del piano**: `planFromProposal` ancora i nodi alla data di gioco
  (nessuna data inventata); non usa ancora le date reali dei processi del motore
  (`ongoingProcesses`) per una timeline a più scadenze.

---

## 7. Limiti residui

- La verifica col provider reale consuma credito LLM e non è riproducibile in CI
  senza chiave: resta un harness manuale documentato, separato dalla suite mock.
- La memoria autorevole è **server-side**; la copia client è una rete
  immediata/offline. Le due copie possono divergere finché il server non è la
  sorgente unica anche in lettura.
- Il piano derivato è per una sola proposta (la prima voce con percorsi, o le
  strade del Tesoro): piani multi-proposta restano fuori scope.

---

## 8. Proposte per la fase successiva

1. **Unificare le proposte del Tesoro** in un'unica lista (atto + agenda), così
   pannello e confronto mostrano esattamente le stesse strade.
2. **Timeline reale del piano**: usare le date dei processi del motore
   (`ongoingProcesses`) invece della sola ancora di gioco, senza inventare tappe.
3. **Evidenza richiesta affidabile col provider reale**: structured output/tool
   call al posto del fence testuale, mantenendo il resolver puro come rete.
4. **Memoria server come sorgente unica in lettura** nel client (oggi la copia
   `localStorage` è la rete immediata), con merge per scope.
5. **Screenshot di regressione mock** per i difetti 1-3 nella suite E2E, così la
   gerarchia è difesa anche visivamente oltre che dal markup.

---

## Riferimenti visivi

Gli screenshot del provider reale sono in
`docs/implementation/assets/ws-minister-ux-08/real/`. La verifica mock
deterministica è nelle spec E2E citate (`e2e/tests/modules.spec.mjs`, P04c/P04d/P07).
