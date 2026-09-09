# M06 — Collegamento al simulatore e rimozione bypass

## µ1 — Feature flag server immutabile

**Stato:** completata, da revisione indipendente.

- Migrazione additiva `games.economy_mode` (`legacy|strict`) e `games.economy_model_version`.
- `SessionRegistry.createSession` legge esclusivamente `worlds.template_id` e il catalogo server-side: `manifest.mode:'strict'` → strict, altrimenti legacy; persiste `manifest.id@version` con la partita.
- Il client non passa né seleziona modalità/modello. Mondo senza template/catalogo resta legacy esplicito, non strict inventato.
- `tests/economy-mode.test.ts`: world bindato a `realism_test_world` produce `strict` e `realism_test_world@1` nel DB.

```
npm --prefix backend-nest test       # 57 file, 416/416 verdi
npm --prefix backend-nest run build  # OK
git diff --check                     # pulito
```

## Prossimo

**µ2:** EffectValidator strict: allowlist causale/tipi, rifiuto `worldChanges` assoluti e comandi LLM `build_facility`/`spawn_battalion`; protocollo invalido → errore/pausa, mai fallback materiale.

## µ2 — EffectValidator strict

**Completata (rafforzata).** Nuovo `core/simulation/EffectValidator.ts` (puro, deterministico, nessuna rete/DB):

- **Allowlist causali/tipi:** effetti strict `ledger|project_tick|shipment|qualitative`; `effectId` non vuoto; causale obbligatoria per gli effetti materiali; campi per tipo (`account` per ledger, `resource` per shipment, `projectId` per project_tick).
- **Rifiuto `worldChanges` assoluti** (territorio, PIL, militare, popolazione, feature) e **`mapChanges` LLM diretti** senza resolver/autorizzazione del modello.
- **Comandi LLM legacy** `build_facility`/`spawn_battalion`/`spawn_unit`/`grant_funds`/`set_gdp` rifiutati prima di ogni fallback.
- **`validateStrictResult`/`validateStrictResultSafe`:** validazione dell'intero risultato (worldChanges, mapChanges da ogni evento, actionOutcomes con `actionId` canonico, effects). Protocollo/ID/effetti invalidi → `EffectValidationError` (errore/pausa), MAI simulazione riuscita per fallback; qualitative senza mutazioni resta valido.
- **Fuzz-safe:** tipi malformati (worldChanges/events/actionOutcomes/effects non-oggetto/non-array, eventi null) → `EffectValidationError`, mai crash non gestito.

`effect-validator.test.ts`: **9 prove** (MAT25/MAT26/MAT27/MAT37/MAT38 + fuzz schema/ID).

```
npm --prefix backend-nest test       # 58 file, 426/426 verdi
npm --prefix backend-nest run build  # OK
npm --prefix frontend run build      # OK
cd frontend && ../node_modules/.bin/vitest run  # 14/14
git diff --check                     # pulito
```

## Prossimo

**µ3:** integrare il validatore in GameSession per le partite strict prima di ogni mutatore di mappa; errore protocollo → rollback/pausa, mai commit narrativo.

## µ3 — Integrazione EffectValidator nel percorso run strict

**Completata.** Il validatore è ora collegato al percorso di simulazione per le partite strict, PRIMA di ogni mutatore materiale o commit narrativo:

- **`rejectDirectMaterialCommand`** su ogni testo d'ordine all'inizio del batch, PRIMA della chiamata al provider (nessun credito consumato per un ordine vietato).
- **`validateStrictResultSafe(promptResult)`** sull'intero risultato subito dopo lo streaming, PRIMA del ramo playback/pausa e di qualsiasi commit: worldChanges assoluti, mapChanges LLM diretti, outcome senza `actionId` canonico ed effetti non consentiti → `EffectValidationError`.
- **Effetti strict resi trasportabili:** `SimulationResult.effects` (tipo `StrictEffect[]`), parsing in `parseSimulationResponse` (batch e NDJSON), pass-through in `processTurnWithPrompts`. Prima il campo `effects` della LLM veniva scartato al confine del controller.
- **Rollback garantito:** un `EffectValidationError` nel batch riporta il mondo all'ultimo checkpoint (catch esistente), il run termina `failed`, nessun checkpoint/evento/cronaca viene committato. Mai simulazione riuscita per fallback.
- Helper `isStrictGame()` centralizza la lettura di `economy_mode` (sostituisce le due chiamate dirette a `getEconomyMode`).

`tests/m06-strict-integration.test.ts`: **8 prove** end-to-end su partita strict con stub LLM (MAT25/26/27/37/38, C01/C10 + sanity):
- worldChanges assoluti → `UNAUTHORIZED_WORLD_CHANGE`, rollback, run `failed`, zero checkpoint;
- mapChanges LLM diretti → `UNAUTHORIZED_MAP_CHANGE`, rollback;
- comando materiale diretto nel testo → `DIRECT_MATERIAL_COMMAND` PRIMA del provider (`processTurnWithPrompts` non chiamato);
- outcome senza actionId → `MISSING_ACTION_ID`;
- effects non consentiti → `MISSING_CAUSE`;
- no-event valido → nessuna mutazione (C10);
- risultato valido con esiti canonici → commit normale (sanity).

```
npm --prefix backend-nest test       # 59 file, 434/434 verdi
npm --prefix backend-nest run build  # OK
npm --prefix frontend run build      # OK
cd frontend && ../node_modules/.bin/vitest run  # 14/14
git diff --check                     # pulito
npm --prefix backend-nest run validate:scenario  # ok, blocking:0
```

## Prossimo

**M06 µ4 (opzionale):** audit dei call path per confermare che nessun mutatore materiale strict operi fuori dal validatore/commit (prova statica + eventuale guard test). In alternativa passare alla revisione indipendente di M06 e alla prossima dipendenza (M07 o U02/U03).

## µ3 — Guardie strict nei call path di GameSession

**Completata.** `gameRepository.getEconomyMode(gameId)` legge la modalità persistata; in strict `GameSession.applyWorldChanges` e `GameSession.applyMapChanges` invocano il validatore PRIMA di ogni risoluzione/mutazione: errore esplicito, nessun fallback. Legacy invariato. `tests/economy-mode.test.ts` (+1): rifiuto su partita strict reale per `worldChanges.regionGDP` e `mapChanges` build_facility (MAT25/MAT26).

**Nota lavoro parallelo:** durante µ3 il validatore su disco risulta esteso da un lavoro parallelo dell'utente (9 test: MAT27, MAT38, outcome senza actionId canonico, `validateStrictResult`/`validateStrictResultSafe`, fuzz schema/ID); le guardie µ3 restano compatibili con quell'API. Backend **58 file / 426 test** verdi, due run consecutivi stabili.

## Prossimo

**µ4:** validazione dell'intero completion nel percorso strict (`validateStrictResult` sul risultato LLM): protocollo invalido → pausa all'ultimo checkpoint, mai commit narrativo; qualitative senza mutazioni resta ammesso.

## µ4 — Completion strict: validazione, rollback e failure

**Presente da lavoro parallelo; verificata in questa consegna (nessuna riscrittura).** Il percorso di salto chiama `validateStrictResultSafe(promptResult)` dopo il provider e prima di mutatori/commit. Il catch ripristina regioni, turn/date, relazioni, azioni, risultati e persistenza; marca `simulation_runs.status='failed'`, non pubblica checkpoint/outbox né una narrativa di successo. `m06-strict-integration.test.ts` (8 casi E2E) prova worldChanges/mapChanges/outcome/effects invalidi, comando diretto bloccato prima del provider e risultato qualitativo pulito (MAT25/26/27/37/38, C10).

Durante la verifica il repository ha ricevuto ulteriori modifiche parallele: suite attuale **60 file / 447 test** verdi; build e `git diff --check` OK.

## Prossimo

**µ5:** `TurnOrchestrator` deterministico: preflight → staging riserve → tick/scadenze prima della proposta LLM → validazione → checkpoint; nessuna rete/LLM dentro la transazione canonica.

## Remediation revisione indipendente — blocker SSE e mutatore legacy

**Implementata, da nuova revisione indipendente.**

- I due `chat_message` precedentemente emessi dentro `withCanonicalTransaction` sono ora bufferizzati e pubblicati solo dopo commit/outbox. `atomic-commit.test.ts` prova che un rollback dopo la creazione della chat non emette SSE (6 casi F02).
- In strict `advanceWorldState` non invoca più `WorldStateEngine.advance`: `TurnOrchestrator.runStrictTick` liquida solo cashflow già canonici/datatI tramite `FinanceService`/ledger. Un salto strict valido non cambia `population/gdp/military_power` legacy (`m06-strict-integration.test.ts`).
- `assertExecutableStrictEffects` è fail-closed: un effect materiale structured non ancora collegato a un adapter canonico non può essere validato e poi ignorato; il run fallisce. Solo qualitative è ammesso finché non arrivano adapter `ledger/project_tick/shipment` verificati.
- I quattro E2E failure strict verificano ora anche `simulation_outbox = 0`.

**Limite dichiarato:** gli adapter materiali `ledger/project_tick/shipment` non sono ancora integrati; M06 non è accettabile finché non saranno applicati attraverso i motori M02–M05 e rivalutati da revisore distinto. Backend **61 file / 449 test** verdi; build e `git diff --check` OK.

## µ5a — Tick strict e scadenze finanziarie canoniche

**Completata, da revisione indipendente.** Nuovo `TurnOrchestrator.runStrictTick`: in strict il salto non chiama più il mutatore legacy e liquida invece i cashflow già datati attraverso `FinanceService.settleDueCashflows` e ledger append-only. `turn-orchestrator.test.ts` prova M02→M06: saldo treasury→court, causale/ledger, retry idempotente. `assertExecutableStrictEffects` resta fail-closed per material effects LLM non server-staged: nessuna proposta può creare beni o moneta direttamente.

**Residuo µ5:** adapter con staging/anchor server-side per `ledger`, `project_tick`, `shipment`; finché assenti il loro uso viene rifiutato e M06 non è accettabile. Backend **61 file / 450 test** verdi.

## µ5b — Adapter ledger staged sul server

**Completata, da revisione indipendente.** Aggiunta tabella `strict_effect_staging` e repository: un motore server può stageare un `LedgerEntryInput` con `branchId` e `anchor_revision`; al commit strict `TurnOrchestrator.applyStagedStrictEffects` consuma l’ID e appende il payload DB nella stessa transazione. Effect mancante/stale/conflittuale → errore; retry consumed non ripaga. I campi LLM non determinano endpoint, importo, unità o causale.

`m06-strict-integration.test.ts` prova E2E seed → stage → completion LLM con solo effectId → ledger court 30 + staging consumed; `turn-orchestrator.test.ts` copre anchor/retry. Backend **61 file / 452 test** verdi.

## Prossimo

**µ5c:** adapter server-staged `shipment` e poi `project_tick`; fino allora sono fail-closed. Nuova revisione indipendente solo dopo che tutti gli adapter materiali necessari sono collegati.

## µ5c-1 — Adapter shipment staged sul server

**Completata, da revisione indipendente.** `strict_effect_staging` ora supporta un lotto shipment di `LedgerEntryInput` materiali, esclusivamente con causali `partenza/consegna/perdita`, stesso `effectId` e indici unici. `TurnOrchestrator` consuma il lotto staged nella transazione canonica; la proposta LLM porta solo ID/tipo, non quantità o custodia. Prova M04→M06: seller 20 → `transit:ship-1` 20, retry invariato. `project_tick` resta fail-closed in assenza di persistenza progetto/adapter. Backend **61 file / 453 test** verdi.

## Prossimo

**µ5c-2:** persistenziare stato progetto e adapter `project_tick` server-staged; solo dopo coprire con E2E e richiedere revisione indipendente M06.

## µ5c-2 — Adapter project_tick staged sul server

**Completata, da revisione indipendente.** Aggiunta persistenza `project_runtime_states` (plan, state, versione) e repository runtime. `stageProjectTick` legge lo stato server, calcola `advancePhaseDay` dal `ProjectEngine` con lavoro server e salva `nextState` con versione; il consume richiede stesso game/branch/anchor/versione e aggiorna lo stato nella medesima transazione del consume. La LLM cita solo `effectId`; `projectId`/lavoro nel completion non decidono lo stato. Prova M05→M06: active workload 5 → completed/work 5/day 1; retry non aumenta versione né lavoro.

Con µ5b/µ5c tutti i kind materiali strict (`ledger`, `shipment`, `project_tick`) hanno adapter server-staged; cashflow datati passa dal tick FinanceService/ledger. Backend **61 file / 454 test** verdi, build e `git diff --check` OK.

## Prossimo

Richiedere una **nuova revisione indipendente M06**: verificare in particolare staging/anchor, commit atomico e assenza di bypass legacy/SSE. Non dichiarare M06 accettata senza quel verdetto.

## Remediation seconda revisione — µ5d

**Implementata; in attesa di terza revisione indipendente.**

- `worldTick()` e `advanceDate()` rifiutano subito partite strict (`strict_legacy_path_forbidden`), prima di data/mappa/DB.
- Nel playback per-evento il tick strict è ora dentro la stessa `withCanonicalTransaction` di CAS/checkpoint/outbox: fault post-settlement rollbacka cashflow e ledger.
- Un errore completion staged nel playback strict chiude il run `failed`, azzera `pausedRun` e rimette gli ordini in coda; legacy conserva il comportamento precedente.
- Fencing repository completo: game esistente, branch appartenente alla game e uguale a head, `anchorRevision === games.world_revision` sia a stage sia a consume.
- Snapshot v1 esteso con `project_runtime_states`, `strict_ledger_schedule`, `project_work_schedule`, `shipment_runtime_states`; `strict_effect_staging` effimero viene cancellato al restore.
- Nuovo `StrictEffectProducerService`, invocato da `runStrictTick`: schedule ledger datato M02, lavoro progetto verificato M05 e runtime shipment M04 generano realmente staging+consume nella transazione checkpoint. E2E GameSession prova un `project_tick` prodotto senza staging manuale.
- Test nuovi: bypass strict, rollback tick/cashflow, failed paused, fencing cross-game/non-head/stale, restore runtime/schedule, producer automatici ledger/project/shipment.

Verifica: backend **61 file / 462 test** verdi; build OK; `git diff --check` pulito. Non dichiarare M06 accettata senza terzo verdetto indipendente.

## Remediation terza revisione — µ5e

**Implementata; in attesa di quarta revisione indipendente.**

- SSE `broadcast` non lancia mai: errori client registrati e outbox resta `pending` per retry (commit non toccato). `publishPendingOutbox` marca pubblicate SOLO le righe realmente diffuse e non entra nei catch di rollback. Test: broadcaster che lancia → checkpoint/ledger/run `completed` intatti, outbox pending.
- Playback: a ogni checkpoint strict gli effect ID ancora staged vengono promossi atomicamente dalla revisione precedente a quella appena creata (`promotePlaybackEffectAnchors`), solo per il run corrente e con fencing. Test E2E: ledger staged alla revisione 0 sopravvive ai checkpoint 1 e 2 e viene consumato alla chiusura.
- `continueSimulation`: l'evento estratto con `shift()` è nello staging RAM e viene ripristinato dopo fault (niente divergenza RAM/DB). Test: fault su secondo checkpoint → retry ricommette «Seconda» alla data giusta.
- Transizione `awaiting_next → failed + requeue`: `finishSimulationRun`+`replacePendingActions` in UNA transazione; se fallisce, RAM torna paused e il run resta `awaiting_next`. Test con fault su `replacePendingActions`.
- `loadFromSave` strict: snapshot economico obbligatorio e verificabile; hash del contenuto verificato in `loadSavedGame` PRIMA della normalizzazione geografica e ripassato a `loadFromSave` (ricalcolato se la migrazione cambia il dato). `restoreEconomicSnapshot` invalida sempre lo staging del ramo, anche su snapshot legacy rifiutato.
- Date canoniche ovunque: `isCanonicalDate` in ledger e producer (rifiuta `1951-02-31`).
- Tick strict esegue anche a `elapsedDays === 0`: le scadenze odierne (`due_date <= asOfDate`) non vengono rinviate.

Verifica: backend **61 file / 466 test** verdi; frontend 51; build e `validate:scenario` OK; `git diff --check` pulito.

## Remediation quarta revisione — µ5f

**Implementata; in attesa di quinta revisione indipendente.**

- **B2 (nuovo blocker) corretto**: in `_commitPausedStepUnlocked` la `closeReason` è hoistata fuori dal `try` e la completion dell'ultimo evento è invocata DOPO il catch: un fault della completion non ripassa più dal rollback pre-step. Test dedicato sul percorso concatenato (ultimo evento = destinazione, effect mancante): RAM ferma alla data post-step, run `failed`, `pausedRun` azzerato, coda requeued e un salto successivo funziona (sessione non bloccata). Il percorso era non testato prima d'ora.
- **M2**: lo staging di fault cattura e ripristina anche `currentEventId/checkpointId/revision`: dopo un fault il lettore punta al checkpoint confermato, non al tentativo fallito (test esteso).
- **M3**: `FinanceService.date()` usa il round-trip UTC canonico, non solo regex.
- **M5**: rimosso il codice unreachable in `loadFromSave`; `promoteStagedEffectAnchors` ammette solo la promozione al checkpoint consecutivo (`toRevision === fromRevision + 1`).
- **M4**: aggiunti test per il rifiuto `strict_economic_snapshot_missing` e per l'invalidazione dello staging anche da snapshot rifiutato.

### Limite dichiarato su B1 (producer applicativi)

**Precisazione onesta che sostituisce ogni affermazione contraria nelle sezioni precedenti (µ5d):** le API `scheduleVerifiedLedgerEffect`/`scheduleVerifiedProjectWork`/`createShipmentRuntime` sono **contratti server-side**; il lato consume (`applyDueCanonicalEffects` via `runStrictTick`, dentro la transazione del checkpoint) è automatico e reale, **ma nessun percorso di gameplay le invoca ancora**: né route, né intent, né preflight creano appropriazioni/cashflow/riserve/spedizioni/progetti in una partita strict. Conseguenza dichiarata: **l'economia strict è inerte in produzione** finché M07 (mandati) o i flussi dossier/ordini strutturati non alimenteranno i producer; un effect materiale nella completion LLM fallisce sempre closed (`MISSING_STAGED_EFFECT` → run `failed`), che è sicuro ma non ancora un flusso di gioco. Il collegamento producer→gameplay è la condizione residua per chiudere M06 e sarà la prima micro-consegna di M07.

Verifica: backend **61 file / 468 test** verdi; build OK; `git diff --check` pulito.

## µ6a — Producer gameplay reali (collegamento M02→M06 via route e bootstrap)

**Implementata; in attesa di quinta revisione indipendente.** Correzione sostanziale del B1 residuo (producer invocati solo dai test):

- **Bootstrap economico automatico**: `bootstrapCatalogEconomy` materializza lo stato iniziale del catalogo nel ledger del ramo (tesorerie → `stanziamento`, lotti → `estrazione`), datato alla `manifest.startDate` (stabile: niente conflitti di idempotenza tra batch — difetto beccato test-first), effectId fisso `catalog:bootstrap`, append verificato. Invocato automaticamente all'inizio di ogni batch strict (`GameSession._processActionBatchUnlocked`) e dalle command route.
- **Route economy con binding server**: `POST /:id/economy/cashflows` (obblighi datati → `FinanceService`) e `POST /:id/economy/reservations` (prenotazioni → `ReservationService`). Il client fornisce solo creditore/importo/data: debitore, valuta e ramo sono **bound server-side** (tesoro della polity del giocatore dal catalogo; `ledgerUnitId` canonicalizza `TEST`→`test`, punto unico di mapping dichiarato). Shortfall esplicito 422, mai clamp (MAT05); legacy → 409 `economy_mode_legacy`.
- **Catena E2E reale**: route cashflow → tick strict → `settleDueCashflows` dentro la transazione del checkpoint → ledger `court 400000`, tesoro `600000`, cashflow `paid`. Bootstrap idempotente attraversi batch ripetuti (7 righe `catalog:bootstrap`, mai doppioni).
- **Restano server-internal** (dichiarato): `scheduleVerifiedProjectWork`/`createShipmentRuntime` non hanno ancora route di gameplay — il lavoro progetto richiede l'allocazione forza-lavoro (MAT10) e le spedizioni l'autorizzazione trasporto; saranno collegati da M07 (mandati) / flusso ordini strutturati. Il loro lato consume nel tick è automatico.

Difetti beccati test-first e corretti: data bootstrap instabile tra batch; parametri harness. Verifica: backend **62 file / 473 test** verdi; build OK; `git diff --check` pulito.

## QUINTA REVISIONE INDIPENDENTE — VERDETTO: ACCETTABILE

`REVIEW-INDIPENDENTE-M06-5.md`: nessun finding sostanziale; B1 (denaro) e B2 chiusi con prove; residui dichiarati non bloccanti (R-3 rehash post-migrazione senza test; O-1/O-4 osservazioni; O-2 mappatura 422 suggerita per `catalog_conflict` — miglioramento futuro). **M06 CHIUSO.** Prossimo passo di piano: M07 (mandati/flussi) collega i producer progetti/spedizioni ancora server-internal.
