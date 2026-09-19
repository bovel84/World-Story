# MILITARY PR3 — WAR GAMEPLAY DYNAMICS

**Contrattacchi, avanzata bidirezionale, recupero reparti e ricostituzione**

Base: `main = 9bca9f8` (PR #86 mergiata). Ramo `feat/military-pr3-war-dynamics`.
Tre commit separabili: **A** motore puro, **B+C** integrazione servizio e recupero,
**D** ricostituzione e read model.

---

## 1. Stato iniziale e limite precedente

Il fronte era **direzionale**: `attackerPolityId` poteva sfondare e conquistare,
`defenderPolityId` poteva solo resistere o far **collassare** l'avversario. Il
difensore non poteva mai avanzare, nemmeno contrattaccando con ordine `attack`:
il motore non aveva un concetto di **iniziativa del periodo**, e i ruoli storici
del fronte decidevano chi poteva muoversi. Inoltre `retreating` era uno stato
**terminale di fatto**: un reparto ripiegato restava fuori linea per sempre.

Nessuno dei due limiti era un bug di integrità: il core era corretto, mancava la
**dinamica** di gioco. PR3 aggiunge quella, senza riaprire identità, aggragazione
delle armate, movimento, fulfillment, consumi, supply NPC, capacità strutturale,
time-step, save/rewind/branch (tutti invariati e sotto test).

## 2. Ruolo storico ≠ iniziativa del periodo

`attackerPolityId` / `defenderPolityId` restano **memoria dell'origine** del
fronte: stabili, persistenti, usati da id, nome, obiettivo dichiarato e read
model. Chi **avanza** nel periodo lo decide il motore con `advance.side`,
calcolato dai fatti del periodo (pressione, ordini, sfondamento). Un fronte non
cambia identità perché cambia chi ha l'iniziativa: `frontIdFor()` è non
direzionale e una coppia di polity resta **un solo fronte**.

## 3. Intento offensivo (commit A)

`sideHasOffensiveIntent({ units, legacyOrder })`:

| parte | intento offensivo |
|---|---|
| con reparti persistenti | almeno un reparto attivo con `order = attack` |
| senza reparti (quota dichiarata) | `legacyOrder = attack` (da `npcFrontOrder`) |

`withdraw` non è **mai** offensivo (nemmeno se il reparto è in rotta), `defend` e
`reserve` non lo sono. La funzione è pura e non sa chi sia il giocatore: vale
identica per player e NPC, e leggerà le unità NPC quando esisteranno (la quota
legacy conta **solo** se non ci sono reparti).

## 4. Sfondamento bidirezionale

Una **sola** formula, applicata alle due parti, con la stessa soglia:

```
passed = !bothZero
      && pressureRatio >= BREAKTHROUGH_RATIO      (1,5)
      && !selfRouted && opponentRouted
      && offensiveIntent
      && roll < BREAKTHROUGH_CHANCE               (0,55)
```

Nessuna costante nuova (`DEFENDER_BREAKTHROUGH_RATIO`, `COUNTERATTACK_CHANCE`
non esistono). Semi deterministici distinti: l'attaccante conserva
`phase: 'breakthrough'` (**nessun cambio del flusso dei tiri già usati**), il
contrattacco usa `'breakthrough-defender'`. `SideBreakthrough` espone per parte
`pressureRatio`, `opponentRouted`, `offensiveIntent`, `passedRoll`, `passed`.

`collapsedSide` rende esplicito chi non tiene più il fronte: lo status
`collapsed` non è più implicitamente «dell'attaccante». `breakthrough` significa
ora «**una delle parti** ha sfondato».

## 5. `TerritorialAdvance` e selezione dell'obiettivo

Un solo campo neutrale, niente `counterAdvance`:

```ts
interface TerritorialAdvance {
  side: 'attacker' | 'defender';
  advancingPolityId: string;
  retreatingPolityId: string;
  objectiveRegionId: string;
  regionName: string | null;
}
```

`frontObjectiveForSide({ theatre, advancingPolityId, opposingPolityId,
preferredRegionId })` seleziona il bersaglio con le **stesse** regole di
`frontObjectiveFor` (provincia dell'avversario, adiacente a territorio proprio
via `borders` reali, scelta deterministica: meno difesa, poi id). L'obiettivo
dichiarato dal fronte vale **solo se è ancora valido**: dopo una conquista non
resta nessun obiettivo stale (né proprio, né non più adiacente). Una provincia
di **terza** polity non è mai un bersaglio e non esiste alcun teletrasporto.

**Retake**: chi difende può riconquistare ciò che ha perso — la provincia è ora
dell'avversario, quindi è un obiettivo legittimo — e **dopo** il retake la
controffensiva può entrare nel territorio originario avversario: nessuna barriera
artificiale, nessuna memoria dell'ownership storica.

## 6. Integrazione servizio (commit B)

- **Conquista generica**, una sola authority: `transferRegion(region,
  advance.advancingPolityId)` e **verifica** che la provincia sia ancora del
  `retreatingPolityId` (difesa in profondità: se è cambiata, non si trasferisce
  nulla). Nessuna scrittura a mano di `region.owner`.
- **Ritirata**: resta `retreatRegionFor()` con geografia reale (provincia amica
  adiacente, fuori dal teatro e dagli obiettivi).
- **Teatro e obiettivo**: non si toccano a mano dopo l'avanzata; li ricostruisce
  `syncFronts()` dal nuovo confine al periodo successivo.
- **Dispacci col dato reale**: «Italia conquista …», «Austria **contrattacca e
  conquista** …», e per il collasso «… non tiene più il fronte».
- **NPC**: nessuna MilitaryUnit NPC (fuori ambito). L'NPC difensore storico con
  `npcFrontOrder = attack` e player collassato **avanza**, con lo stesso motore
  (test 29).

### 6-bis. Fix di contorno emerso in PR3

Lo **sgancio** fuori teatro (`detachOutOfTheatre`) non riscrive più
`updatedDate`: è bookkeeping (toglie il `frontId`), e riscriverlo — in certi
percorsi con una data più **vecchia** del fatto — faceva rientrare in anticipo i
reparti in ritirata, azzerando il conteggio dei giorni.

## 7. Recupero dei reparti (commit C)

`rallyRetreatingUnits()` è un pass **deterministico** dentro il tick del fronte:

| condizione | regola |
|---|---|
| stato | `retreating` **e** `frontId = null` (chi è ancora nel teatro segue prima le regole del fronte) |
| territorio | regione del paese giocatore o di un suo alleato |
| tempo | `daysBetween(unit.updatedDate, date) >= 30` (`RALLY_DAYS`) |
| effetto | **solo** `readiness` e `status` ricalcolati (`unitStatusFromCoverage`, `unitReadiness`, soglia organica) |
| invarianti | `personnel` ed `equipment` **invariati**; `destroyed` non si rianima **mai** |

Il rally **non è una cura** e non è una ricostituzione: un reparto che rientra
può essere `degraded` (sotto organico o sotto copertura) o `operational`, mai
«operativo per decreto». Tutto vive in `MilitaryUnitState` (già snapshot,
replay e branch-safe): nessuna tabella nuova, nessuna modifica a `SaveData`.

## 8. Ricostituzione (commit D)

**Nessun motore nuovo**: `reconstitute` è l'orchestrazione **atomica** delle
primitive esistenti — `transferMenToArmy` (riserva addestrata → reparto) e
`transferEquipment` (deposito → reparto). Conservazione verificata: riserva ↓ =
reparto ↑, deposito ↓ = assegnato ↑.

- target organico da `militaryManpower` (nessun 12.000 scritto a mano);
- dotazione da `rifleRequirement` + catalogo (nessuna seconda tabella TO&E);
- **blocco sul fronte**: un reparto schierato non si ricostituisce (o è fuori dal
  fronte, o è in riserva); i rinforzi già ammessi dal modello restano;
- `destroyed` non torna con lo stesso id: per una forza nuova c'è `raiseFormation`;
- senza riserva e senza deposito **non applica nulla** (nessun aggiornamento a
  metà), con anteprima PRIMA → DOPO, motivo di blocco e righe di conservazione;
- UI: l'azione entra nel pannello dei reparti **esistente** (`UNIT_ACTIONS`,
  `UnitActionId`, «Ricostituisci»). Nessun secondo pannello, nessuna mappa
  tattica, nessun pulsante finto: la regola di abilitazione nel core è la stessa
  che il servizio applica.

## 9. Read model

`WarFrontState.momentumPolityId` (opzionale) = polity con la pressione
prevalente nell'ultimo periodo risolto. È **solo lettura**: nessun bonus, nessun
moltiplicatore nascosto, nessuno snowball — serve alla UI e alla memoria del
fronte. Ordini e anteprime restano quelli esistenti (`unitOrder` con `dryRun`).

## 10. Test

`tests/war-fronts.test.ts` — **47 test**, di cui 14 di PR3:

| # | caso |
|---|---|
| 23 | `defender attack` → contrattacca e `advance.side = defender` con obiettivo nemico |
| 24 | `defender defend` → nessuna conquista, collasso dell'attaccante |
| 25 | `withdraw` mai offensivo (né conquista, né collasso) |
| 26 | obiettivo rifiutato se non adiacente o di terza polity |
| 27 | obiettivo dichiarato valido solo se ancora tale; `frontIdFor` non direzionale |
| 28 | regressione: sfondamento dell'attaccante (seme invariato) |
| 29 | **NPC difensore storico** conquista via `transferRegion` («contrattacca») |
| 30 | **player difensore storico** conquista (ruoli invertiti) |
| 31 | catena A→B→A, **stesso front id**, obiettivo aggiornato dopo il cambio di proprietà |
| 32 | contrattacco fallito + **ordini misti** del giocatore intatti |
| 33 | 90 giorni = 3×30 (owners, fronti, pressioni, reparti, scorte) |
| 34 | ritirata: < 30 giorni resta `retreating`, ≥ 30 rientra senza recuperare uomini o pezzi |
| 35 | `destroyed` non rientra nemmeno dopo 365 giorni |
| 36 | rewind e ramo isolato riportano lo stato **pre-rally** |
| 37 | ricostituzione: conservazione uomini |
| 38 | ricostituzione: conservazione deposito |
| 39 | risorse insufficienti → bloccato, nulla creato |
| 40 | blocco sul fronte, ammissione in riserva |

Test reso veritiero: #19 (stallo fra pari) ora **riarma** i reparti ogni mese,
perché senza riarmo il giocatore collassa e — con PR3 — l'NPC difensore
contrattacca: non sarebbe più uno stallo.

**Magneticità (misurata)**: con il solo `src` del motore precedente (`9bca9f8`)
e i test nuovi: **15 failed | 32 passed**. Falliscono, cioè *non esistono* su
`main`: contrattacco del difensore (23), difesa che non conquista e collasso
esplicito (24), `withdraw` mai offensivo (25), obiettivi rifiutati (26), stale
(27), regressione attaccante (28), contrattacco NPC (29) e del giocatore (30),
catena di proprietà (31), rally <30/≥30 giorni (34), rewind/rami del rally (36),
ricostituzione (37–40). Passano su entrambe le versioni — sono **guardie** e sono
dichiarate come tali — i test 32 (ordini misti intatti), 33 (90 = 3×30) e 35
(`destroyed` mai rientrato: senza alcun ciclo di rally era già vero).

Verifica eseguita **senza** toccare gli stash: `git checkout 9bca9f8 --
backend-nest/src`, suite, poi ripristino del `src` corrente.

## 11. Quality gate (eseguito)

| Comando | Esito |
|---|---|
| backend `npx tsc --noEmit` | ✅ |
| backend `npx vitest run` | ✅ **160 file / 1634 test** (erano 1616: +18) |
| backend `npm run build` | ✅ |
| frontend `npx tsc --noEmit` | ✅ |
| frontend `npx vitest run` | ✅ **67 file / 494 test** |
| frontend `npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **49 passed** |
| inventario endpoint | 106 route (lo snapshot riflette il nuovo verbo `reconstitute`) |

## 12. Invarianti rispettate

`MaterialFulfillment`, `structuralMilitaryNeeds`, `legacyWarConsumptionFactor`,
`onMaterialPeriod`/`beforeMaterialPeriod`, `storageCapacity`/`RESERVE_MONTHS`/
`seedStock`, movement BFS, unit id, `reassign`, `LEGACY_SUPPORT_WEIGHT`,
rewind/checkpoint/branch: **non toccati**. Nessuna auto-ricostruzione di
`region.militaryPower`. Nessun LLM nei numeri: chi sfonda, quante perdite e chi
cambia proprietario li decide il motore (l'LLM narra).

## 13. Limiti residui (dichiarati)

- **MilitaryUnit NPC persistenti**: gli NPC restano `militaryPower` dichiarata +
  policy deterministica (PR3 non li introduce);
- **encirclement** (accerchiamento) e **supply lines geografiche**: assenti;
- **strategic movement time**: i movimenti restano immediati (limite già noto);
- **fortifications**, **air superiority**, **naval invasions**, **amphibious
  warfare**: fuori ambito;
- **multi-front command HQ**: non esiste un livello di comando aggregato;
- **peace negotiation overhaul**: la chiusura del fronte resta legata
  all'ostilità;
- il rally è un recupero di **stato**, non di sostanza: per tornare forti servono
  riserva e deposito (ricostituzione).

## 14. Esito GitHub Actions (PR #87)

PR dedicata **#87** («MILITARY PR3 — counterattacks, bidirectional advance and
unit recovery»), ramo `feat/military-pr3-war-dynamics`, base `main = 9bca9f8`.

| Check | Esito |
|---|---|
| `test-build` | ✅ **success** (dopo un rerun: vedi sotto) |
| `e2e-mock` | ✅ **success** |
| `mergeable` | ✅ `true` (`state = clean`) |

**Nota trasparente**: il primo `test-build` è fallito su
`tests/industrial-capacity-service.test.ts` → «senza saturazione l'industria non
frena la produzione», un **flaky preesistente** già noto (circa una volta su
cinque, su un percorso che PR3 non tocca: capacità industriale). Il job fallito è
stato **rilanciato senza modifiche al codice**: `test-build` ed `e2e-mock` sono
passati. Nessun test è stato disattivato o reso permissivo.

Il merge resta al proprietario del repository.

---

# PR3 RESIDUI — atomicità della ricostituzione, read model bidirezionale, typing

Tre residui chiusi **sulla stessa PR #87**, con minimo diff e nessuna riapertura
del core (FrontEngine, soglie, perdite, fulfillment, consumi, capacità
strutturale, movimento, identità dei reparti, save/rewind, NPC: invariati).

## 15. Audit residuo

| # | Residuo | Verità prima |
|---|---|---|
| P0 | `reconstitute` **validava** in modo atomico ma **persisteva** in tre scritture separate | un errore a metà lasciava `riserva ↓ / reparto invariato / deposito ↓` |
| P1 | il fronte mostrava i ruoli storici ma **non l'iniziativa** del periodo | un fronte con difensore in pressione (1,4 vs 0,7) non lo diceva; i testi di collasso assumevano la direzione |
| P1 | `WarFrontPayload` non rappresentava il campo dell'iniziativa | il backend poteva esporre un campo che il frontend non conosceva |

**Nota di trasparenza**: durante il ciclo PR3 il campo `momentumPolityId` era
stato perso nell'albero (presente in `cf07310`, assente in `90c92e0`: un amend
aveva fotografato uno stato di lavoro non aggiornato) mentre il rapporto lo
dichiarava. Qui il campo è **reintrodotto nel tipo e assegnato dal servizio**, e
la cosa è coperta dai test 45 e 46. `attackerPolityId`/`defenderPolityId` restano
i **ruoli storici**; `momentumPolityId` è l'**iniziativa reale** del periodo.

## 16. Validazione atomica ≠ persistenza atomica

La validazione di `reconstitute` era già atomica: `transferMenToArmy`,
`transferEquipment` e `refreshUnit` calcolano i numeri e i blocchi **prima** di
qualsiasi scrittura, e `dryRun` non scrive nulla. Il difetto era dopo: la
persistenza.

**Vecchia sequenza (tre scritture indipendenti):**

```
finish(...)                                   → store.savePersonnel(personnelAfter)   (catch + warn)
                                              → store.saveUnits(nextUnits)           (persist: catch + warn)
if (!dryRun && piecesApplied > 0)
  this.saveArsenal(polityId, nextDepot)       → arsenalRepository.upsert(...)         (catch + warn)
```

Aggravante: i salvataggi opportunisti dello store fanno `catch` + `warn` e
**non rilanciano**: il chiamante poteva credere riuscita un'azione scritta a
metà. Inaccettabile per un'azione che tocca tre authority canoniche.

**Nuovo confine transazionale:**

```
militaryPersistenceRepository.reconstitute({ gameId, polityId, personnel, units, arsenal, turn, date })
  └─ db.transaction(() => {
       upsert persona (kind 'personnel', object_id = polityId)
       upsert reparti + DELETE dei mancanti (semantica di replaceKind)
       upsert arsenale (game_arsenals)
     })            ← una sola transazione, statement semplici, nessuna annidata
  poi (solo se il commit è riuscito):
    store.adoptPersisted({ personnel, units })   → cache + aggregato armate derivato
    this.arsenals.set(polityId, nextDepot)       → cache dell'arsenale
```

Il percorso è **strict**: nessun `try/catch`, un errore rilancia e la
transazione fa rollback. Il repository **non ricalcola** nessuna regola: scrive
i numeri già validati dal servizio.

## 17. Stato canonico, stato derivato, cache

```
canonical : personnel stock · MilitaryUnit[] · arsenal/depot
derived   : aggregato Army (aggregateArmyFromUnits) · oggetti regione
cache     : OperationalStateStore · Map arsenali di MilitaryService
```

`MilitaryUnit[]` resta **l'unica authority** dei reparti: l'aggregato dell'armata
è per definizione la loro somma (`aggregateArmyFromUnits`), quindi **canonical
atomicity + deterministic derived refresh**: la transazione copre le tre
authority canoniche; l'aggregato si ricalcola subito dopo dai reparti appena
persistiti (`adoptPersisted`) e, se quel refresh non riuscisse, la prossima
`saveUnits`/`syncArmies` lo ricalcola comunque dai reparti. La mappa non è mai
l'authority dei numeri.

**Semantica del commit**: le cache si toccano **solo dopo** il commit riuscito
(altrimenti ci sarebbero RAM nuova e DB vecchio); al fallimento DB, cache, unità,
riserva e deposito restano **come prima** e l'azione **non** restituisce
`applied: true` né nasconde l'errore dietro un `console.warn`.

## 18. Failure injection (non una validazione)

Il test 41 provoca un fallimento **reale dentro la transazione**: un trigger
SQLite temporaneo (`BEFORE INSERT`/`BEFORE UPDATE` su `game_arsenals` con
`RAISE(ABORT)`) fa fallire la **terza** scrittura, dopo che riserva e reparti
sono già stati scritti. Non è `reserve = 0` (quella è validazione): è un errore
di persistenza a metà transazione.

| Verifica | Esito |
|---|---|
| l'azione **rilancia** (nessun successo silenzioso) | ✅ |
| RAM (stessa sessione): riserva, uomini, fucili, deposito invariati | ✅ |
| DB (`game_operational_objects`, `game_arsenals`): righe identiche a prima | ✅ |
| conservazione `riserva + reparto` e `deposito + assegnato` intatte | ✅ |
| **nuova lettura** dalla sessione (cache nuova): stato di prima | ✅ (test 42) |
| `dryRun`: zero scritture (RAM e DB) | ✅ (test 43) |
| successo: le tre authority persistite, conservazione verificata anche sulle righe DB | ✅ (test 44) |

## 19. Read model bidirezionale

- fact **`Iniziativa`** (sezione `stato`) dal `momentumPolityId` del fronte: la
  polity con la pressione prevalente nell'ultimo periodo, `null`/«nessuna
  iniziativa netta» a pressioni pari. È **sola lettura**: non entra in pressioni,
  perdite, sfondamenti, rifornimenti o consumi (nessun bonus, nessuno snowball).
- `Attaccante`/`Difensore` restano i **ruoli storici** e lo dicono nel testo
  («non è «chi avanza» / «chi arretra»: vedi Iniziativa»).
- **Testi di collasso neutrali**: «Il fronte è collassato: una delle parti non
  tiene più il contatto (pressione nettamente sbilanciata)» — sia sul reparto sia
  sulla scheda del fronte. Prima dicevano «La pressione nemica domina» e «La
  difesa ha respinto l'attacco»: assumevano una direzione che il dato non ha
  (`collapsedSide` è transitorio in `FrontResolution` e **non** viene persistito
  per il testo).
- **`why` del fronte** generalizzato: intento offensivo + vantaggio sufficiente +
  avversario che non tiene + obiettivo adiacente valido → `transferRegion`,
  dall'attaccante storico **o** dal difensore che contrattacca.
- **`Obiettivo dichiarato`**: è dell'attaccante storico; una controffensiva
  calcola il proprio obiettivo sul confine corrente.
- **`Reparti impegnati`**: reparti **persistenti del giocatore** (l'NPC combatte
  con la forza dichiarata) — nessun reparto NPC finto.

**Frontend**: `WarFrontPayload.momentumPolityId?: string | null` (test di typing
in `operationalObjects.test.ts`); nessuna nuova struttura, nessuna nuova
schermata: le facts restano l'authority della UI.

## 20. Test e magneticità

| # | caso | magnetico su `90c92e0` |
|---|---|---|
| 41 | fallimento della persistenza → rollback, RAM e DB invariati | ✅ (fallisce) |
| 42 | dopo il rollback una **nuova lettura** dal DB vede lo stato di prima | ✅ (fallisce) |
| 43 | `dryRun` non scrive nulla | guardia (era già vero) |
| 44 | successo: tre authority persistite, conservazione sul DB | guardia |
| 45 | read model: ruolo storico **e** iniziativa, testi neutri, obiettivo dichiarato | ✅ (campo assente ⇒ nessun fact `Iniziativa`) |
| 46 | l'iniziativa segue le pressioni e **sopravvive** a save/ricarica | ✅ |
| — | frontend: il payload rappresenta `momentumPolityId` | ✅ (tipo assente) |

Verifica di magneticità eseguita con `git checkout 90c92e0 -- backend-nest/src`
(poi ripristino del `src` corrente): **41 e 42 falliscono** sul motore
precedente, perché lì le scritture erano separate e nessuna rilanciata.

## 21. Quality gate (eseguito)

| Comando | Esito |
|---|---|
| backend `npx tsc --noEmit` | ✅ |
| backend `npx vitest run` | ✅ **160 file / 1640 test** (erano 1634: +6) |
| backend `npm run build` | ✅ |
| frontend `npx tsc --noEmit` | ✅ |
| frontend `npx vitest run` | ✅ **67 file / 495 test** (+1) |
| frontend `npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **49 passed** |
| inventario endpoint | 106 route (invariato) |

## 22. Esito GitHub Actions (PR #87, head aggiornata)

PR **#87** («MILITARY PR3 — counterattacks, bidirectional advance and unit
recovery»), ramo `feat/military-pr3-war-dynamics`, base `main = 9bca9f8`:
nessuna nuova PR aperta.

| Check | Esito |
|---|---|
| `test-build` (backend test + build, frontend test + build) | ✅ **success** |
| `e2e-mock` (Playwright su mock API) | ✅ **success** |
| `mergeable` | ✅ `true` (`state = clean`) |

Nessun flaky in questo ciclo: entrambi i check sono passati al primo tentativo
(il primo `test-build` della PR, sul head precedente, era caduto su
`industrial-capacity-service` — flaky preesistente, rilanciato senza modifiche).
Il merge resta al proprietario del repository.

## 23. Limiti residui (invariati)

NPC MilitaryUnit persistenti · encirclement · supply lines geografiche ·
strategic movement time · fortifications · air/naval warfare · amphibious · HQ e
comandanti di fronte · ridisegno della negoziazione di pace. L'atomicità è
applicata **solo** a `reconstitute` (unico percorso multi-authority): `reinforce`
e `reequip` restano le primitive separate di sempre, e il rally non è toccato.
