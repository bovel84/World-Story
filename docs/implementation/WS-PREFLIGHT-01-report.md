# WS-PREFLIGHT-01 — La bozza di un ordine non produce deficit di schema fantasma

Branch: `fix/ws-preflight-01-intent` · Base: `main` @ `6e0bb3a`.
Classe: **A/B** — correzione di derivazione server + campo additivo di presentazione.
Nessuna migrazione, nessun tocco al motore congelato.

---

## 1. Problema trovato (causa reale sul codice)

Nella schermata del giocatore, verificando un ordine in bozza con testo valido,
il pannello «Catena della fattibilità» mostrava **otto** deficit dal suono
tecnico — `INVALID_ID`, `MISSING_FIELD`, `UNKNOWN_ACTION_KIND`,
`INVALID_PRIORITY`, `MISSING_AUTHORIZATION` — come se la bozza fosse sbagliata.
La RICHIESTA era compilata, il testo era sensato: la colpa non era del giocatore.

**Catena del dato (confermata sul codice):**

1. UI `verifyOrder(text)` → `gameApi.checkFeasibility` → `POST /games/:id/actions/check-feasibility`.
   Il client invia **solo `{ text }`**: nessun intent strutturato.
2. La route chiama `session.checkFeasibilityWithCosts(text)`
   (`backend-nest/src/game/OrderExecutionService.ts`).
3. Quel metodo chiamava `convertActionsBatch` e passava **direttamente** la sua
   uscita a `normalizeOrderIntent`.

**Causa:** il convertitore LLM restituisce un `ConvertedAction`
(`backend-nest/src/prompts/types.ts`), cioè
`{ actionId?, legacyIndex?, type, text, targetPolity?, chatMessage? }` — **non**
un `OrderIntent`. I campi canonici (`id`, `actorPolityId`, `originalText`,
`actionKind`, `targetIds`, `priority`, `dependencyIds`, `authorization`) non
esistono in quella forma. `normalizeOrderIntent` faceva quindi il suo mestiere:
segnalava ogni campo assente. Riprodotto esattamente con un test (uscita reale):

```
{ actionId: 'ab12', type: 'action', text: '…' }
→ needs_clarification:
  INVALID_ID        field=id
  INVALID_ID        field=actorPolityId
  MISSING_FIELD     field=originalText
  UNKNOWN_ACTION_KIND field=actionKind
  MISSING_FIELD     field=targetIds
  INVALID_PRIORITY  field=priority
  MISSING_FIELD     field=dependencyIds
  MISSING_AUTHORIZATION field=authorization
```

Non era una regressione recente: il difetto precede la decomposizione
`f0f9185`. `normalizeOrderIntent` non era sbagliato — era **usato come
validatore di una forma che non è un intent**. Il secondo difetto, minore: la
route appiattiva i chiarimenti in `blockers` perdendo `field`, quindi la UI non
poteva nemmeno dire *quale* campo mancasse.

Il percorso legacy (`respondLegacyFeasibility`) non ha il difetto: restituisce
`feasible: true` senza deficit. Il bug è solo del percorso **strict**.

---

## 2. Correzione applicata

**Deriva ciò che il server possiede; non inventare l'interpretazione.**

- Nuova funzione **pura** `draftIntentCandidate({ id, actorPolityId, originalText })`
  in `backend-nest/src/core/feasibility/intent.ts`: costruisce l'involucro
  canonico di una bozza da testo libero. Compila i campi che sono **del server**
  (id, polity, testo, priorità, autorizzazione) e per la parte semantica non
  interpretata dichiara `actionKind: 'qualitative'` con target/catalogo/quantità
  vuoti. Un testo libero non è una distinta: fingersi un `construct`/`produce`
  con target inventati sarebbe stato peggio di dichiararlo qualitativo.
- In `checkFeasibilityWithCosts`:
  - il convertitore resta un **controllo di convertibilità** (se non produce
    nemmeno un'azione, l'errore specifico «Impossibile convertire il testo in
    intenzione» resta);
  - l'identità politica si risolve **prima** e si passa all'involucro;
  - si normalizza `draftIntentCandidate(...)`, non l'uscita del convertitore:
    `normalizeOrderIntent` **resta il punto unico di validazione**;
  - la stima costi usa lo stesso candidato (per `qualitative` è `basis: 'none'`,
    coerente con il percorso di prima: nessun consumo materiale dichiarato).
- **Campo del deficit reso visibile** (secondo difetto, punto 2 del task):
  `field` ora sopravvive da `Clarification` → `Blocker` → `rawAssessment` →
  vista frontend → nodo della catena:
  - `Blocker.field?` in `core/feasibility/FeasibilityService.ts`;
  - la mappa chiarimenti→blocker lo propaga;
  - `FeasibilityBlockerView.field?` e `ChainNode.field?`;
  - `FeasibilityChainPanel` mostra `— <dettaglio> (campo: <field>)`.
    Nel percorso strict corretto non ci sono più chiarimenti, ma la garanzia
    resta: un deficit dichiarato dal motore porta la sua causa, mai un codice
    muto.

**Cosa NON è cambiato:** nessun nuovo motore o validatore parallelo; nessuna
modifica a schema, DB, repository, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, checkpoint/run di simulazione,
`useSimulationPlayback`, pipeline di avanzamento tempo. Il freeze è intatto.

### Punto 3 del task — riuso di `INVALID_ID` (documentato, non nuovo codice)

Il task chiedeva di introdurre codici distinti **solo se il resto del sistema li
usa già**. La UI non distingue i codici: `REASON_LABEL[code] ?? code` mostra
l'etichetta o il codice grezzo, e il raggruppamento in prerequisiti/rischi/avvisi
avviene per fascia, non per codice. Non esiste quindi un consumatore che
beneficerebbe di `INVALID_ORDER_ID` / `INVALID_ACTOR_ID` separati. Scelta:
**riusare `INVALID_ID`, che già porta `field`**, e rendere `field` visibile.
Nessun enum nuovo, nessuna migrazione.

---

## 3. File modificati

| file | intervento |
| --- | --- |
| `backend-nest/src/core/feasibility/intent.ts` | **+** `draftIntentCandidate` (derivazione pura dell'involucro) |
| `backend-nest/src/game/OrderExecutionService.ts` | normalizza l'involucro canonico, non l'uscita del convertitore; propaga `field` |
| `backend-nest/src/core/feasibility/FeasibilityService.ts` | `Blocker.field?` |
| `backend-nest/tests/ws-preflight-01-intent.test.ts` | **nuovo** — integrazione route + regressioni |
| `backend-nest/tests/feasibility-intent.test.ts` | test involucro + prova della causa |
| `frontend/src/components/Game/feasibilityExplanation.ts` | legge `field` |
| `frontend/src/components/Game/feasibilityChain.ts` | `ChainNode.field?` |
| `frontend/src/components/Game/FeasibilityChainPanel.tsx` | mostra il campo nel dettaglio |
| `frontend/src/components/Game/feasibilityExplanation.test.ts` | test del campo |
| `frontend/src/components/Game/feasibilityChain.test.ts` | test del campo sul nodo |
| `docs/implementation/WS-PREFLIGHT-01-report.md` | questo report |

Nessuna nuova route → `docs/implementation/q02-endpoint-inventory.json` invariato.

---

## 4. Verifica

- `backend-nest/tests/ws-preflight-01-intent.test.ts` (nuovo, prima **rosso**):
  1. una bozza valida non produce codici di schema e risulta `feasible: true`,
     con l'avviso esplicito «ordine qualitativo» (il verde è motivato, non muto);
  2. testo vuoto → `400` con messaggio specifico;
  3. catalogo assente (partita strict senza preset) → errore di contratto, non
     otto deficit.
- `backend-nest` suite completa:
  `../node_modules/.bin/vitest run --exclude '**/dist/**' --exclude '**/node_modules/**'`
  → **200 file, 2082 test, tutti verdi**.
- Typecheck: `backend-nest` `tsc --noEmit` pulito; `frontend` `tsc --noEmit` pulito.
- Frontend mirato: `feasibilityExplanation.test.ts` + `feasibilityChain.test.ts`
  → 14 test verdi.

---

## 5. Limiti dichiarati (non-obiettivi)

- Il preflight da testo libero **non** deduce il tipo materiale dell'ordine
  (ricetta, target, quantità). Non lo faceva prima e non lo fa ora: lo dichiara
  `qualitative`. Dedurlo è materia di un'altra iniziativa, con contract LLM
  dedicato — non di questa correzione.
- I costi mostrati per una bozza qualitativa sono `basis: 'none'` («nessun
  consumo dichiarato»). Questa era già la proiezione effettiva prima della
  correzione (il candidato di fallback era già qualitativo senza `catalogRef`):
  nessuna cifra è stata tolta.
- La visibilità di `field` è coperta da test unitari frontend; nel percorso
  corretto i chiarimenti di schema non si producono più, quindi non è
  esercitata end-to-end dalla route. Resta come garanzia difensiva.
