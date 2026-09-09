# M07 — Delega, servizi e politiche nazionali (R2)

## µ1 — Motore dei mandati (passo 1): tetto, periodo, whitelist, scadenza, fornitori/prezzo

**Stato:** completata, da revisione indipendente.

### Fotografia iniziale
- HEAD `384dac7`, working tree con tutto il lavoro F00–M06 NON committato (riorganizzazione `docs/` dell'utente intoccata).
- Backend 59 file / 434 test verdi; frontend 14/14; build OK.

### Requisiti audit / invarianti / test
- **MAT31** (mandato budget 100, spese 60+60, retry → seconda non autorizzata, limite non superato).
- Maestro §7.5 (delega controllata: whitelist, tetti, scadenza, fornitori, prezzo; plafond consumato una volta; nessuna autonomia estende il mandato).
- Piano M07 passo 1.

### File letti e modificati
- **Letti:** `domain/quantities.ts`, `domain/ledger.ts`, `services/ReservationService.ts`, `services/FinanceService.ts`, `core/projects/ProjectEngine.ts`, `database.ts`, `tests/reservations.test.ts`.
- **Nuovi:** `src/core/mandates/MandateEngine.ts` (motore puro), `src/services/MandateService.ts` (persistenza), `tests/mandates.test.ts` (13 prove).
- **Modificati:** `src/database.ts` (migrazione additiva `mandates` + `mandate_executions`).

### Comportamento prima (test rosso o prova statica)
- Nessun concetto di mandato/delega esisteva: nessuna tabella, nessun motore, nessun test MAT31. Prova statica: `grep -r mandate src/` vuoto.

### Contratto API/schema e compatibilità
- **Motore puro** `MandateEngine`:
  - `MandateDefinition`: `id, title, currencyId, ceiling, startDate, endDate, whitelist[], suppliers[], priceLimit?, resourceId?, minStock?, noNewDebt`.
  - `MandateExecution`: `executionId, mandateId, actionType, supplier, amount, price?, quantity?, atDate`.
  - `createMandate`, `executeMandate` (ritorna `{state, applied}`), `isExpired`, `remainingPlafond`, `cancelMandate`, `validateMandate`.
  - Errori `MandateError` con `code`: `ceiling_exceeded`, `not_in_whitelist`, `not_in_suppliers`, `price_exceeded`, `not_started`, `expired`, `execution_conflict`, `not_active`, `bad_*`.
- **Servizio** `MandateService` (persistenza SQLite, transazioni canoniche):
  - `createMandateRecord`, `executeMandateRecord`, `getMandate`, `getMandateDefinition`, `listActiveMandates`, `getMandateRemaining`, `cancelMandateRecord`, `assertWithinPlafond`, `totalMandateSpent`.
  - `MandateConflictError` per retry con contenuto diverso.
- **Compatibilità:** migrazione additiva `CREATE TABLE IF NOT EXISTS`; nessuna modifica a tabelle esistenti; nessun cambio di contratto pubblico.

### Algoritmo e invarianti mantenute
- Ogni esecuzione cita `mandateId` e consuma il plafond UNA volta: chiave unica `(branch_id, mandate_id, execution_id)`; retry = no-op verificato (stesso contenuto), contenuto diverso = conflitto.
- Vincoli applicati dal motore puro PRIMA della scrittura: whitelist, fornitori, prezzo limite, periodo `[startDate,endDate]`, scadenza, tetto `spent+amount ≤ ceiling`.
- `spent` accumulato in `IntString` (bigint), mai `SUM()` SQL su TEXT; nessun arrotondamento.
- Nessuna autonomia estende il mandato: fuori whitelist/tetto → errore, mai esecuzione implicita.

### Migrazioni eseguite solo su copie
- Solo DB temporaneo `OPEN_PAX_DB_PATH` in `os.tmpdir()` (test). Nessun DB reale toccato.

### Comandi test e risultato completo
```
npm --prefix backend-nest test       # 60 file, 447/447 verdi (era 434, +13)
npm --prefix backend-nest run build  # OK
cd frontend && ../node_modules/.bin/vitest run  # 14/14
git diff --check                     # pulito
```

### Cosa NON è implementato / dipendenze mancanti
- Passo 2 (priorità manutenzione/servizi, scorte minime, richieste fuori autorizzazione → decisione giocatore): `minStock`/`resourceId` sono già nel modello ma non ancora usati da un motore di scorte.
- Passo 3 (politiche istituzionali con iter ed effetti dilazionati).
- Passo 4 (dashboard eccezioni, metriche decisioni eliminate/notifiche).
- Nessuna route HTTP né UI Nazione ancora collegata (R2, dipende da U03).
- Replay/restore dei mandati (test richiesto dal piano) non ancora coperto: dipende dall'integrazione nel checkpoint/snapshot.

### Nessun credito/DB reale/deploy
- Nessun provider reale, nessun DB reale, nessun deploy, nessuna rete.

### Decisione revisore
- **Da revisione indipendente** (revisore ≠ implementatore). Non auto-accettato.

## Prossimo
**µ2:** passo 2 — priorità manutenzione/servizi e scorte minime; richieste fuori autorizzazione → decisione giocatore (usa `minStock`/`resourceId` già nel modello). In alternativa integrare i mandati nel checkpoint/snapshot per replay/restore.

---

## µ2 — Mandato → finanza canonica (collegamento M07 µ1 → producer M06) — IMPLEMENTATA; in attesa di revisione indipendente

**Nota onestà**: la µ2 qui descritta realizza il collegamento mandato→economia reale (obblighi datati del tesoro bound, MAT31+MAT05); il «passo 2» del piano (scorte minime `minStock`/`resourceId` + richieste fuori autorizzazione → decisione giocatore) resta aperto ed è la prossima micro-consegna.

### Contenuto (implementatore: LLM; attribuzione parallela: µ1 già chiusa da lavoro esterno)
- `src/services/MandateEconomyService.ts` (nuovo): `executeMandateEconomy` — esecuzione mandato (plafond consumato UNA volta, idempotenza executionId) + obbligo datato REALE via `FinanceService.createCashflow` (debitore = tesoro bound, creditore = fornitore ammesso, scadenza = `atDate` dell'esecuzione, `shortagePolicy` = `default` se `noNewDebt` altrimenti `arrears`). Plafond e cashflow nella STESSA transazione canonica (savepoint): crash → o entrambi o nessuno. Retry → no-op verificato (né doppia spesa né doppio obbligo). `mandateCashflowId` = `mandate_<mid>_<eid>` (canonico, citabile).
- Route in `games.routes.ts` (strict only, riuso `bindStrictEconomy`): `POST /:id/mandates` (creazione: valuta/tesoro server-bound, campo `currencyId` client ignorato), `POST /:id/mandates/:mandateId/executions`, `POST /:id/mandates/:mandateId/cancel`; errori motore/finanza → 422 con `code` (`not_in_whitelist`, `not_in_suppliers`, `price_exceeded`, `ceiling_exceeded`, `expired`, `not_started`, `not_active`, `execution_conflict`), legacy → 409.
- Tick strict: liquidazione automatica già esistente (`applyDueCanonicalEffects` + `settleDueCashflows`) — nessun nuovo percorso di pagamento.

### Test `tests/mandate-economy.test.ts` (8)
1. creazione con binding server (`currencyId`/`treasury` client ignorati);
2. violazioni → 422 (whitelist/fornitori/prezzo/non iniziato/scaduto);
3. E2E: esecuzione → tick → cashflow `paid` (`default` policy), ledger tesoro `900000`/fornitore `100000`;
4. retry idempotente (1 sola riga cashflow, 1 sola esecuzione);
5. plafond superato → 422 `ceiling_exceeded`;
6. policy `arrears` quando `noNewDebt:false`;
7. cancellazione → `not_active`;
8. legacy → 409.

### Verifica
- Backend: **63 file / 481 test** verdi; build OK; `git diff --check` pulito.
- Replay/restore mandati nel checkpoint: NON ancora integrato (dichiarato; dipende da integrazione snapshot).

### Decisione revisore
- Da revisione indipendente (revisore ≠ implementatore). Non auto-accettato.

## µ2-bis — Remediation della prima revisione (REVIEW-M07-MU2.md: NON ACCETTABILE)

Difetti sostanziali corretti (test-first con regressioni dedicate):
- **S-1 (atomicità)**: `executeMandateEconomy` ora gira nel MEDESIMO albero transazionale canonico (`withCanonicalTransaction`; `executeMandateRecord`/`createCashflow` annidati = savepoint): rifiuto finanza o crash → plafond NON consumato e nessun obbligo, o entrambi committati. Test S-1: mandato con fornitore = tesoro bound → 422 `bad_cashflow`, esecuzioni 0, spent `0`.
- **S-2 (riparazione)**: `createCashflow` invocata SEMPRE (anche su retry `applied:false`) — idempotente e verificata: ripara la finestra di crash «plafond consumato, obbligo assente» invece di mascherarla. Test S-2: riga cashflow cancellata (simulazione crash) → retry ricrea `50000`/`arrears`.
- **M-1**: valuta mandato ≠ tesoro → 422 `bad_currency` PRIMA del consumo (era `StrictEffectStagingError`→500 dopo il consumo).
- **M-2**: prefisso `mandate_` riservato sulla route M06 `/economy/cashflows` → 422 `reserved_cashflow_id` (il client non può pre-seminare/dirottare obblighi µ2).
- **M-3**: id composito validato PRIMA dell'esecuzione (specchio pattern FinanceService, max 128) → 422 `bad_cashflow_id`.

Verifica: backend **63 file / 485 test** verdi; build OK; `git diff --check` pulito. In attesa di riesame indipendente.

## Chiusura µ2 — seconda revisione: VERDETTO ACCETTABILE

`REVIEW-M07-MU2-2.md`: remediation µ2-bis verificate (atomicità provata empiricamente su savepoint better-sqlite3; retry riparatore; validazioni preventive 422/mai 500; prefisso riservato). Residuo minore chiuso dall'implementatore: **test dedicato M-3** (`bad_cashflow_id` con id composito 135 > 128 → 422, zero consumo). Residuo strutturale dichiarato: **replay/restore mandati** (integrazione snapshot) — aperto, da affrontare prima di collegare i mandati a checkpoint/restore. **µ2 CHIUSA.**

---

## µ3 — Replay/restore mandati nello snapshot economico — IMPLEMENTATA; revisione indipendente pendente

Prerequisito dichiarato dopo µ2: non valutare mandati ai tick/checkpoint se un restore può conservare cashflow e perdere plafond/esecuzioni.

- `economy-snapshot.repository.ts`: `TABLES` include ora `mandates` e `mandateExecutions` (campi completi: definizione, spent/status, esecuzioni). L'ordine è intenzionale: restore cancella in reverse (**executions → mandates**) e inserisce in avanti (**mandates → executions**).
- Compatibilità: schema snapshot resta v1; vecchi snapshot senza le due chiavi sono trattati come liste vuote, non inventano mandato/esecuzioni e cancellano lo stato locale del ramo bersaglio. Nessuna conversione di quantità o stato inventata.
- `tests/economy-snapshot.test.ts`: ramo figlio recupera definizione (`resourceId/minStock/noNewDebt`), `spent:'20'` ed esecuzione `purchase-1`; test esplicito snapshot v1 senza chiavi M07 → nessun mandato stale o inventato nel target. I salvataggi/checkpoint strict usano già `captureEconomicSnapshot`/`restoreEconomicSnapshot` in `GameSession`.

Verifica: backend **63 file / 486 test** verdi; build OK; `git diff --check` pulito.

### Decisione revisore
- Da revisione indipendente (revisore ≠ implementatore). Non auto-accettato.

## Chiusura µ3 — revisione indipendente: VERDETTO ACCETTABILE

`REVIEW-M07-MU3.md`: nessun finding sostanziale. I tre warning di copertura sono stati chiusi prima della chiusura (stati/definition completi, execution stale legacy, fencing game/branch). **µ3 CHIUSA.**

Prossimo: **µ4**, valutazione esclusivamente ai tick autorizzati delle scorte minime `resourceId/minStock`, con eccezione persistente e decisione esplicita del giocatore per ciò che non è autorizzabile senza dati inventati (no prezzo/quantità/nuovo debito automatici).

---

## µ4a — Scorte minime ai tick strict → decisione giocatore — IMPLEMENTATA; revisione indipendente pendente

**Scope deliberatamente limitato:** attua il sottoflusso «scorte minime / fuori autorizzazione» del passo 2 M07. Priorità manutenzione/servizi richiede runtime verificato di capacità/addetti/manutenzione e resta aperta: non è simulata con valori inventati.

### Semantica dichiarata
- `minStock` vale sulla somma delle sole giacenze ledger **di proprietà** degli attori catalogo della polity del giocatore (non custodi, non stock straniero), derivata server-side al tick strict.
- Un mandato non contiene quotazione né quantità d’acquisto verificata: un deficit **non crea** cashflow, esecuzioni, movimenti o debito. Apre invece una decisione persistente; `purchase` in whitelist → `stock_shortfall_authorized` (prezzo/quantità da decidere), assente → `stock_shortfall_outside_authorization`.
- `resourceId` e `minStock` sono una coppia obbligatoria; la route verifica che la risorsa esista nel catalogo server. Nessuna guardia parziale/risorsa inventata entra nel tick.

### Implementazione
- `core/mandates/MandateStockEngine.ts`: valutazione pura (periodo, stato, sufficienza, shortfall); nessuna I/O/mutazione.
- `services/MandateDecisionService.ts` + tabella `mandate_decisions`: apertura una volta, ack senza consenso/spesa, risoluzione con scorta sufficiente, riapertura su nuova carenza; annullamento mandato risolve l’eccezione. Dashboard legge solo open/acknowledged.
- `GameSession.advanceWorldState`: refresh solo nel ramo strict e solo al tick autorizzato, dopo `runStrictTick`; owner refs dal catalogo server. Nessuna guardia configurata → nessun nuovo requisito actor binding (regressione M06 beccata e corretta); guardia configurata senza binding → fail closed.
- Route: `GET /:id/mandates/decisions` read-only (nessun bootstrap/refresh), `POST /:id/mandates/:mandateId/decisions/:kind/acknowledge` (solo acknowledgement); create mandato accetta guardia catalog-verified.
- Snapshot economico v1 esteso anche a `mandateDecisions` (restore/legacy senza chiave non inventa e pulisce stale).

### Prove
- Pure engine: deficit autorizzato/fuori whitelist, periodo/sufficienza/configurazione incompleta.
- Service: aggregazione multi-owner, esclusione stock estero, zero execution/cashflow, idempotenza anti-spam, ack, sufficienza/riapertura, cancel, binding solo se guardia presente.
- E2E: create guardia → GET vuoto prima del tick → salto strict → decisione `tools 20/30`, zero cashflow/esecuzioni; unknown resource/incomplete → 422.
- Snapshot: decisione aperta restore ramo figlio; legacy senza chiave cancella decisione stale.

Verifica: backend **65 file / 493 test** verdi; build OK; `git diff --check` pulito.

### Decisione revisore
- Da revisione indipendente (revisore ≠ implementatore). Non auto-accettato.

## µ4b — Remediation revisione 1 (µ4a NON ACCETTABILE) — IMPLEMENTATA; riesame pendente

`REVIEW-M07-MU4A.md` (verbale trascritto: ambiente reviewer read-only) ha trovato due sostanziali reali e due minori. Correzioni:

- **S-1 proprietà ≠ holder:** estensione additiva `ownerRef` ai soli movimenti materiali del ledger (`owner_ref` nullable; nessun backfill inventato). `reconstructOwnedStock` ricostruisce owner+holder+resource; le guardie sommano esclusivamente gli `ownerRef` degli attori della polity. Bootstrap catalogo, shipment strict e bridge produzione/consumo dichiarano ownerRef. Merce estera custodita presso attore ALPHA è provata e esclusa. Righe legacy senza provenienza restano non attribuite (deficit prudenziale, mai disponibilità fittizia). Bootstrap legacy completo non confligge: non viene riscritto; bootstrap parziale fallisce chiuso.
- **S-2 cancel immediato:** `cancelMandateAndResolveDecisions` esegue cancel game-fenced + risoluzione decisione nella medesima transazione (savepoint). Dopo POST cancel, GET è vuoto e acknowledgement → 422 `not_open`; prove service+route.
- **M-1 restore atomico:** `restoreEconomicSnapshot` ora è sempre `withCanonicalTransaction`; test snapshot malformato → throw e saldo target invariato.
- **M-2 kind alternativo:** una sola decisione per `(branch,mandate)` (migrazione conservativa deduplica, unique index); upsert normalizza un kind stale a quello derivato dal mandato.
- Snapshot ledger conserva anche `owner_ref`; prova owner estero custodito restore ramo figlio.

Verifica: backend **65 file / 494 test** verdi; build OK; `git diff --check` pulito. Riesame indipendente pendente.

## µ4c — Remediation riesame 2 (µ4b NON ACCETTABILE) — IMPLEMENTATA; riesame pendente

`REVIEW-M07-MU4B.md` (verbale trascritto: reviewer read-only) ha trovato:

- **S-3 bootstrap nuovo nascosto da tesorerie senza ownerRef:** la compatibilità legacy ora si attiva SOLO se una riga **materiale** bootstrap non ha ownerRef; confronta rigorosamente tutte le altre colonne e fallisce `BOOTSTRAP_CONFLICT` se divergono. Bootstrap nuovo passa sempre da `appendLedgerEntries` verificato. Test: conflitto bootstrap nuovo; legacy ownerRef nullo completo → no-op; legacy divergente → fail closed.
- **S-4 energia senza ownerRef:** `EconomyCommitService` propaga `ownerRef` anche al consumo energia; test ownership-aware energia a zero dopo lavoro.
- **M-3 snapshot ownerRef:** `restoreEconomicSnapshot` valida le righe ledger con `validateLedgerEntry` prima del delete target; money+owner_ref → rifiuto. Staging strict viene invalidato in transazione separata anche su rifiuto (M06), mentre sostituzione target resta atomica. Test: snapshot money ownerRef invalido → throw, saldo target invariato, staging vuoto.

Verifica: backend **65 file / 494 test** verdi; build OK; `git diff --check` pulito. Riesame indipendente pendente.

## µ4d — Remediation riesame 3 (µ4c NON ACCETTABILE) — IMPLEMENTATA; riesame pendente

`REVIEW-M07-MU4C.md` (verbale trascritto: reviewer read-only) ha trovato:

- **S-5 bootstrap ibrido:** la compatibilità legacy si attiva ora solo se **tutte** le righe materiali sono ownerless. Una riga materiale owner-aware divergente usa append verificato e confligge. Test nuovo: legacy completamente ownerless no-op; ibrido owner errato → `LedgerConflictError`; legacy non-owner diverge → `BOOTSTRAP_CONFLICT`.
- **S-6 snapshot strict distruttivo:** `isEconomicSnapshot` richiede record non-array, tutte le tabelle v1 storiche e liste di record; solo chiavi M07 sono opzionali per compatibilità. `tables: []/{}` non passa; `GameSession.loadFromSave` strict richiede anche esito `restoreEconomicSnapshot === true`. Test strict `tables:[]` → `strict_economic_snapshot_missing`, stato RAM invariato.

Verifica: backend **65 file / 494 test** verdi; build OK; `git diff --check` pulito. Quarto riesame indipendente pendente.

## µ4e — Remediation riesame 4 (µ4d NON ACCETTABILE) — IMPLEMENTATA; riesame pendente

`REVIEW-M07-MU4D.md` (verbale trascritto: reviewer read-only) ha trovato un bypass restore strict:

- **S-7 preflight tardivo/RAM staging incompleto:** `validateEconomicSnapshot` è ora puro e preflight di `loadFromSave` prima di qualunque mutazione RAM; distingue forma incompatibile (`strict_economic_snapshot_missing`) da riga semanticamente invalida (`strict_economic_snapshot_invalid`). Lo staging RAM ora include anche players, consolidazione, difficulty e intervene flag, ripristinati dal catch.
- **S-8 staging rifiutato:** `invalidateStrictEffectStaging` è separato e persistente; viene chiamato su hash mismatch, forma invalida, semantica invalida e catch strict, mai rollbackato dalla transazione restore fallita.
- **M-4 schema snapshot:** `isEconomicSnapshot` richiede tabelle v1 storiche complete, record-list e nessuna chiave ignota; solo le aggiunte M07 restano opzionali per compatibilità v1. `loadFromSave` controlla anche `restoreEconomicSnapshot === true`.
- Test E2E strict: `money.owner_ref` invalido → preflight reject, turn/data RAM invariati, staging DB vuoto.

Verifica: backend **65 file / 495 test** verdi; build OK; `git diff --check` pulito. Quinto riesame indipendente pendente.

## µ4f — Remediation riesame 5 (µ4e NON ACCETTABILE) — IMPLEMENTATA; riesame pendente

- **S-9 compatibilità M02 v1:** obbligatorie solo le 8 tabelle M02 originarie; M06/M07 opzionali. Test con snapshot M02 reale (rimosse tutte chiavi post-M02) → restore saldo corretto.
- **S-10 decoder semantico esteso:** preflight valida `MandateDefinition` (ceiling/list/date/flag), execution/decision referenziate, cashflow, quantità/date/JSON runtime; corruzione `NaN`/liste invalide/importi non canonici è rifiutata prima RAM/target.
- **S-11 target fence:** `restoreEconomicSnapshot` verifica `game_branches.game_id` prima di staging/delete; test ramo altro game → `snapshot_branch_fence`.
- Chiavi snapshot sconosciute rifiutate; liste devono contenere record.

Verifica: backend **65 file / 496 test** verdi; build OK; `git diff --check` pulito. Sesto riesame pendente.

## µ4g — Remediation riesame 6 (µ4f NON ACCETTABILE) — IMPLEMENTATA; riesame pendente

- **S-12 plafond/execution:** snapshot manda­ti ricostruisce la sequenza: whitelist/fornitore, date canonicali e periodo, amount/prezzo/quantità, ceiling; `spent` deve coincidere esattamente con la somma delle execution. `MandateEngine.assertDate` ora round-trip UTC (rifiuta `1951-02-30`).
- **S-13 M02/runtime decoder:** preflight controlla reservation (range/status), cashflow (amount/outstanding/policy/status), appropriation/debt (incluso denominatore >0), escrow, schedule/project/shipment JSON e range/version/status; nessuna TEXT corrotta entra nel target.
- **S-14 source fence:** capture e restore verificano `game_branches.game_id`; source/target cross-game rifiutati prima di query/delete. Test target cross-game e M02 v1 reale.

Verifica: backend **65 file / 496 test** verdi; build OK; `git diff --check` pulito. Settimo riesame pendente.
