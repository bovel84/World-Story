# OP-OBJECTS PERSISTENT — gli oggetti hanno uno stato proprio

**Macro-task:** OP-OBJECTS PERSISTENT (punti 1–50 di `/tmp/pi-task-op-objects-persistent.md`)
**Direzione:** `REAL OBJECTS → AGGREGATION → NATIONAL STATE → UI` (al posto di `NATIONAL STATE → distribuzione convenzionale → oggetti fittizi`)
**Famiglie:** `Army · Facility · Ship · Fleet · Construction` — esattamente queste quattro famiglie di oggetti principali (+ flotte, contenitore delle navi).

---

## 1. Problema

OP-OBJECTS (macro-task 24) aveva costruito una «sala di governo» leggibile, ma gli oggetti erano **rappresentazioni derivate di aggregati nazionali**:

1. **`MilitaryDoctrine.ts` (~189–192)** calcolava `reservePersonnel` come derivato (`max(mobilized, active × reserveRatio)`), quindi **creare una formazione aumentava la riserva** invece di consumarla: 96.000 attivi / 86.400 riserva → 108.000 / **97.200** (sbagliato: la riserva deve calare).
2. **`OperationalObjects.ts`** distribuiva l'equipaggiamento con quote proporzionali (`share = totalFormations > 0 ? …`) e attribuiva con **convenzioni dichiarate**: `STAFF_PER_LINE`, `STAFF_PER_MINE_POINT`, `FULL_TANK_MONTHS`, `MAX_REPRESENTATIVE_SHIPS`.
3. **Fabbriche, navi, cantieri** non esistevano: erano righe calcolate a ogni lettura da `factories`, `ports`, `universities`, `units`. Nessun `facility.workers` persistente, nessun `ProductionOrder.facilityId` (l'assegnazione era una rotazione al momento della lettura), nessun `shipId` che sopravvivesse al reload.
4. **Equipaggiamento**: `units` era una cosa sola (deposito e dotazione insieme), senza distinguere **magazzino** e **assegnato a un oggetto**.

Conseguenza per il giocatore: i numeri cambiavano *perché la UI li ricalcolava*, non perché un oggetto fosse cambiato.

## 2. Regola di architettura

> Nessun secondo motore, nessuna seconda contabilità.
> Il motore continua a calcolare i conti nazionali (WorldStateEngine), i materiali (MaterialEconomy), la dottrina (MilitaryDoctrine), la capacità (IndustrialCapacity), la produzione (MilitaryProduction), la copertura e la prontezza.
> Gli **oggetti** possiedono solo ciò che l'aggregato non può esprimere: uomini, equipaggiamento assegnato, addetti, lavorazioni, scafi, cantieri.
> L'aggregato nazionale è la **somma degli oggetti** (deposito + assegnato = totale).

Refactor **minimo**: un modulo puro nuovo (`OperationalState.ts`), uno store di persistenza (`OperationalStateStore.ts`), un repository (`operational-object.repository.ts`) e **una sola tabella additiva**. Nessun framework generico, nessun rewrite della UI, nessun tocco a diplomazia, NPC, crisi, playback, fazioni, mercato del lavoro, popolazione individuale, logistica tattica.

## 3. Le famiglie e dove vivono (una sola fonte per oggetto)

| Famiglia | Dove vive lo stato | Perché |
|---|---|---|
| **Army** | campi operativi **sugli oggetti `army` della mappa** (regione) | l'oggetto mappa è già il fatto da cui il motore deriva `forces`: un solo record, nessuna duplicazione |
| **Facility** | tabella `game_operational_objects`, `kind='facility'` | tipo, nome, capacità, addetti, ricetta, ordini: la mappa non li ospita |
| **Ship / Fleet** | `kind='ship'`, `kind='fleet'` | `shipId` unico che sopravvive al reload; le flotte raggruppano navi reali |
| **Construction** | `kind='construction'` | progresso, requisiti, costo residuo, scadenza |
| **MilitaryPersonnelState** | `kind='personnel'`, `object_id = polityId` | riserva e equipaggi come **stock**, non come rapporto dottrinale |

Una sola tabella additiva (nessuna migrazione di dati, nessun `ALTER` distruttivo):

```sql
CREATE TABLE IF NOT EXISTS game_operational_objects (
  game_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (game_id, object_id)
)
```

Le **armate** non aggiungono campi obbligatori alle regioni: `personnel`, `equipment`, `monthlyNeeds`, `status` sono campi **opzionali** (compatibilità totale con i salvataggi esistenti).

## 4. Deposito vs equipaggiamento assegnato

- `game_arsenals.units` diventa il **deposito** (magazzino non assegnato).
- L'equipaggiamento **assegnato** è la somma degli oggetti: `army.equipment` + scafi e munizionamento delle navi.
- Il **totale nazionale** è `deposito + assegnato`: è questo che alimenta copertura, qualità, forza e prontezza.
- Invariante verificata per ogni voce: `stockpile + assigned === units`.

Esempio reale (test 38, dal motore):

```
Deposito 10.000 fucili → assegna 9.000 a un'armata
  deposito 1.000 · assegnato 9.000 · totale nazionale 10.000  (invariato)
```

L'API `/arsenal` espone ora `units` (totale, compatibilità), `stockpile` (deposito) e `assigned` (assegnato). La UI mostra la ripartizione nella sintesi degli armamenti («deposito 42 · assegnato 1 su 43»): nessun numero calcolato dal browser.

## 5. La riserva è uno stock che si consuma (test 37)

`MilitaryDoctrine` resta la **capacità** (bacino, tetto di richiamo, uomini per reparto). Lo **stato di partita** dice chi è sotto le armi:

```ts
personnelOverlay(state, doctrine) // bacino e tetto dalla dottrina, uomini dallo stato
transferMenToArmy(state, men, doctrine) // riserva − men, attivi + men  (null se non basta)
transferCrewToShip(state, crew, doctrine) // equipaggi dalla riserva
```

Esito verificato:

```
96.000 attivi / 86.400 riserva
+ 1 reparto da 12.000 uomini
→ 108.000 attivi / 74.400 riserva          (non 97.200)
```

Invarianti: `attivi + riserva ≤ bacino`, `riserva ≥ richiamati`, `richiamati ≤ riserva disponibile`. Se la riserva non basta l'azione è **rifiutata** (`formation_blocked`), non compensata a debito di uomini.

## 6. Transazione atomica della formazione

`raiseFormation` esegue, in quest'ordine:

1. **Anteprima PRIMA → DOPO** (sola lettura) con i numeri del motore;
2. verifica **uomini** (riserva disponibile ≥ reparti × uomini per reparto);
3. verifica **equipaggiamento** dal **deposito** (i pezzi già assegnati a un'altra armata non si prendono);
4. verifica **denaro** (cassa + credito, la stessa finanza del commercio di armi);
5. *solo dopo tutte le verifiche* scrive: deposito → cassa → personale → oggetto `army` della mappa → stato dell'armata;
6. il **consumo nazionale si ricalcola da solo**: `account.forces` nasce dagli oggetti `army` della mappa, quindi fabbisogni, spese e saldo si muovono perché è cambiato il fatto.

Nessun fallimento parziale: ogni rifiuto avviene prima della prima scrittura.

## 7. Impianti persistenti (test 39, 40)

`FacilityState` = `{ id, kind, name, regionId, capacity, workers, status, recipe, activeOrders, createdDate, legacyDerived }`.

- **Tipo concreto**: `steel_mill · arms_factory · vehicle_factory · aircraft_factory · shipyard · research_center · mine` — non nomi decorativi: ogni tipo ha una **ricetta** input → output sulle risorse già esistenti nel motore.
- **Lavoratori**: `facility.workers` è stato persistente (seed dichiarato: 900 addetti/linea di fabbrica, 1.200 di cantiere, 600 di ricerca).
- **Produzione dal proprio stato**: `facilityProduction(facility, { stock, endowment, activity })` → fattore `min(attività, disponibilità input)`. Input ferro 20 richiesto con 10 disponibili ⇒ output dimezzato; con 0 ⇒ produzione zero; impianto fermo ⇒ zero.
- **Ricetta dal motore, non riscritta**: al seed ogni impianto prende la ricetta da `marginalPlant({ factories | ports | universities: 1 }, endowment, technologies)`, che separa **quello che l'impianto produce** (`flow`) da **quello che consuma** (`materialNeeds`). La **somma degli impianti è la produzione nazionale** (a fattore pieno): un centro di ricerca produce punti ricerca, non armamenti.
- **Miniere**: il contributo dichiarato è la **differenza del motore** per un punto di giacimento (`endowmentContribution`) moltiplicata per i punti del registro del paese. Dove il motore non ha una voce separata non si mostra nulla: nessun contributo inventato.
- **Costi ≠ colli di bottiglia**: la spesa del denaro resta nella sezione «costi»; non si trasforma in un input che spegne l'impianto.
- **Disponibilità di un input**: se è un **materiale di magazzino** (`food · clothing · weapons · fuel · research · money`) si legge dalla scorta; se è un **giacimento** (`iron · coal · oil · …`) si legge dal registro del paese. Senza questa distinzione un'acciaieria risulterebbe ferma in un mondo dove il ferro è giacimento e non scorta.
- **Capacità industriale**: `IndustrialCapacityInput.facilities` — quando gli impianti reali esistono, la capacità nazionale è `sum(facility.capacity)` (le miniere non contano linee); `factories/ports/universities` restano **fallback legacy**. Il totale è identico a prima (10 linee/fabbrica, 4/cantiere, 2/ateneo), quindi l'aggregato non cambia con la materializzazione.
- **Il tick non è riscritto**: la produzione che entra nelle scorte resta quella del motore (`advanceStock`, bilancio materiale). La scomposizione per impianto si calcola dallo **stato dell'impianto** (capacità, addetti, ordini, scorte e giacimenti reali) e mostra dove la filiera si blocca: nessun secondo bilancio nazionale.
- **Etichette**: i materiali del motore (Cibo, Vestiario, Armamenti, Carburante, Punti ricerca, Cassa) e i giacimenti (Ferro, Carbone, …) hanno un nome leggibile; le voci di catalogo il loro.
- **Ordini**: `ProductionOrder.facilityId` — l'ordine nasce già assegnato a un impianto reale, in modo deterministico (id più basso con meno lavoro); l'impianto mostra «Ordine in lavorazione» e «Consegna prevista». Niente più rotazione al momento della lettura (resta il fallback dichiarato per gli ordini legacy senza `facilityId`).

## 8. Navi e flotte persistenti (test 41)

- Ogni scafo è un oggetto con `id` **unico e stabile** (`ship-<polityId>-<voce>-<n>`), `equipmentId`, `fleetId`, `crew`, `monthlyFuel`, `ammunition`, `status`.
- **Equipaggio da un bacino reale**: al varo gli uomini escono dalla **riserva addestrata** (`transferCrewToShip`); se non bastano, la nave resta in servizio **senza equipaggio** e il bollettino lo dichiara (nessun marinaio inventato).
- Lo scafo **esce dal deposito**: `deposito + assegnato = totale`. Vale sia per la produzione completata sia per l'acquisto immediato (`buy` resta immediato: consegna subito — ma una nave comprata entra in servizio come nave, non resta una riga di magazzino).
- Le flotte raggruppano navi reali (`fleet.shipIds`), una flotta per categoria.

## 9. Cantieri persistenti (test 42)

`ConstructionState` = `{ id, targetType, targetName, regionId, progress, materialRequirements, capacityDemand, costRemaining, expectedDate, createdDate }`.

- Finché il progetto è **in corso** (lista `ongoingProcesses` del motore) il cantiere resta un cantiere e **non produce nulla**: `output Beneficio = 0`, requisiti e costo residuo visibili.
- Quando il motore chiude il progetto (scadenza o completamento), `syncConstructions()` chiude il cantiere e fa **nascere l'impianto finale** con la sua capacità — nessun beneficio retroattivo.

## 10. Migrazione legacy (salvataggi esistenti)

`legacyDerived: true` su ogni oggetto **materializzato** da un aggregato legacy; il seed è **lazy** (una riga sentinella `kind='personnel'` dice se è già avvenuto) e **non cambia il risultato nazionale**:

- armate: `personnel` derivato dalla dottrina (somma = attivi di terra), `equipment` **vuoto** — la dotazione resta nel deposito finché non viene assegnata davvero;
- navi: scafi spostati dal deposito alla nave (stessa somma nazionale);
- impianti: tipo, ricetta e addetti dal seed dichiarato; linee identiche a `factories/ports/universities`;
- cantieri: dai progetti in corso;
- personale: `seedPersonnel(manpower)` una volta sola.

Dove lo stato non c'è, resta il percorso derivato del motore con le sue convenzioni — dichiarate in `conventions[]` e nel testo delle schede.

## 11. UI — nessun ridisegno

- La grammatica universale (`Stato · Capacità · Personale · Input · Output · Costi · Autonomia`, problemi, azioni, «Perché?») è invariata: cambiano solo i **dati** che la alimentano.
- Il read model `operationalObjects.ts` formatta, non calcola: `data` → data di gioco, note dei fatti mantenute, righe PRIMA → DOPO filtrate quando non si muovono.
- Nuovo, minimo: `arsenalSplit` / `arsenalSplitText` (deposito vs assegnato) nella sintesi degli armamenti; i tipi API `stockpile`, `assigned`, `reserves`, `men`, `equipment` sono **additivi**.

## 11-bis. Anteprima PRIMA → DOPO aggiornata (punto 44)

L'anteprima della creazione di reparti è ora **persona-aware** e mostra il movimento dei pezzi:

| Riga | PRIMA → DOPO |
|---|---|
| Riserva addestrata | 86.400 → **74.400** (non 97.200) |
| Deposito armi individuali | 10.000 → 1.000 |
| Armi individuali assegnate | 0 → 9.000 (l'armata che le riceve) |

L'aritmetica del personale vive in un solo posto (`PersonnelStock.ts`), usata sia dal quadro operativo sia dal piano di formazione: `formationImpact` riceve lo **stato reale** (`personnel`) e calcola il «dopo» con `transferMenToArmy`; senza stato persistente resta la dottrina (fallback legacy dichiarato). Quando l'azione è **bloccata** nulla si muove, quindi le righe del deposito e dell'armata non compaiono.

## 12. Test obbligatori (37–42) e invarianti

`backend-nest/tests/operational-state.test.ts` — **20 test**:

| # | Verifica |
|---|---|
| **37** | la riserva è uno stock: creare 1 reparto toglie gli uomini (96.000/86.400 → 108.000/74.400); senza riserva l'azione è rifiutata |
| **37-bis** | l'anteprima mostra `Riserva 86.400 → 74.400` e `Deposito → armata` per le armi individuali, con totale nazionale invariato |
| **38** | deposito + assegnato = totale per ogni voce, sia a riposo sia dopo la formazione |
| **39** | produzione dallo stato dell'impianto: input 10/20 ⇒ output 50%; input 0 ⇒ 0; impianto fermo ⇒ 0 |
| **40** | impianti con tipo/addetti/capacità propri; ordine assegnato a un impianto reale (`facilityId` persistito) e lavorazione visibile |
| **41** | nave in servizio con `id` stabile ed equipaggio reale (riserva calata), scafo fuori dal deposito, flotta presente; **dopo il reload della sessione** (ricostruita dal database) lo `shipId` è lo stesso |
| **40-bis** | l'ordine conserva `facilityId` **dopo il reload**: stessa fabbrica, non una rotazione del read model |
| **42** | il cantiere non crea impianti finché è in corso; a fine lavori nasce l'impianto con la capacità del tipo |
| invarianti | somma uomini delle armate = attivi di terra; `stockpile + assigned = units`; navi delle flotte = navi degli oggetti; `personnelInvariant`; `equipmentInvariant`; aggregazione senza numeri inventati; **il seed legacy non cambia il totale** |

Test aggiornati al nuovo significato (senza indebolirli): `op-objects-integration.test.ts` verifica ora il passaggio deposito → assegnato con totale invariato.

## 13. Quality gate (eseguito)

| Gate | Esito |
|---|---|
| backend `npx tsc --noEmit` | ✅ |
| backend `npm test` | ✅ **154 file / 1429 test** (da 153/1409: **+20**) |
| backend `npm run build` | ✅ |
| frontend `npx tsc --noEmit` | ✅ |
| frontend `npx vitest run` | ✅ **67 file / 488 test** (da 485: **+3**) |
| frontend `npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **45 / 45** (mock esteso con `stockpile`/`assigned`, nuova asserzione sulla ripartizione) |

Baseline precedenti: backend 153/1409 · frontend 67/485 · e2e 45.

## 14. FREEZE

`core/simulation/**`, `GameSession`, schema/db, `MilitaryService` sono sotto freeze. In questa macro-task sono stati modificati **con nota di freeze**, come già fatto per COUNTRY-CLARITY e OP-OBJECTS:

- `core/simulation/IndustrialCapacity.ts` — campo **opzionale** `facilities` (fallback legacy intatto) e conteggio dichiarato nella base;
- `core/simulation/MilitaryProduction.ts` — campo **opzionale** `facilityId` sull'ordine;
- `core/simulation/OperationalObjects.ts` — `depot` opzionale nel piano, sostituzione degli oggetti derivati quando lo stato persistente esiste, esportazione di `fact`;
- `src/database.ts` — **una** tabella additiva (`CREATE TABLE IF NOT EXISTS`);
- `src/game-session.ts` — costruzione dello store e scrittura dei campi operativi sulle armate (nessuna regola nuova);
- `src/game/MilitaryService.ts` — deposito/totale nazionale, overlay del personale, transazione della formazione, varo delle navi, assegnazione impianto.

Nessuna regola economica o militare è stata duplicata: gli oggetti sono alimentati dalle stesse funzioni del motore.

## 14-bis. Verifica su **dati reali** (copia locale del database)

Eseguita su una **copia** di `backend-nest/data/open-pax.db` (il database di produzione non è stato toccato), con il motore reale e due partite esistenti.

**Partita 1815 `246c9cda8b8f`** (Confederazione Germanica) — seed legacy: 1 armata (`Reparti di guarnigione`, 3 reparti), 2 impianti, 4 miniere, 3 cantieri; deposito `fucili 160 · apc 6`; nessun equipaggiamento assegnato (resta nel deposito, come dichiarato).

```
Anteprima 1 reparto: BLOCCATA
  «Mancano 560 armi individuali: un reparto non si forma senza fucili (160 in deposito su 720).»
  riserva 1.440 → 1.440 · uomini 2.400 → 2.400   (nulla si muove, righe deposito assenti)
Impianti:
  Acciaieria Confederazione Germanica · 10 linee · 9.000 addetti · ritmo 50%
    input limitante: Ferro 50% (giacimento del paese)
    output: Vestiario 0,35 · Armamenti 0,4 · Carburante 2,125 /mese   (profilo del motore)
```

**Partita moderna `23fd1fe361ae`** — 25 oggetti (`facility 17 · mine 6 · army 1 · force 1`), 114 linee dagli impianti reali.

```
Anteprima 1 reparto: AMMESSA
  uomini      96.000 → 108.000
  riserva     86.400 →  74.400      ← non 97.200
  deposito    72.000 →  63.000
  assegnate        0 →   9.000 fucili
Reparti 8 · 96.000 uomini · riserva nazionale 86.400 · invariante uomini ≤ bacino: vero
```

Il seed legacy **non ha cambiato il totale** in nessuna delle due partite (`deposito + assegnato` = stessa dotazione di prima), e la capacità industriale è rimasta quella del motore (`1 fabbrica + 1 ateneo` ⇒ 12 linee; `10 fabbriche + 7 atenei` ⇒ 114 linee).

## 15. Limiti dichiarati

1. **Equipaggi delle marine legacy** (scafi presenti nel salvataggio): restano fuori dallo stock di uomini (il seed non li sottrae alla riserva). Solo le navi varate in partita consumano la riserva reale. Evita di alterare l'aggregato storico; dichiarato nel report.
2. **`assignFacilityFor`** scrive l'assegnazione prima dell'ordine: se il salvataggio dell'ordine fallisse, l'impianto conserverebbe un id orfano (caso raro, coperto da `try/catch`).
3. **Azioni future non implementate** (come richiesto): trasferimento di reparti tra armate, fusione di flotte, chiusura di impianti, licenziamenti. Lo **stato** è già pronto (`army.equipment`, `fleet.shipIds`, `facility.activeOrders`, `facility.workers`).
4. **Munizionamento delle navi**: lo stato esiste (`ship.ammunition`), l'assegnazione automatica al varo non è prevista (resta nel deposito finché non ci sarà l'azione).
5. **Materializzazione lazy su GET**: la prima lettura di `/arsenal` (o la prima anteprima) semina gli oggetti legacy. È idempotente e non cambia l'aggregato, ma è una scrittura su una lettura: dichiarato.
6. **Miniere**: il contributo estrattivo resta quello del bilancio materiale del motore; la scheda non lo ricalcola (dichiara il giacimento e gli addetti).
7. **Output degli impianti a fattore ridotto**: la somma degli impianti è la produzione nazionale **a fattore pieno**; quando un input scarseggia la somma è inferiore all'aggregato del motore — è la conseguenza sistemica dichiarata (input insufficiente ⇒ produzione ridotta), non un doppio conteggio.

## 16. File e punti di ancoraggio

**Nuovi**
- `backend-nest/src/core/simulation/PersonnelStock.ts` — personale militare come stock: overlay, trasferimenti (uomini, equipaggi), invarianti (usato da quadro e anteprima)
- `backend-nest/src/core/simulation/OperationalState.ts` — tipi, ricette, seed, trasferimenti di equipaggiamento, produzione per impianto, aggregazione, cantieri, oggetti persistenti del quadro
- `backend-nest/src/game/OperationalStateStore.ts` — seed lazy, lettura/scrittura, riconciliazione armate, cantieri
- `backend-nest/src/repositories/operational-object.repository.ts` — `list/idsOfKind/upsert/upsertMany/remove/removeKind`
- `backend-nest/tests/operational-state.test.ts` — test 37–42 + invarianti
- `docs/implementation/OP-OBJECTS-PERSISTENT-report.md` — questo documento

**Modificati**
- `backend-nest/src/database.ts` (`game_operational_objects`)
- `backend-nest/src/repositories/index.ts`, `production.repository.ts` (`facilityId`)
- `backend-nest/src/core/simulation/IndustrialCapacity.ts`, `MilitaryProduction.ts`, `OperationalObjects.ts`
- `backend-nest/src/game/MilitaryService.ts`, `backend-nest/src/game-session.ts`
- `backend-nest/tests/op-objects-integration.test.ts`
- `frontend/src/services/api.ts`, `components/Game/arsenalSummary.ts`, `arsenalSummary.test.ts`, `components/Game/NationDock.tsx`, `NationDock/useNationDockModel.ts`
- `e2e/mock-api.mjs`, `e2e/tests/materiel-clarity.spec.mjs`

## 17. Come si legge la differenza

| Prima | Dopo |
|---|---|
| Riserva = `active × reserveRatio` (cresceva creando reparti) | Riserva = **stock** che si consuma (96.000/86.400 → 108.000/74.400) |
| `units` = dotazione indistinta | `deposito` + `assegnato` = totale nazionale |
| Equipaggiamento per armata in proporzione | Equipaggiamento **assegnato** all'armata (quote solo per i legacy, dichiarate) |
| Fabbriche = `factories × 10` ricalcolate a ogni lettura | Impianti con tipo, ricetta, addetti e lavorazioni propri |
| Ordine in produzione = rotazione al momento della lettura | `ProductionOrder.facilityId` persistito |
| Navi = scafi raggruppati per tipo (`MAX_REPRESENTATIVE_SHIPS`) | Navi con `id`, equipaggio e carburante propri; flotte con navi reali |
| Cantiere = riga derivata dal progetto | Cantiere persistente; a fine lavori nasce l'impianto |
| Numeri che cambiano perché li ricalcola la UI | Numeri che cambiano perché è cambiato l'oggetto |
