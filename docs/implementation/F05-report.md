# F05 — Job asincroni e recupero dopo crash

## Pacchetto / revisore / fotografia iniziale

- **Pacchetto:** F05, micro-consegne 1–3 (accettazione 202, worker claim/lease, idempotenza C09, recovery lease C13; arresto controllato con abort fino al convertitore, heartbeat del lease, ripresa/chiusura autorizzabile di paused_recovery; delega dei legacy al percorso job con deprecazione esplicita).
- **Revisore:** da designare (chi implementa non auto-approva).
- **Fotografia iniziale:** `POST /:id/time-skip` attendeva il provider inline nel percorso HTTP: la durata del run era legata alla rete/proxy, un retry poteva generare una seconda chiamata pagata (solo la chiave era controllata, non l'hash del payload — residuo F02), e un crash del processo lasciava il run `running` per sempre.

## Requisiti audit / invarianti / test

| Audit | Test | Esito |
|---|---|---|
| A09 (idempotenza debole) | `jobs.test.ts`: stessa chiave + stesso payload → stesso job, replay, nessuna seconda generazione; stessa chiave + payload diverso → **409 `idempotency_conflict`** (C09, ora con hash del payload). | Verde (rosso prima: tabella/servizio assenti) |
| A09 (accettazione) | `jobs.test.ts`: POST accetta **202** mentre il provider è bloccato sul gate; il worker reclama (`running`) e completa solo dopo il rilascio; il run collegato è `completed`. | Verde |
| A13 (crash/lease) | `jobs.test.ts`: job `running` con lease scaduto + run `running` → `recoverExpiredLeases()` marca il job `failed` (`lease_expired`) e il run **`paused_recovery`** all'ultimo checkpoint; **nessuna rigenerazione** (il provider non è richiamato). | Verde |
| A13 (arresto) | `jobs.test.ts` µ2: `shutdown()` con il convertitore bloccato → l’abort raggiunge l’adattatore (signal nel convertitore), il job in volo è `failed` con errore di abort; `startup()` riapre il worker. | Verde |
| A13 (lease fencing) | `jobs.test.ts` µ2: il rinnovo del lease è consentito solo al proprietario (`renewJobLease` con fencing), il gioco non avanza mai per heartbeat. | Verde |
| C13 (ripresa/chiusura) | `jobs.test.ts` µ2: `close-recovery` → run `interrupted`; `resume-recovery` → job riaccodato **esplicitamente**, nuovo run creato, run vecchio `interrupted` (mai una seconda chiamata automatica). | Verde |
| C09/C13 (delega) | `jobs.test.ts` µ3: `/time-skip` delega al worker con la **stessa risposta sincrona** (world_advanced/awaiting_next/no_event_found); stessa chiave + payload diverso → **409 `idempotency_conflict`** (C09 chiuso sul percorso HTTP legacy); replay della stessa risposta; pausa → 409 `simulation_paused` senza nuovo job. | Verde |
| C13 (delega) | `jobs.test.ts` µ3: `/actions/process-all` delega al worker e conserva la forma `{simulationId, processedCount, actions}`. | Verde |

## File letti e modificati

- `backend-nest/src/jobs/SimulationJobService.ts` — **nuovo**: `submit` (idempotenza + hash), `kick`/`drain`/`claimNext` (single-flight, claim atomico), `execute` (scelta batch/mondo al tempo di esecuzione, heartbeat), `recoverExpiredLeases`, `shutdown`/`startup`, `resumeRun`/`closeRecoveryRun`, `publicJob` (allowlist), `IdempotencyConflictError`.
- `backend-nest/src/database.ts` — tabella additiva `simulation_jobs` (+ `error_name`, `result_json`) + indici (`idx_jobs_game_status`, univoco `idx_jobs_game_key`).
- `backend-nest/src/repositories/game.repository.ts` — `createJob`, `getJob`, `getJobByRunId`, `findJobByIdempotencyKey`, `updateJobStatus`, `nextQueuedJob`, `claimJob`, `renewJobLease` (fencing), `expiredRunningJobs`, `markRunPausedRecovery`, `latestRunningRun`.
- `backend-nest/src/database.ts` — migrazione `simulation_jobs` con `result_json`/`error_name` (µ3: i percorsi legacy delegano e ricostruiscono la risposta dall’esito del job).
- `backend-nest/src/routes/games.routes.ts` — nuovi endpoint canonici `POST /:id/simulation-jobs` (202) e `GET /:id/simulation-jobs/:jobId`; rifiuto 409 `simulation_in_progress` con run attivo (F04); `POST /:id/simulations/:runId/resume-recovery` (202, job riaccodato) e `POST /:id/simulations/:runId/close-recovery` (µ2); **µ3**: `/time-skip` e `/actions/process-all` delegano al worker (header `Deprecation: true`, risposta compatibile, pre-check 409 pausa/attivo); `/actions/process` documentato NON aggirabile (usa la stessa pipeline `_processActionBatchUnlocked`).
- `backend-nest/src/index.ts` — `recoverExpiredLeases()` all'avvio: i job orfani di un crash diventano `failed`/`paused_recovery` senza rigenerare.
- `backend-nest/src/prompt-builder.ts`, `backend-nest/src/agents.ts` — l’`AbortSignal` del run arriva ora anche al **convertitore** (`convertAction`/`convertActionsBatch`): l’abort degli adattatori è completo (µ2).
- `backend-nest/src/game-session.ts` — `abortActiveSimulation()` pubblico per l’arresto controllato.
- `backend-nest/tests/jobs.test.ts` — nuove prove (red → green).

## Comportamento prima / prova

- **Prima:** la POST di salto teneva aperta la risposta HTTP finché il provider non finiva; un retry con la stessa `Idempotency-Key` e payload diverso riusava lo stesso run (hash non controllato); un crash lasciava run e stato incoerenti senza percorso di recupero.
- **Dopo:** la POST risponde **202** prima della fine del provider (test con gate chiuso); il worker esegue con lease di 30s rinnovabile per claim; il retry con stesso payload restituisce lo stesso job senza chiamare il provider; payload diverso → 409; lease scaduta → `paused_recovery` senza seconda chiamata pagata.

## Contratto API e compatibilità

- **Nuovo:** `POST /api/games/:id/simulation-jobs` → `202 { type:'job_accepted', jobId, status }`; replay → `200 { type:'job_replayed', jobId, status, runId, replayed:true }`; conflitto → `409 { code:'idempotency_conflict', jobId }`.
- **Nuovo:** `GET /api/games/:id/simulation-jobs/:jobId` → `{ id, gameId, type, status, runId, error, createdAt, updatedAt }` (allowlist).
- **Invariato:** `POST /:id/time-skip` resta sincrono fino alla µ3 (delega al medesimo percorso); i test esistenti non sono toccati.

## Algoritmo e invarianti

- Hash del payload con la stessa canonicalizzazione degli snapshot (`semanticStateHash`): il C09 non dipende dall’ordine delle chiavi.
- Claim durevole: `UPDATE ... WHERE status='queued'` — un solo vincitore; lease 30s rinnovato ogni 10s dall’**heartbeat tecnico** (toca solo `simulation_jobs`, mai lo stato di gioco; fencing sul proprietario); single-flight nel processo (R1: un worker per processo è sufficiente).
- Arresto controllato: `shutdown()` non accetta nuovo lavoro, aborta il run in volo (signal fino al convertitore), attende il drain; il job in volo finisce `failed` con l’errore di abort. `startup()` (all’avvio del processo) recupera i lease scaduti e riapre il worker.
- `run_id` è l'ancora pubblica di riconciliazione: la clientusa legge il risultato dal lettore (`GET /simulations/:runId`), non dalla durata della POST.
- **Delega legacy compatibile (µ3)**: la risposta è ricostruita da `result_json` del job con la stessa forma di prima (`world_advanced`/`awaiting_next`/`no_event_found`/`actions_processed`); l'idempotenza controlla PRIMA l'hash del payload (409 su conflitto) e usa il replay per run solo come fallback per run pre-job; la pausa è un 409 immediato senza accodare lavoro.
- **Pump self-healing**: il `finally` del worker riparte se nel frattempo sono arrivati nuovi job (race risolta: il flag `processing` si aggiornava in una microtask successiva alla catena dei chiamanti, inghiottendo il kick del secondo submit).
- Ripresa ≠ automatica: dopo un lease scaduto il run è `paused_recovery`; SOLO la chiamata esplicita `resume-recovery` riaccoda il job (nuova chiamata pagata autorizzata), `close-recovery` chiude in `interrupted`.
- Il DoD «rete/proxy non è il ciclo di vita del job; stato recuperabile indipendentemente dal browser» è coperto da job 202 + GET job + run lettabile a prescindere dalla connessione.

## Migrazioni eseguite solo su copie

Tabella additiva con `CREATE TABLE IF NOT EXISTS` su DB temporanei dei test; mai su `backend-nest/data/world-story.db`.

## Comandi test e risultato completo

```
npm --prefix backend-nest test -- jobs.test.ts   # red → green (12 prove)
npm --prefix backend-nest test                   # 32 file; 279/279 verdi
npm --prefix backend-nest run build              # tsc OK
git diff --check                                 # pulito
```

## Screenshot/trace UI

Nessuno: pacchetto backend.

## Cosa NON è implementato / dipendenze mute

- Contratti client sulle 202 (F06/U02): i client attuali su `/time-skip` vedono lo stesso comportamento sincrono; la migrazione al flusso 202 + polling è di F06.
- Kill/restart reale del processo in test: la prova usa `shutdown()`/`startup()` espliciti su fixture (l’avvio reale chiama `startup()`).
- Rinnovo del lease via interval durante run estremamente lunghi: l’heartbeat è attivo ogni 10s per il job in esecuzione; non esiste ancora un rinnovo reattivo su eventi di provider.

## Crediti / DB reale / deploy

Zero chiamate LLM reali, zero deploy, nessun dato reale toccato. Provider stub con gate; DB in `os.tmpdir()`.

## Decisione revisore

Attesa revisione indipendente (test, call path, effetti vietati). Lo sviluppatore non si auto-approva.