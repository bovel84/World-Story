# WS-PREFLIGHT-01 — La bozza di un ordine non produce deficit di schema fantasma

Branch: `fix/ws-preflight-01-intent` · Base: `main` @ `6e0bb3a`.
Classe: **A/B** — derivazione server-owned + campo additivo di presentazione.
Nessuna migrazione. Nessun tocco al motore congelato.

---

## 1. Problemi trovati (causa reale)

Verificando un ordine in bozza con testo **valido**, il pannello «Catena della
fattibilità» mostrava deficit tecnici — `INVALID_ID`, `MISSING_FIELD`,
`UNKNOWN_ACTION_KIND`, `INVALID_PRIORITY`, `MISSING_AUTHORIZATION` — come se
la bozza fosse sbagliata. La RICHIESTA era compilata, il testo sensato: la colpa
non era del giocatore.

**Catena del dato, confermata sul codice:**

1. UI `verifyOrder(text)` → `gameApi.checkFeasibility` →
   `POST /games/:id/actions/check-feasibility`. Il client invia **solo `{ text }`**:
   nessun intent strutturato.
2. La route chiama `session.checkFeasibilityWithCosts(text)`
   (`backend-nest/src/game/OrderExecutionService.ts`).
3. Quel metodo passava **direttamente** l'uscita di `convertActionsBatch` a
   `normalizeOrderIntent`.

**Causa:** il convertitore LLM restituisce un `ConvertedAction`
(`backend-nest/src/prompts/types.ts`):
`{ actionId?, legacyIndex?, type, text, targetPolity?, chatMessage? }` — **non**
un `OrderIntent`. I campi canonici (`id`, `actorPolityId`, `originalText`,
`actionKind`, `targetIds`, `priority`, `dependencyIds`, `authorization`) non
esistono in quella forma, quindi `normalizeOrderIntent` — correttamente —
segnalava ogni campo assente. Prova riprodotta (uscita reale, 8 chiarimenti):

```
{ actionId:'ab12', type:'action', text:'…' } → needs_clarification:
  INVALID_ID            field=id
  INVALID_ID            field=actorPolityId
  MISSING_FIELD         field=originalText
  UNKNOWN_ACTION_KIND   field=actionKind
  MISSING_FIELD         field=targetIds
  INVALID_PRIORITY      field=priority
  MISSING_FIELD         field=dependencyIds
  MISSING_AUTHORIZATION field=authorization
```

Non è una regressione recente: precede la decomposizione `f0f9185`.
`normalizeOrderIntent` non era sbagliato: era **usato come validatore di una
forma che non è un intent**.

**Secondo problema (minore):** la mappa chiarimenti→`blockers` perdeva il campo
`field`, quindi la UI non poteva dire *quale* campo mancasse: mostrava il codice
grezzo senza causa. Il percorso legacy (`respondLegacyFeasibility`) non ha il
difetto (restituisce `feasible: true` senza deficit): il bug è del solo percorso
**strict**.

---

## 2. Correzioni applicate

**Derivare ciò che il server possiede; non inventare l'interpretazione.**

- Nuova funzione **pura** `draftIntentCandidate({ id, actorPolityId, originalText })`
  in `backend-nest/src/core/feasibility/intent.ts`: costruisce l'involucro
  canonico di una bozza da testo libero. Compila i campi **del server** (id,
  polity, testo, priorità, autorizzazione) e dichiara `actionKind:'qualitative'`
  con target/catalogo/quantità vuoti. Un testo libero non è una distinta:
  fingersi `construct`/`produce` con target inventati sarebbe stato peggio.
- In `checkFeasibilityWithCosts`:
  - il convertitore resta un **controllo di convertibilità** (se non produce
    nemmeno un'azione, l'errore specifico «Impossibile convertire il testo in
    intenzione» resta);
  - l'identità politica si risolve **prima** e si passa all'involucro;
  - si normalizza `draftIntentCandidate(...)`, non l'uscita del convertitore:
    `normalizeOrderIntent` **resta il punto unico di validazione**;
  - la stima costi usa lo stesso candidato (`qualitative` → `basis:'none'`,
    identico alla proiezione di fallback precedente: nessuna cifra tolta).
- **Campo del deficit reso visibile** (secondo problema):
  `Clarification.field` → `Blocker.field` → `rawAssessment` → vista frontend →
  nodo della catena:
  - `Blocker.field?` in `core/feasibility/FeasibilityService.ts`;
  - la mappa chiarimenti→blocker propaga `field`;
  - `FeasibilityBlockerView.field?` e `ChainNode.field?`;
  - `FeasibilityChainPanel` mostra `— <dettaglio> (campo: <field>)`.

**Nessun nuovo motore/validatore parallelo.** La parte semantica non
interpretata è dichiarata `qualitative`, non dedotta. Nessuna modifica a
`normalizeOrderIntent` né alla logica dei costi.

**Punto 3 del task — riuso di `INVALID_ID` (documentato, non nuovo codice):** la
UI non distingue i codici (`REASON_LABEL[code] ?? code`); il raggruppamento in
prerequisiti/rischi/avvisi avviene per fascia, non per codice. Nessun consumatore
beneficerebbe di `INVALID_ORDER_ID`/`INVALID_ACTOR_ID` separati: si **riusa
`INVALID_ID`, che già porta `field`**, e si rende `field` visibile. Nessun enum
nuovo, nessuna migrazione.

---

## 3. File modificati

| file | intervento |
| --- | --- |
| `backend-nest/src/core/feasibility/intent.ts` | **+** `draftIntentCandidate` (derivazione pura) |
| `backend-nest/src/game/OrderExecutionService.ts` | normalizza l'involucro canonico, non l'uscita del convertitore; propaga `field` |
| `backend-nest/src/core/feasibility/FeasibilityService.ts` | `Blocker.field?` |
| `backend-nest/tests/ws-preflight-01-intent.test.ts` | **nuovo** — integrazione route + regressioni (prima rosso) |
| `backend-nest/tests/feasibility-intent.test.ts` | test involucro + prova della causa |
| `frontend/src/components/Game/feasibilityExplanation.ts` | legge `field` |
| `frontend/src/components/Game/feasibilityChain.ts` | `ChainNode.field?` |
| `frontend/src/components/Game/FeasibilityChainPanel.tsx` | mostra il campo nel dettaglio |
| `frontend/src/components/Game/feasibilityExplanation.test.ts` | test del campo |
| `frontend/src/components/Game/feasibilityChain.test.ts` | test del campo sul nodo |
| `docs/implementation/WS-PREFLIGHT-01-report.md` | questo report |

Nessuna nuova route → `docs/implementation/q02-endpoint-inventory.json` invariato.

---

## 4. Conferma CORE ENGINE FREEZE

Il freeze è **intatto**. Non è stato toccato alcuno di:
`core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/DB, repository, semantica checkpoint/simulation-run,
`useSimulationPlayback`, pipeline di avanzamento temporale.

Le modifiche confinate a `core/feasibility/**` (non congelato), a
`game/OrderExecutionService.ts` (derivazione d'ingresso) e alla presentazione
frontend. Nessuna migrazione, nessuna nuova tabella/colonna, nessuna route nuova.

---

## 5. Test eseguiti (esito reale)

| gate | comando | esito |
| --- | --- | --- |
| Backend (suite completa) | `backend-nest`: `vitest run --exclude '**/dist/**' --exclude '**/node_modules/**'` | **200 file / 2082 test verdi** |
| Backend mirato | `ws-preflight-01-intent` + `feasibility-intent` + `order-execution-service` + `evaluate-route` + `mg01` + `mg02` | 6 file / 60 test verdi |
| Typecheck backend | `backend-nest`: `tsc --noEmit` | pulito (exit 0) |
| Build backend | `backend-nest`: `npm run build` (`tsc`) | pulito (exit 0) |
| Typecheck frontend | `frontend`: `tsc --noEmit` | pulito (exit 0) |
| Build frontend | `frontend`: `npm run build` (`tsc && vite build`) | pulito (exit 0) |
| Frontend mirato | `feasibilityExplanation` + `feasibilityChain` | 14 test verdi |
| Frontend (suite completa) | `frontend`: `vitest run --exclude '**/dist/**'` | 87 file / **746 test verdi**; 16 file **non caricati** per `Cannot find package 'react'` / `'react-dom/server'` (problema d'ambiente del checkout locale, preesistente e non toccato: quei file importano React e non risolvono il pacchetto in questa installazione). Il job CI `test-build` esegue la stessa suite con dipendenze risolte ed è **pass** sulla PR. |
| E2E mock (Playwright, Chrome di sistema) | `e2e`: `playwright test` | **147 test verdi** (18.3 min) |
| CI `test-build` (richiesto) | PR #132 | **pass** (2m25s) |

Il nuovo `backend-nest/tests/ws-preflight-01-intent.test.ts` era **rosso** prima
della correzione (asserzione «nessun deficit di schema» fallita su
`INVALID_ID`); è verde dopo. Nessuna soglia alzata, nessun test disattivato.

---

## 6. Risultati

- Una bozza con testo valido **non produce più alcun codice di schema**; il
  preflight risponde `feasible: true` con l'avviso esplicito «ordine
  qualitativo» (il verde è motivato, non muto).
- I casi d'errore legittimi restano corretti e specifici: testo vuoto → `400`
  «Testo ordine obbligatorio»; partita strict senza catalogo → errore di
  contratto, non otto deficit.
- Un deficit dichiarato dal motore porta ora la sua causa (`field`) fino al nodo
  della catena.
- Criteri di successo del task: bozza senza deficit di schema ✅; causa
  identificata con prova dal codice ✅; errori legittimi specifici ✅; nessun
  nuovo motore, freeze intatto, test verdi ✅.

---

## 7. Limiti residui

- Il preflight da testo libero **non deduce** il tipo materiale dell'ordine
  (ricetta, target, quantità): non lo faceva prima, né lo fa ora; lo dichiara
  `qualitative`. Dedurlo richiede un contract LLM dedicato — materia di altra
  iniziativa, non di questa correzione.
- I costi per una bozza qualitativa sono `basis:'none'` («nessun consumo
  dichiarato»): era già la proiezione effettiva prima (candidato di fallback
  qualitativo senza `catalogRef`), quindi nessuna cifra è stata rimossa.
- La visibilità di `field` è coperta da test unitari frontend; nel percorso
  corretto i chiarimenti di schema non si producono più, quindi non è esercitata
  end-to-end dalla route. Resta come garanzia difensiva.
- La suite frontend completa non è eseguibile al 100% in questo checkout locale
  per il problema di risoluzione di `react` (preesistente); la copertura è
  garantita da CI.

---

## 8. Proposte per la fase successiva

1. **Contract LLM del convertitore**: se si vuole che una bozza libera aspiri a
   un `actionKind` materiale (con target/catalogo/quantità), definire un output
   strutturato nel prompt del convertitore e validarlo con `normalizeOrderIntent`.
   Finché non esiste, `qualitative` è la dichiarazione onesta.
2. **Parità dei due preflight**: `evaluate` (intent dal client) e
   `check-feasibility` (testo libero) oggi convergono su `normalizeOrderIntent`;
   un test di parità esplicito sui casi limite (target assente, catalogo
   assente) renderebbe l'invariante permanente.
3. **Flakiness nota (fuori scope, già diagnosticata)**: rendere deterministici
   `backend-nest/tests/industrial-capacity-service.test.ts` e
   `backend-nest/tests/op-objects-time-step.test.ts` (test 42) — dipendono da
   `shortId()` basato su `crypto.randomUUID()`.
