# OP-OBJECTS FLOW — gli oggetti reali dentro il tick materiale

Macro-task 26. Stato: implementato, testato, verificato su dati reali (copia del DB).
Spec: `/tmp/pi-task-op-objects-flow.md` (punti 1–53).

Principio che governa tutto il pacchetto:

```
se la scheda dice «consuma 2 carburante/mese»
→ dopo un mese quel carburante è davvero sparito dal magazzino

se la scheda dice «produzione ridotta al 50% per carenza di ferro»
→ il magazzino nazionale riceve davvero solo il 50% dell'output
```

---

## 1. Problema — quattro difetti concreti, una causa sola

**P1. La catena materiale ignorava gli oggetti.**
`advanceStock` calcolava produzione e consumi dalla formula nazionale
(`factories × coeff`, `ports × coeff`, `universities × coeff`, `account.forces`).
Gli impianti, le armate e le navi persistiti (OP-OBJECTS PERSISTENT) erano visibili
nelle schede ma **non entravano nel tick**: una scheda poteva dichiarare «Ritmo 50%
per carenza di ferro» mentre il magazzino riceveva la produzione piena.

**P2. Un'armata di 96.000 uomini consumava zero.**
Prova su dati reali (partita moderna `23fd1fe361ae`, copia del DB):

```json
{ "id": "GBR-garrison", "formations": 8, "personnel": 96000,
  "monthlyNeeds": { "fuel": 0, "weapons": 0, "food": 0 } }
```

Il fabbisogno dell'oggetto era **azzerato** (le armate create dal seed non lo
derivavano): il tick sottraeva cibo, armamenti e carburante solo tramite
`account.forces`… che per il percorso a oggetti non è più la fonte.

**P3. La produzione degli impianti si sommava alla vecchia formula (doppio conteggio).**
Le ricette persistite contenevano termini che non appartengono a un impianto:
l'agricoltura del giacimento e la **cassa** fra gli input. Prova (stessa partita,
prima del riallineamento):

```json
"production": { "food": 55.498, "clothing": 3.202, "weapons": 7.156, "fuel": 46.38 },
"consumption": { "weapons": 1.4, "fuel": 1.4, "money": 0.14 },
"militaryNeeds": { "food": 0, "clothing": 0, "weapons": 0, "fuel": 0 }
```

Cibo «prodotto dagli impianti» = produzione agricola contata due volte (una
nell'impianto, una nel motore); `money` sottratto come input produttivo quando il
costo è già nei conti nazionali.

**P4. Due impianti potevano consumare la stessa scorta.**
Ogni impianto verificava i propri input contro la scorta nazionale **per conto
suo**: con 20 di ferro e due acciaierie da 20, entrambe risultavano al 100%.

**Causa comune.** Non esisteva un **passaggio di allocazione**: il motore
applicava numeri aggregati, gli oggetti calcolavano i propri numeri per la UI, e
nessuno dei due conosceva l'altro. Due contabilità parallele sullo stesso stato.

---

## 2. Regola di architettura — una sola contabilità

```
OGGETTI REALI  →  (produzione, consumi, fabbisogni)  →  OVERLAY  →  MOTORE  →  STOCK
```

- **OP-OBJECTS fornisce numeri** (produzione già allocata, consumi, fabbisogno
  militare, materiali presi dai giacimenti). Non scrive mai una scorta.
- **Il motore applica** flow, tetti di stoccaggio, carenze, debito e interessi:
  `advanceStock` resta l'unico punto che modifica il magazzino.
- Nessun secondo motore economico, nessuna seconda fonte di verità: le schede
  leggono **lo stesso** pass di allocazione del tick (`allocation`), non una
  copia ricalcolata.

Se l'overlay è `null` (nessun oggetto: partita legacy) il percorso è quello di
sempre, **identico** (test 45).

---

## 3. Separazione dei consumi civili e militari

In `core/simulation/MaterialEconomy.ts` il fabbisogno è ora scomposto; la somma
resta l'aritmetica di prima:

```ts
civilMaterialNeeds(account)      // popolazione + impianti: food, clothing, fuel
legacyMilitaryNeeds(account)     // reparti dell'account: food, clothing, weapons(≥0,2), fuel
materialNeeds(account) = civile + legacy          // identico a prima (nessuna regressione)
effectiveMaterialNeeds(account, overlay) = civile + overlay.militaryNeeds ?? legacy
```

Così esiste **una sola** voce militare per volta:

| contesto | fabbisogno militare | fonte |
|---|---|---|
| nessun oggetto (legacy) | `legacyMilitaryNeeds` | `account.forces + mobilized` |
| oggetti presenti | `overlay.militaryNeeds` | somma delle armate + navi |
| paesi NPC | `legacyMilitaryNeeds` | il paese giocatore è l'unico con oggetti |

Mai sommati insieme: è la regola che elimina il doppio conteggio dei consumi.

---

## 4. L'overlay — forma e perché

```ts
interface MaterialFlowOverlay {
  production: Partial<Record<ResourceKind, number>>;   // output degli impianti, già allocati
  consumption: Partial<Record<ResourceKind, number>>;  // input effettivamente presi
  militaryNeeds?: MaterialNeeds;                       // armate + navi
  naturalInputs?: Partial<Record<NaturalResourceKind, number>>; // presi dal silo estrattivo
  navyFuel?: number;                                   // dettaglio del flusso, non un secondo consumo
}
```

Perché **due mappe di produzione/consumo** invece di un flusso già netto:

- il motore deve poter distinguere «quanto produce un impianto» da «quanto
  consuma la nazione»: servono il tetto di stoccaggio, le carenze e il dettaglio
  `{ civilian, facilities, army, navy, natural, total }`;
- il netto è calcolabile da chiunque (`production − consumption`), il contrario
  no;
- `navyFuel` è **solo il dettaglio**: il consumo navale è già dentro
  `militaryNeeds.fuel`, e sottrarlo due volte sarebbe un doppio conteggio
  (verificato dal test 47).

---

## 5. Consumi delle armate — una sola fonte

```ts
armyFuel    = Σ army.monthlyNeeds.fuel
armyWeapons = Σ army.monthlyNeeds.weapons     // nessun `navyWeapons` inventato
armyFood    = Σ army.monthlyNeeds.food
```

`OperationalStateStore.militaryNeeds()` somma **solo** i campi dichiarati dagli
oggetti. Due difetti corretti perché la somma fosse vera:

1. **Riparazione dei fabbisogni a zero** (`syncArmies`): se un'armata ha reparti
   o uomini ma `monthlyNeeds` è assente o tutto a zero, il fabbisogno si riprende
   dal motore (`monthlyNeedsPerFormation`, cioè `materialNeeds` su un conto con un
   solo reparto). Nessun numero inventato, nessun reparto che «non consuma».
   La riparazione avviene anche per le armate di guarnigione (i reparti derivati
   da `account.forces`).
2. **Fallback legacy sempre funzionante**: se lo store non c'è, o se non ci sono
   oggetti, resta `legacyMilitaryNeeds(account)` (test 45: tick bit-identico).

`MilitaryService` legge lo **stesso** fabbisogno efficace per prontezza e
autonomia (`effectiveNeeds`): una sola contabilità anche in lettura.

---

## 6. Consumi delle navi — stato + equipaggio collegati al tick

```ts
navyFuel = Σ ship.monthlyFuel × shipConsumptionFactor(ship.status)
// operational → 1  ·  maintenance/damaged → 0,5  ·  under_construction → 0
```

`shipConsumptionFactor` è **centralizzato** in `OperationalState.ts` e usato dal
tick, dalla scheda e dall'aggregato. Una nave in costruzione non consuma; una in
manutenzione consuma metà. Nessun costo monetario nuovo inventato: gli scafi e il
carburante sono già oggetti (e i costi monetari restano nei conti nazionali).

---

## 7. Produzione degli impianti e allocazione proporzionale

`allocateFacilityProduction({ facilities, availability, activity })` — funzione
**pura**, non muta nulla, in `core/simulation/OperationalState.ts`:

```
1. required[id] = Σ (ricetta.inputs[id] × statusFactor × activity)   ← domanda
2. share[id]    = min(1, availability[id] / required[id])            ← quota disponibile
3. ratio        = min(share[id]) sugli input dell'impianto           ← collo di bottiglia
4. factor       = statusFactor × activity × ratio
5. inputs presi = floor(required × ratio)   (la somma non supera mai la disponibilità)
   outputs      = ricetta.outputs × factor
```

**Policy: proporzionale.** Con due acciaierie da 20 su 20 di ferro la quota è
50% + 50%, non first-come-first-served: stabile e indipendente dall'ordine di
lettura (test 38/39). Mai ordine casuale.

- **Stato impianto** (`facilityStatusFactor`): `operational → 1`,
  `maintenance → 0,5`, `idle` / `under_construction → 0`. Il tick aggregato **non
  produce** per un impianto fermo.
- **`materialFactor`** = `statusFactor × ratio` (senza il fattore di capacità
  nazionale): è il numero che moltiplica il tempo degli ordini, così il fattore
  di saturazione delle linee non viene applicato due volte (punto 28).
- **Bottleneck reale**: `{ id, required, assigned, coveragePct }` — «Ferro
  richiesto 20 · assegnato 10 · copertura 50%».
- Materiale **non dichiarato** dal chiamante = `Infinity` (non razionato):
  bloccare la produzione su un materiale di cui il motore non ha una filiera
  sarebbe inventare un vincolo.

---

## 8. Giacimenti ≠ stock infinito

La filiera prende i minerali dal **silo dell'estrazione**, non dal giacimento:

```ts
availability[naturale] = ledger.stockpile + extractionRate(node, account)   // mese
drawResourceStockpile(ledger, overlay.naturalInputs)                        // prelievo reale
```

`drawResourceStockpile` (nuova, pura, in `ResourceMarket.ts`) scala dal silo
quanto la filiera ha davvero preso: se il silo è vuoto non si produce nulla in
più. I materiali presi dai giacimenti (`naturalInputs`) sono tolti dal silo in
`advanceResources`, gli altri dalla scorta. Nessun `endowment = 8 → posso
consumare 8 ogni mese per sempre`.

---

## 9. Nessun doppio conteggio con la vecchia formula

In `advanceStock`, con overlay presente la quota **industriale** della formula
storica viene **sostituita**, non sommata:

```ts
const industry = (kind, legacy) => overlay ? overlay.production[kind] ?? 0 : legacy;

clothing: industry('clothing', factories*0.7*bonus) + popM*0.004*bonus − objectDraw − needs
weapons : industry('weapons',  factories*0.5*bonus + universities*0.2)
          + iron*0.12*bonus + coal*0.06*bonus − objectDraw − needs
fuel    : industry('fuel',     ports*1.1 + factories*0.4) + oil*0.7 + gas*0.35 − objectDraw − needs
research: industry('research', universities*0.35) + popM*0.002
```

Restano del motore (non rappresentati da un impianto): agricoltura, giacimenti,
popolazione. La `Facility` sostituisce **solo la quota che rappresenta**.

E la produzione lorda di un impianto è quella giusta:

```ts
marginalPlant(plant, endowment, technologies) → { flow, needs, gross }
// gross = saldo del motore + soli consumi civili/industriali dell'impianto
```

`gross` non include il pavimento militare di 0,2 armamenti (è consumo
dell'esercito, non produzione dell'impianto): è la voce che alimenta
`engineFacilityRecipe`, quindi la somma degli impianti è **esattamente** la quota
`factories/ports/universities` che sostituisce. `marginalProduction` resta
invariata (somma `flow + needs`).

**Riallineamento delle ricette salvate** (`facilityRecipeDrifted`): una ricetta
persistita con materiali diversi da quelli del motore (cassa, termini agricoli,
schema vecchio) viene rifatta al primo `snapshot()`. Corregge i dati già scritti
senza migrazione.

---

## 10. Il denaro non è un input produttivo

Nessuna ricetta del motore dichiara più `money`. La cassa è un **costo**, non un
collo di bottiglia: resta nei conti nazionali (`monthlyBalance`), non spegne gli
impianti. Le ricette legacy con la cassa si riallineano da sole (§9).

---

## 11. Ordini di produzione → fattore materiale reale

```ts
effectiveFactor = industrialCapacityFactor × facilityMaterialFactor
```

- `advanceProduction` moltiplica già i mesi per il fattore di saturazione
  nazionale (`capacity.overflowFactor`) e poi per il **fattore materiale**
  dell'impianto: nessun doppio effetto.
- **fattore 0** (impianto `idle`, o senza input) → l'ordine **non avanza di un
  punto**, bollettino «lavorazione sospesa», `expectedDate = null` (test 44).
- **fattore ridotto** → l'ordine avanza più lentamente e l'ETA si **aggiorna**
  (`withOrderEta` × fattore): una data aggiornata invece di una data finta.

---

## 12. Le schede mostrano la stessa simulazione del tick

`MilitaryService.getOperatingPicture()` passa l'oggetto `allocation` **del tick**
a `persistentObjects(...)`: la scheda dell'impianto legge `factor`,
`inputs`/`outputs` e `bottleneck` da quel pass — nessun ricalcolo per la UI
(invariante testato: «la scheda dell'impianto usa lo stesso fattore del tick»).

`aggregateObjects` e `persistentObjects` accettano `allocation?`: quando c'è,
schede e tick non possono divergere.

---

## 13. Il flusso nazionale leggibile

`game/materialBalance.ts`:

```ts
materialFlowBreakdown(stock, account, endowment, days, overlay): MaterialFlowRow[]
// { kind, label, civilian, facilities, army, navy, natural, total }
```

- `total` = saldo del motore; `natural` = ciò che resta togliendo oggetti e
  consumi (aritmetica, nulla di inventato).
- Esposto da `GET /games/:id/resources` come `flow` (accanto a `balance`, che ora
  usa il fabbisogno efficace) e stampato nel bollettino del turno:
  `⚙️ Bilancio materiale degli oggetti — Carburante −2/mese (impianti +0, naturale +0, civile +0, esercito −2, marina +0); …`
- Nessuna nuova schermata: la scheda Risorse esistente legge già i numeri del
  motore (`resources.balance`). La priorità era il motore.

---

## 14. Transazioni SQLite (punto 48, correzione mirata)

Nuova `operationalObjectRepository.replaceKind(gameId, kind, rows)`: upsert degli
oggetti presenti + rimozione di quelli scomparsi in **una sola transazione**
(`db.transaction`). Gli store `saveFacilities` / `saveShips` / `saveFleets` /
`saveConstructions` passano tutti di lì (`persist`): o seed, o transazione
d'azione — mai uno stato a metà. Nessun ampliamento del refactor DB.

---

## 15. Comportamento legacy

- **Nessun oggetto** → `materialFlow()` restituisce `null` → `advanceStock`
  prende il ramo storico: stessi numeri di prima, byte per byte (test 45:
  `withObjects.flow ≈ legacy.flow` con lo stesso fabbisogno militare).
- **Nessun impianto, ma armate/navi** → overlay con sola parte militare: il
  fabbisogno militare arriva dagli oggetti, l'industria resta la formula del
  motore (nessuna produzione fantasma).
- **Partite storiche (1815)**: i consumi sono quelli degli oggetti realmente
  presenti, nessun carburante navale moderno o munizionamento inventato (test 46).
- **Paesi NPC**: percorso legacy, l'overlay vale solo per il paese giocatore.

---

## 16. Test aggiunti — `backend-nest/tests/op-objects-flow.test.ts` (17 test)

| # | Test | Cosa dimostra |
|---|---|---|
| 38 | due impianti, 20 di ferro, bisogno 40 | `totalInputs.iron ≤ 20`, mai 40 |
| 39 | due impianti, ferro abbondante | entrambi al 100% |
| — | materiale non dichiarato | importato, non collo di bottiglia |
| 40 | armata con 2 di carburante | il tick sottrae **esattamente** il fabbisogno dichiarato |
| 41 | due navi 0,4 + 0,6 | fabbisogno 1,0, tolto una sola volta |
| 25 | nave in manutenzione / in costruzione | 0,5 / 0 fattori di consumo |
| 42 | input 100% / 50% / 0 | output 3 / 1,5 / 0 nel magazzino |
| 43 | impianti + vecchia formula | la quota `factories × coeff` **non** si somma |
| 44 | ordine su impianto `idle` | progresso invariato, ETA `null`, bollettino «sospesa» |
| 45 | nessun oggetto | tick identico a prima |
| 46 | nessuna nave | `navyFuel = 0`, nessun munizionamento navale inventato |
| 47 | conservazione | `stock = min(tetto, max(0, iniziale + flusso))`, ricerca senza tetto |
| — | armata con fabbisogni azzerati | li riprende dal motore (`monthlyNeedsPerFormation`) |
| — | ricetta salvata con la cassa | si riallinea a quella del motore |
| inv. | allocazione ≤ disponibilità | nessun materiale creato dal nulla |
| inv. | scheda = tick | stesso fattore |
| inv. | `flow` coerente | `production`/`militaryNeeds` uguali all'allocazione |

---

## 17. Quality gate (eseguito, verde)

| Gate | Comando | Esito |
|---|---|---|
| Backend tipi | `npx tsc --noEmit` | ✅ pulito |
| Backend test | `npm test` | ✅ **155 file / 1446 test** (era 154 / 1429) |
| Backend build | `npm run build` | ✅ |
| Frontend tipi | `npx tsc --noEmit` | ✅ pulito |
| Frontend test | `npx vitest run` | ✅ **67 file / 488 test** (invariati) |
| Frontend build | `npm run build` | ✅ |
| E2E mock | `npm run test:e2e:mock` | ✅ **45/45** |

**Nessun componente frontend modificato** (punto 50: se ne toccavano molti,
fermarsi). Il Dossier leggeva già `resources.balance`/`needs` dal motore, che ora
riflettono il fabbisogno efficace: la UI cambia comportamento senza cambiare
codice.

Nota di onestà: in 5 esecuzioni complete della suite è stata osservata **una**
volta una failure intermittente in `tests/industrial-capacity-service.test.ts`
(«senza saturazione l'industria non frena la produzione»), **non riproducibile**
in 9 esecuzioni isolate dello stesso file (9/9 verdi) né nelle 4 esecuzioni
complete successive. Nel mondo di quel test non esistono nodi di ferro/carbone nel
ledger (verificato: `availability` contiene solo `fertile_land`/`water`), quindi il
fattore materiale vale 1 e l'ordine avanza: la causa non è il flusso degli
oggetti. È dichiarata qui perché non va nascosta.

---

## 18. Verifica su dati reali (copia del DB, nessuna modifica all'originale)

`data/open-pax.db` → copia `/tmp/ws-flow-probe.db`; probe temporaneo rimosso
prima della PR.

### Partita storica `246c9cda8b8f` (1815, DEU)

| | PRIMA | DOPO |
|---|---|---|
| fabbisogno militare del tick | da `account.forces` (4 reparti) | dalle armate reali: cibo 0,18 · armamenti 0,6 · carburante 0,09 |
| produzione impianti | ignorata dal tick | `clothing 0,233 · weapons 0,234 · fuel 0,133 · research 0,117` a fattore 0,33 |
| minerali | nessun prelievo | `iron 0,010 · coal 0,007` dal silo estrattivo |
| bilancio Armamenti | `prod 0,594 cons 0,6 saldo −0,006` | invariato nella forma, ora con oggetti dentro |

### Partita moderna `23fd1fe361ae` (GBR)

| | PRIMA | DOPO |
|---|---|---|
| `army monthlyNeeds` | `{0, 0, 0}` (oggetto a 8 reparti, 96.000 uomini) | `food 0,48 · weapons 1,6 · fuel 0,24` (dal motore) |
| `militaryNeeds` del tick | tutti zero | `food 0,48 · weapons 1,6 · fuel 0,24` |
| `production` degli impianti | `food 55,5 · clothing 3,2 · weapons 7,156 · fuel 46,38` (agricoltura + cassa) | `clothing 7 · weapons 6,4 · fuel 4 · research 2,45` |
| `consumption` | `weapons 1,4 · fuel 1,4 · money 0,14` | `weapons 0,046 · fuel 0,07` (solo input reali) |
| colli di bottiglia | ferro 0,19/2 su 17 impianti (ricetta vecchia) | nessuno: fattore 1,00 su 17 impianti |
| saldo del mese | — | Cibo +3,44 · Vestiario +6,72 · Armamenti +5,05 · Carburante +7,04 |

Il cibo «prodotto dagli impianti» è sparito (era agricoltura contata due volte) e
l'esercito consuma davvero: i due difetti che la verifica su dati reali ha
scoperto e che i test non potevano vedere.

### 18-bis. Verifica live sul Worker (deploy `55fcd13`)

Worker Version ID `25d31e2c-034a-4632-9402-a966bbe5f06e`, tunel
`https://ind-strikes-meant-adaptive.trycloudflare.com`, `GET /api/health` →
`{status:'ok', build:{backend:'dev', frontend:'55fcd13'}, schema:{database:{tables:52}}}`.

**`GET /api/games/23fd1fe361ae/resources` (moderno)** — il tick e le schede
raccontano la stessa storia:

```json
"needs": { "food": 1.867, "clothing": 0.555, "weapons": 1.6, "fuel": 0.74 },
"flow": [
  { "kind": "weapons", "facilities": 6.354, "army": -1.6, "natural": 0.3, "total": 5.054 },
  { "kind": "fuel",    "facilities": 3.93,  "army": -0.24, "natural": 3.85, "total": 7.04 }
]
```

`productionPerMonth − consumptionPerMonth = balancePerMonth` in ogni riga di
`balance` (armamenti 6,654 − 1,6 = 5,054 ✓).

**`GET /api/games/23fd1fe361ae/arsenal`** — scheda dell'armata di guarnigione:

```
Reparti 8 · Uomini 96000 · Carburante 0,24 · Armamenti 1,6 · Cibo 0,48
```

Sono **gli stessi** numeri della colonna `army` del flusso e del campo `needs`:
la scheda non ricalcola nulla. Impianti a `Ritmo di lavoro 100`,
`Ferro 0,032`/`Carbone 0,024` in ingresso e `Vestiario 0,7 · Armamenti 0,5 ·
Carburante 0,4` in uscita: la somma dei 10 impianti di quel tipo è esattamente
la produzione pubblicata dal tick.

**`GET /api/games/246c9cda8b8f/arsenal` (1815)** — la prova storica:

```
army-DEU-garrison: Reparti 3 · Carburante 0,09 · Armamenti 0,6 · Cibo 0,18
factory-DEU-1:     Ritmo di lavoro 33,3 · Vestiario 0,233 · Armamenti 0,167 · Carburante 0,133
research_center:   Ritmo di lavoro 33,3 · Punti ricerca 0,117
mine-DEU-coal:     Giacimento 4 · Armamenti (a pieno regime) 0,24
```

Il fabbisogno dell'armata (armamenti 0,6) **non** è quello dei reparti generici
(0,2): viene dall'oggetto reale, come il tick.

---

## 19. FREEZE — cosa non è stato toccato

- Nessun cambiamento a schema/database, migrazioni, `GameSession` come classe di
  stato, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`,
  `repositories` (tranne la nuova `replaceKind` nel repository **degli oggetti**,
  già introdotto da OP-OBJECTS PERSISTENT), checkpoint, `useSimulationPlayback`.
- `advanceStock` **non** è diventato il posto in cui si decide cosa produce un
  impianto: riceve un overlay e applica. La decisione vive negli oggetti.
- Nessuna scrittura di scorte da OP-OBJECTS: `OperationalStateStore` non tocca
  `ResourceStock`.
- `preset.json` (dati dei preset) non toccato.
- Il percorso legacy resta il default quando gli oggetti non ci sono.

---

## 20. Limiti dichiarati

1. **Miniere e contributo estrattivo**: le miniere non ricalcolano il contributo
   della filiera (restano la scheda informativa di OP-OBJECTS PERSISTENT). Nel
   tick i minerali entrano dal silo dell'estrazione + bonus del giacimento, non
   «per miniera».
2. **Materiali non dichiarati**: un input che il chiamante non dichiara è
   `Infinity` (importato dal mercato, che vive altrove). Documentato, non un
   vincolo silenzioso.
3. **Ricette per tecnologia**: una ricetta si riallinea quando le tecnologie
   cambiano **o** quando lo schema del motore cambia (`facilityRecipeDrifted`);
   fra due cambi non c'è ricalcolo (scelta: nessun ricalcolo a ogni lettura).
4. **Tetti di stoccaggio**: il tetto dipende dal fabbisogno efficace. Con
   fabbisogni bassi può tagliare la produzione in eccesso (deperimento
   dichiarato): è il motore, non un difetto del flusso.
5. **NPC**: nessun oggetto per i paesi non giocatori: restano sul percorso
   legacy (dichiarato).
6. **Output a fattore ridotto**: la produzione a fattore < 1 è **minore**
   dell'aggregato storico del motore per lo stesso paese (conseguenza sistemica
   già dichiarata in OP-OBJECTS PERSISTENT): è il prezzo di una filiera reale.
7. **Costi monetari degli oggetti**: non introdotti (punto 30/31). Restano nei
   conti nazionali finché non saranno oggettuali.
8. **Transazioni**: `replaceKind` copre le famiglie di oggetti; `assignFacilityFor
   + save order` resta la sequenza attuale (nessuna transazione condivisa con il
   repository degli ordini) — dichiarato, non risolto.
9. **Il tipo di impianto non differenzia la produzione**: `engineFacilityRecipe`
   usa la formula del motore per un impianto (vestiario + armamenti + carburante),
   che non distingue una acciaieria da una fabbrica di armi. La **somma** degli
   impianti resta esattamente la quota industriale che sostituisce (nessun numero
   inventato); differenziare la produzione per tipo richiederebbe una formula del
   motore che oggi non esiste. Limite ereditato da OP-OBJECTS PERSISTENT, non
   introdotto qui.

---

## 21. File toccati e anchor points

| File | Intervento |
|---|---|
| `core/simulation/MaterialEconomy.ts` | `civilMaterialNeeds`, `legacyMilitaryNeeds`, `materialNeeds` (somma), `MaterialFlowOverlay`, `effectiveMaterialNeeds`, `storageCapacity(account, needs?)`, `capStock(stock, account, needs?)`, `advanceStock(..., overlay?, needsOverride?)`: `industry()` sostituisce la quota industriale, `objectDraw()` sottrae gli input |
| `core/simulation/OperationalState.ts` | `facilityStatusFactor`, `shipConsumptionFactor`, `engineFacilityRecipe` (da `gross`), `facilityRecipeStale`, `facilityRecipeDrifted`, `allocateFacilityProduction` (+`FacilityAllocation`, `FacilityAllocationEntry`), `FACILITY_RECIPES.inputs` = coefficienti per unità di output |
| `core/simulation/OperationalObjects.ts` | `marginalPlant` → `{ flow, needs, gross }`; `persistentObjects`/`aggregateObjects` accettano `allocation?` |
| `core/simulation/ResourceMarket.ts` | `drawResourceStockpile` (prelievo dal silo) |
| `game/materialBalance.ts` | `materialBalance(..., overlay?)`, `materialFlowBreakdown`, `describeMaterialFlow`, `MaterialFlowRow` |
| `game/OperationalStateStore.ts` | input `ledger`/`account`; `availability()`, `allocation()`, `facilityFactor()`, `militaryNeeds()`, `navyFuel()`, `materialFlow()`; `refreshRecipes` con drift; `syncArmies` con riparazione dei fabbisogni; `persist` → `replaceKind` |
| `game/NationStateService.ts` | `materialOverlay(polityId)` (solo paese giocatore); overlay in `advanceStock`, prelievo dal silo (`drawResourceStockpile`), bollettino «Bilancio materiale degli oggetti»; `getResources()` con `flow` e fabbisogno efficace (`capacity`, `needs`, `balance`) |
| `game/MilitaryService.ts` | `effectiveNeeds`, `facilityMaterialFactor`, `withOrderEta` × fattore, sospensione con ETA `null`, `allocation` nelle schede, ordini avanzati con il fattore materiale |
| `game-session.ts` | input dello store `ledger`/`account`; hook `materialOverlay` nel contesto di `NationStateService` |
| `repositories/operational-object.repository.ts` | `replaceKind` (transazione: upsert + rimozione) |
| `tests/op-objects-flow.test.ts` | test 38–47 + 4 invarianti (nuovo) |

---

## 22. Come si legge la differenza

Prima: due sistemi che si ignoravano.

```
scheda impianto: «Ritmo 50%, collo di bottiglia Ferro»   ← calcolo locale
tick nazionale:  factories × 0,5 → produzione piena       ← formula nazionale
armata:          monthlyNeeds salvato ma mai applicato    ← consumi a zero
```

Dopo: una catena sola, verificabile in tre punti.

```
1. tick         → advanceStock(..., overlay)         → lo stock cambia per davvero
2. scheda       → persistentObjects(..., allocation) → lo stesso factor del tick
3. bollettino   → materialFlowBreakdown              → da dove arriva, dove finisce
```

Chi vuole verificare senza fidarsi della UI:

```
GET /api/games/:id/resources
  .needs          → fabbisogno efficace (civile + oggetti)
  .balance[]      → produzione, consumo, saldo, deperimento
  .flow[]         → { civilian, facilities, army, navy, natural, total } per materiale
```
