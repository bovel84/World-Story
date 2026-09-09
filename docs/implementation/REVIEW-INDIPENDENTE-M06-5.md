# Quinta revisione indipendente — M06 remediation µ5f + µ6a

**Revisore:** agente `reviewer`, distinto dall'implementatore.
**Esito:** **ACCETTABILE** (con riserve minori, nessun blocker).
**Data:** ciclo di revisione successivo a µ6a; working tree esaminato così com'è (non committato — vedi R-1).
**Metodo:** ispezione read-only di sorgenti, test, report e call path; riesecuzione indipendente della suite backend (`npm --prefix backend-nest test`), `git diff --check` e `tsc --noEmit`. Nessuna modifica al codice; nessuna scrittura su DB di partita.

## Ambito

1. **B2 (µ5f)** — percorso concatenato step→completion: doppio rollback.
2. **B1 (µ6a)** — producer economici di gameplay reali per il denaro: bootstrap catalogo→ledger, route economy con binding server, onestà della dichiarazione residua.
3. **Minori M2/M3/M5/M6 (µ5f)** — staging checkpoint fantasma, date round-trip, codice unreachable, promozione consecutiva, report/handoff.
4. **Regressioni** — suite, whitespace, build.

## Esiti delle verifiche richieste

### 1. B2 (µ5f) — VERIFICATO CORRETTO

- `backend-nest/src/game-session.ts:2201` — `closeReason` è dichiarata fuori dal `try` di `_commitPausedStepUnlocked`; dentro la transazione viene solo marcata (`game-session.ts:2334-2338`) e il run NON viene più messo in pausa quando la chiusura è imminente.
- `backend-nest/src/game-session.ts:2418` — la completion dell'ultimo evento è invocata DOPO il catch del passo: un suo fault non ripassa più dal rollback pre-step; resta un solo rollback (quello della completion, post-step + run `failed` + requeue, `game-session.ts:2720-2751`).
- Test dedicato sul percorso concatenato: `backend-nest/tests/m06-strict-integration.test.ts:374-396` (fixture `two_events_chained_fault`, ultimo evento = destinazione 1951-01-31, effect staged mancante). Attese verificate: RAM alla data post-passo (`1951-01-31`), run `failed`, `getPausedRunInfo() === null`, ordini requeued `pending`, e un salto pulito successivo processa 2 ordini (sessione viva). Il percorso era non testato prima di µ5f.

### 2. B1 (µ6a) — VERIFICATO CORRETTO, dichiarazione residua onesta

- **Bootstrap** — `backend-nest/src/services/StrictEffectProducerService.ts:145-157`: tesorie→`stanziamento` (money), lotti→`estrazione` (material), `effectId` fisso `catalog:bootstrap`, datato alla `manifest.startDate` (stabile tra batch → idempotenza senza conflitti); `ledgerUnitId` (`:135-139`) canonicalizza `TEST`→`test` con rifiuto `BAD_CATALOG_UNIT` se non canonicalizzabile. Append via `appendLedgerEntries` (`ledger.repository.ts:87-`): chiave `(branch_id, effect_id, entry_index)`, ripetizione identica = no-op, contenuto divergente = conflitto fail-closed. Manifest di `realism_test_world`: 2 tesorerie + 5 lotti = 7 righe, coerente con il test.
- **Invocazione in batch** — `backend-nest/src/game-session.ts:3339-3350`: solo in strict (`isStrictGame()`), via `template_id` del mondo + `loadSimulationCatalog`; catalogo invalido → `strict_catalog_invalid` (fail-closed dentro il try del batch, il cui catch marca il run `failed`).
- **Route con binding server** — `backend-nest/src/routes/games.routes.ts:447-476` (`bindStrictEconomy`: polity→tesoro del catalogo, valuta canonicalizzata, head branch; bootstrap idempotente a ogni command), `:489-517` (cashflows) e `:519-551` (reservations). Il client fornisce solo creditore/importo/data: `debtorRef`/`currencyId` nel body non sono nemmeno destrutturati (spoofing strutturalmente ignorato, testato). Errori dominio → 422 con `code` (`respondEconomyError:480-483`); legacy → 409 `economy_mode_legacy` (`:449`).
- **E2E** — `backend-nest/tests/economy-routes.test.ts` (5 test, DB temporaneo prima dell'import dinamico): prenotazioni con shortfall 422 esplicito mai clampato (MAT05, via `InsufficientAvailabilityError` in `ReservationService.createReservation`), catena route→tick→cashflow `paid` con ledger `court 400000` / tesoro `600000` (liquidazione `settleDueCashflows` dentro la transazione del checkpoint via `runStrictTick`, `TurnOrchestrator.ts:16`), bootstrap idempotente su batch ripetuti (7 righe, saldo invariato), legacy 409.
- **Onestà della dichiarazione residua** — VERIFICATA ONESTA. Call-site produttivi accertati: `bootstrapCatalogEconomy` (batch + route) e il lato consume `applyDueCanonicalEffects`/`settleDueCashflows` (automatici nel tick strict). `scheduleVerifiedProjectWork`/`createShipmentRuntime`/`scheduleVerifiedLedgerEffect` restano senza call-site di gameplay (solo test: `m06-strict-integration.test.ts:490`, `turn-orchestrator.test.ts`) — ed è **dichiarato**, non nascosto: M06-report µ5f («Limite dichiarato su B1», che retroatta onestamente le affermazioni µ5d) e µ6a («Restano server-internal», con motivazione MAT10/M07); HANDOFF-LLM allineato («producer gameplay REALI per il denaro; progetti/spedizioni server-internal dichiarati — quinta revisione pendente»). Per il denaro l'economia strict non è più inerte.

### 3. Minori M2/M3/M5 — VERIFICATI CORRETTI

- **M2** — lo staging di fault di `_commitPausedStepUnlocked` cattura e ripristina `currentEventId/checkpointId/revision` (`game-session.ts:2196-2198` e ripristino nel catch `:2401-2403`); test esteso sul retry dopo fault checkpoint (`m06-strict-integration.test.ts:399-414`, il lettore resta sul checkpoint confermato).
- **M3** — `FinanceService.date()` fa il round-trip UTC, non solo regex (`FinanceService.ts:18`); `1951-02-31` viene rifiutato. Usato da `createCashflow` e `settleDueCashflows`.
- **M5** — `loadFromSave` termina linearmente con `return` (`game-session.ts:1896-2001`): codice unreachable rimosso. `promoteStagedEffectAnchors` impone `toRevision === fromRevision + 1` (`strict-effect-staging.repository.ts:11`, rifiuto `BAD_PROMOTION`); la promozione nel playback passa per `previousRevision → revision` consecutivi dentro la transazione del passo (`game-session.ts:2293`).
- **M4** — test presenti per `strict_economic_snapshot_missing` e per l'invalidazione staging da snapshot rifiutato; il ricalcolo hash post-normalizzazione geografica in `loadSavedGame` è ora implementato (`session-registry.ts:165-193`: hash verificato PRIMA della migrazione, ricalcolato e persistito se la migrazione cambia il dato) ma **resta senza test dedicato** (v. R-3).
- **M6** — M06-report aggiornato con le sezioni µ5f e µ6a (incluse verifiche 62 file/473); HANDOFF aggiornato nell'intestazione.

### 4. Regressioni — VERIFICATE

- Suite backend rieseguita dal revisore: **62 file / 473 test, tutte verdi** (coerente con la dichiarazione µ6a).
- `git diff --check`: pulito. `tsc --noEmit`: nessun errore.
- Pattern controllati: DB temporanei impostati prima degli import dinamici nei test nuovi; nessuna scrittura fuori transazione canonica nei percorsi esaminati; snapshot/restore economico include `ledger_entries`/`finance_cashflows`/schedule (`economy-snapshot.repository.ts:4-16`), quindi il bootstrap sopravvive coerentemente a restore/branch.

## Findings

### Sostanziali
Nessuno. I blocker B1 (per il denaro) e B2 sono corretti con prove; i minori µ5f sono chiusi.

### Minore
- **R-1 — working tree non committato** (processo, già segnalato come M5 dalla quarta revisione): l'intera remediation µ5e/µ5f/µ6a è nel working tree non ancora commitato (`git status`: 151 path modificati). Fino al commit non esiste uno stato ispezionabile stabile e la tracciabilità revisione↔codice resta debole. *Suggerimento:* committare a micro-consegne verificate prima della revisione successiva.
- **R-2 — HANDOFF con conteggi stanti** — `docs/implementation/HANDOFF-LLM.md:140`: «Tutto verificato (61 file backend, 462 test…)» non aggiornato a µ6a (62 file/473), mentre l'intestazione (`:6`) sì. *Suggerimento:* allineare il conteggio alla micro-consegna più recente.
- **R-3 — ricalcolo hash post-migrazione senza test** — `session-registry.ts:186-193`: il percorso `saveChanged → rehash + UPDATE saves` non è coperto da alcun test (residuo dichiarato onestamente nelle note µ5f). *Suggerimento:* regressione in `integrity-regressions.test.ts` con uno snapshot pre-migrazione (oggetti legacy x/y) e assert su hash aggiornato + load OK.

### Osservazione
- **O-1 — `strict_catalog_invalid` senza test di fault**: il fail-closed del bootstrap in batch (`game-session.ts:3345`) non ha un test che inietti un catalogo rotto e assertions su run `failed`/assenza scritture. Rischio basso (percorso semplice dentro il try-catch esistente), ma è l'unico ramo nuovo di µ6a senza prova.
- **O-2 — `LedgerConflictError` → 500 generico sulle route economy**: se il preset a catalogo viene modificato dopo la creazione della partita, il bootstrap in `bindStrictEconomy` (`games.routes.ts:475`) lancia conflitto ledger che finisce nel ramo generico di `respondRouteError` (500). *Suggerimento:* mapparlo su 422/409 con `code: 'catalog_conflict'` per diagnostica esplicita.
- **O-3 — finestra di crash nel percorso concatenato**: tra il commit dell'ultimo passo e il commit della completion il run in DB non ha un `pending_state` aggiornato (la pausa precedente resta quella del passo k−1); un crash in quella finestra porta a un replay at-least-once del passo, sicuro per gli effect (idempotenti per `effectId`, nuove revisioni) ma da tenere presente se M07 introdurrà producer non idempotenti.
- **O-4 — dettaglio cosmetico in `settleDueCashflows`**: nel ramo di replay idempotente la risposta riporta lo status corrente della riga con l'importo storico (`FinanceService.ts:68`); nessun impatto sul ledger.

## Aspetti verificati positivi

- Single-rollback del percorso concatenato con contabilità corretta dei tre fallimenti (step / completion / persist-failure del `failed`), ciascuno con test.
- Binding server delle route economy: nessun campo fidato dal client su debitore/valuta/ramo; shortfall esplicito (MAT05) e spending block su arretrato/default.
- Idempotenza a tutti i livelli della catena nuova (bootstrap, schedule, settle, operazioni finance/reservation) con conflitti fail-closed.
- Onestà documentale: il limite B1 residuo è dichiarato esplicitamente e sostituisce le affermazioni precedenti; niente affermazioni non verificabili nel report µ6a.
- Suite, build e whitespace verificati indipendentemente dal revisore.

## Condizioni (non bloccanti per questo verdetto)

1. Commit del working tree (R-1) prima dell'iterazione successiva.
2. Test per il rehash post-migrazione (R-3) e per `strict_catalog_invalid` (O-1) nella prossima micro-consegna.
3. Il residuo strutturale resta dichiarato: producer progetti/spedizioni (MAT10) e collegamento mandati M07; l'eventuale evoluzione dei producer non idempotenti dovrà considerare O-3.

## Verdetto

**ACCETTABILE.** Le remediation µ5f e µ6a risolvono i blocker B2 e B1-per-il-denaro con implementazione corretta, test E2E reali (route→tick→ledger) e dichiarazione onesta dei residui; i minori M2/M3/M5 sono chiusi. Le riserve residue sono di copertura test e igiene documentale/processo, senza impatto sulla correttezza del verticale esaminato.
