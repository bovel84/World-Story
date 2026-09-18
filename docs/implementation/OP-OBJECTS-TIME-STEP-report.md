# OP-OBJECTS TIME-STEP — Flusso materiale coerente su salti lunghi

**Branch**: `feat/op-objects-time-step` · **Base**: `main` `567a44d`
**Documento di consegna**: `/tmp/pi-task-op-objects-timestep.md` (§1–53)
**Principio**: *se una risorsa finisce al mese 2, la fabbrica non può continuare come se fosse disponibile fino al mese 12.*
**Regola di architettura**: `advance 180 giorni ≈ 6 × advance 30 giorni` (sistema materiale).

---

## §1. Problema: causa esatta del difetto temporale

`NationStateService.advanceResources(days, …)` faceva **una sola** chiamata al motore:

```ts
const natural = advanceLedger(ledger, account, days);
const overlay = this.materialOverlay(polityId);
const drawn   = drawResourceStockpile(natural.ledger, overlay?.naturalInputs || {});
const tick    = advanceStock(this.resourceStock(polityId), account, days, effective, asOfDate, overlay);
```

e `MaterialEconomy.advanceStock` chiude con `const period = Math.max(0, days) / 30`.
Conseguenza: **un solo passaggio di allocazione**, sullo stato del primo giorno, poi
moltiplicato per l'intero periodo.

Esempio del documento: `weapons 1`, impianto `input 1/mese → output 10/mese`:

| salto | disponibilità vista | fattore | input | output |
|---|---|---|---|---|
| 30 giorni | 1 | 100% | 1 | 10 |
| 360 giorni | **1** | **100%** | **12** | **120** |

Il fattore era calcolato **una volta** (riga dell'allocazione in `OperationalStateStore.allocation()` →
`allocateFacilityProduction({ availability: this.availability(), … })`) e il tempo era una
moltiplicazione: nessuna conservazione materiale.

Lo **stesso** difetto su tre assi:

1. **Risorse naturali**: `advanceLedger(ledger, account, days)` estraeva una volta
   (`period = days/30`), `drawResourceStockpile()` prelevava una volta e la disponibilità dei
   giacimenti veniva poi moltiplicata per il periodo.
2. **Consumi Army/Ship**: `needs` erano costanti nel periodo, così come i tetti di stoccaggio.
3. **ProductionOrder**: `advanceProduction(days)` calcolava `months = days/30 × overflowFactor ×
   materialFactor` con **un** `materialFactor` letto all'inizio del salto.

`splitMaterialPeriod` non esisteva.

---

## §2. Dove l'allocazione veniva calcolata una sola volta

| punto | file | prima |
|---|---|---|
| passaggio di allocazione | `OperationalStateStore.allocation()` | una chiamata per **salto** |
| disponibilità | `OperationalStateStore.availability()` | `silo + extractionRate()` (un mese) |
| flusso | `MaterialEconomy.advanceStock(..., days, ...)` | `period = days/30` |
| estrazione | `ResourceMarket.advanceLedger(ledger, account, days)` | `period = days/30` |
| prelievo silo | `ResourceMarket.drawResourceStockpile()` | una volta |
| ordini | `MilitaryService.advanceProduction(days)` | `months = days/30`, fattore del giorno 1 |

Tutti questi punti restano invariati nella **loro** semantica: continuano a valere per **un solo
periodo**. Ciò che cambia è **chi li chiama**: `advanceResources` ora li chiama **una volta per
periodo materiale**.

---

## §3. Strategia scelta — substep, non moltiplicazione

Opzione scartata: `allocation.totalInputs × period` (vietata dal §6: `ferro 20`, `need 10/mese`,
6 mesi non è `33%` per sei mesi: sono **due mesi al 100% e poi zero**).
Opzione scartata: tick giornalieri o orari (§7).

Scelta: **periodi materiali interni** con `advanceStock()` per **un solo** periodo, in un ciclo
dentro `NationStateService.advanceResources()`, che è il livello proprietario di
`ResourceStock`/`ResourceLedger`/`MaterialFlowOverlay` (§9). Nessuna duplicazione di
`advanceStock()`, nessun secondo motore, nessun cambiamento a Army/Facility/Ship.

---

## §4. Dimensione del periodo

```ts
export const MATERIAL_STEP_DAYS = 30;                       // NationStateService.ts:96
export function splitMaterialPeriod(days, maxStepDays = 30) // NationStateService.ts:126
// 0 → [] · 10 → [10] · 30 → [30] · 31 → [30,1] · 45 → [30,15]
// 90 → [30,30,30] · 95 → [30,30,30,5] · 365 → 13 periodi · 3650 → 122 periodi
```

Funzione **pura**, deterministica, senza dipendenze: `95 → [30, 30, 30, 5]` (§8). Il resto è
sempre in coda, mai un periodo più corto in testa: due salti della stessa durata producono la
stessa successione di periodi.

---

## §5. Ordine del tick (documentato nel codice)

`NationStateService.advancePolityMaterialStep()` (§10) implementa esattamente A–G:

```
A. stato iniziale del periodo        (scorte, silo, cache)
B. estrazione naturale del periodo   advanceLedger(ledger, account, stepDays) → silo
C. disponibilità effettiva           silo già aggiornato (monthlyExtraction: false)
D. allocazione degli impianti   ┐
E. consumi armate / navi        ┘    → MaterialFlowOverlay
F. advanceStock(step)                flow, tetti, carenze, debito, scadenze
G. persistenza                       saveResourceStock + saveResourceLedger
```

`advanceStock()` continua a gestire **un solo** periodo: il difetto non è stato spostato dentro
il motore, è stato tolto dal chiamante.

---

## §6. Risorse naturali — una sola fonte, nessun doppio conteggio

`OperationalStateStore.availability({ monthlyExtraction })` (riga 286):

* default `true` (Dossier/read model): `silo + extractionRate(node, account)` — «quanto posso
  lavorare questo mese»;
* nel tick a periodi: `false`. L'estrazione del periodo è **già** nel silo perché `advanceLedger`
  è stato chiamato al punto B con `stepDays`, quindi sommarla di nuovo sarebbe un doppio
  conteggio (§13).

Conseguenze verificate:

* `step = 15 giorni` → `period = 0,5` in `advanceLedger` → estrazione **1,5** con `endowment 6`
  (3/mese), non 3 (test 35-bis);
* `stock 0`, `extraction 3/mese`, `need 4/mese`, 90 giorni → ferro preso **9** (3 + 3 + 3) e
  armamenti **2,25**; il giacimento statico non è disponibilità (test 35);
* invariante del silo: `silo_iniziale + estrazione − input industriali = silo_finale`
  (test 35: `0 + 9 − 9 = 0`; test 47).

---

## §7. Facility — ricalcolo a ogni periodo

`allocation()` viene richiamata **dentro** ogni periodo (`materialOverlay(polityId,
{ monthlyExtraction: false })`), quindi disponibilità, fattore di stato e quote
proporzionali sono ricalcolati dallo stock corrente. Lo stato resta letto a ogni periodo
(`facilityStatusFactor`: `operational` 1 · `maintenance` 0,5 · `idle`/`under_construction` 0):
**nessun** cambio automatico di status introdotto (§17).

Test 40: `ferro 15`, `need 10/mese`, 90 giorni → fattori **100% → 50% → 0%**, ferro preso
`10 + 5 + 0 = 15`, armamenti `1 + 0,5 + 0 = 1,5`. Con un salto unico di 90 giorni **stessi
numeri**: è l'essenza della correzione.

---

## §8. Army e Ship — consumo proporzionale al tempo

I fabbisogni degli oggetti (`militaryNeeds()`, `navyFuel()`) sono **mensili** e il motore li
moltiplica per il periodo di **quel** periodo, non per il salto:

| caso | atteso | verificato |
|---|---|---|
| armata `fuel 2/mese`, produzione 0, stock 10, 90 giorni | **4** | test 37 |
| nave `0,5/mese`, 180 giorni (stock 3) | consumo **3**, stock **0** | test 38 |
| nave `0,5/mese`, 30 giorni | stock **2,5** | test 38 |
| frazione di mese: `fuel 3/mese`, 15 giorni | **1,5** | test 39 |

Nessuna nave o armata inventata: i fabbisogni vengono dagli oggetti persistenti
(`overlay.militaryNeeds`), il percorso legacy resta per i paesi senza oggetti.

---

## §9. ProductionOrder — lo stesso passaggio di allocazione del periodo

Il difetto qui era doppio, e il secondo pezzo è stato scoperto durante la verifica:

1. `advanceProduction(days)` calcolava il fattore **una volta** (`months × materialFactor`);
2. lo calcolava **dopo** il prelievo materiale del periodo (`store.facilityFactor(order.facilityId)`
   legge la disponibilità **corrente**), quindi l'ordine si sospendeva proprio quando l'impianto
   aveva appena lavorato a pieno regime.

Correzione minima e coerente:

* `MaterialFlowOverlay.facilityFactors?: Record<string, number>` (MaterialEconomy.ts:353) porta
  con sé il **passaggio di allocazione** da cui l'overlay nasce; `OperationalStateStore.materialFlow()`
  lo riempie dai `materialFactor` dell'allocazione (riga 373).
* `NationStateService.advanceResources(..., hooks?: MaterialAdvanceHooks)` espone
  `onPlayerSlice?: (slice) => string[]` (`MaterialSliceInfo`: `polityId`, `stepDays`, `stepDate`,
  `factors`): il gancio gira **dentro** il periodo, subito dopo F, quindi gli ordini vedono gli
  stessi numeri degli impianti.
* `game-session.advanceWorldState()` non duplica più un ciclo proprio: chiama **una volta**
  `nationState.advanceResources(days, accounts, asOfDate, { onPlayerSlice })` — il time-slice
  comune è così **dentro** il servizio che possiede il magazzino, e l'ordine resta
  `risorse → produzione` (§27–28) senza due loop temporali indipendenti.
* `MilitaryService.advanceProduction(days, account, factors?, notices?)` segue la stessa
  granularità (`splitMaterialPeriod`) e usa il fattore dichiarato per il primo periodo; per i
  periodi successivi lo ricalcola sullo stato aggiornato.

Test 41: progresso `1 mese pieno + metà + zero` (fattori 1 / 0,5 / 0), **non** `3 × fattore
iniziale`. Test 41-bis: `180 giorni` in un colpo ≡ `6 × 30 giorni` sul progresso dell'ordine.
Test 42: `expectedDate` diventa `null` a impianto fermo e **torna** valorizzata quando torna il
ferro (§42: la data non viene inventata).

---

## §10. Output che diventano input — semantica dichiarata

Come richiesto (§23–24): l'allocazione di un periodo usa la disponibilità **all'inizio del
periodo**; l'output diventa disponibile **dal periodo successivo**. Nessuna rete produttiva
iterativa nello stesso mese, nessuna dipendenza dall'ordine degli impianti.

Test 36: A produce 2 armamenti senza input, B ne consuma 2 → mese 1 B ha fattore **0** e lo stock
resta 2; mese 2 B ha fattore **1**, consuma 2 e lo stock resta 2.

---

## §11. Carenze e bollettini — aggregati, mai duplicati

* **Mai scorte negative**: la clausola resta quella del motore (`applyFlow` + `capStock`), che
  tronca a zero e registra la carenza.
* **Carenze di periodi intermedi registrate**: `MaterialPeriodReport` (NationStateService.ts:158)
  aggrega per materiale tenendo il **deficit peggiore** e il numero di periodi
  («Carenza materiale — Carburante: deficit fino a 2 in 2 periodi su 3»). Test 39-bis: una sola
  riga, stock finale 0.
* **Un bollettino per salto**: magazzino, tecnologia, debito, estrazione, deperimento e
  «Nel periodo (N periodi): prodotti/consumati/prelevati» sono resi **una volta** alla fine del
  salto (`report.lines()`). Con un periodo solo le righe sono identiche a prima.
* **Produzione**: `ProductionNotices` (`seen` + `state`, MilitaryService.ts:69) è condiviso da
  tutti i periodi dello stesso salto: la sospensione compare **al cambio di stato**, quindi un
  anno fermo è **una** riga. Test 43 verifica entrambi i percorsi (un salto unico e 12 turni
  distinti con lo stesso registro).

---

## §12. Frazione di mese e arrotondamenti

`splitMaterialPeriod(15) = [15]` e ogni grandezza scala con `period = 15/30 = 0,5`
(`advanceLedger`, `advanceStock`, `advanceProduction`). Il `factor` dell'impianto resta il
rapporto fra disponibilità e fabbisogno **mensile**: con `ferro 1,5` su `4/mese` la fabbrica
lavora al `37,5%` per **mezzo** mese → `0,1875` di armamenti (test 35-bis), cioè esattamente la
parte che le tocca.

Arrotondamenti (§46): calcolo in floating, `round3()` solo ai **confini** (silo, scorte
persistite, bollettini, `navyFuel`). Nessun arrotondamento intermedio nel ciclo.

---

## §13. Legacy e strict invariati

* **Legacy** (nessun oggetto persistente): `materialFlow()` restituisce `null`, `industry(kind, legacy)`
  usa la formula di sempre e `overlay` resta `undefined`: il percorso non cambia nemmeno sui
  salti lunghi. Test 45: `advance 90 ≡ 3 × advance 30` con solo conti e impianti **non**
  oggettuali (`materialFlow() === null` verificato).
* **Strict** (`isStrictGame()`): nessun avanzamento materiale, `[]` in uscita, scorte intatte
  (test 46).

---

## §14. Invarianti verificate

Test 47 (365 giorni con armata, nave, impianto, silo):

```
consumo cumulato <= stock disponibile + produzione cumulata + estrazione
stock[kind] >= 0            per food, clothing, weapons, fuel, research, money
silo >= 0  e  silo <= estrazione cumulata + silo iniziale
```

Test 48 (10 anni) e 49 (100 anni): nessun `NaN`/`Infinity`, nessuna scorta negativa.

---

## §15. Performance su 1 / 10 / 100 anni

Misure reali della suite (MacBook di sviluppo, vitest):

| salto | periodi | costo del ciclo materiale |
|---|---|---|
| 365 giorni (test 43) | 13 | 353 ms (test completo) |
| 3650 giorni (test 48) | 122 | **900 ms** |
| 36500 giorni (test 49) | 1217 | **8 910 ms** |

Costo **lineare** (~7,3 ms per periodo) e dominato dal lavoro reale (allocazione, ledger,
`advanceStock`). Nessun ciclo annidato, nessuna memoizzazione necessaria.

---

## §16. Verifica su dati reali (sonda su copia del DB)

Sonda `tests/_probe/timestep-probe.test.ts` (creata, eseguita, **cancellata** prima della PR) su
una copia di `backend-nest/data/open-pax.db`: per ogni partita, sequenza A = sei chiamate da 30
giorni, sequenza B = una chiamata da 180 giorni, **stesso stato di partenza** (stock + ledger
ripristinati fra le due sequenze, stesso conto nazionale, stesse date di periodo).

| partita | polity | data | A vs B |
|---|---|---|---|
| `23fd1fe361ae` (moderna) | GBR | 2026-01-01 | **identici** |
| `246c9cda8b8f` (1815) | DEU | 1816-05-05 | **identici** |

Dettagli della partita moderna: stock finale identico in A e B —
`money 71,474 · food 11,205 · clothing 4,44 · weapons 25,6 · fuel 4,44 · research 35,532` — e
**anche i rollover del debito** cadono alla stessa data (`issuedDate 2026-01-31`) in entrambe le
sequenze, perché la data del periodo è quella che il periodo raggiunge (`addDays(asOfDate,
elapsed − days)`), non l'ultimo giorno del salto. Stessa cosa per la partita 1815
(`money −6,337 · food 2 · clothing 1,5 · weapons 3,964 · fuel 1,958 · research 24,906`; il
`money` negativo è lo scoperto **preesistente** della partita, non un effetto del salto).

Flusso pubblicato dopo il salto (resta **mensile**, §44–45): moderna
`food +5,294 · clothing +6,723 · weapons +5,054 · fuel +7,04` con `army −0,48 / −1,6 / −0,24`;
1815 `weapons −0,006`, `fuel −0,007`.

---

## §17. Test aggiunti — `backend-nest/tests/op-objects-time-step.test.ts` (24)

Mondo di prova dedicato: polity `TSX` (nessun fatto reale), popolazione 200 000,
`militaryPower: 0` imposto dopo la creazione (la `addRegion` scrive `|| 100`), nessun oggetto
armata sulla mappa, `naturalResourcesFor` azzerato: i **soli** consumi militari sono quelli
dichiarati dal test, quindi i numeri attesi sono esatti e non dipendono da una guarnigione
seminata dal motore (guardia esplicita: «non ha reparti propri»).

| # | test | copre |
|---|---|---|
| — | `splitMaterialPeriod` pura (0/10/30/31/45/90/95/365/3650) | §8 |
| — | mondo di prova senza reparti | fixture |
| **32** | `advance 180` ≡ `6 × advance 30` (6 decimali, stock + silo + estrazione cumulata) | equivalenza |
| **33** | ferro 2, need 1/mese, 90 giorni → preso **2**, non 3 | depletion |
| **34** | ferro 10, need 4/mese → max 10, armamenti 2,5 | input naturale |
| **35** | estrazione 3/mese reale: ferro 9, armamenti 2,25, silo 0 | estrazione |
| **35-bis** | periodo parziale: 15 giorni → estrazione 1,5, armamenti 0,1875 | §12–14 |
| **36** | A produce 2, B ne consuma 2: mese 1 no, mese 2 sì | output→input |
| **37** | armata 2/mese, stock 10, 90 giorni → **4** | Army |
| **38** | nave 0,5/mese: 30 giorni → 2,5; 180 giorni → consumo 3 | Ship |
| **39** | mese parziale: 3/mese, 15 giorni → 1,5 | partial |
| **39-bis** | carenza a metà salto: **una** riga aggregata, stock 0 | §20–21 |
| **40** | fattore 100/50/0 e salto unico ≡ tre periodi | Facility |
| **41** | ordine: mese pieno + metà + zero (non 3 × fattore iniziale) | ProductionOrder |
| **41-bis** | ordine: `180` ≡ `6 × 30` sul progresso | §25–26 |
| **42** | ETA `null` a impianto fermo, valorizzata quando riparte | ETA |
| **43** | anno intero: **una** sospensione, **un** bollettino di magazzino | bollettini |
| **44** | flusso API mensile dopo un anno (e non il totale del salto) | §44–45 |
| **45** | percorso legacy identico sui salti lunghi (`materialFlow() === null`) | legacy |
| **46** | strict: nessun avanzamento | strict |
| **47** | invarianti: scorte ≥ 0, silo nei limiti | §51 |
| **48** | 10 anni: niente NaN, costo misurato | long-game |
| **49** | 100 anni: niente NaN, costo misurato (1217 periodi) | long-game |

Nessuna sonda o file temporaneo lasciato nel repository (`tests/_probe/` e `tests/_dbg/`
cancellati prima della PR).

---

## §18. Quality gate (eseguito, verde)

| gate | comando | esito |
|---|---|---|
| backend tipi | `npx tsc --noEmit` | ✅ |
| backend test | `npm test` | ✅ **156 file / 1470 test** (erano 155 / 1446) |
| backend build | `npm run build` | ✅ |
| frontend tipi | `npx tsc --noEmit` | ✅ |
| frontend test | `npx vitest run` | ✅ **67 file / 488 test** |
| frontend build | `npm run build` | ✅ |
| e2e mock | `npm run test:e2e:mock` | ✅ **45/45** |

Nessun file frontend modificato: la correzione è interamente nel sistema materiale, e i contratti
delle API (`/resources`, `/arsenal`) sono **invariati** (`facilityFactors` è un campo opzionale
dell'overlay interno, non del payload).

---

## §18-bis. Verifica live dopo il deploy

Deploy: `bash scripts/deploy-cloudflare.sh` (il backend locale risale dopo il solito errore di
attesa 150 s, poi `--skip-backend` per frontend + Worker + KV). Worker Version ID
**`16c51d96-2dde-47c4-8ae3-adf8b66286dc`**.

`GET /api/health` sul Worker (`https://world-story.bovel-cannas.workers.dev`):

```json
{"status":"ok","build":{"backend":"dev","frontend":"22c561c"},
 "schema":{"database":{"tables":52}},"auth":"open-single-user"}
```

`frontend: 22c561c` è il commit di questo pacchetto (squash della PR #72) ✓.

**Percorso di lettura invariato** (nessuna regressione, il flusso resta **mensile**). Partita
`23fd1fe361ae`, valori identici a quelli registrati in OP-OBJECTS FLOW §18-bis:

| grandezza | valore live |
|---|---|
| `needs` | `{food 1.867 · clothing 0.555 · weapons 1.6 · fuel 0.74}` |
| `capacity` | `{food 11.205 · clothing 4.44 · weapons 25.6 · fuel 4.44}` |
| `flow` armamenti | `facilities +6.354 · army −1.6 · natural +0.3 → total +5.054` |
| `flow` carburante | `facilities +3.93 · army −0.24 · natural +3.85 → total +7.04` |
| `balance` | `balancePerMonth` = `flow.total` per ogni materiale |
| `/arsenal` | `GBR-garrison` Carburante **0,24** · Armamenti **1,6** · Cibo **0,48**; `factory-GBR-10` Ritmo **100%**, Ferro/Carbone **0,016**, output Vestiario **0,7** · Armamenti **0,5** · Carburante **0,4** |

**Salto lungo via HTTP**: `POST /api/games/23fd1fe361ae/time-skip {jump_days: 180, mode: fixed}`
risponde `424 {"error":"openai-compatible: HTTP 401 — Unauthorized"}`: è il **blocco noto del
provider LLM** (`LLM_API_KEY` assente in `backend-nest/.env`), non un effetto di questo pacchetto —
la stessa chiamata falliva prima. Verificato che **la partita non è stata mutata** (stock
identico: `money 73,91 · fuel 3,907 · weapons 3`).

La verifica del **salto lungo su dati reali** è quindi affidata a due prove eseguite davvero:

1. la **sonda su copia del DB reale** (§16): `advance 180` ≡ `6 × advance 30`, identici fino
   all'ultima cifra, su `23fd1fe361ae` (GBR) e `246c9cda8b8f` (DEU 1815);
2. la suite `tests/op-objects-time-step.test.ts` (24 test), che riproduce la stessa sequenza su
   uno stato controllato e verifica anche i bollettini aggregati di un salto annuale.

---

## §19. Nota CORE ENGINE FREEZE

Sono stati toccati file dell'**engine congelato** (`core/simulation/**`, `GameSession`,
pipeline di avanzamento del turno), come già autorizzato e documentato nei precedenti pacchetti
OP-OBJECTS:

* il difetto **sta** in `NationStateService`/`MaterialEconomy`/`MilitaryService`: nessuna
  correzione possibile nella sola presentazione;
* il documento di consegna **prescrive** esplicitamente questo punto (§9: «probabilmente
  `NationStateService.advanceResources()`», §10 estrarre la privata, §25–26 la stessa granularità
  per gli ordini, §27–28 il time-slice comune);
* **nessuna** modifica a schema/DB, `repositories`, `TurnOrchestrator`, `TurnPipelineService`,
  `SessionStateStore`, checkpoint, simulation runs, playback, crisi, branching, rewind,
  `FactionMemory`, NPC;
* refactor **minimo**: nessuna firma pubblica di `advanceStock`, nessun secondo motore, nessuna
  riscrittura di OP-OBJECTS o di `MaterialEconomy`.

---

## §20. Limiti residui (dichiarati, non nascosti)

1. **Modificatori nazionali**: il decadimento resta **una volta per avanzamento**, come prima, e
   non una volta per periodo materiale. È una scelta di **bilancio** (fuori dal flusso
   materiale, §29): `advance 180` e `6 × advance 30` possono quindi differire nei modificatori
   **persistiti**, mai nei conti materiali (il conto passato a `advanceStock` è lo stesso
   snapshot per tutti i periodi, e il test 32 lo verifica).
2. **Salto di tempo puro** (`POST /games/:id/time-skip`, percorso playback): avanza il materiale
   ma **non** gli ordini di produzione, come prima di questo pacchetto. Non è una regressione, ma
   resta un'asimmetria con il tick del turno (che ora avanza gli ordini periodo per periodo).
3. **Estrazione e tetti**: il tetto del silo cresce con il **giacimento** (`endowment × 0,5 × 6`,
   minimo 10) e non con la riserva: un silo molto pieno può essere ridotto al tetto dal primo
   `advanceLedger` di un salto (comportamento preesistente del motore, non introdotto qui).
4. **Fattore di allocazione del mese parziale**: la disponibilità è confrontata col fabbisogno
   **mensile** e l'output è poi scalato per il tempo: un periodo di 15 giorni con materiale
   abbondante produce metà del mese, non il 100%. È il comportamento coerente con la semantica
   dei coefficienti (per mese) e non una perdita di materiale (il prelievo segue lo stesso
   fattore).
5. **Ordine di lavorazione**: gli impianti non differenziano per tipo (la somma resta la quota
   del motore) — limite già dichiarato in OP-OBJECTS FLOW §20, non toccato qui.
6. **NPC**: senza oggetti persistenti restano sul percorso legacy, quindi il tick a periodi non
   li riguarda.
7. **`advanceProduction` isolata**: se chiamata con un salto lungo e **senza** il registro
   condiviso, apre un registro proprio per la chiamata (comportamento di prima: messaggi
   deduplicati all'interno della chiamata). Il percorso di gioco condivide sempre il registro.

---

## §21. File e punti di innesto

| file | modifica |
|---|---|
| `src/game/NationStateService.ts` | `MATERIAL_STEP_DAYS` (96), `MaterialSliceInfo`/`MaterialAdvanceHooks` (99/113), `splitMaterialPeriod` (126), `MaterialPeriodReport` (158), `advanceResources` a periodi + gancio (275), `advancePolityMaterialStep` A–G (334), `materialOverlay(options)` (374) |
| `src/game/OperationalStateStore.ts` | `availability(options)` (286), `allocation(options)` (318), `materialFlow(options)` + `facilityFactors` (364/373) |
| `src/game/MilitaryService.ts` | `ProductionNotices`/`createProductionNotices` (69/75), `facilityMaterialFactor(order, factors)` (1043), `advanceProduction(days, account, factors, notices)` a periodi (1084) |
| `src/game-session.ts` | `advanceWorldState` → una sola chiamata con `onPlayerSlice` (616); `materialOverlay(options)` dal contesto |
| `src/core/simulation/MaterialEconomy.ts` | `MaterialFlowOverlay.facilityFactors?` (353) |
| `tests/op-objects-time-step.test.ts` | **nuovo**, 24 test |

---

## §22. Come si legge la differenza (prima → dopo)

| | prima | dopo |
|---|---|---|
| disponibilità su 180 giorni | quella del giorno 1 | ricalcolata 6 volte |
| fattore impianto | 100% per sei mesi | 100% → 50% → 0% (esempio test 40) |
| estrazione naturale | estratta una volta, poi × 6 | estrazione di ogni periodo, subito nel silo |
| armata 2/mese su 90 giorni | consumo moltiplicato per il salto | 6 esatti su 6 periodi |
| ordine militare | `fattore iniziale × 6 mesi` | fattore del periodo che vive |
| bollettini di un anno | 13 righe identiche | **una** per tipo, con i totali del periodo |
| `advance 180` vs `6 × advance 30` | diversi | **identici** (test 32 + sonda su dati reali) |
