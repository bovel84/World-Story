# WS-JEV-W2 — Ingestion narrativa deterministica

## 1. Perimetro ed esito

Seconda fase della roadmap JEV: pipeline di **ingestion narrativa** per eventi governo, conversazioni ministri e decisioni del giocatore, con fast path deterministico `KEEP`/`DEFER`/`DROP` e **nessun LLM**. Base `main@bfd1b8f` (W1+W3 già mergiati), branch `feat/ws-jev-w2-ingestion`. Nessun merge/deploy: PR verso `main`.

JEV resta **solo memoria narrativa/politica**: non scrive mai lo stato deterministico (economia, PIL, cassa, unità, territori, consenso). Le uniche righe scritte sono in `jev_memory` più i metadati di accesso (`access_count`, `last_accessed_at`) in retrieval.

## 2. Classificatore deterministico

Nuovo `backend-nest/src/core/government/jev/jev-classify.ts` (puro: zero I/O, zero modello):

1. `eventType` in {`ui_notification`, `ui_event`, `screen_update`, `render`} o `source === 'ui'` → **DROP** (`ui_noise`);
2. testo vuoto → **DROP** (`empty_text`);
3. testo > 4000 caratteri → **DROP** (`text_too_large`);
4. `eventType` noto {`war_declared`, `treaty_signed`, `government_*`, `minister_*`, `player_decision`, `player_order`} → **KEEP** (`known_event_type`);
5. `source === 'simulation'` e `metadata.hasNumericOutcome === true` → **KEEP** (`verified_simulation_outcome`);
6. altrimenti → **DEFER** (`ambiguous_no_llm`).

Rispetta la specifica §6 e `llmFallbackEnabled=false`: un `DEFER` **non** interroga alcun modello e **non** viene salvato. Il flag non è ancora consultato perché non esiste un classificatore locale: il determinismo è garantito per omissione (documentato come limite).

## 3. Facade e adapter

`backend-nest/src/core/government/jev/jev-memory.service.ts` (esteso, non riscritto; `getMinisterMemory` di W3 invariata):

- `jevIngestId(input)`: `metadata.eventId` esplicito → `jev:<eventId>`; altrimenti sha256 deterministico di scope/game/branch/data/turno/sorgente/evento/**testo normalizzato**. Lo stesso evento ri-ingestito aggiorna la stessa riga.
- `ingestJevMemory(input)`: valida che `scope.gameId`/`scope.branchId` coincidano con l'input; con flag off ritorna `DROP/jev_disabled` **senza toccare il repository** (funziona anche senza tabella); classifica; scrive solo su `KEEP`. Mappe deterministiche evento → `type`/`importance`/`confidence` (es. `war_declared`→`conflict`/.95, esito simulazione→`outcome`/.9, `minister_statement`→`opinion`/.6). `lifecycle = importance ≥ 0.8 ? 'hot' : 'warm'`, `status='active'`. Testo trim/collassato (solo spazi/tab, per non schiacciare la struttura Domanda/Risposta) e cappato a 2000 caratteri.
- `ingestJevBatch`: telemetria (`considered/kept/deferred/dropped/stored`, `model_calls: 0`, latenza) e **isolamento per-item**: un input invalido non fa cadere il batch.
- Adapter (le mappature vivono qui, nessun file separato):
  - `governmentEventInput(event, ctx)`: evento di memoria politica della fazione → scope `government`, `eventType` da `kind` (favor/grievance/ignored/promise/kept/broken), `eventId = factionMemoryId(event)`, `topics=[lever]`.
  - `ministerExchangeInput(...)`: scambio presidente↔ministro → scope `minister` (sedia/mandato), `eventType='minister_statement'`. **Chiude il ciclo con W3**: il record è ritrovabile da `getMinisterMemory`.
  - `playerDecisionInput(...)`: ordine del giocatore → scope `government`, `eventType='player_decision'`, `eventId = actionId`.

## 4. Punti d'innesto (best-effort, mai bloccanti)

- **Conversazioni ministri** — `routes/games/advisor.routes.ts`: `persistJevConversation` dopo la reply nella rotta normal e in `/stream`. Deriva ramo (`fenceContext`), mandato (`mandateFor`), data/turno dagli accessor di sessione. Guardia di tipo sulla reply e try/catch: non cambia mai il contratto della risposta.
- **Decisioni player** — `POST /:id/action`: dopo `session.queueAction` viene ingerita la decisione con l'id dell'azione. try/catch.
- **Eventi governo** — `game/NationStateService.ts`, `recordPressureMemory`: dopo `factionMemoryRepository.insertMany`, gli stessi eventi entrano in JEV. try/catch interno; un errore JEV non blocca la decisione di gioco.

Tutti gli hook sono additivi e falliscono in silenzio verso il gioco. Nel percorso canonico del turno l'ingestion avviene dentro la transazione (`TurnPipelineService`), quindi un turno fallito esegue il rollback anche delle righe JEV.

## 5. Sidecar ramo: fork e potatura

`repositories/jev-memory.repository.ts`:

- `pruneAfterTurn(scope, cutoff)`: `DELETE` con `game_id` **e** `branch_id`, clausole OR su turno/data.
- `forkMemory(from, toBranchId)`: `INSERT OR IGNORE` di tutte le colonne; idempotente.

`repositories/game.repository.ts`: accanto al sidecar `MinisterMemory` esistente, `createBranch` copia JEV sul ramo figlio e `deleteAfterTurn` pota JEV con lo stesso cutoff `{turn: turn+1, gameDate}`. I due sidecar sono in **try/catch indipendenti**: il fallimento di uno non salta l'altro. Con memoria JEV vuota sono no-op: fork e rewind si comportano come prima.

## 6. Test e TDD

Nuovo `backend-nest/tests/ws-jev-w2-ingestion.test.ts`: **24 test**, SQLite temporaneo (`OPEN_PAX_DB_PATH`), provider stub mai invocato.

- **RED iniziale**: modulo `jev-classify` assente → suite non caricata (`0 passed / 0 failed`, exit 1).
- **GREEN worker**: **21 passed**.
- Dopo revisione indipendente: aggiunti isolamento cross-branch di `pruneAfterTurn`, persistenza dell'esito numerico (`type:'outcome'`, importance 0.9) e isolamento per-item del batch → **24 passed**.

Copertura: regole del classificatore (KEEP/DROP/DEFER, nessun LLM); idempotenza e aggiornamento con `eventId` esplicito; flag off senza accesso al repository e senza tabella; validazione scope/game/branch; isolamento di ramo; `scopeKey` canonico; telemetria; cap del testo; adapter governo/ministro/giocatore; integrazione W2→W3 (`getMinisterMemory` ritrova la conversazione); prune/fork (incluso isolamento cross-branch); sidecar reali `deleteAfterTurn`/`createBranch`.

## 7. Gate eseguiti (Node 26.10.0)

| Comando | Esito |
|---|---|
| `cd backend-nest && ../node_modules/.bin/vitest run tests/ws-jev-w2-ingestion.test.ts` | **24 passed** |
| focus W1+W2+W3+minister+faction (pre-estensione) | **73 passed** |
| `cd backend-nest && OPEN_PAX_DB_PATH=/tmp/jev-w2-gate/full2.db npm test` | **211 file / 2232 test passed** |
| `../node_modules/.bin/tsc --noEmit` | exit 0 |
| `npm run build -- --outDir /tmp/ws-jev-w2-build-final2` | exit 0 (outDir temporaneo, dist operativo non toccato) |

La fase è backend-only: **nessun test frontend** (nessuna modifica frontend) e **nessun E2E browser** (nessuna modifica a prompt/UI). L'E2E completo resta da fare una volta a fine blocco. `frontend npm test` non è stato eseguito in questa fase.

## 8. Limiti dichiarati

- **Crescita non limitata**: ogni reply ministeriale e ogni evento governo crea una riga; `maxActiveMemories`/`consolidationIntervalTurns` non sono ancora applicati e il consolidamento è W7. La retrieval W3 limita il prompt, non lo storage.
- **`DEFER` non è mai salvato**: serve un classificatore locale (fase successiva) per decidere gli ambigui. Oggi nessun LLM viene chiamato.
- **Nessuna retrieval dello scope `government`**: `getMinisterMemory` legge solo lo scope ministro; gli eventi governo e le decisioni player sono persistiti e pronti per W4/W5+, non ancora usati nel prompt.
- **Fork/rewind delle fazioni**: `factionMemoryRepository.insertMany` scrive sempre sul ramo `'main'`, mentre l'hook JEV usa il ramo head. Su partite ramificate i due store possono divergere; non è raggiungibile come bug finché non esiste una lettura JEV di scope governo. Da allineare prima di W4/W5.
- **Rollback del percorso non transazionale**: il percorso `advanceDate()` inazione e `resolvePeacetimePressure` possono lasciare righe JEV se una scrittura successiva fallisce; è comportamento ereditato dalla memoria delle fazioni, non una regressione W2.
- **Metadata**: vengono conservati `source`, `eventType`, `eventId`/`sourceEventId` e `hasNumericOutcome`; altre chiavi non serializzate sono scartate.
- **Nessuna prova con provider reale, multi-process o simulazione lunga**: i test usano SQLite temporaneo e stub.

## 9. Revisione indipendente

Revisione avversariale separata: nessun bug critico o raggiungibile. Corretti i punti a basso costo — isolamento per-item del batch, hash su testo normalizzato, guardia di tipo nella reply, conservazione di `hasNumericOutcome`, test cross-branch — e documentati i differiti (`maxActiveMemories`, divergenza ramo fazioni, rollback non transazionale). Il report mancante era l'unico blocco di consegna, ora presente.
