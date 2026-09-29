# WS-GOVOFFICE-01 — L'Ufficio del Governo: la seduta diventa una stanza modale

Branch: `feat/ws-govoffice-01` · Base: `main` @ `3d7e944`.
Classe: **A** — chiusura di una feature già scritta + correzione di presentazione (CSS).
Nessuna migrazione. Nessun tocco al motore congelato. Nessuna route nuova.

---

## 1. Problemi trovati (causa reale)

### 1.1 La richiesta dell'autore

> «quando clicco il governo vorrei che aprisse il modale e vedessi l'ufficio con i
> ministri che parlano e presentano i problemi, oppure sono io che presento
> problemi a loro. Tutto questo poi deve trasformarsi in ordini che il sistema
> sia in grado di accettare.»

Due difetti reali, entrambi verificati sul codice:

1. **Il Governo non era una stanza.** Il modulo `orders` apriva la colonna
   laterale del desk (`DeskContent`, ramo `activeModule === 'orders'`): la
   «sala» era una striscia accanto alla mappa, non un ufficio in primo piano in
   cui i ministri parlano. La discussione politica era compressa in un desk.
2. **La chat del ministro era illeggibile.** In `frontend/src/editorial.css` la
   regola globale `.game-shell-desk .entry-text { color: #f2ede2 !important }`
   impone l'**inchiostro chiaro** del Consulente; la chat del ministro sedeva su
   carta chiara (`--op-sheet: #f8f3e9`) e i titoli del markdown sono bianchi.
   **Testo chiaro su carta chiara**: non una svista di tinta, un conflitto tra
   una regola globale `!important` e una superficie che non era pensata per
   quella regola.

### 1.2 La causa del conflitto cromatico

`MinisterChat` vive dentro `.cabinet-seat` dentro `.game-shell-desk` (sfondo
comando `--ws-surface-command: #14243a`). La regola `!important` del desk
dell'editoriale è pensata per l'inchiostro chiaro, ma la scheda `--op-sheet` è
carta. Non si tocca la regola globale (serve al Consulente e al feed, che
l'autore considera corretti): si dà alla chat la **superficie notturna del
Consulente**, dove l'inchiostro chiaro torna leggibile. Il pallet è quello
richiesto dall'autore, non un'invenzione.

### 1.3 Problemi d'ambiente trovati in fase di chiusura (non di codice)

Nessun problema **di codice** è emerso nel percorso
problema → strada → bozza → verifica → coda: era già completo e coerente. La
chiusura ha invece richiesto di rendere il **checkout locale fedele alla CI**;
i rosso osservati erano tutti di ambiente, non di logica:

1. **Install drift (frontend).** Il `package-lock.json` (v3) colloca
   `react`/`react-dom` in `frontend/node_modules` (vedi le voci
   `frontend/node_modules/react` e `frontend/node_modules/react-dom`). Il
   checkout locale li aveva **hoistati** al root e non aveva
   `@rollup/rollup-darwin-x64`: 16 file di test frontend non si caricavano con
   `Cannot find package 'react'` / `'react-dom/server'`, perché l'alias di
   `frontend/vitest.config.ts` risolve `node_modules/react*` **del frontend**.
   Già registrato come problema locale preesistente in
   `WS-PREFLIGHT-01-report.md` §5. Risolto con `npm ci` (che ricrea il layout del
   lockfile) + ripristino del binario nativo darwin, come fa la CI per Linux.
2. **`backend-nest/dist/` stantio.** La build precedente lasciava 6
   `*.test.js` compilati nella `dist/` (gitignored); vitest li raccoglieva e
   falliva con `Vitest cannot be imported in a CommonJS module using require()`.
   La CI esegue i test **prima** della build, quindi `dist/` non esiste. Rimosso
   lo stantio; suite verde.
3. **Un test backend flaky.** `backend-nest/tests/op-objects-time-step.test.ts`
   test 42 («la consegna prevista si sospende a impianto fermo…») è fallito una
   volta su macchina carica, poi è passato in isolamento (37/37) e all'intera
   suite ri-eseguita (2083/2083). Flakiness già diagnosticata in
   `WS-PREFLIGHT-01-report.md` §8.3: `shortId()` usa `crypto.randomUUID()`. Il
   test **non** è stato toccato: si è ri-eseguito.

---

## 2. Correzioni applicate

**Usa → deriva → estendi minimamente.** Nessun nuovo dato di gioco, nessuno
stato nuovo: la stanza monta le stesse parti che il desk montava, e il flusso
degli ordini è quello già validato dal motore.

### 2.1 La stanza modale (nuovo `GovernmentOffice.tsx`)

Nuovo componente `frontend/src/components/Game/GovernmentOffice.tsx` (256 righe)
che monta:

- `AccessibleDialog` **vero** — portal su `document.body`, `role="dialog"`,
  `aria-modal="true"`, **ESC** per chiudere, **click sullo sfondo**, **focus
  trap** (Tab/Shift+Tab), `#root` reso **inerte**, blocco dello scroll e
  ripristino del focus. L'accessibilità non è riscritta: riusa la primitiva
  esistente `frontend/src/components/ui/AccessibleDialog.tsx`;
- `CabinetSession` — le sedie del consiglio con bisogni, cifre (ognuna con la
  sua provenienza) e strade;
- `MinisterChat` sotto la sedia in ascolto — il parlare, con streaming e
  fallback al POST;
- la **coda** degli ordini in attesa (modifica/rimozione) e `ActionsPanel` per
  l'ordine libero, con la dichiarazione del lavoro che il motore accetta;
- intestazione «L'Ufficio del Governo», la chiusura `✕` e un footer di chiusura.

La chat per sedia resta nello store (`useChatStore.ministerChats`): aprire
un'altra sedia o chiudere l'ufficio non perde il filo del discorso.

### 2.2 Integrazione (nessun doppione nel desk)

- `frontend/src/components/Game/GameScreen.tsx`: `GovernmentOffice` è montato al
  livello di `GameScreen` (fratello di `GameShell`, prima nel frammento) e vive
  su `open={activeModule === 'orders'}`. `deskOpen` diventa
  `(activeModule !== 'none' && activeModule !== 'orders') || mapContext !== null`:
  il Governo **non** apre più la colonna laterale, gli altri moduli sì.
- `frontend/src/components/Shell/DeskContent.tsx`: rimosso l'intero ramo
  `orders` (**−216 righe**) e le prop ormai inutili (compositore, coda,
  gabinetto, chat del ministro). Il Governo non è più un desk.

### 2.3 «Sono io che presento problemi a loro»

`frontend/src/components/Game/MinisterChat.tsx`: nuova prop **opzionale**
`onDraftFromUserMessage?: (text: string) => void`. Su un messaggio del
giocatore compare «↳ Prepara ordine da questo problema»: il problema scritto in
chat diventa la **bozza** d'ordine con un click. Se la prop manca, la chat resta
conversazione pura (retro-compatibile).

### 2.4 La legibilità: pallet del Consulente

`frontend/src/editorial.css`: il blocco `.minister-*` adotta la superficie
notturna del Consulente — stanza `#0d1727`, risposta su `#182842` con bordo
sinistro `#8a72e5`, messaggio del governo su viola `#493b87` con testo bianco,
meta `#9fb0c8`, testo `#edf4ff`, input `#091321`, pulsante invio
`#684bc5`/`#927be4`, tracce cifre `#1c2a40`/`#5b7ba6`, strade `#142238`. Più il
layout della stanza modale (`.government-office*`, `.minister-draft-order`),
incluso il comportamento mobile. **Nessun `!important` nuovo** nei selettori del
modulo, come impone `frontend/src/styles/cssDiscipline.test.ts`.

### 2.5 Perché non viola l'invariante MG-I1

Scegliere una strada o premere «Prepara ordine» chiama `updateOrderDraft`:
**prepara la bozza, non registra**. Solo `registerOrder` compie la verifica di
fattibilità e mette in coda l'ordine che il motore accetta. La stanza non
introduce scorciatoie.

### 2.6 Copertura E2E

- `e2e/mock-api.mjs`: fixture `MOCK_CABINET` (2 sedie: `tesoro`, `lavori`, con
  bisogni, cifre con provenienza, strade e, per `lavori`, opera + dichiarazione)
  e route `/government/cabinet` + `/government/minister/*`. Lo **stream**
  risponde `404` di proposito: il mock esercita il **fallback** al POST.
- `e2e/tests/modules.spec.mjs`: nuovo test **P04** — apre il Governo e verifica
  che sia un modale (`role="dialog"`/`aria-modal`) e **non** una colonna del desk;
  due sedie; «Parla» apre la chat di quella sedia; il problema del giocatore
  riceve risposta; «Prepara ordine» porta il testo in `#free-player-order`; la
  strada prepara la bozza (e la coda resta vuota: MG-I1); infine
  `.btn-add-pending` → `.feasibility-check` → `.btn-feasibility-register` accoda
  l'ordine.
- `e2e/a11y/a11y.spec.mjs`: l'audit di base (e il test di tastiera) riflette la
  nuova semantica modale. Prima apriva il Governo e poi usava rail e desk Tempo
  **senza chiudere**: con la stanza modale la rail sottostante è resa inerte da
  `AccessibleDialog`, quindi il test è stato adattato a **chiudere** (Esc / `×`)
  prima di interagire col resto — e **rafforzato** auditando anche la stanza
  aperta. Non è un allentamento: è la semantica corretta di un dialogo, ed è la
  ragione per cui il job informativo `e2e-mock` era rosso prima di questo fix.

---

## 3. File modificati

| file | intervento |
| --- | --- |
| `frontend/src/components/Game/GovernmentOffice.tsx` | **nuovo** — la stanza modale (`AccessibleDialog` + seduta + chat + coda + compositore) |
| `frontend/src/components/Game/GameScreen.tsx` | monta `GovernmentOffice`; `deskOpen` esclude `orders`; rimosse le prop d'ordine dal desk |
| `frontend/src/components/Shell/DeskContent.tsx` | rimosso il ramo `orders` e le prop/import relativi (−216 righe) |
| `frontend/src/components/Game/MinisterChat.tsx` | `onDraftFromUserMessage?` + pulsante «Prepara ordine da questo problema» |
| `frontend/src/editorial.css` | pallet Consulente per `.minister-*`; layout `.government-office*` e `.minister-draft-order`; nessun `!important` nuovo |
| `e2e/mock-api.mjs` | `MOCK_CABINET` + route `government/cabinet` e `government/minister/*` (stream 404 → fallback) |
| `e2e/tests/modules.spec.mjs` | test **P04** (Ufficio del Governo) |
| `e2e/a11y/a11y.spec.mjs` | audit adattato alla stanza modale: chiude prima di usare la rail; audita anche l'ufficio aperto |
| `docs/implementation/WS-GOVOFFICE-01-report.md` | questo report |

Nessuna nuova route backend → `docs/implementation/q02-endpoint-inventory.json`
invariato.

---

## 4. Conferma CORE ENGINE FREEZE

Il freeze è **intatto**. Non è stato toccato alcuno di:
`backend-nest/src/core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, schema/DB, repository, semantica
checkpoint/simulation-run, `useSimulationPlayback`, pipeline di avanzamento
temporale.

Le modifiche sono **solo di presentazione frontend** (componenti React + CSS) e
di **harness E2E** (mock + test), più questo documento. Nessuna migrazione,
nessuna tabella/colonna, nessuna route, nessun nuovo motore o validatore. Il
sistema accetta gli ordini con lo stesso `registerOrder` di prima.

---

## 5. Test eseguiti (esito reale)

Ambiente: macOS, Node v26.10.1, npm 11.19.1. Dipendenze ricreate con `npm ci`
(fedele al lockfile) + ripristino del binario nativo Rollup darwin-x64 (la CI
ripristina quello linux nella job omonima).

| gate | comando | esito |
| --- | --- | --- |
| Backend (suite completa) | `npm --prefix backend-nest test` | **200 file / 2083 test verdi** (dopo rimozione del `dist/` stantio e un ri-run per il flaky noto) |
| Backend mirato (flaky) | `vitest run tests/op-objects-time-step.test.ts` | **37/37 verdi** in isolamento |
| Frontend (suite completa) | `cd frontend && ../node_modules/.bin/vitest run` | **103 file / 873 test verdi** (inclusa `cssDiscipline`) |
| Typecheck frontend | `cd frontend && ../node_modules/.bin/tsc --noEmit` | pulito (exit 0) |
| Build backend + frontend | `WORLD_STORY_BUILD_ID=local-gate npm run build` | pulito (exit 0; frontend `index-DVrL1IGV.css` + `index-Cz1nA3pn.js`; backend `tsc` ×2) |
| E2E mock (Playwright, Chrome di sistema) | `cd e2e && node_modules/.bin/playwright test` | **148 test verdi** (17.8 min) |
| E2E mirato | `playwright test tests/modules.spec.mjs` | **5/5 verdi**, incluso **P04** |
| A11y (Playwright) | `cd e2e && playwright test --config=playwright.a11y.config.mjs` | **3/3 verdi** (l'ufficio modale supera l'audit) |
| Perf baseline | `node e2e/perf/baseline.mjs` | OK (JS 1.70 MB / CSS 0.61 MB, entro soglia) |
| CI `test-build` (richiesto) | PR #136 | **pass** (2m28s) |
| CI `e2e-mock` (informativo) | PR #136, run `36593111727` | **prima rosso → fix a11y → ri-eseguito verde** (vedi sotto) |

Nota onesta: la prima esecuzione della suite backend ha avuto **1 rosso flaky**
(`op-objects-time-step.test.ts` test 42) e la prima della suite frontend era
**rossa per l'install drift locale** (16 file non caricati). Entrambi ri-eseguiti
dopo aver ripristinato l'ambiente fedele: verdi. **Nessuna soglia alzata, nessun
test disattivato, nessun test rilassato.**

**Il job informativo `e2e-mock` è stato rosso alla prima esecuzione CI** (run
`36593111727`): i due test di `e2e/a11y/a11y.spec.mjs` aprivano il Governo e poi
usavano rail e desk Tempo senza chiudere. Con la nuova stanza modale `#root` è
inerte, quindi il click su «Nazione» era intercettato dall'overlay e
`expect(advance).toBeFocused()` falliva. **Causa reale: semantica modale nuova,
non codice rotto.** L'audit è stato adattato (chiude prima di interagire) e
rafforzato (audita l'ufficio aperto); ri-eseguito in locale 3/3 verde e
ri-push del commit. Nessun test disattivato, nessuna soglia toccata.

---

## 6. Risultati

- Cliccare **Governo** apre un **modale** in primo piano
  (`aria-modal="true"`, ESC, click sullo sfondo, focus trap), non più la colonna
  laterale: verificato da P04 (`page.locator('.game-shell-desk')` ha `count 0`).
- I **ministri parlano**: le sedie portano bisogni, cifre con provenienza e
  strade; «Parla» apre la chat di *quella* sedia.
- **Il giocatore parla**: scrive nel composer; il suo problema diventa bozza
  d'ordine con un click. Anche la strada scelta diventa bozza.
- **Tutto si trasforma in un ordine che il sistema accetta**: la bozza passa da
  verifica di fattibilità → coda; la stanza non registra nulla da sola (MG-I1).
- La chat del ministro è ora **leggibile** con il pallet del Consulente; il gate
  `cssDiscipline` resta verde (nessun `!important` nuovo).
- Il job informativo `e2e-mock` (non bloccante, `continue-on-error`) è passato
  dopo l'adattamento dell'audit a11y; il gate richiesto `test-build` era già
  verde alla prima esecuzione.
- Criteri di successo del task: `GovernmentOffice.tsx` integrato e funzionante ✅;
  `tsc --noEmit` pulito ✅; suite backend/frontend verdi ✅; report committato ✅;
  PR verso `main` con `test-build` verde ✅; nessun nuovo motore, freeze intatto ✅.

---

## 7. Limiti residui

- I ministri reali arrivano dal backend (`GET /games/:id/government/cabinet`):
  senza server attivo la stanza è vuota. Gli E2E usano il mock; il contenuto
  autorevole è del motore, non della UI.
- Lo **streaming** della chat del ministro richiede l'endpoint `/minister/:seat/stream`;
  in sua assenza `askStream` ripiega sul POST (esercitato di proposito dal mock,
  che risponde 404 allo stream).
- La cronaca dei ministri è **in memoria** (store Zustand): sopravvive a
  chiusura/apertura dell'ufficio nella sessione, non al reload della pagina.
- Il flaky `op-objects-time-step.test.ts` test 42 resta (fuori scope, già
  diagnosticato): su macchina carica può fallire e va ri-eseguito.
- La suite frontend completa gira al 100% in locale **solo** dopo un `npm ci`
  fedele + ripristino del binario Rollup darwin: il config `vitest` risolve
  `react*` dal `frontend/node_modules` previsto dal lockfile.

---

## 8. Proposte per la fase successiva

1. **`shortId()` deterministico** (fuori scope, già in `WS-PREFLIGHT-01` §8.3):
   togliere `crypto.randomUUID()` dai test `op-objects-time-step` (test 42) e
   `industrial-capacity-service`, così il gate smette di dipendere dal carico.
2. **Persistenza della cronaca dei ministri**: portare `ministerChats` dallo
   store in memoria a una persistenza per partita, come il Consulente, così il
   filo del discorso sopravvive al reload.
3. **A11y dedicata dell'ufficio**: aggiungere un caso all'audit
   `e2e/playwright.a11y.config.mjs` per `.government-office` (focus trap, ESC,
   contrasto del pallet notturno).
4. **CTA «Registra ordine» anche nella chat**: oggi la strada prepara la bozza e
   la conferma è nel compositore; un'azione diretta sotto la strada accorcerebbe
   il percorso problema → ordine.
5. **Contenuto del gabinetto lato motore**: se il gabinetto deve diventare
   azionabile (non solo descrittivo), definire il contratto autorevole dei
   bisogni/strade nel motore, senza dedurlo in UI.
