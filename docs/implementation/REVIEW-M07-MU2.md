# Revisione indipendente — M07 µ2 «Mandato → finanza canonica»

**Revisore:** agente `reviewer`, distinto dall'implementatore.
**Esito:** **NON ACCETTABILE** (una lacuna sostanziale con remediation minima; tutto il resto verificato corretto).
**Data:** ciclo di revisione successivo a µ2; working tree esaminato così com'è (non committato).
**Metodo:** ispezione read-only di sorgenti, test, report e call path; riesecuzione indipendente della suite backend (`set -o pipefail; npm --prefix backend-nest test`), `tsc --noEmit` e `git diff --check`. Nessuna modifica al codice; nessuna scrittura su DB di partita (solo DB temporanei della suite).

## Ambito

1. `src/services/MandateEconomyService.ts` — `executeMandateEconomy`: plafond UNA volta, idempotenza executionId, cashflow canonico, stessa transazione, retry no-op, mismatch valuta.
2. Route in `src/routes/games.routes.ts` — `POST /:id/mandates`, `POST /:id/mandates/:mandateId/executions`, `POST /:id/mandates/:mandateId/cancel`; binding server, 422/409.
3. `tests/mandate-economy.test.ts` — 8 prove.
4. Coerenza MAT31 (plafond una volta, whitelist, nessuna estensione autonoma) e MAT05 (insoluto mai cancellato, solo finanza canonica).
5. Regressioni: suite completa, `tsc --noEmit`, `git diff --check`, integrità µ1 e M06.

## Esiti delle verifiche richieste

### 1. `executeMandateEconomy` — INVARIANTE DI ATOMICITÀ NON IMPLEMENTATA (v. S-1/S-2)

- `MandateEconomyService.ts:31-60`: la funzione chiama `executeMandateRecord` (`MandateService.ts:200`, apre **propria** `withCanonicalTransaction`, commit al return) e poi `createCashflow` (`FinanceService.ts:66`, apre **un'altra** `withCanonicalTransaction`). Nessun `withCanonicalTransaction` avvolge `executeMandateEconomy` (verificato: zero occorrenze nel file), e l'unico call-site è la route (`games.routes.ts:603`), che **non** gira dentro una transazione canonica. Sul percorso HTTP therefore le due scritture sono DUE transazioni separate, con due commit distinti.
- La dichiarazione centrale (header `MandateEconomyService.ts:8-9` e M07-report µ2: «Plafond e cashflow nella STESSA transazione canonica (savepoint): crash → o entrambi o nessuno») è quindi **non implementata** sul percorso reale. Il savepoint esisterebbe solo se il chiamante fosse già in transazione: non lo è mai oggi.
- Il retry non ripara (`MandateEconomyService.ts:40`): con lo stesso executionId `executeMandateRecord` ritorna `applied:false` e la funzione esce in anticipo **senza** creare il cashflow mancante → lo stato «esecuzione registrata + plafond consumato + nessun obbligo» viene confermato con **200 OK** (`applied:false`, `cashflowId` fantasma nel payload, budget consumato, `getMandateRemaining` ridotto). «Né doppia spesa né doppio obbligo» vale, ma la metà «o entrambi o nessuno» no.
- Trigger deterministici (non solo crash-window) in cui `createCashflow` lancia DOPO il consumo del plafond:
  a. `supplier === tesoro bound` → `FinanceError('bad_cashflow')` (`FinanceService.ts:66`): la lista `suppliers` è scelta dal client alla creazione del mandato, quindi è input raggiungibile;
  b. `mandate_<mid>_<eid>` oltre i 128 caratteri della regex ID di `FinanceService` (`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; mandateId ed executionId possono essere ≤128 ciascuno → composito fino a 265) → `FinanceError('bad_id')`;
  c. il client pre-crea via `/economy/cashflows` (M06) un cashflow con lo stesso `cashflowId` `mandate_*` (namespace non riservato, `games.routes.ts:489-502`) → `FinanceConflictError` (o, se il contenuto combacia esattamente, il client può far «cavalcare» all'esecuzione una `shortagePolicy` scelta dal client, eludendo la policy derivata da `noNewDebt`).
  In tutti i casi: 422 al client ma plafond bruciato senza passività, e permanente (S-2).

### 2. Route — VERIFICATE CORRETTE (strict only, binding server, errori)

- `games.routes.ts:552-591` (`POST /:id/mandates`), `:593-623` (`POST /:id/mandates/:mandateId/executions`), `:625-631` (`POST /:id/mandates/:mandateId/cancel`): tutte e tre via `bindStrictEconomy` (`:450-481`), identico alle route M06. Valuta (`currencyId`), tesoro (`treasury`) e ramo NON sono destrutturati dal body (spoofing strutturalmente ignorato, testato in test 1); ramo sempre `getHeadBranch`, tesoro sempre dal catalogo via polity del giocatore; legacy → 409 `economy_mode_legacy` (test 8); errori motore/finanza → 422 con `code` via `respondMandateError` (`:634-640`, test 2/5/7). Unica eccezione di mappatura: `StrictEffectStagingError` → 500 (v. M-1).
- M06 NON toccato: nel diff le route `/economy/cashflows` (`:483-517`) e `/economy/reservations` (`:519-551`) e `bindStrictEconomy` sono quelle di µ6a, invariate; µ2 aggiunge solo i tre endpoint mandati + import + `respondMandateError`.

### 3. Test `tests/mandate-economy.test.ts` (8) — PRESENTI E REALI

1. creazione con binding server (`currencyId:'SUR'`/`treasury:'spoofed'` client ignorati → `test`/`alpha_treasury`);
2. violazioni → 422 con codice (`not_in_whitelist`, `not_in_suppliers`, `price_exceeded`, `not_started`, `expired`);
3. E2E: esecuzione → `processWorldAdvance(30)` → cashflow `paid` (`default`), ledger tesoro `900000` / fornitore `100000` (liquidazione `settleDueCashflows` nel percorso tick strict);
4. retry stesso executionId → 200 `applied:false`, 1 riga cashflow, 1 esecuzione;
5. `ceiling_exceeded` → 422;
6. `noNewDebt:false` → policy `arrears`;
7. cancel → `not_active` → 422;
8. legacy → 409.
Mancano (v. O-2): conflitto executionId (coperto da µ1 sul servizio, non sulla route), coerenza execution↔cashflow in caso di rifiuto finanza, composite-id lungo, mismatch valuta.

### 4. MAT31 / MAT05 — SOSTANZA CORRETTA SUL PERCORSO NORMALE

- **MAT31**: plafond consumato UNA volta (motore puro + chiave unica `(branch_id, mandate_id, execution_id)`, `database.ts:437`); whitelist/fornitori/prezzo applicati dal motore puro PRIMA della scrittura; nessuna estensione autonoma (fuori whitelist/tetto → errore, mai esecuzione implicita; test 2/5/7).
- **MAT05**: nessun movimento ledger grezzo dal percorso mandato; l'obbligo vive solo in finanza canonica e la liquidazione è `settleDueCashflows` (`FinanceService.ts:68`), dove l'insoluto resta `arrears`/`default` e non è mai cancellato; policy corretta (`default` se `noNewDebt`, altrimenti `arrears`; test 3/6); tesoro povero → `outstanding` invariato con status di insoluto, `partialAllowed:false` mai clampato.
- **Riserva**: la garanzia «plafond ⟺ obbligo» (presupposto di entrambe le MAT) vale solo se S-1/S-2 sono corretti; oggi un'esecuzione può esistere senza obbligo (budget bruciato senza passività) — è la stessa asimmetria che il restore produce (v. O-1).

### 5. Regressioni — VERIFICATE indipendentemente

- Suite backend rieseguita dal revisore: **63 file / 481 test, tutte verdi** (coerente con la dichiarazione: 62/473 + 1 file + 8 test).
- `tsc --noEmit`: nessun errore. `git diff --check`: pulito.
- **µ1 non ritoccata**: i file µ1 sono untracked (tutto il worktree F00–M07 è non committato), quindi il diff non può separarli; verifica per equivalenza di contratto: `MandateEngine.ts` e `MandateService.ts` espongono esattamente le firme dichiarate nel report µ1 (nessun parametro nuovo, nessuna route spostata nel servizio), le 13 prove `tests/mandates.test.ts` sono presenti e verdi, le tabelle µ1 (`database.ts:403-440`) sono invariate e µ2 non aggiunge migrazioni. Nessun segno di modifiche µ1 oltre il dichiarato.
- Concorrenza: handler sincrono su better-sqlite3 (single-thread, transazioni seriali) → nessuna interleaving possibile tra `executeMandateRecord` e `createCashflow` nello stesso handler; l'indice UNIQUE difende in profondità anche fuori processo. Nessuna doppia spesa per race trovata.

## Findings

### Sostanziali

- **S-1 — `MandateEconomyService.ts:31-60` (con `MandateService.ts:200`, `FinanceService.ts:66`, call-site `games.routes.ts:603`) — atomicità plafond/cashflow NON implementata.** Le due scritture sono due transazioni canoniche separate (due commit) sul percorso route; la clausola «stessa transazione (savepoint), o entrambi o nessuno» dell'attesa µ2 non è realizzata. Trigger deterministici: supplier = tesoro bound (`bad_cashflow`), composite id > 128 (`bad_id`), cashflowId `mandate_*` pre-seedato via route M06 (`finance_conflict`). Esito: esecuzione + plafond consumati, nessun obbligo, budget mandato bruciato. *Correzione:* avvolgere il corpo in `withCanonicalTransaction(() => { ... })` (le chiamate interne diventano savepoint; qualsiasi `throw` di `createCashflow` riporta indietro esecuzione e plafond; crash → o entrambi o nessuno).
- **S-2 — `MandateEconomyService.ts:40` — retry senza riparazione.** Con `applied:false` la funzione esce senza `createCashflow`: un fallimento avvenuto dopo il commit del plafond (S-1) diventa permanente e il retry lo conferma con 200 (cashflowId fantasma). *Correzione:* invocare `createCashflow` SEMPRE (anche su `applied:false`): è idempotente e verificata (`FinanceService.ts:66`), quindi ripara la finestra di crash senza mai duplicare; combinato con S-1 dà «o entrambi o nessuno» anche in caso di crash.

### Minori

- **M-1 — `MandateEconomyService.ts:42-45` + `games.routes.ts:634-640` — mismatch valuta: controllo post-consumo ed errore mappato 500.** La verifica `def.currencyId !== treasury.currencyId` avviene DOPO `executeMandateRecord` (plafond già consumato) e lancia `StrictEffectStagingError('BAD_STAGED_PAYLOAD')`, che `respondMandateError` non riconosce → `respondRouteError` → **500** invece del 422 promesso. Oggi irraggiungibile via route (entrambi i lati derivano dallo stesso binding), ma raggiungibile se la valuta del tesoro nel preset cambia tra creazione ed esecuzione (stessa famiglia dell'O-2 di M06-5: mutazione del template). *Correzione:* leggere la definizione e verificare la valuta PRIMA di `executeMandateRecord`, lanciare `MandateError('bad_currency')` (o `FinanceError`) → 422, nessun consumo.
- **M-2 — `games.routes.ts:494-497` (route M06 cashflows) — namespace `mandate_*` non riservato**: il client può scegliere liberamente `cashflowId` con prefisso `mandate_`, pre-occupando gli id che µ2 genera (conflitto o dirottamento policy, v. S-1c). *Correzione:* rifiutare in `POST /:id/economy/cashflows` un `cashflowId` che inizia con `mandate_` (422 `reserved_cashflow_id`), oppure validare in `executeMandateEconomy` l'assenza pregressa del cashflow con errore esplicito.
- **M-3 — `MandateEconomyService.ts:26-28` + `FinanceService.ts:16` — composite id non vincolato**: `mandateCashflowId` non rispetta il limite di 128 caratteri dell'ID regex di `FinanceService` quando mandateId+executionId sono lunghi; `createCashflow` rifiuta con `bad_id` DOPO il consumo del plafond (422 + budget bruciato, poi mascherato da S-2). *Correzione:* validare `mandateCashflowId(mandateId, execution.executionId)` (formato+lunghezza) all'ingresso di `executeMandateEconomy`, prima di qualunque scrittura; in alternativa cap sulla somma delle lunghezze alla creazione del mandato.

### Osservazioni

- **O-1 — mandati fuori dallo snapshot/restore economico** — `economy-snapshot.repository.ts:4-16`: `mandates`/`mandate_executions` NON sono nelle tabelle catturate/ripristinate; il report lo dichiara onestamente («replay/restore NON ancora integrato»). Nota per la prossima micro-consegna: l'asimmetria è già visibile — un `restoreEconomicSnapshot` riporta indietro i `finance_cashflows` ma non `mandates.spent`/esecuzioni, producendo esattamente la divergenza plafond⟺obbligo di S-1 in modo persistente. L'integrazione dello snapshot dei mandati dovrebbe precedere o accompagnare l'abilitazione di rami/restore sui mandati.
- **O-2 — copertura test**: nessun test su execution_conflict lato route (coperto da µ1 sul servizio), né su execution↔cashflow in caso di rifiuto finanza (avrebbe mostrato S-1/S-2 in rosso), né su composite-id lungo o mismatch valuta. *Suggerimento:* dopo la remediation aggiungere: pre-seed del cashflowId → esecuzione 422 con plafond NON consumato; retry post-simulazione-crash con cashflow ricreato.
- **O-3 — stile del file di test**: `tests/mandate-economy.test.ts` è quasi interamente one-liner minificato (stile µ5d/µ6a), leggibilità inferiore a `tests/mandates.test.ts` (µ1, formattato). Nessun impatto funzionale.
- **O-4 — `games.routes.ts:619`**: `getMandateRemaining` nella risposta è letto fuori transazione (solo lettura, coerenza accettabile: lo stato è già commitato).
- **O-5 — `cancelMandateRecord` non ricontrolla `game_id`** (`MandateService.ts:273-284`, firma µ1): il ramo è server-bound e un ramo appartiene a una partita, quindi l'ambito è di fatto corretto; per simmetria con `executeMandateRecord` (`MandateService.ts:206`) un assert esplicito sarebbe più difensivo. Ereditato da µ1, non un difetto µ2.

## Aspetti verificati positivi

- MAT31 e MAT05 sostanzialmente rispettate sul percorso normale: plafond una volta, whitelist/fornitori/prezzo server-enforced, insoluto mai cancellato, policy `default`/`arrears` derivate da `noNewDebt` esattamente come da attesa.
- Binding server intatto e non aggirabile: valuta/tesoro/ramo mai desctrutturati dal body client; legacy 409; errori motore → 422 con codice.
- E2E reale con tick e ledger (test 3) e idempotenza del retry verificata a livello righe DB (test 4).
- µ1 intoccata (equivalenza di contratto + 13 prove verdi) e M06 immutato (route economy invariate, suite completa verde).
- Suite 63/481, `tsc --noEmit` e `git diff --check` verificati indipendentemente dal revisore.

## Condizioni per l'accettazione (remediation richiesta)

1. **S-1+S-2**: avvolgere `executeMandateEconomy` in `withCanonicalTransaction` ed eseguire `createCashflow` anche sul percorso `applied:false` (riparazione idempotente); aggiornare la dichiarazione nel report se il design cambiasse.
2. **M-1**: pre-check valuta prima del consumo + mapping 422 (mai 500) per gli errori di dominio del servizio mandato-economia.
3. **M-2/M-3**: namespace `mandate_` riservato sulla route M06 e validazione del composite cashflowId prima delle scritture.
4. **O-2**: test di regressione che provino «rifiuto finanza → plafond NON consumato» e «retry post-crash → cashflow riparato».
5. Il residuo strutturale (O-1, replay/restore mandati) resta dichiarato e va affrontato prima di collegare mandati a rami/restore.

## Verdetto

**NON ACCETTABILE.** Il collegamento mandato→finanza canonica è sostanzialmente corretto sui percorsi normali (binding server, plafond una volta, whitelist, policy corretta, liquidazione canonica, E2E con ledger) e le regressioni sono tutte verdi; però l'invariante centrale dichiarato per µ2 — plafond e cashflow nella STESSA transazione canonica — non è implementato: sul suo unico call-site le due scritture sono due commit separati, con trigger deterministici raggiungibili da input client (supplier = tesoro, composite id lungo, cashflowId pre-seedato) che consumano il plafond senza produrre obbligo, e il retry idempotente conferma e maschera lo stato incoerente invece di ripararlo. La remediation è minima (wrapper canonico + createCashflow incondizionato + due validazioni preventive) e la struttura generale è solida: atteso un ri-esame rapido della prossima micro-consegna.
