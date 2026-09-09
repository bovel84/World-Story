# M02 — Quantità, ledger, riserve e finanza minima

## Fotografia

- **Pacchetto:** M02, micro-consegna 3 (piano passi 1–3: codec, ledger append-only, prenotazioni).
- **Stato:** µ1–µ3 completate e verificate. Il codec è l'unico punto di conversione stringa↔bigint; ledger e prenotazioni garantiscono chiavi idempotenti, ricostruzione e separazione `total`/`committed`/`available`.

## Audit coperto (µ1–µ3)

| Audit / Test | Asserzione | Esito |
|---|---|---|
| MAT03 (codec) | `IntString` canonico: niente `-0`, zero pilota, decimali, notazione scientifica, cifre unicode, separatori; niente Number/IEEE-754 (anche un number "pulito" è rifiutato; NaN/Infinity con motivo «non finito») | Verde |
| MAT03 (exact) | Somma/confronto esatti oltre la precisione float (2^53+1 e valori a 24 cifre): nessuna perdita | Verde |
| MAT03 (abuse) | Limite anti-abuso: oltre 24 cifre (segno escluso) → `too_long` con messaggio esplicito; id valuta/risorsa solo `[a-z0-9_]` | Verde |
| MAT03 (cross) | Somme di importi eterogenei RIFIUTATE: valute diverse (`cross_unit`) e risorse diverse (`cross_unit` — capacità e quantità non si sommano, §4.1.7) | Verde |
| §4.1.3 (ratei) | Razionali `numerator/denominator` con denominatore > 0; divisione intera ESATTA con resto esplicito (identità `q*den + r = num` sempre, incluso oltre float e con segno; troncamento verso lo zero dichiarato) | Verde |
| MAT04 (§6.2) | Ledger append-only: chiave unica `(branch_id, effect_id, entry_index)`; ripetizione con righe identiche = no-op verificata (0 appese, 2 duplicate), contenuti diversi = `LedgerConflictError` e NESSUN secondo pagamento (saldo invariato) | Verde |
| MAT04 (§6.1) | Ricostruzione: `cassaFinale = cassaIniziale + incassi + prestiti − pagamenti − rimborsi − interessi` torna ESATTAMENTE (−20.500 cent di movimenti, cassaFinale 9.795,00); la somma dei movimenti per valuta è zero (trasferimenti bilanciati) | Verde |
| MAT04 (fisico) | Stock per lotto/risorsa concorda dopo estrazione/consegna/consumo/produzione/perdita (causali distinte, provenienza e destinazione esplicite); risorse diverse NON si sommano; stesso evento = più righe con entryIndex distinti | Verde |
| Validazione | Causali fuori dominio per kind rifiutate (`produzione` su money, `pagamento` su material); `delta <= 0`/non canonico rifiutato; origine = destinazione rifiutata (`self_move`); senza endpoint rifiutato; data non ISO-8601 rifiutata; righe rifiutate non toccano il ledger | Verde |
| Rami/valute | Ricostruzione isolata per branchId (controparti di altri rami invisibili); valute diverse per lo stesso conto restano righe/saldi separati (`test:500`, `usd:300`) | Verde |
| §4.1.2 (valuta) | `Amount` in unità monetarie minime (cent/kopeck), negativi ammessi (debito) ma il segno è politica del chiamante | Verde |
| MAT05 (§7.1) | Due cantieri: da 1.000 TEST e 100 kg (=100.000 g) P1 prenota 600/60kg → `available` 400/40kg; P2 non ottiene gli stessi fondi né acciaio (`insufficient_available`), nessuna riserva P2 è creata | Verde |
| MAT05 (consume) | Dopo 3 giorni: cassa 820, households 180, acciaio 82kg; `committed` 420/42kg, libero ancora 400/40kg. Consume appende ledger + decrementa residuo nella STESSA transazione; retry è no-op (nessuna seconda sottrazione) | Verde |
| MAT05 (atomicità) | Conflitto della chiave ledger durante consume fa rollback dell'operazione: riserva ancora active/100, nessun record di consume parziale | Verde |
| MAT05 (release) | Release parziale/finale libera soltanto il residuo (nessun ledger movement perché prenotare non aveva consumato); retry no-op; over-consume/over-release e movimento non coerente rifiutati | Verde |
| Robustezza ref | Riferimenti opachi contenenti `:` sono preservati: chiave saldo interna come tupla JSON, non più join/split ambiguo | Verde |

## File

- `backend-nest/src/domain/ledger.ts` — **nuovo (µ2), consolidato µ3**: dominio puro del ledger — enum causali chiuse (`MONEY_CAUSES`: incasso/pagamento/prestito_erogato/rimborso/interesse/trasferimento/stanziamento; `MATERIAL_CAUSES`: estrazione/produzione/consegna/partenza/consumo/perdita/scarto/recupero/trasferimento), `LedgerEntryInput`, `validateLedgerEntry` (endpoint obbligatorio almeno uno, `self_move` vietato, delta > 0 canonico, data ISO-8601, causale coerente col kind), `applyLedgerEntry`/`applyLedgerEntries` su `BalanceMap`; chiave interna ora tupla JSON + `parseHoldingKey` (regressione: ref con `:` non viene spezzato).
- `backend-nest/src/repositories/ledger.repository.ts` — **nuovo (µ2)**: persistenza append-only — `appendLedgerEntries` (validazione + transazione canonica; riga esistente identica = no-op, diversa = `LedgerConflictError` con dettaglio esistente vs nuova), `listLedgerEntries`, `reconstructBalances` (saldi per conto/valuta e stock per titolare/risorsa in IntString), `getLedgerEntry`. Nessuna funzione di UPDATE/DELETE.
- `backend-nest/src/services/ReservationService.ts` — **nuovo (µ3)**: `createReservation`/`consumeReservation`/`releaseReservation` e query `getReservationAvailability`; `ReservationRecord` e stato `active/consumed/released`; errori espliciti (`InsufficientAvailabilityError`, conflitto/id/input/stato); total dal ledger, committed come somma bigint dei residui active (mai SUM SQL TEXT); consume richiede ledger entry con stesso holder/kind/unit/delta, appende e riduce nella medesima transazione canonica.
- `backend-nest/src/database.ts` — **migrazioni additive (µ2–µ3)**: `ledger_entries` (kind money/material con CHECK, delta TEXT IntString, at_date ISO) + indice univoco ledger; `reservations` (residuo committed) e `reservation_operations` (UNIQUE branch/reservation/operation per consume/release idempotenti), più indice disponibilità.
- `backend-nest/tests/reservations.test.ts` — **nuovo (µ3)**: 8 test MAT05 (fixture §7.1 P1/P2, retry create e consume, consume/ledger atomico, release, input non coerenti, ref opaco con `:`).
- `backend-nest/tests/ledger.test.ts` — **nuovo (µ2)**: 10 test MAT04 (bilancio §6.1, bilanciamento per valuta, stock fisico con causali, retry no-op, conflitto, validazione, isolamento rami, multi-valuta, append-only).
- `backend-nest/src/domain/quantities.ts` — **nuovo**: codec canonico (§4.1): `IntString`/`isIntString`/`parseInteger`/`intToString` con limite `MAX_QUANTITY_DIGITS = 24`; `addInteger`/`subtractInteger`/`compareInteger` esatti; `Amount` (`amount`/`amountValue`/`addAmounts`/`subtractAmounts`) con rifiuto `cross_unit` fra valute; `Quantity` (`quantity`/`quantityValue`/`addQuantities`/`subtractQuantities`) con rifiuto fra risorse; `Rational` (`rational`, denominatore > 0) e `integerDivide` (quoziente troncato verso lo zero + resto esplicito per il carry); `QuantityCodecError` con codici `not_int`/`too_long`/`bad_id`/`cross_unit`/`bad_denominator`.
- `backend-nest/tests/quantities.test.ts` — **nuovo**: 15 test (canonicità, falsificazione client, anti-abuso, esattezza oltre float, valute/risorse eterogenee, carry e segni).
- `backend-nest/src/scenario/types.ts` — il codec di M01 riusa ESATTAMENTE quello di M02 (re-export da `domain/quantities`): un solo punto di verità per la canonicità.

## Modello dati (ledger e prenotazioni)

- Una riga = UN movimento: `delta > 0` passa da `from_ref` a `to_ref` nella stessa unità (bilanciato per costruzione; il test verifica che la somma dei movimenti per valuta sia zero). `from_ref = null` solo per creazione (estrazione/produzione), `to_ref = null` solo per uscita (consumo/perdita/scarto).
- Il saldo INIZIALE non è nel ledger: proviene dallo stato iniziale del catalogo. La ricostruzione del repository restituisce i movimenti netti; il test dimostra la riconciliazione `cassaIniziale (catalogo) + movimenti (ledger) = cassaFinale`.
- Append-only: nessun percorso di aggiornamento/cancellazione; un retry con righe identiche è no-op verificato, con contenuti diversi è conflitto esplicito.
- Una prenotazione ha `initial_amount` immutabile e `remaining_amount`: solo una riserva `active` contribuisce a `committed`. `available = total (ledger) − committed`; se diventa negativo l'incoerenza resta esplicita (`shortfall`), non viene nascosta da un clamp.
- `consume` richiede il movimento ledger coerente e lo appende + riduce il residuo nella stessa transazione; `release` riduce il solo residuo. Le operazioni hanno `operation_id` unico: stesso payload = no-op, payload diverso = conflitto.

## Comportamento prima

Non esisteva un codec numerico: il validatore di M01 aveva una sua `isIntString` locale senza limite anti-abuso, e nessuna aritmetica esatta era disponibile per ledger/riserve. Qualsiasi somma di quantità sarebbe stata esposta a float o a stringhe non canoniche.

## Contratto API

- `parseInteger(value, label?) → bigint` lancia `QuantityCodecError` con `code` e motivo; `intToString(bigint) → IntString` canonico (`-0n → '0'`).
- `amount(currencyId, minorUnits)` / `quantity(resourceId, baseUnits)`: costruttori validati (stringa per storage, bigint dal dominio interno).
- `addAmounts`/`subtractAmounts`/`addQuantities`/`subtractQuantities`: rifiuto `cross_unit` su valute/risorse diverse.
- `rational(num, den)`: denominatore > 0; `integerDivide(num, den)` → `{ quotient, remainder }` con resto esplicito (carry §4.1.3).
- `createReservation(gameId, branchId, { reservationId, target, amount })`; `getReservationAvailability(branchId, target)` → total/committed/available/shortfall; `consumeReservation(..., { operationId, amount, ledgerEntry })`; `releaseReservation(..., { operationId, amount })`. La release totale passa esplicitamente il `remainingAmount` corrente.

## Algoritmo (punti notevoli)

- Il limite anti-abuso conta le **cifre escludendo il segno** (difetto trovato dal test: la prima versione contava la lunghezza totale e lasciava passare 25 cifre senza segno).
- `integerDivide` usa il troncamento verso lo zero di BigInt, dichiarato nel contratto; il resto è ricalcolato come `num − q*den` (nessuna dipendenza da `%` per il segno) e l'identità è testata su valori oltre float.

## Migrazioni

Additive: `ledger_entries` (µ2), `reservations` e `reservation_operations` (µ3). Nessun tocco a dati reali né backfill inventato.

## Comandi test

```
npm --prefix backend-nest test                       # 39 file; 361/361 verdi (15 µ1 + 10 µ2 + 8 µ3)
npm --prefix backend-nest run build                  # tsc OK
npm --prefix backend-nest run validate:scenario      # ok
```

## Cosa NON è implementato / dipendenze mute

- **µ4 (passo 4):** stanziamento/cassa/debito/escrow separati; cashflow datati e carry dei ratei. In particolare MAT36/§7.2: trasferire cassa in escrow estingue la prenotazione d'acquisto corrispondente (vietato sottrarre la stessa somma sia da cassa sia da riserva).
- **µ5 (passo 5):** estensione dello snapshot/restore F04 PRIMA di collegare i fondi al gameplay; schema legacy sconosciuto testato (MAT19).
- Conversioni fra unità/valute: non implementate per design (nessuna conversione senza quotazione datata e costi, §6.1).

## Decisione revisore

Da definire con revisione indipendente (revisore ≠ implementatore). Nota per il revisore: la somma di movimenti per valuta è zero per costruzione (una riga muove un delta fra due endpoint); la riconciliazione col saldo iniziale di catalogo è dimostrata in test ma il collegamento automatico allo stato iniziale resta ai µ successivi (snapshot F04, µ5). Verificare inoltre la scelta deliberata `consume`=movimento ledger+residuo atomico e il comportamento di eventuale shortfall causato da un movimento esterno successivo alla riserva (esposto, non mascherato; politiche d'insolvenza in µ4).
## µ4 — Finanza separata, escrow, cashflow e ratei

**Completata.** Nuovi `FinanceService` e `finance.repository`: cassa ed escrow restano conti distinti nel ledger; `finance_appropriations` separa massimale autorizzato, impegni, spesa e cassa; `finance_debts` richiede contratto/limite/tasso razionale/scadenza e crea liquidità solo con movimento ledger `prestito_erogato`; ACT/365F conserva il carry `numerator` persistito. `finance_cashflows` ordina per priorità legale, registra pagamento parziale e mantiene l'insoluto come `arrears`/`default`, che blocca nuovi impegni monetari. `finance_escrows` deposita buyer→escrow consumando la riserva nella stessa transazione e rilascia/rimborsa una sola volta.

**MAT36:** fixture deposito 100/0/0 → 60/0/40 con riserva buyer a zero (nessuna doppia sottrazione), release → 60/40/0, refund → 100/0/0; retry idempotenti. `tests/finance.test.ts`: 5 test (stanziamento≠cassa, debt+rateo/carry, escrow release/refund, priorità/arretrato/default). Migrazioni additive: `finance_appropriations`, `finance_debts`, `finance_escrows`, `finance_cashflows`, `finance_operations`.

Verifica µ4: backend **40 file / 366 test** verdi, build e `validate:scenario` OK, `git diff --check` pulito. Frontend non modificato.

## Prossimo

**µ5:** estendere snapshot/restore F04 con ledger, prenotazioni e finanza prima del collegamento al gameplay; test schema legacy sconosciuto (MAT19).

## µ5 — Snapshot/restore economico (MAT19)

**Completata.** `economy-snapshot.repository.ts` cattura colonne esplicite (non `SELECT *`) di ledger, prenotazioni, operazioni e finanza nel payload `economicState: {schema:'open_pax_economy', version:1}`. `GameSession` lo include in checkpoint/save/rewind e, nel restore F04, lo sostituisce atomically nel ramo effettivamente creato dopo il branch replacement. Schema assente/legacy/sconosciuto è un no-op sicuro: non attiva né inventa tesorerie/riserve. Test `economy-snapshot.test.ts`: dopo mutazioni, restore nel ramo figlio torna a cassa 100, committed 40, available 60 e mandato 80/50/0; payload version 99 lascia stato invariato. Verifica: backend **41 file / 367 test**; build/validate/diff OK.

**M02 è implementata µ1–µ5; accettazione resta soggetta a revisione indipendente.** Prossimo pacchetto: M03 preflight puro.
