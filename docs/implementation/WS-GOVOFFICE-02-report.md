# WS-GOVOFFICE-02 — L'Ufficio del Governo: dalla sala affollata alla seduta in due passi

Branch: `feat/ws-govoffice-02` · Base: `main` @ `335dc48`.
Classe: **A** — evoluzione di una feature già scritta (una schermata → due
schermate, un esito esplicito). Nessuna migrazione. Nessuna route nuova. Nessun
tocco al motore congelato.

---

## 1. Problemi trovati (causa reale)

### 1.1 La richiesta dell'autore

> «La schermata governo è caotica, io farei una schermata intermedia che fa
> apparire solamente i riquadro dei ministri. Poi quando si entra nella scheda il
> ministro parla "signor presidente...." e elenca dubbi e problemi; alla fine
> della discussione ci deve essere un ordine o un nulla di fatto. Ordine che deve
> essere messo in automatico nella lista degli ordini.»

### 1.2 Il difetto, verificato sul codice

Dopo `WS-GOVOFFICE-01` l'Ufficio era **una stanza sola**: `GovernmentOffice`
montava in un unico colpo `CabinetSession` (tutte le sedie, con item, cifre e
strade), la chat del ministro, la coda degli ordini e `ActionsPanel`. Tre
conseguenze reali:

1. **Nessuna schermata intermedia di scelta.** I ministri non erano «riquadri da
   aprire»: erano già tutti in pagina, mescolati a cifre, strade, coda e
   compositore. Era la «sala affollata» che l'autore ha descritto.
2. **Nessuna voce in prima persona.** Il ministro non si presentava con un
   «Signor Presidente, …»: le sedie esponevano solo `opening` + item, senza una
   cornice di dialogo.
3. **L'esito non era automatico.** Scegliere una strada chiamava
   `chooseCabinetPath`, che si limitava a **preparare la bozza** in
   `#free-player-order`: serviva poi una seconda conferma nel compositore
   (`Registra ordine` → verifica di fattibilità → coda). L'autore vuole che
   «alla fine della discussione» nasca **subito** un ordine in coda — oppure un
   nulla di fatto dichiarato.

### 1.3 L'invariante MG-I1 va aggiornata, non violata

La semantica precedente («leggere non impegna; solo `registerOrder` registra»)
restava vera per il **compositore libero**, ma non per il nuovo flusso. La forma
corretta è: **leggere una seduta non impegna, ma concludere una strada/una
discussione sì** — è l'esito esplicito richiesto dall'autore. Il compositore
libero resta separato e continua a passare dalla verifica di fattibilità.

### 1.4 Problemi d'ambiente trovati in fase di chiusura (non di codice)

Nessun problema **di logica**: il percorso scelta → seduta → esito è nuovo e
coerente. I rosso osservati in locale erano di **ambiente**, gli stessi già
diagnosticati in `WS-PREFLIGHT-01-report.md`:

1. **`backend-nest/dist/` stantio.** La build precedente lasciava 6 `*.test.js`
   compilati nella `dist/` (gitignored); vitest li raccoglieva e falliva con
   `Vitest cannot be imported in a CommonJS module using require()`. La CI esegue
   i test **prima** della build, quindi `dist/` non esiste. Rimosso lo stantio.
2. **Un test backend flaky.** `backend-nest/tests/op-objects-time-step.test.ts`
   test 42 («la consegna prevista si sospende a impianto fermo…») è fallito una
   volta su macchina carica, poi è passato in isolamento (37/37) e all'intera
   suite ri-eseguita (2083/2083). Flakiness già diagnosticata in
   `WS-PREFLIGHT-01-report.md` §8.3: `shortId()` usa `crypto.randomUUID()`. Il
   test **non** è stato toccato: si è ri-eseguito.

---

## 2. Correzioni applicate

**Usa → deriva → estendi minimamente.** Nessun nuovo dato di gioco, nessuno
stato di gioco nuovo, nessuna route: la seconda schermata monta le stesse parti
che la stanza montava, e il testo degli ordini si compone dai dati che il motore
già manda (`address.opening`, `items[].need/because`, `paths[]`).

### 2.1 Il flusso a due schermate (`GovernmentOffice.tsx`)

`frontend/src/components/Game/GovernmentOffice.tsx` riscritto come flusso a due
schermate dentro lo stesso modale (`AccessibleDialog`, invariato):

```
[1] SCELTA   → solo i riquadri dei ministri (nome + `reads`)
                niente item, niente cifre, niente chat, niente coda, niente compositore
      ↓ clic su un riquadro (`.cabinet-pick`)
[2] SEDUTA   → «Signor Presidente,» + `opening` + item (need/because/urgenza/cifre)
                chat del ministro (streaming + fallback POST)
                coda + compositore (la via dell'ordine libero, con verifica)
      ↓ esito esplicito
     ORDINE            → in coda AUTOMATICAMENTE (`.minister-path` o «Concludi con un ordine»)
     NULLA DI FATTO    → nessun ordine, nota dichiarata, ritorno alla scelta
```

- Due stati di **UI** (non di gioco): `openSeat` (quale sedia è aperta) e
  `lastOutcome` (`{ seat, label, kind: 'order' | 'nothing', text? }`). Chiudendo
  l'ufficio si azzerano (`useEffect` su `open`) — riaperto, si riparte dai
  ministri.
- Pulsante di **ritorno** alla scelta (`.government-office-back`, «← Torna ai
  ministri»), fuori dall'header per non interferire con la griglia
  `.council-head`.
- I due esiti sono **espliciti**: `queuePath`/`queueProblem` accodano e dichiarano
  la nota «Ordine in coda — «…»»; `concludeNothing` dichiara «…: nulla di fatto,
  nessun ordine.» e torna alla scelta.

### 2.2 `CabinetSession` esteso, non duplicato

`frontend/src/components/Game/CabinetSession.tsx`: nuove prop opzionali
`variant?: 'pick' | 'full'` (default `full`, retro-compatibile), `onOpenSeat?`,
`onlySeat?`.

- `variant='pick'`: rende `.cabinet-picks` con un `.cabinet-pick` per sedia
  (`.cabinet-pick-name` = `address.label`, `.cabinet-pick-reads` =
  `address.reads`). **Niente** item/cifre/strade/chat/coda.
- `variant='full'` + `onlySeat`: rende **una sola** sedia, con
  `.cabinet-seat-salutation` («Signor Presidente,») e il suo `opening`, gli item
  con cifre e provenienza. Le **strade** restano fuori da qui (`!single`):
  l'esito vive in fondo alla chat.
- `variant='full'` senza `onlySeat`: comportamento storico (consiglio intero),
  usato dai test.

### 2.3 L'ordine automatico (`useOrderQueue` + modulo puro)

- **Nuovo** `frontend/src/components/Game/cabinetOrder.ts` — due funzioni pure,
  estratte da `useOrderQueue` per poterle provare senza schermo:
  `cabinetDeclarationFor(item)` (la dichiarazione d'opera che il motore pretende,
  o `null`) e `composeCabinetOrderText(item, path)` (il testo dell'ordine dai
  dati del motore: strada, bisogno, prerequisiti, esito, vincoli, avvertenza se
  la distinta non è coperta). **Nuovo** `cabinetOrder.test.ts` (7 casi).
- `useOrderQueue.queueCabinetPath(item, path)` **sostituisce**
  `chooseCabinetPath`: compone il testo e **accoda subito**, restituendo
  `Promise<boolean>`. La dichiarazione d'opera, se c'è, viaggia accanto
  (`composeCabinetOrderText` + `cabinetDeclarationFor`).
- `queuePlayerAction` resta l'unico punto che tocca la coda: chiama
  `gameApi.queueAction` (server-authoritative) e poi `addPendingAction`. La
  strada/il problema accodano passando **da qui**, non da `addPendingAction`
  nudo: il testo dell'esito è nuovo e non ancora noto al server, e un
  `addPendingAction` locale produrrebbe un ordine fantasma che il motore non ha
  accettato. È lo stesso criterio del compositore (I02), applicato all'esito.
- Rimosso lo stato `pendingDeclaration`/`clearPendingDeclaration`, ormai inutile.

### 2.4 «Sono io che presento problemi a loro» → esito diretto

`frontend/src/components/Game/MinisterChat.tsx`: la prop opzionale
`onDraftFromUserMessage` **rinominata** `onOrderFromUserMessage` e l'etichetta
cambiata in «↳ Concludi con un ordine da questo problema» (titolo: «Concludi con
un ordine: entra subito nella coda»). Il problema scritto dal giocatore non
prepara più una bozza: **conclude** con un ordine che entra in coda. Se la prop
manca, la chat resta conversazione pura (retro-compatibile).

### 2.5 Integrazione minimale

- `frontend/src/components/Game/GameScreen.tsx`: tolto lo stato `speakingSeat` e
  l'import `CabinetAddressView`; ora destruttura `queueCabinetPath` e
  `queuePlayerAction` e li passa come `onQueueCabinetPath` / `onQueueOrder`.
  `loadCabinet` continua a scattare su `activeModule === 'orders'`.
- Il «Porta in consiglio» del Dossier Nazione (`draftGovernmentPetition`) resta
  invariato: riempie la bozza e apre l'Ufficio — che ora si presenta nella
  schermata di scelta, con la bozza già pronta da ritrovare nella seduta.

### 2.6 Stile

`frontend/src/editorial.css`: aggiunte `.cabinet-picks`, `.cabinet-pick`,
`.cabinet-pick-name`, `.cabinet-pick-reads`, `.cabinet-seat-salutation`,
`.government-office-back`, `.government-office-outcome`, `.cabinet-nothing`,
`.government-office-outcome-note`. **Nessun `!important` nuovo** nei selettori
del modulo, come impone `frontend/src/styles/cssDiscipline.test.ts`.

### 2.7 Copertura E2E

- `e2e/mock-api.mjs`: la route `/actions/queue` restituisce id **progressivi**
  (`mock-action-N`) invece del fisso `mock-action-1` — l'Ufficio può accodare più
  ordini (dal problema e dalla strada); la route di rimozione diventa
  `mock-action-*`.
- `e2e/tests/modules.spec.mjs`:
  - **P04 riscritto**: apre il Governo → vede **solo** i riquadri (nessun item,
    chat, coda o compositore) → entra in una sedia → il ministro parla in prima
    persona → «Concludi con un ordine da questo problema» accoda **subito** →
    anche `.minister-path` accoda direttamente (due `.pending-item`).
  - **P05 nuovo**: «Nulla di fatto» chiude la seduta senza ordine, torna alla
    scelta e **dichiara** l'esito (coda invariata).
  - **U02 adattato**: il compositore vive nella seduta, quindi si entra in un
    riquadro prima di usarlo (stesse asserzioni su bozza/verifica/coda).
  - **U03 adattato**: «Porta in consiglio» apre la schermata di scelta; la bozza
    `Difesa`/`copertura di bilancio` si ritrova entrando nella seduta.
- `e2e/a11y/a11y.spec.mjs`: l'audit «HUD di gioco» ora audita **anche la seduta**
  (`.cabinet-pick` → `.minister-chat`) oltre alla schermata di scelta.

---

## 3. File modificati

| file | intervento |
| --- | --- |
| `frontend/src/components/Game/GovernmentOffice.tsx` | riscritto a due schermate: `openSeat`, `lastOutcome`, ritorno, esiti `queuePath`/`queueProblem`/`concludeNothing` |
| `frontend/src/components/Game/CabinetSession.tsx` | `variant: 'pick' \| 'full'`, `onOpenSeat`, `onlySeat`; schermata di scelta + salutation in prima persona; strade fuori dalla seduta |
| `frontend/src/components/Game/MinisterChat.tsx` | `onDraftFromUserMessage` → `onOrderFromUserMessage`; etichetta «Concludi con un ordine» |
| `frontend/src/components/Game/cabinetOrder.ts` | **nuovo** — funzioni pure `cabinetDeclarationFor`, `composeCabinetOrderText` |
| `frontend/src/components/Game/cabinetOrder.test.ts` | **nuovo** — 7 casi sulle funzioni pure |
| `frontend/src/hooks/useOrderQueue.ts` | `queueCabinetPath` (accoda automaticamente) sostituisce `chooseCabinetPath`; rimossa `pendingDeclaration` |
| `frontend/src/components/Game/GameScreen.tsx` | rimossi `speakingSeat`/`CabinetAddressView`; passa `onQueueCabinetPath` / `onQueueOrder` |
| `frontend/src/editorial.css` | classi della scelta, della salutation, del ritorno e dei due esiti; nessun `!important` nuovo |
| `e2e/mock-api.mjs` | id di coda progressivi (`mock-action-N`) |
| `e2e/tests/modules.spec.mjs` | P04 riscritto; P05 nuovo; U02 e U03 adattati al flusso |
| `e2e/a11y/a11y.spec.mjs` | audit anche della seduta |
| `docs/implementation/WS-GOVOFFICE-02-report.md` | questo report |

Nessuna nuova route backend → `docs/implementation/q02-endpoint-inventory.json`
invariato.

---

## 4. Conferma CORE ENGINE FREEZE

Il freeze è **intatto**. Non è stato toccato alcuno di:
`backend-nest/src/core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, schema/DB, repository, semantica
checkpoint/simulation-run, `useSimulationPlayback`, pipeline di avanzamento
temporale.

Le modifiche sono **solo di presentazione frontend** (componenti React + CSS), di
**coda lato hook** (che usa le stesse API server-authoritative esistenti) e di
**harness E2E** (mock + test), più questo documento. Nessuna migrazione, nessuna
tabella/colonna, nessuna route, nessun nuovo motore o validatore. Il sistema
accetta gli ordini con lo stesso `queueAction`/`registerOrder` di prima.

---

## 5. Test eseguiti (esito reale)

Ambiente: macOS, Node v26.10.0, npm 11.19.1.

| gate | comando | esito |
| --- | --- | --- |
| Backend (suite completa) | `npm --prefix backend-nest test` | **200 file / 2083 test verdi** (dopo rimozione del `dist/` stantio e un ri-run per il flaky noto) |
| Backend mirato (flaky) | `vitest run tests/op-objects-time-step.test.ts` | **37/37 verdi** in isolamento |
| Frontend (suite completa) | `cd frontend && ../node_modules/.bin/vitest run` | **104 file / 880 test verdi** (inclusa `cssDiscipline` e `cabinetOrder.test.ts`) |
| Typecheck frontend | `cd frontend && ../node_modules/.bin/tsc --noEmit` | pulito (exit 0) |
| Build backend + frontend | `WORLD_STORY_BUILD_ID=local-gate npm run build` | pulito (exit 0; frontend `index-DwIKkvZu.css` + `index-CheTi1mI.js`; backend `tsc` ×2) |
| E2E mock (Playwright, Chrome di sistema) | `cd e2e && node_modules/.bin/playwright test` | **149 test verdi** (17.5 min) |
| E2E mirato | `playwright test tests/modules.spec.mjs` | **6/6 verdi**, inclusi **P04** e **P05** |
| A11y (Playwright) | `cd e2e && playwright test --config=playwright.a11y.config.mjs` | **3/3 verdi** (scelta **e** seduta superano l'audit) |
| Perf baseline | `node e2e/perf/baseline.mjs` | OK (JS 1.70 MB / CSS 0.62 MB, entro soglia) |
| CI `test-build` (richiesto) | PR #137 | **pass** (2m31s) |
| CI `e2e-mock` (informativo) | PR #137 | **pass** (8m42s, inclusi audit a11y e perf baseline) |

Nota onesta: la prima esecuzione della suite backend ha avuto **1 rosso flaky**
(`op-objects-time-step.test.ts` test 42), ri-eseguito verde in isolamento e
sull'intera suite. **Nessuna soglia alzata, nessun test disattivato, nessun test
rilassato.** La prima esecuzione di P04 in locale è stata rossa perché cercava
`.cabinet-path` (nascosto nella seduta): corretto il test su `.minister-path`, che
è la strada dell'esito nella chat. Anche questo è un adattamento alla semantica
nuova, non un allentamento.

---

## 6. Risultati

- Cliccare **Governo** apre la **schermata di scelta**: solo i riquadri dei
  ministri (nome + competenza). Nessun item, chat, coda o compositore in primo
  piano — verificato da P04 (`.cabinet-item`, `.minister-chat`, `.pending-item`,
  `#free-player-order` tutti a `count 0` sulla scelta).
- Entrando in una sedia, il ministro **parla in prima persona**
  (`.cabinet-seat-salutation` = «Signor Presidente,») e **elenca dubbi e
  problemi dai dati del motore** (`opening`, `items[].need/because`, urgenza,
  cifre con provenienza).
- La discussione si conclude con **uno dei due esiti espliciti**: un **ordine in
  coda automaticamente** (dalla strada o dal problema scritto in chat) oppure un
  **nulla di fatto dichiarato** che riporta alla scelta.
- **MG-I1 aggiornata**: leggere non impegna, **concludere sì**. Il compositore
  libero conserva verifica di fattibilità e coda server-authoritative.
- `cssDiscipline` verde (nessun `!important` nuovo); l'audit a11y copre scelta e
  seduta; il gate richiesto `test-build` verde.
- Criteri di successo del task: due schermate ✅; voce in prima persona ✅; esito
  ordine/nullia ✅; `tsc` pulito ✅; suite backend/frontend verdi ✅; P04 (e P05)
  verdi ✅; report committato ✅; PR verso `main` con `test-build` verde ✅; freeze
  intatto ✅.

---

## 7. Limiti residui

- I ministri reali arrivano dal backend (`GET /games/:id/government/cabinet`):
  senza server attivo la scelta è vuota. Gli E2E usano il mock; il contenuto
  autorevole è del motore, non della UI.
- Lo **streaming** della chat del ministro richiede l'endpoint
  `/minister/:seat/stream`; in sua assenza `askStream` ripiega sul POST
  (esercitato di proposito dal mock, che risponde 404 allo stream).
- La cronaca dei ministri è **in memoria** (store Zustand): sopravvive a
  chiusura/apertura dell'ufficio nella sessione, non al reload della pagina.
- L'esito «nulla di fatto» è **UI**: la nota si vede dopo il ritorno, non è
  persistita (come da vincolo: nessuno stato di gioco nuovo).
- Il flaky `op-objects-time-step.test.ts` test 42 resta (fuori scope, già
  diagnosticato): su macchina carica può fallire e va ri-eseguito.
- In `variant='full'` senza `onlySeat` `CabinetSession` mostra ancora le strade
  (`!single`): è il comportamento storico usato dai test, non il flusso a due
  schermate.

---

## 8. Proposte per la fase successiva

1. **`shortId()` deterministico** (fuori scope, già in `WS-PREFLIGHT-01` §8.3):
   togliere `crypto.randomUUID()` dai test `op-objects-time-step` (test 42) e
   `industrial-capacity-service`, così il gate smette di dipendere dal carico.
2. **Persistenza della cronaca dei ministri**: portare `ministerChats` dallo
   store in memoria a una persistenza per partita, così il filo del discorso
   sopravvive al reload.
3. **Traccia del nulla di fatto**: se l'esito deve essere rileggibile, definire
   un read model lato motore invece di dedurlo in UI.
4. **CTA «Concludi» accanto a ogni item della seduta**: oggi l'esito sta in fondo
   alla chat; un'azione diretta sotto il singolo problema accorcerebbe il
   percorso.
5. **Contenuto del gabinetto lato motore**: se il gabinetto deve diventare
   azionabile (non solo descrittivo), definire il contratto autorevole dei
   bisogni/strade/dichiarazioni nel motore, senza dedurlo in UI.
