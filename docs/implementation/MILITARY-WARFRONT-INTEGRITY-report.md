# MILITARY/WARFRONT INTEGRITY — identity, rewind, logistics, material accounting

**Base**: `main` = `e1b8687` («docs(military): esito del merge di MILITARY-UNITS PR2 (PR #81)»).
**Branch**: `fix/military-warfront-integrity`.
**Natura**: correzione della **base** di MILITARY-UNITS PR1/PR2. **Nessuna** feature di PR3 (contrattacco, inversione dei ruoli, ricostituzione, accerchiamento, aviazione, marina, profondità tattica).

```
REASSIGN ≠ MOVE · MOVE ≠ TELEPORT · FRONT ID ≠ PRESENZA SUL FRONTE
WAR CONSUMPTION ≠ BASE + WAR · REWIND ≠ SOLO MAPPA
```

---

## 1. Sommario in una tabella

| # | Sintomo osservato | Causa | Correzione | Test che fallisce prima |
|---|---|---|---|---|
| P0-1 | Dopo rewind le regioni tornano indietro ma reparti e fronti restano al futuro; i branch si contaminano | `captureCheckpointData()` non includeva `game_operational_objects`; nessun `replaceAll` | snapshot dedicato nel `SaveData` + `replaceAll(gameId, rows)` + `invalidate()` della cache | 1–7 |
| P0-2 | In guerra il consumo è `base + 1,8× = 2,8×` | `WarFrontService.advanceFronts()` sottraeva `resolution.consumption` **dopo** il tick materiale | un solo punto che sottrae (`advanceStock`), coefficiente dell'ordine dentro `militaryNeeds()` | 20, 21, 22, 19 |
| P0-3 | Un reparto trasferito a Roma continuava a combattere su un fronte in Austria | `syncFronts()` non azzerava `frontId`; `sides()` non verificava il teatro | `detachOutOfTheatre()` + filtro di teatro in `sides()` | 15, 17, 18 |
| P1-1 | `reassign` rinumera l'id (`a1-unit-001 → army-…-unit-004`) | `unitIdFor(targetArmy, n)` dentro `reassign` | id immutabile: `unitIdFor` solo alla nascita | 10, 11, 12 |
| P1-2 | Spostando un reparto, l'armata di partenza **ricrea** un reparto `forming` vuoto | `syncArmies()` usava il `level` della mappa come target | il livello è **seed**; il numero reale viaggia sull'oggetto della mappa | 13, 14, 28 |
| P1-3 | `transfer` teletrasporta (costo come 1 tratta qualunque sia la distanza) | `movementCost(before)` senza `distanceFactor`, nessuna geografia | BFS pura sui `borders` + `distanceFactor = tratte` | 23, 24, 25, 26, 27 |
| P2 | «stesso motore per tutti» non era verificato | – | dichiarazione esplicita del modello NPC (§22) | 29 |

---

## 2. P0-1 — il checkpoint dello stato operativo

**Prima**: `captureCheckpointData()` salvava turno, regioni, diplomazia, azioni, crisi, economia… **non** le righe di `game_operational_objects`. Un rewind riportava indietro le regioni ma lasciava i reparti al futuro: due storie nella stessa partita. Il repository esponeva `replaceKind(gameId, kind, rows)` (per tipo): non esisteva un modo atomico di dire «lo stato operativo di questa partita **è** questo insieme».

**Ora** (`SaveData.operationalState`):

```ts
interface OperationalObjectsSnapshot {
  schema: 'world_story_operational_objects';
  version: 1;
  rows: Array<{ objectId: string; kind: OperationalObjectKind; data: Record<string, unknown> }>;
}
```

- **Cattura**: `captureCheckpointData()` legge `operationalObjectRepository.snapshot(this.id)` — **tutti** i kind (`personnel`, `unit`, `front`, `facility`, `ship`, `fleet`, `construction`), ordinati per `kind, object_id`, **senza `recorded_at`**: l'hash semantico dipende dai fatti, non dall'ora di scrittura.
- **Ripristino**: `GamePersistenceService.loadFromSave()` applica l'insieme **dentro la transazione canonica** (`applyState` → `prepareRestore` → `replaceAll`). Semantica **REPLACE ALL FOR GAME**: le righe del checkpoint sostituiscono *tutte* le righe della partita, di qualunque tipo. `unit A, unit B, front X` nel checkpoint + `unit C, front Y` nel presente → dopo il rewind restano `A`, `B`, `X`.
- **Atomico**: `replaceAll` fa `upsert` delle righe presenti e `DELETE` delle righe della partita non presenti in **una sola** transazione: o si applica tutto, o niente (test 5).

**Legacy save** — la distinzione richiesta dalla specifica:

| Valore | Significato | Comportamento |
|---|---|---|
| `undefined` (campo assente) | save scritto **prima** di questo campo | lo stato operativo **non** si tocca (nessuna cancellazione) — test 8 |
| `{ version: 1, rows: [...] }` | un fatto | si applica l'insieme, anche se parziale |
| `{ version: 1, rows: [] }` | un fatto: «questa partita non ha oggetti» | si applica: le righe della partita vengono rimosse — test 9 |

Nel test 9 la riga `personnel` del seed viene cancellata insieme alle altre, quindi la **prima** lettura successiva ri-materializza i reparti dal seed lazy (è la regola dello store per una partita mai seminata, non una riga sopravvissuta al rewind). Il test verifica entrambe le cose: DB vuoto **subito dopo** il ripristino e re-materializzazione deterministica identica al checkpoint.

---

## 3. P0-1 — cache invalidation e rewind sulla stessa istanza

`OperationalStateStore` teneva `state`, `seedChecked`, `seedDone` in memoria: una sessione già viva continuava a servire il **futuro** anche dopo il ripristino (una sessione nuova dal DB funzionava, la stessa no — il bug peggiore da diagnosticare).

- aggiunto `invalidate()` (`state = null; seedChecked = false; seedDone = false`);
- `applyPersistenceState()` lo chiama (copre **avanti** e **indietro**);
- `afterRestoreState()` lo chiama di nuovo **dopo** il commit (cintura e bretelle: se il commit ha toccato le righe, la prima lettura è comunque quella nuova).

Test 6 misura il caso difficile: **stessa istanza di sessione**, due checkpoint, rewind avanti e indietro, senza mai ricreare la sessione. Il test 7 verifica che `semanticStateHash` cambi se cambia `unit.personnel` o `front.status` (l'hash è la garanzia che il checkpoint sia davvero confrontabile).

---

## 4. P0-2 — un solo consumo: i coefficienti sono il **totale**

**Prima** (doppia sottrazione):

```
advanceResources → advanceStock  : consuma militaryNeeds   = Σ unit.monthlyNeeds          (base)
                → onPlayerSlice → advanceFronts → resolution.consumption = Σ needs × 1,8
                                  → applyFlow(stock, −consumption)                       (seconda volta!)
```

Risultato misurato sul mondo di test (4 reparti al fronte da `food 0,06` + 10 di guarnigione):

| | vecchio | nuovo |
|---|---|---|
| `militaryNeeds().food` (ordine `attack`) | **0,84** (nessun fattore) | **1,032** |
| sottrazione del fronte (`applyFlow`) | **0,432** | **0** (non esiste più) |
| consumo totale del periodo | **1,272** = base + 1,8× → il reparto al fronte pagava **2,8×** il suo fabbisogno | **1,032** = 1,8 × 0,24 + 0,6 → **1,8×** esatto |

**Ora** — l'unico punto che sottrae è `advanceStock` (`effectiveMaterialNeeds`), e il coefficiente entra nel fabbisogno:

```ts
orderConsumptionFactor(unit) = unit.frontId ? UNIT_ORDER_INFO[unit.order ?? 'defend'].consumption : 1
```

- unità **fuori** dal fronte → `×1` (una guarnigione non paga il coefficiente di battaglia);
- unità **sul** fronte → `×UNIT_ORDER_INFO[order].consumption`;
- `WarFrontService` **non tocca più il magazzino**: `warConsumption()` resta una **lettura** (fatti del fronte, `supplyCoverage`), non una seconda sottrazione;
- un'armata **senza reparti** consuma quanto dichiara (una sola volta): nessun doppio conteggio armata+reparti.

**Valori misurati** (mondo di test: 4 reparti al fronte × `food 0,06`, 10 di guarnigione × `food 0,06`, tick 30 giorni, `flow.food` di `advanceStock`):

| ordine | `militaryNeeds().food` | `weapons` | `fuel` | `flow.food` a 30 gg |
|---|---|---|---|---|
| `attack` (1,8) | **1,032** | 3,44 | 0,516 | **−1,032** |
| `defend` (1,2) | **0,888** | 2,96 | 0,444 | **−0,888** |
| `reserve` (0,8) | **0,792** | 2,64 | 0,396 | **−0,792** |
| `withdraw` (1,0) | **0,840** | 2,80 | 0,420 | **−0,840** |

La parte al fronte è 0,24 di cibo: `attack → 0,432` (1,8×), `defend → 0,288` (1,2×), `reserve → 0,192` (0,8×), `withdraw → 0,24` (1,0×). **Sotto 1 il consumo scala davvero** (era il punto 4 della specifica: nessun `base + max(0, m−1)`).

**Tempo** (test 21, 22): 15 giorni = metà periodo (`flow.food = −need/2`); 180 giorni = sei periodi da 30 (confronto con sei `advanceStock` concatenati: stessa storia, un solo consumo per periodo). Nessun secondo ciclo temporale: ogni slice (`max 30 gg`) legge l'ordine corrente e consuma una volta.

---

## 5. P0-2 — semantica dei rifornimenti (supply) prima/dopo il tick

Ordine canonico del periodo materiale:

```
advanceResources → advanceStock (consuma i fabbisogni) → onPlayerSlice → advanceFronts
```

`FrontEngine.supplyCoverage()` legge lo **stock della polity in quell'istante**: cioè **dopo** che il periodo ha già pagato i fabbisogni. Il numero che entra nella battaglia è quindi esattamente lo stock che esiste davvero in quel momento — nessun secondo fabbisogno inventato, nessuna divergenza fra «supply usato per la battaglia» e «scorte disponibili». La semantica è documentata sul metodo `sides()` di `WarFrontService`, dove viene letto lo stock.

Conseguenza voluta: se il paese non riesce a pagare, `supplyCoverage < 1` **nello stesso periodo** in cui la carenza è nata, e la battaglia ne tiene conto (comportamento già coperto da `war-fronts.test.ts`).

---

## 6. P0-3 — un reparto combatte solo **nel** teatro

Invariante applicata (due volte: alla sincronizzazione e alla lettura):

```
unit.frontId === front.id  AND  front.status !== 'closed'
AND unit.regionId ∈ front.regionIds
AND polity(unit) ∈ { attackerPolityId, defenderPolityId }
AND unit.status !== 'destroyed'
```

- `syncFronts()` termina con `detachOutOfTheatre(fronts, units, date)`: per ogni reparto con `frontId`, se il fronte non esiste / è `closed` / il reparto non è più nel teatro / non è più di una delle due parti → `frontId = null` (`updatedDate` aggiornata, stato salvato solo se qualcosa è cambiato).
- `sides()` filtra **anche** per `front.regionIds.includes(unit.regionId)`: difesa in profondità contro una riga persistita vecchia o sbagliata. Un reparto a Roma non può più combattere su un fronte in Austria, qualunque cosa dica il `frontId`.
- I reparti **distrutti** non si sganciano: sono inerti (non combattono, non consumano, non si rianimano) e il fronte su cui sono caduti è la loro storia.

Test: 15 (trasferito in provincia interna → `frontId = null`, pressione **zero**), 16 (pace/fronte chiuso → reparti liberi), 17 (ritirata fuori teatro → sganciato alla sync successiva), 18 (`frontId` che punta a un fronte inesistente → azzerato).

---

## 7. P1-1 — l'id di un reparto è immutabile

**Causa**: `reassign` ricalcolava l'id dal numero libero dell'armata di arrivo (`unitIdFor(targetArmy.id, nextNumber)`) e spostava anche `regionId`/`regionName` sull'armata di arrivo. Un reparto che cambiava catena di comando cambiava **identità**: storia di combattimento, battle records, riferimenti UI, ciclo di vita del fronte e debug si rompevano. Peggio: la mappa dichiarava ancora `level = 4`, e il reparto «mancante» veniva ricreato (`cadre`) come unità `forming` senza uomini.

**Nuova semantica**:

- `unit.id` non cambia **mai** (reassign, transfer, reinforce, reequip, ordine, fronte, combattimento, reload);
- `unitIdFor()` si usa **solo** alla nascita di un reparto nuovo (seed iniziale, `raise_formation`);
- **`reassign` = cambio di catena di comando**: cambia **solo** `armyId` (e `updatedDate`). `regionId`, `regionName`, `name`, uomini, pezzi, ordine, `frontId` restano quelli del reparto;
- `dryRun` non scrive nulla; l'anteprima mostra lo stato **dopo** (armata di arrivo) ma con l'id di sempre.

Test: 10 (`armyId` cambia, id e posizione no), 11 (`dryRun`), 12 (`transfer`, `reinforce`, `reequip` e ricaricamento dal DB conservano l'id), 13 (le due armate restano la somma dei reparti: totale invariato).

---

## 8. P1-2 — phantom unit: nessun reparto inventato dal livello della mappa

**Prima**: `syncArmies()` usava `army.formations` (derivato dal `level` della mappa) come numero-target. Dopo lo spostamento di un reparto da A (4) a B (1), l'armata A aveva 3 reparti persistiti ma il target restava 4 → nasceva un reparto `forming` con 0 uomini. Dopo un reload lo stesso meccanismo ricreava reparti dal `level`: la mappa era una **seconda fonte di verità**.

**Nuova regola** (una sola direzione):

| Momento | Fonte del numero di reparti |
|---|---|
| mai materializzata (nessun reparto persistito, nessun numero scritto) | `level` della mappa — **seed**, una volta sola |
| già materializzata | `MilitaryUnit[]` — la lista dei reparti **è** la fonte autorevole |
| armata svuotata e poi ricaricata | il numero **reale** scritto sull'oggetto della mappa (`object.formations`) |

Implementazione (minimo diff):

- `syncArmies()`: `target = existing.length > 0 ? existing.length : (persistedFormations ?? army.formations)`;
- `saveArmiesForSession()` scrive sull'oggetto della mappa `object.formations = round(state.formations)` — il **fatto**, accanto a `personnel`/`equipment`/`monthlyNeeds`/`status` che già venivano scritti lì;
- `armySeedsForObjects()` legge `object.formations` come `persistedFormations` (campo opzionale di `SeedArmyInput`), **senza toccare `level`**;
- `aggregateArmyFromUnits(army, [])`: un'armata **già materializzata** senza reparti è la somma di zero reparti → `formations = 0` (e non l'aggregato vecchio, che risaliva sulla mappa e faceva rinascere i reparti). Un'armata **legacy** (mai materializzata) o dichiarata con `formations = 0` e un fabbisogno proprio conserva il valore dichiarato;
- in `MilitaryService.reassign` è sparita la materializzazione del `cadre` (`materializeUnitsForArmy`) e la nota «ne nasce uno in formazione, senza uomini».

**Perché `level` non diventa il numero reale**: `level` alimenta `account.forces` (`WorldStateEngine`: `account.forces += level`) e quindi la **guarnigione** (`totalFormations − accounted`) e `baseline.forces`. Riscriverlo sui reparti reali avrebbe spostato uomini fra armate e guarnigione: `level` resta la dichiarazione del mondo, il numero reale viaggia come fatto sul medesimo oggetto.

Test: 13 (invariante del totale, anche dopo un secondo `snapshot()`), 14 (nessun `forming personnel = 0` creato dal livello), 28 (reload dal database senza reparti fantasma).

---

## 9. P1-3 — il trasferimento ha geografia e distanza

**Prima**: `transfer` verificava solo che la provincia fosse del paese, poi chiamava `movementCost(before)` **senza distanza** — un reparto «teletrasportato» pagava sempre come una tratta.

**Ora** (`src/utils/region-path.ts`, nuovo, funzione **pura**, ~3 KB):

```ts
friendlyRegionPath({ fromRegionId, toRegionId, owner, regions }): string[] | null
regionHops(path) = max(0, path.length - 1)
```

**Algoritmo** — BFS deterministica **sui `region.borders` esistenti** (nessun secondo grafo, nessun nuovo servizio):

1. si attraversano **solo** province con `owner === owner` (territorio controllato dal paese);
2. frontiera e vicini **ordinati** (ordine stabile: nessuna dipendenza dall'ordine di una `Map`);
3. la prima volta che si raggiunge la destinazione si ricostruisce il percorso dal predecessore;
4. se la destinazione non è raggiungibile → `null` → il trasferimento è **bloccato** con messaggio esplicito («Nessun percorso territoriale controllato fra … e …»);
5. **fallback legacy**: se **entrambe** le province non dichiarano `borders` (mappe vecchie/native senza adiacenza), il percorso è `[from, to]` (1 tratta). Una mappa legacy resta navigabile; se **almeno una** delle due dichiara confini, l'assenza di percorso **blocca** (test 23).

**Distanza e costo**: `distanceFactor = regionHops(path)` → `movementCost(stock, distanceFactor)` (la firma supportava già il parametro, la formula **non** è duplicata). Il costo entra nei fatti dell'azione: nuova riga «Distanza percorsa (tratte)» nel PRIMA → DOPO, e la nota dell'azione dichiara il numero di tratte.

**Valori misurati** (test 24, 25): 1 tratta = **0,15** di cibo, 3 tratte = **0,45** = esattamente 3× (il costo del motore è lineare nel `distanceFactor`).

| caso | esito |
|---|---|
| adiacente (1 tratta) | ok — id, uomini e pezzi invariati |
| 2 tratte (A→B→C) | ok — id, uomini e pezzi invariati |
| 3 tratte (A→B→C→D) | ok — costa **3×** la prima |
| isola senza confini / exclave dietro territorio ostile | **bloccato**: nessun percorso controllato |
| destinazione **estera** | **rifiutata** (`region_unknown`): l'invasione è del `WarFront`, non di `unitAction.transfer` |
| lasciando il teatro | `frontId = null` (regola P0-3) |

`transferRegion()` resta l'**unico** percorso di cambio di proprietario: `transfer` sposta un reparto, non conquista territorio. Nessun travel time, nessun convoglio, nessuna ferrovia (fuori ambito dichiarato).

---

## 10. P2 — modello NPC reale (dichiarazione senza ambiguità)

Verificato sullo store e sul codice dei servizi (test 29):

```
Player uses persistent MilitaryUnit?              YES
NPC uses persistent MilitaryUnit?                 NO
NPC losses applied to MilitaryUnit?               NO
NPC losses applied only to region.militaryPower?  YES
```

Lo `OperationalStateStore` è costruito per **una** polity (`playerPolityId`, `playerRegionsForObjects()`, `armySeedsForObjects()`): materializza i reparti del **giocatore**. L'NPC porta la sua forza in battaglia come `SideStrength.legacyRaw` (potenza dichiarata dalla mappa) e la perde **lì**: `FrontResolution.legacyLost` erode `region.militaryPower`, mai una riga `unit` di un altro paese. Il test 29 verifica entrambe le metà: il giocatore ha reparti con id stabili e `monthlyNeeds`, l'NPC no — e la sua `militaryPower` **scende** dopo i mesi di guerra.

Conseguenza dichiarata: i due lati combattono con lo **stesso** `FrontEngine` e le stesse formule; cambia **chi sceglie l'ordine** (il giocatore dal pannello, l'NPC dalla policy deterministica `npcFrontOrder`) e **cosa** viene consumato (reparti per il giocatore, potenza dichiarata per l'NPC). Unità NPC persistenti richiederebbero uno store multi-polity: **fuori ambito**, non implementato.

---

## 11. Limiti residui (dichiarati, non nascosti)

1. **NPC legacy**: l'NPC non ha reparti persistiti; il suo logoramento è sulla potenza dichiarata. Un futuro «esercito NPC» è un refactor dello store, non una patch.
2. **Save vecchi**: un save senza `operationalState` non ha checkpoint dello stato operativo: dopo un rewind su un save vecchio i reparti restano quelli correnti (comportamento scelto: non cancellare). Dal primo save nuovo il problema non esiste.
3. **Geografia senza `borders`**: per le mappe che non dichiarano adiacenze il trasferimento resta una tratta diretta (fallback dichiarato). Il backfill dei `borders` legacy è un lavoro di dati, non di motore.
4. **`transfer` immediato**: nessun tempo di percorrenza, nessun movimento in corso, nessun consumo durante il viaggio (dichiarato fuori ambito).
5. **Guarnigione svuotata artificialmente**: se le righe `unit` di un'armata senza oggetto di mappa (`${polityId}-garrison`, che non ha un `object.formations` da cui leggere il fatto) venissero cancellate fuori dal motore, la prima lettura la ri-materializza dal residuo del livello. Non è un percorso raggiungibile dalle azioni di gioco (nessuna azione cancella reparti) ed è il prezzo per non toccare `account.forces`.
6. **`level` non riallineato**: la mappa continua a dichiarare il livello iniziale. È voluto (`account.forces`, guarnigione, `baseline.forces`): la UI legge i reparti reali, non il livello.
7. **Reparti distrutti**: restano nel fronte in cui sono caduti (storia), non vengono rimossi né ricostituiti (ricostituzione = PR3).

---

## 12. Congelamento del core (nota di trasparenza)

Le uniche modifiche dentro `core/` sono **additive e documentate**:

- `core/simulation/OperationalObjects.ts`: `OperationalRegion.owner?` e `OperationalRegion.borders?` (campi opzionali della proiezione: le regioni si usano per il piazzamento, non vengono diffuse nell'output);
- `core/simulation/OperationalState.ts`: `SeedArmyInput.persistedFormations?` (campo opzionale) e il caso «armata già materializzata senza reparti = somma di zero reparti» in `aggregateArmyFromUnits`;
- `core/simulation/WarFronts.ts`, `MaterialEconomy.ts`, `PersonnelStock.ts`, `UnitOrder…`: **nessuna modifica** (costanti, `FrontEngine`, `unitReadiness`, `frontRollSeed`, `stableRoll` intatti).

Nessuna nuova simulazione, nessun secondo stato, nessuna seconda fonte di verità: `MilitaryUnit[]` resta l'unica fonte dei reparti, la mappa resta il seed e il registro dei fatti, gli oggetti operativi restano l'unica persistenza.

---

## 13. Test

Nuovo file `backend-nest/tests/military-warfront-integrity.test.ts` — **29 test**, mondo di prova dedicato con confini **espliciti** (`ITA1—ITA2—ITA3—ITA4` catena da 1/2/3 tratte, `ITA5` isola, `ITA6` exclave dietro `AUT1`, `AUT1—AUT2`, `FRA1`), checkpoint via `session.save()` + riga `saves`, restore via `session.loadFromSave()`, ricaricamento via `registry.removeSession()`/`getSession()`.

| gruppo | test |
|---|---|
| P0-1 save/rewind/branch | 1–9 (tutti i kind, ordine deterministico, nessun `recorded_at`, rewind di unità e fronti, oggetto creato/cancellato, stessa istanza, `semanticStateHash`, legacy save, `rows: []`) |
| P1-1/P1-2 identità e phantom | 10–14 |
| P0-3 teatro | 15–18 |
| P0-2 consumo | 19–22 |
| P1-3 geografia | 23–27 |
| save/reload completo + NPC | 28–29 |

**I test falliscono sul codice precedente**: con le sorgenti di `main` (`e1b8687`) applicate e il solo file di test nuovo, **21 dei 29 test falliscono** (`21 failed | 8 passed`). I test aggiornati di `military-units.test.ts` (8: «il livello della mappa è *seed*…», 20: «Cambia armata sposta il reparto, l'id resta…») e di `war-fronts.test.ts` (16: «il fronte NON sottrae scorte…») falliscono anch'essi sul codice precedente.

Nessun `Math.random`, nessun `Date.now` come seed: tutti i roll passano da `frontRollSeed` → `stableRoll`.

---

## 14. Quality gate

| Verifica | Comando | Esito |
|---|---|---|
| Backend typecheck | `npx tsc --noEmit` | ✅ pulito |
| Backend test | `npx vitest run` | ✅ **160 file / 1577 test** (era 159/1548: +1 file, +29 test) |
| Backend build | `npm run build` | ✅ |
| Frontend typecheck | `npx tsc --noEmit` | ✅ pulito |
| Frontend test | `npx vitest run` | ✅ **67 file / 494 test** |
| Frontend build | `npm run build` | ✅ |
| E2E mock | `node_modules/.bin/playwright test` | ✅ **49 passed** |

Endpoint inventory: **106**, invariata. Endpoint mantenuti: `GET /military/units`, `GET /military/fronts`, `POST /military/units/:id/:action`, `POST /military/units/:id/order`. **Nessuna nuova schermata.** La UI non ha bisogno di workaround: l'id stabile è lo stesso che `ObjectsBoard` usa per trovare il reparto, e un `frontId` sganciato mostra automaticamente «nessun fronte».

Regressione PR #81 verificata dai test esistenti (verdi): creazione fronti, obiettivo, i quattro ordini, perdite reali, attrito degli equipaggiamenti, ritirata, sfondamento, conquista via `transferRegion`, roll deterministici, fallback legacy sulle coppie di province.

---

## 15. File toccati

| File | Modifica |
|---|---|
| `src/repositories/operational-object.repository.ts` | `OperationalObjectsSnapshot`, `OPERATIONAL_OBJECTS_SCHEMA`, `snapshot()`, `replaceAll()` |
| `src/repositories/index.ts` | export del tipo e dello schema |
| `src/game-session.ts` | `SaveData.operationalState`, cattura nel checkpoint, `invalidate()` su apply/restore, `owner`/`borders` nella proiezione regioni, `object.formations` scritto sull'oggetto della mappa, `persistedFormations` nel seed |
| `src/game/GamePersistenceService.ts` | `replaceAll` dentro la transazione canonica (legacy: non tocca) |
| `src/game/OperationalStateStore.ts` | `invalidate()`, `orderConsumptionFactor()`, `militaryNeeds()` per armata (reparti → ordine; armata senza reparti → dichiarato), target di `syncArmies()` |
| `src/game/WarFrontService.ts` | `detachOutOfTheatre()`, filtro di teatro in `sides()`, rimozione della sottrazione duplicata, doc della semantica di supply |
| `src/game/MilitaryService.ts` | `transfer` con percorso e distanza, `reassign` id-immutabile senza `cadre` |
| `src/utils/region-path.ts` | **nuovo**: `friendlyRegionPath`, `regionHops` |
| `src/core/simulation/OperationalObjects.ts` | `OperationalRegion.owner?`, `.borders?` |
| `src/core/simulation/OperationalState.ts` | `SeedArmyInput.persistedFormations?`, aggregato di un'armata svuotata |
| `tests/military-units.test.ts`, `tests/war-fronts.test.ts` | due test riallineati alla semantica corretta (livello = seed; il fronte non sottrae) |
| `tests/military-warfront-integrity.test.ts` | **nuovo**: 29 test |

---

## 16. Comportamento di branch

Poiché lo stato operativo entra nel **checkpoint del salvataggio** (non in una tabella a parte), ogni branch che parte da un salvataggio eredita esattamente l'insieme di oggetti di quel punto:

- caricando un checkpoint, il branch legge `operationalState.rows` di quel momento → reparti e fronti sono quelli del checkpoint;
- `replaceAll` è **per partita** e sostituisce l'insieme in blocco: le righe di un branch non possono mescolarsi con quelle di un altro;
- l'`invalidate()` garantisce che anche una sessione già aperta sullo stesso `gameId` (playback, rewind nella stessa schermata) rilegga lo stato.

(Il percorso di diramazione è lo stesso `loadFromSave()` coperto dai test 2–9; non è stata aperta una PR di branch dedicata.)

---

## 17. Esito GitHub Actions

PR dedicata **#83** («MILITARY/WARFRONT INTEGRITY — identità, rewind, logistica e contabilità materiale»).

| Check | Esito |
|---|---|
| `test-build` (backend test + build, frontend test + build) | ✅ **success** |
| `e2e-mock` (Playwright su mock API) | ✅ **success** |
| `mergeable` | ✅ `true` (`state = clean`) |

La PR **non** è stata mergiata da chi ha scritto il codice: il merge è del proprietario del repository.

---

# WARFRONT SUPPLY/TICK CONSISTENCY — copertura del periodo e sincronizzazione prima del tick

> PR dedicata, di **correzione della base** di PR #83. Nessuna funzione nuova di
> guerra (contrattacco, accerchiamento, ricostituzione reparti, aviazione, marina:
> fuori ambito). Il congelamento del core vale anche qui: le due modifiche in
> `core/simulation/` sono **additive e pure** (§12-bis).

## 18. Obiettivo e difetto corretto

Due numeri della guerra erano **letti nel momento sbagliato**:

1. **La copertura del rifornimento** (`supplyCoverage`) era dedotta dallo stock
   **residuo**, cioè *dopo* che il materiale del periodo era già stato speso. Un
   reparto con le scorte esattamente pari al fabbisogno finiva a magazzino zero:
   il fronte leggeva «zero materiale» e combatteva come se non fosse mai stato
   rifornito. Il periodo **vissuto** era pieno; quello **misurato** era vuoto.
2. **Lo stato del fronte era assestato dopo il tick materiale.** Un reparto
   trasferito fuori dal teatro pagava ancora il coefficiente di guerra (×1,8)
   per un periodo in cui non combatteva, perché il fabbisogno veniva calcolato
   prima dello sgancio.

Nessuna delle due correzioni aggiunge una seconda fonte di verità: la copertura è
un **dato transitorio del tick**, il fronte resta puro, il fabbisogno resta
`militaryNeeds()`.

## 19. P0-A — la copertura è il periodo vissuto

Definizione applicata, in `core/simulation/MaterialEconomy.ts`:

```
required  = fabbisogno del periodo        (quello che il motore ha già sottratto)
available = max(0, stock_iniziale + produzione + required)   // stessa aritmetica di advanceStock
fulfilled = min(required, available)
coverage  = required <= 0 ? 1 : fulfilled / required         // 0..1, mai NaN
```

- nuovo tipo `MaterialFulfillment { food; clothing; weapons; fuel }` (quote 0..1);
- nuova funzione **pura** `materialFulfillment({ stock, flow, period, required })`,
  chiamata **dentro** `advanceStock` (nessun secondo percorso, nessun secondo
  calcolo: la stessa aritmetica del tick, riordinata);
- il rapporto di copertura è calcolato sul **fabbisogno militare** del periodo
  (`needsOverride ?? overlay.militaryNeeds ?? legacyMilitaryNeeds(account)`) —
  è il fabbisogno che il fronte consuma;
- `MaterialTick.fulfillment` lo espone al chiamante; **non** viene persistito
  (dato del tick, non dello stato).

Il fronte **legge** e non ricalcola: `WarFrontService` tiene una `Map` transitoria
`periodCoverage` e la espone con `periodSupply(polityId)`; `sides()` preferisce
questa copertura (clamp 0..1) e ricade sul `supplyCoverage` documentato solo
quando non è disponibile. `FrontEngine`/`WarFronts` restano **puri** (nessuna
lettura di DB o di store).

Misure reali (mondo di test, fabbisogno armamenti del periodo 3,44, reparti in
teatro con ordine d'attacco):

| Caso | disponibilità | copertura | stock finale | carenza |
|---|---|---|---|---|
| fabbisogno esatto | 10 / 10 | **1** | **0** | no |
| metà fabbisogno | 4 / 10 | **0,4** | 0 | sì |
| nessun materiale | 0 / 10 | **0** | 0 | sì |
| scorte abbondanti | 1000 / 10 | **1** | 160 (tetto) | no |
| produzione 4 + stock 6 | 10 / 10 | **1** | **0** | no |
| produzione 4 + prelievi 6 + stock 6 | 4 / 10 | **0,4** | 0 | sì |
| periodo parziale 15 gg (fabbisogno 5) | 5 / 5 | **1** | **0** | no |
| periodo parziale 15 gg | 2,5 / 5 | **0,5** | 0 | sì |
| fabbisogno zero | — | **1** | 0 | no (nessun NaN) |

Sul fronte (pressione d'attacco del periodo):

| Partita | copertura | pressione | stock finale | carenza |
|---|---|---|---|---|
| scorte esatte (3,44) | 1 | **1,3061** | **0** | no |
| scorte abbondanti (34,4) | 1 | **1,3061** | 30,96 | no |
| nessun armamento | 0 | **0,8509** | 0 | sì |

La partita con le scorte **esatte** combatte come quella con dieci volte tanto
(pressione identica) e meglio di chi non ha armamenti: prima della correzione la
prima sarebbe stata letta a zero e avrebbe combattuto come la terza.

Degradazione **periodo per periodo** (sei turni da 30 giorni, date canoniche):

| Scorte iniziali | coperture | pressioni | carenze |
|---|---|---|---|
| 6 mesi | 1,1,1,1,1,1 | 1,3061 → 0,5960 | nessuna |
| 1 mese | **1,0,0,0,0,0** | 1,3061 → 0,4731 | dal 2º periodo |
| 0 mesi | 0,0,0,0,0,0 | 0,8509 → 0,4577 | dal 1º periodo |

Il primo periodo della partita «1 mese» ha copertura **1** e la **stessa**
pressione della partita con sei mesi (1,3061): una copertura unica calcolata sul
salto intero avrebbe dato zero anche a lui.

## 20. P0-B — lo stato del fronte si assesta **prima** del fabbisogno

Regola unica, esportata da `core/simulation/WarFronts.ts`:

```ts
unitIsActiveOnFront({ unit, front, unitPolityId? })
// reparto vivo + fronte assegnato + reparto **davvero** nel teatro del fronte
```

Usata in **un solo posto per ciascun consumatore**: `orderConsumptionFactor`
(fabbisogno materiale), `detachOutOfTheatre` (sincronizzazione), `sides()` del
front service. Non esistono più tre versioni della stessa regola.

La sincronizzazione gira **prima** del tick materiale: `NationStateService` espone
l'hook `MaterialAdvanceHooks.beforePlayerSlice`, e `GameSession` vi collega
`warFronts.syncFronts()` (in `try/catch`: un errore di sincronizzazione non
impedisce il tick). Il materiale del periodo vede quindi lo stato **assestato**,
non quello del turno precedente.

Misure reali:

| Caso | fabbisogno | effetto del periodo |
|---|---|---|
| reparto trasferito fuori teatro | **3,44 → 3,28** (−0,16 = 0,2×0,8) | nessuna carenza, stock 0 con scorte esatte, `frontId = null` |
| `frontId` su un fronte inesistente | **3,44 → 3,28** | nessun coefficiente di guerra |
| fronte chiuso (pace) | tutti i reparti ×1 | fronte `closed`, eventi di chiusura, nessuna carenza |
| reparto distrutto | consumo 0, contributo 0 | resta distrutto, non combatte |

Costo: un `syncFronts()` in più per periodo. È **idempotente** (assegnazioni,
sganci e aggiornamento dei fronti scrivono solo se cambiano) e il tick fronte
successivo rilegge lo stesso stato: nessun doppio effetto misurato (`frontId`,
pressioni e perdite identici con e senza il richiamo aggiuntivo nei test 33–41).

## 21. P1 — i rami dello stato operativo bastano così

Test **A → B → A** sui rami reali (`loadFromSave` con `newBranch`, checkpoint di
`game_operational_objects`):

| Passo | uomini in memoria | pressione fronte | riga su DB |
|---|---|---|---|
| ramo A | 7000 | 0,4 | 7000 |
| ramo B | 12000 | 0,1 | 12000 |
| ramo A (di nuovo) | **7000** | **0,4** | **7000** |

L'hash semantico dei due checkpoint è **diverso** (lo stato operativo è parte del
confronto), i rami nascono dallo stesso checkpoint e l'insieme delle righe di un
ramo non si mescola con l'altro. **Non è stato aggiunto `branch_id`** a
`game_operational_objects`: il checkpoint e `replaceAll` (PR #83) bastano, e il
test lo dimostra.

## 22. Test aggiunti (12: numeri 30–41)

`tests/military-warfront-integrity.test.ts`, sezioni **«P0-4 — supply/tick
consistency»**, **«P0-B — sincronizzazione prima del tick»**, **«P1-4 — rami dello
stato operativo»** e **«coerenza del salto lungo»**:

| # | Cosa verifica |
|---|---|
| 30 | fabbisogno esatto → 1 con stock 0; metà → 0,4; zero → 0; abbondante → 1; fabbisogno nullo → 1 (niente NaN) |
| 31 | disponibilità **quella** del motore: produzione del periodo inclusa, prelievi degli impianti esclusi |
| 32 | periodo parziale (15 gg): fabbisogno e disponibilità dimezzati |
| 33 | il fronte usa la copertura del periodo: esatto = abbondante > zero, stock esatto ≈ 0 |
| 34 | sei periodi con un mese di scorte: copertura 1 al primo periodo e 0 dal secondo, pressione coerente, carenze dal 2º |
| 35 | reparto distrutto: consumo 0 e nessun contributo |
| 36 | trasferito fuori teatro: il periodo successivo paga ×1, senza sincronizzazione manuale |
| 37 | pace prima del tick: fronte chiuso, reparti liberi, nessun ultimo mese di guerra |
| 38 | `frontId` inesistente: nessun coefficiente di guerra, e il fantasma non sopravvive alla sincronizzazione |
| 39 | il livello della mappa non apre un fronte senza contatto |
| 40 | rami A ↔ B ↔ A: memoria e DB identici a ogni ripristino, hash diversi |
| 41 | 180 giorni e sei turni da 30 sono la stessa storia (scorte, uomini, pezzi, fronte) |

**Magneticità verificata** (`git stash push -- backend-nest/src`, test nuovi sul
codice precedente): **8 failed | 33 passed** — falliscono 30, 31, 32, 33, 34, 36,
37, 38. I test 35, 39, 40, 41 sono **guardie** (comportamento già corretto o
equivalenza) e passano su entrambe le versioni: sono dichiarati come tali.

## 23. Quality gate (eseguito, non presunto)

| Comando | Esito |
|---|---|
| backend `npx tsc --noEmit` | ✅ |
| backend `npx vitest run` | ✅ **160 file / 1589 test** (erano 160/1577: +12) |
| backend `npm run build` | ✅ |
| frontend `npx tsc --noEmit` | ✅ |
| frontend `npx vitest run` | ✅ **67 file / 494 test** |
| frontend `npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **49 passed** |
| inventario endpoint | 106 (invariato) |

## 24. File toccati

- `src/core/simulation/MaterialEconomy.ts` — `MaterialFulfillment`, `materialFulfillment()` (pura), `MaterialTick.fulfillment`;
- `src/core/simulation/WarFronts.ts` — `unitIsActiveOnFront()` condivisa (pura);
- `src/game/OperationalStateStore.ts` — `orderConsumptionFactor(unit, front)` sulla regola condivisa; `militaryNeeds()` con mappa dei fronti;
- `src/game/WarFrontService.ts` — `FrontTickOptions.supply`, `periodSupply()`, `sides(...)` con copertura del periodo, `advanceFronts(days, date?, options?)`, `detachOutOfTheatre` sulla regola condivisa;
- `src/game/NationStateService.ts` — `MaterialSliceInfo.fulfillment`, `MaterialAdvanceHooks.beforePlayerSlice`, ritorno di `advancePolityMaterialStep`;
- `src/game-session.ts` — hook `beforePlayerSlice` → `syncFronts()`, passaggio della copertura a `advanceFronts`;
- `tests/military-warfront-integrity.test.ts` — 12 test nuovi;
- `docs/implementation/MILITARY-WARFRONT-INTEGRITY-report.md` — questa sezione.

### 24-bis. Congelamento del core (nota di trasparenza, §12-bis)

Due soli file di `core/`, entrambi **additivi e puri**:

- `MaterialEconomy.ts`: una funzione pura nuova e un campo nuovo di un tipo di
  ritorno (`MaterialTick.fulfillment`). Nessuna costante di guerra toccata;
  l'aritmetica del tick è la stessa, solo **riordinata** per misurare *prima*
  della sottrazione.
- `WarFronts.ts`: una funzione pura nuova esportata. **Nessuna** costante
  modificata (ordini 1,8/1,2/0,8/1,0, `COMBAT_LOSS_PER_MONTH`,
  `BREAKTHROUGH_RATIO`, `COLLAPSE_RATIO`, `STALEMATE_BAND`, `frontRollSeed`,
  `stableRoll`, `friendlyRegionPath`: intatti). `supplyCoverage` resta come
  ricaduta documentata.

Nessun nuovo stato persistito, nessuna migrazione, nessuna seconda simulazione.

## 25. Limiti residui (dichiarati)

1. **Copertura di un solo periodo**: la `Map` transitoria vale per l'ultimo
   periodo avanzato. Un consumatore che volesse la serie storica dovrebbe
   registrarla (non richiesto, e non persistito di proposito).
2. **`frontId` fantasma**: lo sgancio dell'assegnazione invalida avviene nella
   stessa passata in cui si assegnano i reparti liberi, quindi il reparto
   fantasma torna sul fronte **vero** alla sincronizzazione successiva (due
   chiamate). Nel frattempo paga ×1 (mai il coefficiente di guerra).
3. **Copertura NPC**: il lato NPC legacy non ha reparti persistiti, quindi non ha
   una copertura per reparto: resta la ricaduta dichiarata `supplyCoverage`.
4. **Nessun tempo di movimento** nel trasferimento (già dichiarato in §11):
   il reparto è fuori teatro subito, quindi paga ×1 dal periodo successivo.
5. **Salvataggi vecchi**: nessuna copertura nei save precedenti (dato del tick,
   non dello stato): dopo un caricamento il primo periodo ricalcola tutto.

## 26. Non implementato (fuori ambito, dichiarato)

Reparti NPC persistiti; contrattacco; avanzata del difensore; ricostituzione dei
reparti distrutti; accerchiamento; tempo di movimento strategico; fronte navale;
guerra aerea. Nessuno di questi è stato toccato o simulato in questa PR.

## 27. Esito GitHub Actions (PR #84 — WARFRONT SUPPLY/TICK CONSISTENCY)

PR dedicata **#84** («WARFRONT SUPPLY/TICK CONSISTENCY — copertura del periodo e
sincronizzazione prima del tick»), ramo `fix/warfront-supply-tick`, base
`main = 56ea21c`.

| Check | Esito |
|---|---|
| `test-build` (backend test + build, frontend test + build) | ✅ **success** |
| `e2e-mock` (Playwright su mock API) | ✅ **success** |
| `mergeable` | ✅ `true` (`state = clean`) |

La PR **non** è stata mergiata da chi ha scritto il codice: il merge è del
proprietario del repository.
