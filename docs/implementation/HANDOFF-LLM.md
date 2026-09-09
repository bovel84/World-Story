# HANDOFF — Stato del lavoro LLM (aggiornato a U03 µ1)

> **Scopo:** documento di passaggio tra esecutori LLM. Contiene lo stato
> esatto del lavoro, le regole non negoziabili, i pattern e le trappole
> dell'ambiente. Chi subentra deve leggere questo file PRIMA di toccare codice.
> **Ultimo aggiornamento:** M01 CHIUSO + M02 µ1–µ5 chiuse (codec §4.1, ledger §6.2, prenotazioni MAT05) + M06 µ1–µ6a implementate (strict flag, validator, rollback, orchestratore, producer gameplay REALI per il denaro (bootstrap catalogo automatico + route cashflows/reservations con binding server; progetti/spedizioni server-internal dichiarati — vedi M06-report µ6a), quinta revisione pendente) + **M07 µ1 (motore mandati, MAT31)** + **U01 µ1 (activeModule enum, UI01)** + **U02 µ1 (compositore ordine con bozza preservata e «Registra ordine», UI02/UI13)** + **U03 µ1 (Dossier Nazione a sezioni §10.3, default «decisioni richieste», formattazione deterministica, UI01/UI04)** + **Q01 µ1–µ3 (harness E2E mock, moduli U01/U02/U03, audit a11y DOM, baseline perf)**.

---

## 1. Dove si è arrivati

Progetto: **World Story**, monorepo `frontend/` (React+Vite) + `backend-nest/`
(Node+Express+SQLite, test con vitest). Lavoro guidato da due documenti:

- **Maestro:** `docs/PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md` (specifiche di gioco)
- **Piano esecutivo:** `docs/PIANO_ESECUTIVO_LLM_REALISMO_UX.md` (pacchetti F/M/U/Q, test di accettazione C/MAT/UI, gate)

### Pacchetti completati (rapporti in `docs/implementation/`)

| Pacchetto | Contenuto | Stato |
|---|---|---|
| **F00** | Baseline: guardie su DB reali + riproduzioni audit A01/A03/A05/A07/A10 | ✅ chiuso |
| **F01** | Contratti ID end-to-end, `actionId`, `completesProjectId`, queue states, esito tecnico `unresolved`, backward-compat persistenza | ✅ chiuso |
| **F02** | Checkpoint atomici, `games.world_revision` monotono, outbox at-least-once, CAS/staging RAM, `withCanonicalTransaction` sui 3 siti di commit | ✅ chiuso |
| **F03** | Contratto run pubblico (allowlist snake_case, niente `pending_state` in HTTP), `lastCommittedResult`, `executed` flag (409 vs `no_event_found`) | ✅ chiuso |
| **F04** | Save/load/rewind: hash semantico (`semantic-hash.ts`), rami (branch id = fencing token), 409 durante run (anche pausa), `archivePendingOutbox` sul restore | ✅ chiuso |
| **F05** | Job asincroni (`simulation_jobs`), 202-acceptance, lease con heartbeat/fencing, recovery post-crash, shutdown con abort, `/time-skip` e `/actions/process-all` delegati al worker con `Deprecation: true`, pump auto-riparante | ✅ chiuso |
| **F06** | Reducer puro `simulationStore.ts` + runtime Zustand (`simulationRuntime.ts`) con guardia anti-stale; App/SSE/HTTP/restore sul medesimo reducer; save-load con snapshot canonico (oggetti mappa inclusi); continue-from-checkpoint solo dopo restore valido con anchor; polling di recupero senza SSE; anteprime mai in newsQueue | ✅ chiuso (µ1+µ2+µ3) |
| **M01 µ1** | Formato catalogo `simulation/` (maestro §4), loader/validatore import strict (`src/scenario/`), CLI `validate:scenario`, fixture sintetica `realism_test_world` | ✅ chiusa |
| **M01 µ2** | Pilota storico `cold_war_1951_v2` in NUOVA versione del preset: polity USA, filiera energetica 1951 con fonti reali verificate (OWID/Energy Institute/EIA, Etemad & Luciani dichiarato), censimento 1950 proxy dichiarato, attori reali, matrice R1 | ✅ chiusa ma pilota NON approvato, gate CHIUSO |
| **M01 µ2-bis** | Contratto **multi-valuta** retrocompatibile (`manifest.currencies[]`) + URSS nel pilota su fonti reali: attori sovietici (MinFin/Gosbank/MPS), estrazione carbone/greggio 1951 (4401/1346 GWh/giorno), popolazione proxy 181.582.000, tesoreria in rubli; test portati a 23 in `scenario-pilot.test.ts` | ✅ chiusa ma pilota NON approvato, gate CHIUSO |
| **M01 µ3** | Piano passo 4 operativo: `balanceWorld(mode)` — strict ⇒ NESSUN bilanciamento di alleanze/potenze; cache balance e riuso baseline per **impronta di contenuto** (`catalogFingerprint`, `CACHE_VERSION` 3, migrazione additiva `worlds.catalog_fingerprint`); `runWorldGeneration` carica il catalogo del preset e registra l'impronta; test `balance-mode.test.ts` (6) | ✅ chiusa |
| **M01 µ4** | Piano passo 5: editor con tab «Catalogo» (checklist 9 file, errori per campo con percorsi JSON, anteprima copertura filiere, stato Import strict BLOCCATO/disponibile); `GET /templates/:id/scenario`; import zip con catalogo validato in memoria PRIMA del disco (rotto → 400 con percorso, niente scrittura); zip esporta/reimporta `simulation/`; `ScenarioReport.coverage`; test `scenario-editor.test.ts` (6) | ✅ chiusa |
| **M02 µ1** | Codec canonico quantità/valuta/ratei (`src/domain/quantities.ts`, §4.1): IntString con limite anti-abuso 24 cifre (segno escluso), aritmetica esatta oltre float, `Amount`/`Quantity` con rifiuto `cross_unit`, `Rational`+`integerDivide` con resto esplicito per carry; M01 riusa ESATTAMENTE questo codec; test `quantities.test.ts` (15, MAT03) | ✅ chiusa |
| **M02 µ2** | Ledger append-only (§6.2, MAT04): migrazione `ledger_entries` con chiave unica `(branch_id, effect_id, entry_index)`; ripetizione = no-op verificata, contenuti diversi = `LedgerConflictError` (nessun secondo pagamento); dominio puro `domain/ledger.ts` (causali chiuse money/material, validazione endpoint/delta/data), repository con `appendLedgerEntries`/`reconstructBalances` (saldi per conto/valuta, stock per titolare/risorsa); bilancio §6.1 torna esatto; chiave saldo interna in tupla JSON (ref opachi con `:` preservati); test `ledger.test.ts` (10) | ✅ chiusa |
| **M02 µ3** | Prenotazioni atomiche/idempotenti (MAT05, fixture §7.1): migrazioni `reservations` + `reservation_operations`; `ReservationService` create/consume/release, total dal ledger e `committed` bigint separato da `available`/`shortfall`; P1 600 TEST+60kg → P2 bloccato; consume = append ledger + decremento residuo stessa transazione, retry no-op; release libera solo residuo; test `reservations.test.ts` (8) | ✅ chiusa |
| **M06 µ1** | Feature flag server immutabile: migrazione `games.economy_mode` (`legacy|strict`) + `economy_model_version`; `SessionRegistry.createSession` legge solo `worlds.template_id` e catalogo server-side (`manifest.mode:'strict'` → strict); client non seleziona modalità; test `economy-mode.test.ts` | ✅ chiusa |
| **M06 µ2** | EffectValidator strict (`core/simulation/EffectValidator.ts`): allowlist `ledger/project_tick/shipment/qualitative`, causale per effetti materiali, rifiuto `worldChanges` assoluti e `mapChanges` LLM diretti, comandi legacy `build_facility`/`spawn_battalion`/`grant_funds`/`set_gdp`, `validateStrictResult`/`validateStrictResultSafe` fuzz-safe; protocollo invalido → `EffectValidationError`, mai fallback materiale; test `effect-validator.test.ts` (9, MAT25/26/27/37/38 + fuzz) | ✅ chiusa |
| **M06 µ3–µ5d** | Integrazione nel percorso run strict: `rejectDirectMaterialCommand` sui testi d'ordine PRIMA del provider; `validateStrictResultSafe(promptResult)` dopo lo streaming e PRIMA di playback/commit; `SimulationResult.effects` trasportato (tipo `StrictEffect[]`, parsing in `parseSimulationResponse`, pass-through in `processTurnWithPrompts`); rollback all'ultimo checkpoint + run `failed` su errore protocollo; helper `isStrictGame()`; test `m06-strict-integration.test.ts` (8, MAT25/26/27/37/38, C01/C10 + sanity) | 🟡 implementata, terza revisione pendente |
| **M07 µ1** | Motore mandati (maestro §7.5, piano passo 1): `core/mandates/MandateEngine.ts` puro (tetto/periodo/whitelist/scadenza/fornitori/prezzo, `executeMandate` consuma il plafond UNA volta, idempotenza per executionId) + `services/MandateService.ts` (persistenza SQLite, transazioni canoniche, `MandateConflictError`) + migrazione additiva `mandates`/`mandate_executions`; test `mandates.test.ts` (13, MAT31) | ✅ chiusa |
| **U01 µ1** | `activeModule` enum (un solo modulo attivo, UI01): `stores/moduleState.ts` puro (`openModule`/`closeModule`/`toggleModule`, invariante un-modulo-attivo, `'none'` = mappa libera) + stato/azioni in `uiStore` (rimosso `showActions`) + `App.tsx` deriva `showActions`/`panelOpen`/`panelTab` da `activeModule`; test `moduleState.test.ts` (9, UI01) | ✅ chiusa |
| **U02 µ1** | Compositore ordine (passo 1): `stores/orderDraft.ts` puro (`updateDraft`/`startEnhance`/`enhanceSuccess`/`enhanceFailure`/`acceptEnhanced`/`rejectEnhanced`/`clearDraft`, bozza MAI persa su errore rete/rifiuto anteprima) + `orderDraftStore.ts` (Zustand) + `components/Game/ActionsPanel.tsx` (estratto da App, etichetta **«Registra ordine»**, nota limiti espliciti, errore tecnico `role=alert`) + `App.tsx` (`registerOrder` svuota bozza solo dopo accodamento riuscito, `enhanceOrder` sul reducer); test `orderDraft.test.ts` (10, UI02/UI13) | ✅ chiusa |
| **U03 µ1** | Dossier Nazione a sezioni (passo 1): `stores/nationDock.ts` puro (`NationSection` = situazione/progetti/bilancio/risorse/conoscenze/politiche, default `situazione` = «decisioni richieste», `setSection` solo navigazione) + `utils/format.ts` (formattazione DETERMINISTICA it-IT: `formatNumber`/`formatMoney`/`formatPercent`/`formatDate`/`formatPeriod`, valori non validi → `—`, non dipende da ICU) + `components/Game/NationDock.tsx` (schede 6 sezioni §10.3, bollettino con denaro/unità formattati, sezioni oltre Situazione = placeholder «Da cosa dipende?») + `App.tsx` (bollettino inline sostituito da `NationDock`); test `nationDock.test.ts` (7) + `format.test.ts` (11), UI01/UI04 | ✅ chiusa |
| **Q01 µ1** | Harness E2E mock: `e2e/playwright.config.mjs`, `e2e/mock-api.mjs` (rete esterna bloccata, `/api/**` mockato), `e2e/mock-constants.mjs`, `e2e/tests/mock-smoke.spec.mjs` (landing → template → paese → mondo → HUD + stato di errore). Fix: aggiunti mock `/api/geo/countries` e `/api/geo/capitals` (senza i quali `WorldSelectMap` cadeva nel fallback a griglia e il layout `.country-list-item` non veniva renderizzato) + mock coda ordini/enhance | ✅ chiusa |
| **Q01 µ2** | E2E mock dei moduli della scrivania: `e2e/tests/modules.spec.mjs` (3 test) — U01 un solo modulo attivo (Ordini→Nazione), U02 compositore «Registra ordine» accoda senza avanzare tempo, U03 Dossier Nazione a sezioni con default «Situazione» e placeholder «Da cosa dipende?» | ✅ chiusa |
| **Q01 µ3** | `test:a11y` e `test:perf` reali (prima erano stub con exit 1): `e2e/a11y/a11y.spec.mjs` + `e2e/playwright.a11y.config.mjs` (audit DOM di base SENZA axe, offline: controlli di form senza nome, bottoni senza nome, img senza alt, id duplicati, `<html lang>`), `e2e/perf/baseline.mjs` (baseline bundle: JS 1.32MB / CSS 0.43MB, soglie 2MB/1MB) | ✅ chiusa |

### Stato verifiche all'ultima consegna

- Backend: **65 file di test, 496/496 verdi** (`npm --prefix backend-nest test`)
- Frontend: **51/51 verdi** (`cd frontend && ../node_modules/.bin/vitest run`)
- E2E mock: **5/5 verdi** (`npm run test:e2e:mock`)
- A11y: **1/1 verde** (`npm run test:a11y`)
- Perf: **OK** (`npm run test:perf` — JS 1.32MB, CSS 0.43MB, TOT 1.75MB)
- Build: `npm --prefix backend-nest run build` e `npm --prefix frontend run build` OK
- `validate:scenario`: `ok: true, blocking: 0` (avvisi attesi: 7 legacy + 4 `unknown_quantity` del pilota)
- `git diff --check` pulito
- ⚠️ **Tutto il lavoro è NON committato** (working tree modificato + file nuovi).
  I file `D` in `git status` sotto `docs/` sono riorganizzazione dell'utente: **non toccarli, non ripristinarli**.

### Gate

- GATE-1 (F01–F06 accettati) e l'accettazione di M01 richiedono **revisione indipendente** (revisore ≠ implementatore): NON auto-accettare. Da revisionare esplicitamente: le **fonti del pilota** e la **modifica di contratto** `manifest.currencies` (µ2-bis).
- Gate realismo storico: **chiuso** — il pilota copre USA+URSS/filiera energetica; servono acciaio/ferro/grano, riserve minerarie, saldi di cassa (fonti elencate in `sources.md#dati-non-inclusi` del pilota).

---

## 2. Regole non negoziabili (piano §1 + istruzioni utente)

1. **Un pacchetto alla volta, una micro-consegna alla volta.** Lavorare solo sul pacchetto assegnato.
2. **Test-first sui difetti:** prima il test rosso, poi la correzione.
3. **Solo DB temporanei** (`OPEN_PAX_DB_PATH` in `os.tmpdir()` impostato PRIMA dell'import dinamico di `../src/database`). Vietato toccare `backend-nest/data/world-story.db`, niente deploy, niente migrazioni su dati reali.
4. Vietato: `git reset --hard`, `git add -A`, disattivare test per andare verdi, `any` in codice nuovo, **inventare dati** (fonti insufficienti → `unknown`, mai fabbricare).
5. **Contratto di consegna:** report `docs/implementation/<ID>-report.md` con le sezioni: fotografia, audit coperto (tabella con esiti), file, comportamento prima, contratto API, algoritmo, migrazioni, comandi di test, cosa NON è implementato, decisione revisore. Aggiornare il report a ogni µ.
6. **Niente LLM/network/broadcast dentro le transazioni canoniche**; transazioni annidate → savepoint (better-sqlite3).
7. §9.4.1: validazione PRIMA della mutazione; mai ripristinare lease/outbox-delivery/fencing; un solo messaggio pubblico di sostituzione ramo.
8. Rispondere in **italiano**. Le cancellazioni/movimenti di file in `docs/` in `git status` sono dell'utente: lasciarli stare.
9. **Nessuna installazione di pacchetti via rete** (ambiente offline): usare ciò che c'è nei node_modules.

---

## 3. Comandi di verifica (da lanciare dopo OGNI modifica)

```bash
npm --prefix backend-nest test                    # 65 file, 496/496
cd frontend && ../node_modules/.bin/vitest run    # 51/51 (vitest 4.1.11 alla ROOT del workspace)
npm --prefix frontend run build                   # tsc + vite
npm --prefix backend-nest run build               # tsc
npm run test:e2e:mock                             # 5/5 (Playwright, API mockate nel browser)
npm run test:a11y                                # 1/1 (audit DOM di base, offline)
npm run test:perf                                # baseline bundle (JS 1.32MB / CSS 0.43MB)
git diff --check                                  # whitespace
npm --prefix backend-nest run validate:scenario   # ok:true, blocking:0, warnings:11 (7 legacy + 4 pilota)
```

⚠️ **Ambiente macOS con esbuild/tsx ROTTI** (dyld symbol error): la CLI di
scenario usa `tsc && node dist/scenario/cli.js`, NON tsx. Non convertire a tsx.

---

## 4. Trappole dell'ambiente (pagate in ore — leggerle tutte)

1. **Frontend senza runner locale:** usare `cd frontend && ../node_modules/.bin/vitest run <path>`.
2. **Symlink react/react-dom alla root:** `node_modules/react` → `frontend/node_modules/react` (+ react-dom) creati a mano perché zustand (hoisted alla root) non risolve react. Se `Cannot find package 'react' imported from .../zustand/esm/react.mjs` → ricrearli: `ln -sfn frontend/node_modules/react node_modules/react` (dalla root del repo).
3. **`frontend/vitest.config.ts`**: `server.deps.inline: ['zustand']` + alias react/react-dom verso `frontend/node_modules` — necessario per testare il runtime Zustand in ambiente node.
4. **`frontend/tsconfig.json`** esclude `src/**/*.test.ts(x)` dal build.
5. **Mock `res` nei route test:** DEVE includere `set(_name,_value){return this;}` — le route F05 chiamano `res.set('Deprecation', ...)`; senza, un'eccezione nell'async-handler diventa unhandled rejection e il test **aggancia** con tabelle vuote (sintomo: `simulation_jobs` vuota).
6. **Pump dei job:** il flag `processing` si aggiornava in un microtask successivo alla catena del chiamante — un secondo kick veniva inghiottito e il job restava `queued`. Fix: il `.finally` del pump ri-kicka se esiste `nextQueuedJob()` (pump auto-riparante). NON rimuovere.
7. **Debug:** log temporanei + ispezione diretta del DB + instance id per escludere singleton duplicati; pulire SEMPRE i log di debug prima della consegna.
8. **`.at(-1)`**: il `lib` del backend non include ES2022 — usare `arr[arr.length - 1]`.
9. **BigInt su stringhe non canoniche lancia SyntaxError**: nel validatore scenario, BigInt SOLO dopo `isIntString` (ramo else).
10. **Caso test con stesso gameId:** resumare un save dello stesso gameId NON ri-triggera `initGame` (guarda solo su gameId): il flusso `handleResumeSave` applica esplicitamente `branchReplace` + `invalidateCommand`.
11. **E2E mock — `WorldSelectMap` richiede `/api/geo/countries`:** senza quel mock il componente cade nel fallback a griglia (`.country-card`) e il layout `.country-list-item` non viene mai renderizzato (sintomo: smoke test che non trova `.country-list-item`). Il mock geo è in `e2e/mock-api.mjs`.
12. **E2E mock — `.nation-desk` è sempre nel DOM** (collassato con `panel-collapsed`): nei test usare `toBeHidden()`/`toBeVisible()`, NON `toHaveCount(0)`. `.action-desk` invece è renderizzato solo quando attivo → `toHaveCount(0)` va bene.
13. **`test:a11y`/`test:perf`:** l'ambiente è offline e `@axe-core` NON è installato → l'audit a11y è un controllo DOM di base, non sostituisce axe né le verifiche manuali. `test:perf` legge `frontend/dist/assets/` (richiede `npm --prefix frontend run build` prima).

### Fatti sui run in pausa (pattern test)

- Salto fisso da 2 eventi → pausa all'evento 1; due `continueSimulation(runId)` chiudono il run.
- `processAllPendingActions` ritorna `{paused: true, simulationId}`.
- Gli eventi devono rientrare nella finestra del salto (2° evento ≤ start+jumpDays) altrimenti il run non si pausa.
- Shape risposta jump: `{events:[{headline,description,date,mapChanges}], narration, actionOutcomes, voided, startChat, relationshipChanges, worldChanges}`.

---

## 5. Mappa dei simboli chiave introdotti

- **Backend** (`backend-nest/src/`): `domain/semantic-hash.ts` (`semanticStateHash`), `game.repository.ts` (`ensureMainBranch`, `getHeadBranch`, `createBranch`, `getWorldRevision`, `archivePendingOutbox`, `renewJobLease`, `claimJob`, `nextQueuedJob`, `expiredRunningJobs`, `markRunPausedRecovery`, `latestRunningRun`, `getJobByRunId`, `findJobByIdempotencyKey`, `updateJobStatus`), `game-session.ts` (`fenceContext`, `assertFenceValid`, `hasActiveRun`, `abortActiveSimulation`, `getAdvisorUnchecked`, `ContextChangedError`), `jobs/SimulationJobService.ts` (`simulationJobService`, `IdempotencyConflictError`), `routes/games.routes.ts` (`respondTimeSkipResult`, `respondJobFailure`, `GET /:id` espone `headBranchId`/`worldRevision`/`queueVersion`/`pausedSimulation`, esiti jump con `revision`), `scenario/` (M01: `types.ts`, `loader.ts`, `cli.ts`).
- **Frontend** (`frontend/src/`): `stores/simulationStore.ts` (reducer PURO: `initialSimulationState`, `applyEnvelope`, `replaceCanonicalSnapshot`, `applyBranchReplace`), `stores/simulationRuntime.ts` (store Zustand + `beginCommand`/`isStale`/`invalidateCommand`), `App.tsx` (init effect su `[gameId, headBranchId]`, dispatch da `handleTimeSkip`/SSE `onJumpEvent`/polling run 5s, `branchReplace` in restore e resume-save), `AdvisorChat.tsx`/`ChatsPanel.tsx` (guardie anti-stale su generation), `services/api.ts` (tipi con `branchId`/`anchor`/`revision`), `types/index.ts` (`Game.headBranchId`/`worldRevision`/`queueVersion`).
- **M07** (`backend-nest/src/`): `core/mandates/MandateEngine.ts` (puro: `createMandate`, `executeMandate`→`{state,applied}`, `isExpired`, `remainingPlafond`, `cancelMandate`, `validateMandate`; errori `MandateError` con `code`), `services/MandateService.ts` (`createMandateRecord`, `executeMandateRecord`, `getMandate`, `getMandateDefinition`, `listActiveMandates`, `getMandateRemaining`, `cancelMandateRecord`, `assertWithinPlafond`, `totalMandateSpent`, `MandateConflictError`), migrazione `mandates`/`mandate_executions`.
- **U01** (`frontend/src/`): `stores/moduleState.ts` (puro: `ActiveModule` = `'none'|'orders'|'diplomacy'|'advisor'|'news'|'nation'`, `initialModuleState`, `openModule`/`closeModule`/`toggleModule`), `stores/uiStore.ts` (`activeModule` + `openModule`/`closeModule`/`toggleModule`, rimosso `showActions`), `App.tsx` (deriva `showActions`/`panelOpen`/`panelTab` da `activeModule` via `moduleToPanelTab`; `panelSheetOpen` resta dettaglio visivo locale).
- **U02** (`frontend/src/`): `stores/orderDraft.ts` (puro: `OrderDraftState`, `updateDraft`/`startEnhance`/`enhanceSuccess`/`enhanceFailure`/`acceptEnhanced`/`rejectEnhanced`/`clearDraft`), `stores/orderDraftStore.ts` (Zustand), `components/Game/ActionsPanel.tsx` (compositore estratto, etichetta «Registra ordine», nota limiti espliciti), `App.tsx` (`registerOrder`/`enhanceOrder` sul reducer, `useOrderDraftStore`).
- **U03** (`frontend/src/`): `stores/nationDock.ts` (puro: `NationSection` = situazione/progetti/bilancio/risorse/conoscenze/politiche, `NationDockState`, `setSection`, `NATION_SECTIONS`, `NATION_SECTION_LABEL`), `utils/format.ts` (puro: `formatNumber`/`formatMoney`/`formatPercent`/`formatDate`/`formatPeriod`, raggruppamento DETERMINISTICO it-IT, valori non validi → `—`), `components/Game/NationDock.tsx` (schede 6 sezioni §10.3, default «decisioni richieste», bollettino con denaro/unità formattati, placeholder «Da cosa dipende?» per le sezioni non alimentate), `App.tsx` (bollettino inline sostituito da `NationDock`).
- **Q01** (`e2e/`): `mock-api.mjs` (rete esterna bloccata + `/api/**` mockato, incl. geo/countries, geo/capitals, coda ordini, enhance), `mock-constants.mjs`, `playwright.config.mjs` (E2E mock), `playwright.a11y.config.mjs` (audit a11y), `tests/mock-smoke.spec.mjs` (smoke creazione partita), `tests/modules.spec.mjs` (U01/U02/U03), `a11y/a11y.spec.mjs` (audit DOM di base), `perf/baseline.mjs` (baseline bundle). Script root: `test:e2e:mock`, `test:a11y`, `test:perf`.

---

## 6. Prossimi passi (in ordine di preferenza)

**Stato M01: PACCHETTO CHIUSO** — µ1 (formato+loader+fixture), µ2 (pilota USA), µ2-bis (multi-valuta + URSS), µ3 (strict/authored + impronta di contenuto), µ4 (editor catalogo). **M02 µ1–µ5 chiuse** (codec §4.1+MAT03; ledger+MAT04; prenotazioni+MAT05). **M06 µ1–µ6a implementate (strict flag, validator, rollback, orchestratore, producer gameplay REALI per il denaro (bootstrap catalogo automatico + route cashflows/reservations con binding server; progetti/spedizioni server-internal dichiarati — vedi M06-report µ6a), quinta revisione indipendente: VERDETTO ACCETTABILE, nessun finding sostanziale — vedi REVIEW-INDIPENDENTE-M06-5.md) — **M06 CHIUSO**.** **M07 µ1 (motore mandati, MAT31) chiusa + µ2 (mandato → finanza canonica: route mandati con binding server, esecuzione → obbligo datato reale, retry idempotente; revisione 1 NON ACCETTABILE (atomicità due-commit) → µ2-bis: albero transazionale unico + riparazione retry + validazioni preventive; 63→486 test; seconda revisione: ACCETTABILE, residuo minore M-3 chiuso con test dedicato — µ2 CHIUSA; µ3 snapshot/replay mandati CHIUSA (v1 compatibile; stati completi, ramo figlio + legacy senza chiavi, fencing game/branch; revisione ACCETTABILE) + µ4a scorte minime: review1→µ4b; review2→µ4c; review3→µ4d; review4→µ4e; review5→µ4f; review6 NON ACCETTABILE (plafond/decoder/source fence) → µ4g; 65/496 verdi; SETTIMO riesame pendente; manutenzione/servizi restano aperti).** **U01 µ1 (activeModule enum, UI01) chiusa.** **U02 µ1 (compositore ordine con bozza preservata e «Registra ordine», UI02/UI13) chiusa.** **U03 µ1 (Dossier Nazione a sezioni §10.3, default «decisioni richieste», formattazione deterministica, UI01/UI04) chiusa.** **Q01 µ1–µ3 (harness E2E mock, moduli U01/U02/U03, audit a11y DOM, baseline perf) chiuse.** Tutto verificato (65 file backend, 496 test; frontend 51 test; E2E mock 5; a11y 1; perf OK).

1. **Q01 µ4 (passo 4):** matrice viewport/browser e screenshot stabili (aspettando DOM/map readiness e font); test screenshot NON sostituisce asserzioni DOM/stato/rete. **Q01 µ5 (passo 5):** axe + tastiera manuale, Safari iOS/Chrome Android reali, audit prestazioni profilo del maestro e chunk splitting dopo baseline. **Q01 µ6 (passo 6):** eval narrativa offline su risposte salvate + eventuale campagna con budget approvato.
2. **U03 µ2 (passo 2):** disponibile/impegnato/previsto separati; progetti con fase, lavoro, ostacoli e data condizionata; ledger filtrato tramite causal refs. Dipende da M02/M05 per i dati reali; in assenza, mock congelati dichiarati. Oppure **U03 µ2 (passo 3):** chat accessibile con card accordo strutturata; nessun bottone conversa che sottoscrive condizioni senza preview/consenso.
3. **U02 µ2 (passo 2):** catena della fattibilità (`FeasibilityChain`) con dati/deficit/fonti; dettaglio a elenco su mobile, diagramma accessibile e lista equivalente su desktop; leggibilità anche senza colori. Dipende da M03 per i dati reali; in assenza, mock congelati dichiarati. Oppure **U02 µ2 (passo 3):** conflitti batch e priorità modificabile con bottoni/tastiera, «Registra» non muta tempo/cassa, date/costi stimati distinguibili dai fatti.
4. **U01 µ2 (passo 1):** prototipo desktop/mobile statico sui dati reali di esempio e token del maestro (§10.2), screenshot di tutti gli stati (chiuso/aperto/loading/empty/error/disabled). Oppure **U01 µ2 (passo 3):** shell grid + registro z-index (map 0, shell 10, module 20, overlay 30, dialog 40, toast 50) + `GameShell`/`CommandSheet`/`AccessibleDialog` con focus/inert/return e safe area.
5. **M07 µ2 (passo 2):** priorità manutenzione/servizi e scorte minime; richieste fuori autorizzazione → decisione giocatore. Usa `minStock`/`resourceId` già presenti nel modello mandato. In alternativa integrare i mandati nel checkpoint/snapshot per replay/restore (test richiesto dal piano).
6. **M01 µ2-ter (opzione — completare il pilota USA+URSS):** cercare fonti raggiungibili per acciaio/minerale di ferro/grano 1951 e riserve minerarie; estendere `cold_war_1951_v2` per entrambe le polities. NIENTE tassi di cambio. Il gate di realismo storico resta CHIUSO finché il pilota non è completo + revisione indipendente.
7. **Revisione indipendente di F00–F06 + M01 + M06 µ1–µ6a + U01 µ1 + U02 µ1 + U03 µ1 + Q01 µ1–µ3** (delivery contract: revisore ≠ implementatore) — da segnalare all'utente, non autogestita.

Test di accettazione per M02: MAT03–MAT06, MAT13, MAT19, MAT36.
Test di accettazione per M07: MAT31/MAT32 e replay/restore mandati.

## 7. Decisioni architetturali congelate (non contraddire)

- `games.world_revision` incrementa ESATTAMENTE una volta per checkpoint; mai derivato dal turno.
- Commit canonico atomico unico; LLM/SSE fuori transazione; chiusura run DOPO la transazione via marker `closeReason`.
- CAS sull'ancora mondo: conflitto → `world_anchor_conflict` + rollback; le scritture non-commit sono incondizionate.
- Outbox at-least-once: publish dopo commit, mark published dopo broadcast; ID stabili = event ID.
- Allowlist A03 sul run pubblico; `pending_state` resta nello schema, nascosto in HTTP.
- Niente fallback posizionale (A10): il risultato è associato all'ID alla creazione; flag `executed` distingue 409 da `no_event_found`.
- Restore F04: apre un ramo FIGLIO nella STESSA transazione delle collezioni; il rewind NON crea ramo (residuo documentato).
- Chat/advisor durante run: 409 esplicito, incluse pausa; risposte tardive (`ContextChangedError`) non scrivono sul ramo nuovo; advisor proattivo esente (broadcast-only post-commit).
- Outbox del ramo abbandonato archiviato nella transazione di restore, mai ripubblicato.
- F05: 202-acceptance senza attendere il provider; lease 30s con heartbeat 10s fenced su `lease_owner`; lease scaduta → `paused_recovery` (MAI rigenerazione automatica); resume/close sono endpoint autorizzati espliciti.
- F06: reducer puro testato PRIMA di collegare React; cambio branch SOLO da `applyBranchReplace` su risposta di comando esplicito; envelope scartato → STESSO riferimento (zero mutazioni); archive scoped al ramo (`archiveKey = gameId:branchId`).
- M01: quantità `IntString` (mai float), capacità ≠ quantità, il settore privato non è magazzino del governo, tre consensi separati, `unknown` dichiarato mai fabbricato.
- M01 µ2: il pilota è un NUOVO preset (`cold_war_1951_v2`), il v1 resta legacy intoccato; conversioni fonti→catalogo SEMPRE con `methodVersion` dichiarata; le filiere senza fonti verificabili non entrano nel catalogo; una µ che consegna un pilota parziale NON chiude il gate di realismo storico.
- M01 µ2-bis: `manifest.currencies` è un INSIEME DI VALUTE AMMESSE (retrocompatibile); il check treasury è di appartenenza, non di uguaglianza; `currency` resta valuta di conto primaria; NESSUNA conversione incrociata tra valute senza fonte e decisione revisore; il cambio di contratto deve passare in revisione indipendente.