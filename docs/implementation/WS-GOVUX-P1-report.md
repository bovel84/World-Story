# WS-GOVUX-P1 — Council alive: l'agenda viva del Consiglio

Base verificata: `main` / `origin/main` **`8cf7a44`** (merge PR #160, WS-JEV W8).
Branch: **`feat/ws-govux-p1`**, commit `1d65ab0` (+ questo report).
Task letti integralmente: `/tmp/pi-tasks/pi-task-gov-ux-roadmap.md` (§P1) e
`/tmp/pi-tasks/pi-task-govux-gates-lite.md` (gate ridotto + eccezione UI minima).

**P1 completata.** P3…P7 non avviate. Nessun merge, nessun deploy.

## 1. Problema risolto e comportamento finale

Il P0 aveva rilevato (matrice, righe P1) che la **schermata di scelta** del
Consiglio mostrava soltanto nome e competenza: **nessuna frase, nessun argomento,
nessuna questione, nessuno stato, nessuna sintesi**. I dati esistevano già
(`CabinetAddressView` porta `opening` e `items`; lo store porta il filo del
colloquio e la memoria per sedia), ma non erano derivati in una vista d'agenda.

Comportamento finale, a parità di motore e di dati:

- ogni sedia mostra **nome, ruolo, frase breve, argomento, questioni aperte e uno
  stato**;
- la **sintesi** in testa al Consiglio è contata sugli **stessi record** della
  lista (non da `summary.critical` del server);
- l'**ordinamento è stabile** (l'ordine dichiarato delle sedie);
- aprire una sedia **riprende il colloquio esistente** (il filo resta, e la card
  lo dichiara: «Riprendi il colloquio · N scambi»).

Gli stati sono quattro, distinti, con una **regola verificabile** e una precedenza
dichiarata — **mai urgenza inventata**:

1. `richiede-attenzione` — esiste una voce del **motore** con urgenza `critica`.
   È l'unico modo in cui l'attenzione è dichiarata: mai dedotta dal testo/stima.
2. `in-attesa-di-decisione` — in memoria c'è `proposal-discussed` **dopo** l'ultima
   `queued-decision` (proposta discussa e non ancora firmata).
3. `discussione-aperta` — esiste un filo di colloquio, oppure `open-question` è in
   memoria dopo l'ultima decisione accodata.
4. `disponibile` — nessuna delle precedenti: la sedia ha dati ma è quieta.

Il calcolo è **puramente client-side** (`deriveCouncilAgenda`): nessuna richiesta
LLM per ministro all'apertura del Consiglio, nessun nuovo endpoint, nessuno stato
di gioco nuovo.

## 2. File effettivamente modificati e componenti riusati

Classificazione locale esplicita (stessa convenzione usata dai report del modulo
Governo, da `WS-GOVOFFICE-04-report.md`): **A** comportamento/layout, **B** harness,
**C** test, **D** report/assets, **E** componenti congelati. In P1: **E nessuna modifica**.

| File | Classe | Scopo |
|---|---|---|
| `frontend/src/components/Game/councilAgenda.ts` | **A — nuovo selettore puro** | `deriveCouncilAgenda`, `councilSeatState`, `COUNCIL_SEAT_ORDER`, `COUNCIL_STATE_LABEL`, tipi `CouncilAgenda*`. Nessun I/O, nessuna chiamata al modello |
| `frontend/src/components/Game/councilAgenda.test.ts` | **C** | 11 test del selettore (stati, precedenza, ordinamento, sintesi dagli stessi record, agende vuote) |
| `frontend/src/components/Game/councilAgendaRender.test.tsx` | **C** | 5 test di render statico del `pick` con agenda + retro-compatibilità senza agenda |
| `frontend/src/components/Game/CabinetSession.tsx` | **A — estensione** | Prop opzionale `agenda`; il variant `pick` rende sintesi + card arricchite. Senza `agenda`, resta la scelta storica |
| `frontend/src/components/Game/GovernmentOffice.tsx` | **A — estensione** | `useMemo` che deriva l'agenda da `session`, `ministerChats`, `memoryStore` e la passa a `CabinetSession` |
| `frontend/src/editorial.css` | **A — stile** | Classi `council-*` (sintesi, stato, frase, argomento, questioni, ripresa). Nessun `!important` |
| `e2e/tests/govux-p1-council.spec.mjs` | **B — E2E mirato** | 2 test a 390×844: agenda viva + ripresa; voce critica ⇒ «richiede attenzione» |
| `docs/implementation/assets/ws-govux-p1/*.png` | **D — evidenze** | Screenshot 390×844 (gate) e 1366×768 (report) |
| `docs/implementation/WS-GOVUX-P1-report.md` | **D — documentazione** | Questo report |

**Riusati senza modificarli:** `CabinetSession` (variant `pick`/`full`), il flusso
`GovernmentOffice` scelta↔seduta, `MinisterChat`, `chatStore` (`ministerChats`),
`ministerMemory` (tipi `MinisterMemoryRecord`/`MinisterMemoryKind`), `seatProposals`,
`EngineText`. Nessuna libreria o dipendenza aggiunta; nessun sistema parallelo;
nessun backend toccato.

## 3. Verifiche eseguite con esito reale

Ambiente: macOS, Node **v26.10.0**, Chrome di sistema headless. Log in
`/tmp/govux-p1-gate/`. Le verifiche sono nuove esecuzioni P1, non copiate.

| Comando | Esito reale |
|---|---|
| `cd frontend && ../node_modules/.bin/vitest run src/components/Game/councilAgenda.test.ts` | **11/11 passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run src/components/Game/councilAgendaRender.test.tsx` | **5/5 passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run <5 file mirati: councilAgenda, CabinetSession, governmentOfficeMobile, ministerUx01Render, cssDiscipline>` | **5 file / 42 test passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run` (suite intera frontend) | **125 file / 1050 test passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd frontend && npm run build` | exit 0; warning chunk >500 kB e opzioni Vite deprecate, non occultati |
| `cd backend-nest && npm run build` | exit 0 |
| `cd e2e && CHROME_PATH='…Google Chrome' node_modules/.bin/playwright test tests/govux-p1-council.spec.mjs` | **2/2 passati**, 14,1 s, exit 0; viewport 390×844 |

**Non eseguiti in questa fase (profilo ridotto, dichiarati non verdi):** suite
backend completa (`npm --prefix backend-nest test`), E2E completo dei percorsi
Governo e matrice multi-viewport — rimandati al **gate completo di fine blocco**
(una volta sola) come da `pi-task-govux-gates-lite.md`. L'audit `a11y` non è stato
rieseguito. Nessun test è stato escluso, allentato o dichiarato verde senza esito.

### Screenshot (eccezione UI minima)

1 E2E mirato a **390×844** (gate) + 1 screenshot; aggiunto il desktop 1366×768 per
il §4 del report. PNG verificati per dimensioni pixel = viewport CSS.

| Viewport CSS | Consiglio vivo (agenda) |
|---|---|
| **390×844** | [PNG](assets/ws-govux-p1/390x844-council-agenda.png) |
| **1366×768** | [PNG](assets/ws-govux-p1/1366x768-council-agenda.png) |

## 4. Screenshot mobile e desktop del flusso interessato

Le due evidenze sopra ritraggono lo **stesso stato**, raggiunto dal flusso reale
mock (nessun backend, nessun provider): Consiglio aperto, sintesi visibile, poi un
colloquio avviato con il Tesoro e ritorno alla scelta. A 390 px il Tesoro mostra
`discussione aperta` e «Riprendi il colloquio · 2 scambi»; a 1366 px la griglia
mostra le stesse card su più colonne. La sintesi in testa (2 ministri, 1 discussione
aperta, 1 disponibile, 2 questioni sul tavolo) è la stessa contata sulla lista.

Riproduzione: `cd e2e && CHROME_PATH='…' node_modules/.bin/playwright test
tests/govux-p1-council.spec.mjs`. È un E2E mock offline (API e provider simulati),
non una prova su backend reale: non consuma credito LLM e non tocca la partita reale.

## 5. Checklist di fase

### Checklist P1

- **Completato:** agenda con nome, ruolo, frase breve, argomento, questioni aperte, stato.
- **Completato:** quattro stati distinti con regola verificabile e precedenza; nessuna urgenza inventata.
- **Completato:** ordinamento stabile (ordine dichiarato delle sedie).
- **Completato:** sintesi contata dallo **stesso** selettore della lista (test dedicato).
- **Completato:** aprire una sedia riprende il colloquio esistente (RAM; il filo resta nella stessa sessione).
- **Completato:** nessuna chiamata LLM all'apertura del Consiglio; selettore puro.
- **Riusato:** `CabinetSession`, `GovernmentOffice`, `chatStore`, `ministerMemory`, `seatProposals`.
- **Rimandato con motivo:** sedia **senza voci** resa cliccabile e persistenza della
  cronaca al reload — richiedono modifiche fuori perimetro (vedi §7).

## 6. Conferma CORE ENGINE FREEZE

**Intatto.** Il diff P1 tocca solo `frontend/src/**`, `e2e/tests/**` e
`docs/implementation/**`. Non tocca `backend-nest/src/**`, `core/simulation/**`,
`GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`,
repository, schema/database, semantica checkpoint/simulation run/playback, né la
pipeline di avanzamento del tempo. Il selettore è client-side e di sola lettura:
non registra ordini, non applica atti, non muta il mondo.

## 7. Differenze rispetto alla roadmap e limiti residui

- **«Sedia disponibile senza questioni» (divergenza dichiarata).** `Cabinet.ts`
  omette le sedie senza voci e `game-session.ts` rifiuta un ministro non presente:
  rendere cliccabile una sedia vuota richiederebbe una modifica d'**engine**
  (classe E) su componenti congelati, **non autorizzata in P1**. Interpretazione
  adottata e documentata: `disponibile` = sedia **presente con dati** ma senza
  attenzione/discussione/decisione. Non si inventano ministri per riempire il layout.
- **Sintesi non da `summary.critical`.** Nel mock `summary.critical = 1` mentre le
  voci non sono critiche. Il selettore conta dalle `items` reali e **non usa**
  `session.summary`: così la sintesi non può divergere dalla lista. La regola
  «attenzione solo da urgenza `critica` del motore» resta quella.
- **Cronaca in RAM, non al reload.** Ri-aprire una sedia nella stessa sessione
  riprende il colloquio; la persistenza della cronaca al reload non è oggetto di P1
  ed è rimandata (la memoria persistente server esiste ma è un'altra capacità).
- **`role` = competenza dichiarata.** Non si inventano biografie: il «ruolo» resta
  `reads`, come già nel motore.
- **Nessun nuovo stato di gioco.** L'agenda è derivata: niente `localStorage`,
  niente endpoint, niente numero nuovo.

## 8. Fase successiva indicata, senza dichiararla completata

**Prossima fase: P3 — Conversational Canvas** (l'ordine indicato dalla roadmap dopo
P1 è P1 → P3 → P4 → P6 → P7; P2 e P5 sono già in `main`). P3 estenderà
`presentation.ts`/le direttive esistenti con le operazioni `sostituisci principale`,
`aggiungi confronto`, `aggiorna`, `rimuovi` e i relativi schemi/limiti, **senza
toccare il freeze**. P4, P6, P7 restano da fare: nessuna fase saltata o dichiarata
consegnata. Sola PR verso `main`; merge, deploy e gate completo di fine blocco
restano alla regia.
