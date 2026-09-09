# Riesame indipendente — M07 µ2-bis «Remediation revisione 1» (REVIEW-M07-MU2.md: NON ACCETTABILE)

**Revisore:** agente `reviewer`, distinto dall'implementatore; riesame indipendente, nessuna auto-accettazione.
**Esito:** **ACCETTABILE** (tutte le remediation richieste risultano implementate e verificate; residui solo minori/osservativi).
**Data:** ciclo di riesame successivo a µ2-bis; working tree esaminato così com'è (tutto F00–M07 non committato).
**Metodo:** ispezione read-only di sorgenti, route, test e report; riesecuzione indipendente della suite backend (`set -o pipefail; npm --prefix backend-nest test`), `npx tsc --noEmit`, `git diff --check`; prova empirica diretta del meccanismo di annidamento better-sqlite3 (DB in-memory temporaneo, nessuna scrittura sul repository né su DB di partita). Nessuna modifica al codice.

## Verifica puntuale della remediation dichiarata (M07-report.md, sezione µ2-bis)

### 1. S-1 — Atomicità plafond/cashflow — IMPLEMENTATA E VERIFICATA

- `MandateEconomyService.ts:40-73`: `executeMandateEconomy` avvolge TUTTO il corpo in un unico `withCanonicalTransaction` (l'unico albero transazionale di primo livello della funzione). Dentro l'albero: `executeMandateRecord` (`MandateService.ts:197`, apre propria transazione) e `createCashflow` (`FinanceService.ts:66`) → annidati = **savepoint** (better-sqlite3 12.8.0: transazione invocata dentro un'altra diventa savepoint; commento di design già in `database.ts:947-953`).
- **Prova empirica indipendente** del meccanismo (DB `:memory:`, better-sqlite3 12.8.0): transazione esterna con scrittura + transazione annidata che lancia → catturato il throw → **0 righe persistite**: il rollback del savepoint risale all'intero albero. È esattamente la meccanica di `createCashflow` che rifiuta dentro l'albero di `executeMandateEconomy`.
- **Prova di regressione reale (test S-1, `tests/mandate-economy.test.ts:8`)**: mandato con fornitore = tesoro bound (`alpha_treasury`) → `createCashflow` lancia `FinanceError('bad_cashflow')` (`FinanceService.ts:66`, `debtor.ref === creditor.ref`) DENTRO l'albero → rollback di esecuzione e plafond → **422 `bad_cashflow`**, `mandate_executions` = **0**, `mandates.spent` = **'0'**. Verificato nel test a livello di righe DB. Unico call-site: `games.routes.ts:609` (nessun altro invocante, verificato con grep; nessun percorso tick/checkpoint).
- Un throw in qualsiasi punto del callback (finanza, motore, `not_found` difensivo) ora riporta indietro ENTRAMBE le scritture; crash del processo → nessun commit parziale (BEGIN…COMMIT unico).

### 2. S-2 — `createCashflow` SEMPRE invocata — IMPLEMENTATA E VERIFICATA

- `MandateEconomyService.ts:70-78`: `createCashflow` non è più condizionata a `applied:true`; anche sul retry (`applied:false`) viene invocata. Poiché `applied:false` si produce SOLO quando l'esecuzione è già registrata con contenuto identico (`MandateService.ts:215-218` + `MandateEngine.ts` `assertExecutionShape`/`executeMandate`), l'invocazione incondizionata è (a) no-op idempotente se l'obbligo esiste già identico, (b) **riparazione** se la finestra di crash l'aveva perso, (c) `FinanceConflictError`→422 se il contenuto diverge (mai obbligo silenziosamente diverso).
- **Test S-2 (`tests/mandate-economy.test.ts:9`)**: riga `mandate_mnd-route-b_exec-1` ELIMINATA (simulazione finestra di crash) → retry stesso executionId → 200 → riga ricreata con `{amount:'50000', shortage_policy:'arrears'}`. Lo stato «plafond consumato, obbligo assente» non è più permanente né mascherato da 200 con `cashflowId` fantasma: il `cashflowId` nel payload ora è garantito esistente (o la richiesta fallisce 422).
- Nota: con S-1 la finestra di crash è di fatto eliminata (transazione unica, commit atomico); S-2 resta difesa in profondità per stati pre-fix o alterazioni manuali del DB.

### 3. M-1 — Pre-check valuta prima del consumo — IMPLEMENTATA E VERIFICATA

- `MandateEconomyService.ts:59-63`: `getMandateDefinition` + confronto `def.currencyId !== treasury.currencyId` eseguiti PRIMA di `executeMandateRecord` (nessun consumo) e lanciano `MandateError('bad_currency')` → `respondMandateError` (`games.routes.ts:640-645`) → **422 con code**, mai 500. Zero occorrenze di `StrictEffectStagingError` nel percorso mandati (grep).
- **Test M-1 (`tests/mandate-economy.test.ts:11`)**: mandato in valuta `sur` vs tesoro `test` → 422 `bad_currency`, `mandate_executions` = **0**.

### 4. M-2 — Prefisso `mandate_` riservato — IMPLEMENTATA E VERIFICATA

- `games.routes.ts:502-505` (`POST /:id/economy/cashflows`): `cashflowId.startsWith('mandate_')` → **422 `reserved_cashflow_id`**, prima di ogni scrittura; il client non può più pre-seminare/dirottare gli id generati da µ2 (chiusa la via S-1c della revisione 1).
- **Test M-2 (`tests/mandate-economy.test.ts:10`)**: 422 `reserved_cashflow_id`.

### 5. M-3 — Id composito validato prima dell'esecuzione — IMPLEMENTATA (test dedicato assente, v. m-1)

- `MandateEconomyService.ts:35-38,48-52`: `mandateCashflowId(mandateId, executionId)` verificata contro `FINANCE_ID_RE` — specchio ESATTO della regex ID di `FinanceService` (`FinanceService.ts:16`, `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`) — PRIMA di `executeMandateRecord` (nessun consumo) → `MandateError('bad_cashflow_id')` → 422. Chiusa la via S-1b (composite id > 128 non può più bruciare il plafond).
- **Mancanza**: nessun test di regressione dedicato su `bad_cashflow_id` (zero occorrenze in `tests/`).

## Nessun problema nuovo introdotto

- **Retry di un'esecuzione valida non ricrea un obbligo DIVERSO** (contenuto deterministico): `cashflowId` composito deterministico; debitore = tesoro server-bound (`bindStrictEconomy`, catalogo); creditore/importo/data = campi dell'esecuzione **verificati identici** da `assertSameExecution` (`MandateService.ts:130-141`) sul percorso retry; `legalPriority:0`/`partialAllowed:false` costanti; `shortagePolicy` derivato da `noNewDebt` della definizione, che è IMMUTABILE (uniche UPDATE su `mandates`: `SET spent` e `SET status`, mai colonne di definizione). Se il binding tesoro cambiasse tra le esecuzioni, `createCashflow` rileva la riga esistente diversa → `FinanceConflictError` → 422 dentro la transazione: **mai** obbligo divergente silenzioso, mai doppio obbligo (chiave unica `cashflow_id` + verifica contenuto in `FinanceService.createCashflow`).
- **`getMandateDefinition` null dopo esecuzione → `not_found` → rollback** (`MandateEconomyService.ts:66-68`): difensivo, dentro l'albero transazionale → rollback di esecuzione+plafond. Comportamento conforme.
- **Mappature route invariate**: `respondMandateError` (`games.routes.ts:640-645`) mappa `MandateError`/`MandateConflictError`/`FinanceError` → 422 con `code` (ora load-bearing per S-1/M-1/M-3); `respondEconomyError` e `bindStrictEconomy` invariati rispetto a M06; le tre route mandati restano strict-only con binding server (valuta/tesoro/ramo mai dal body, legacy → 409 `economy_mode_legacy`).
- **M06 intoccato** (fuori dalla remediation): route `/economy/cashflows` e `/economy/reservations` identiche a µ6a salvo il blocco M-2 (la remediation stessa); nessun tocco a `FinanceService`, `ReservationService`, tick/liquidazione.
- **µ1 intoccata** (equivalenza di contratto, tutto non committato): `MandateService`/`MandateEngine` espongono esattamente le firme dichiarate nel report µ1 (nessun parametro nuovo); `MandateEngine` resta puro; tabelle `mandates`/`mandate_executions` e chiave unica `(branch_id, mandate_id, execution_id)` invariate; `tests/mandates.test.ts` (13 prove) verdi nella suite.

## Regressioni indipendenti (rieseguite dal revisore)

- Suite backend: **63 file / 485 test, tutte verdi** (coerente con la dichiarazione µ2-bis: 481 + 4 test µ2-bis = S-1, S-2, M-1, M-2; il file mandato-economia conta 12 `it`: 8 originali + 4).
- `npx tsc --noEmit`: nessun errore. `git diff --check`: pulito.
- Concorrenza: handler sincrono su better-sqlite3 (single-connection, transazioni seriali) → nessuna interleaving possibile; l'indice UNIQUE e l'idempotenza `finance_operations` difendono in profondità.

## Findings

### Sostanziali
- Nessuno. S-1, S-2, M-1, M-2, M-3 sono implementati come da condizioni 1-3 di `REVIEW-M07-MU2.md`; la condizione 4 (test S-1/S-2) è soddisfatta.

### Minori

- **m-1 — `tests/mandate-economy.test.ts` (assente) vs `MandateEconomyService.ts:36-52` — M-3 senza test dedicato.** La guardia `bad_cashflow_id` è corretta per ispezione (regex identica a `FinanceService`, valutata prima di ogni scrittura) ma nessuna prova esercita un id composito > 128 (o carattere non valido) per affermare 422 + plafond NON consumato. La revisione 1 (O-2) indicava esplicitamente «composite-id lungo» tra le coperture suggerite. *Suggerimento:* aggiungere in una prossima micro-consegna: `executionId` che rende `mandate_<mid>_<eid>` > 128 → 422 `bad_cashflow_id`, esecuzioni 0, spent '0'. Non blocca l'accettazione (la via S-1b è chiusa dal codice).

### Osservazioni (non bloccanti)

- **o-1 — ordine dei pre-check** (`MandateEconomyService.ts:48-60`): `bad_cashflow_id` è valutato prima dell'esistenza del mandato; un id lungo + mandato inesistente risponde `bad_cashflow_id` invece di `not_found`. Inoffensivo (422 in entrambi i casi, nessuna scrittura).
- **o-2 — riparazione di un obbligo cancellato DOPO la liquidazione** (estremo di S-2, raggiungibile solo alterando manualmente il DB): il retry ricrea la riga come `scheduled`; se esiste già l'operation `settle:<id>:<asOf>`, il tick successivo riconcilia con `verify()` (nessun doppio pagamento) e in caso di cash del tesoro cambiato fallisce rumorosamente con `FinanceConflictError` dentro il tick. Difesa in profondità corretta (mai doppio pagamento); da tenere presente se si introdurrà un percorso di amministrazione dati.
- **o-3 — retry su mandato annullato**: `executeMandateRecord` sul percorso idempotente non ricontrolla lo status e il retry ricrea l'obbligo mancante: coerente con la semantica µ1 «le esecuzioni già applicate restano».
- **o-4 — residuo strutturale O-1 confermato e ancora dichiarato**: `mandates`/`mandate_executions` restano fuori da `economy-snapshot.repository.ts`; il report dichiara onestamente «replay/restore NON ancora integrato». Con S-1+S-2 l'invariante plafond⟺obbligo vale sul percorso runtime; l'integrazione nello snapshot/restore deve precedere il collegamento dei mandati a rami/restore (come già condizionato nella revisione 1).
- **o-5 — stile**: `tests/mandate-economy.test.ts` resta one-liner minificato (legge già nota, nessun impatto funzionale).

## Verdetto

**ACCETTABILE.** Tutte e cinque le remediation dichiarate in µ2-bis sono reali e verificate: l'albero transazionale unico (annidamenti = savepoint, provato empiricamente e dalla suite) realizza «o entrambi o nessuno»; il retry ripara invece di mascherare; le validazioni preventive (valuta, id composito, namespace `mandate_`) intervengono prima di qualunque consumo con 422, mai 500; i contenuti del retry sono deterministici e ogni divergenza produce conflitto esplicito, mai obbligo silenzioso. Suite 63/485 verde rieseguita dal revisore, `tsc --noEmit` e `git diff --check` puliti, µ1 e M06 intoccati. Residuo: test dedicato per M-3 (m-1, suggerito) e il residuo strutturale dichiarato replay/restore dei mandati (o-4) da affrontare prima di collegare i mandati a snapshot/restore.
