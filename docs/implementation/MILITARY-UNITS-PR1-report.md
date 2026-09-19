# MILITARY-UNITS PR1 — I reparti sotto l'armata

**Data:** 2026-09-18 · **Base:** `main` @ `8113ab7` · **Branch:** `feat/military-units`
**Stato:** PR aperta verso `main`, **non mergiata** (come richiesto). Nessun deploy.

---

## 1. Sintesi

Prima di questo pacchetto un'armata era un **aggregato con un livello**: `formations: 4`
significava «quattro reparti», ma i reparti non esistevano da nessuna parte. Non si
poteva rinforzare *quel* reparto, riequipaggiarlo, spostarlo o spostarlo di armata:
si poteva solo aggiungere un reparto in più all'armata.

Ora il **reparto** (unità) è un oggetto persistente con uomini, equipaggiamento e
fabbisogni propri, e l'armata è **la somma dei suoi reparti**:

```
MilitaryUnit[]  →  Army (derivata: Σ unità)  →  aggregato nazionale (derivato: Σ armate)
```

Una sola fonte di verità. Nessun secondo motore: i reparti si materializzano dagli
aggregati esistenti (senza cambiarne la somma), le azioni usano i passi che il motore
già ha (riserva addestrata, deposito, costo di movimento del material flow), e il
read model (sala di governo) mostra i reparti reali sotto la loro armata.

---

## 2. Problema

1. **Nessuna granularità.** «Rinforza il 2° reparto» non era esprimibile: l'armata era
   un numero.
2. **Nessuna persistenza.** Ricaricando la partita non c'era niente da ricaricare: il
   livello veniva dagli oggetti `army` della mappa, il resto era derivato a ogni lettura.
3. **Nessuna azione.** Le uniche azioni erano «crea reparto» (a livello di armata) e
   procura/compra. Nessun trasferimento, nessun riequipaggiamento mirato.
4. **UI con unità finte.** La scheda dell'armata non poteva mostrare reparti perché non
   esistevano: mostrare una quota proporzionale sarebbe stato inventare.

---

## 3. Principi (vincoli rispettati)

| Principio | Come è rispettato |
|---|---|
| Nessun secondo motore | I reparti **derivano** dagli aggregati legacy; le azioni riusano `transferMenToArmy`, `transferEquipment`, `movementCost`/`payMovement`, `needsForArmy`/`monthlyNeedsPerFormation`. |
| Nessuna riscrittura di `WorldStateEngine` | Non toccato. Il tick materiale, l'allocazione, le crisi, il playback, gli NPC non cambiano. |
| Nessun grande refactor | Estensioni additive: un tipo nuovo, funzioni pure nuove, un `kind` nuovo, un pannello nuovo. Le firme esistenti restano le stesse (parametri **opzionali**). |
| Reparti persistenti | `MilitaryUnit[] → Army → nazionale`: l'aggregato dell'armata è **derivato** quando i reparti esistono. |
| Una sola fonte autoritativa | `army.personnel/equipment/monthlyNeeds/formations` = `Σ unit.*` / `count(unità attive)`. |
| L'LLM non muove numeri | Nessun prompt, nessun tool, nessuna reazione LLM toccata: le azioni sono endpoint del motore. |
| Conservazione | Uomini: solo `transferMenToArmy` (riserva → reparto). Pezzi: solo `transferEquipment` (deposito ↔ reparto), `deposito + assegnato` = totale nazionale. |

---

## 4. P1 — `MilitaryUnitState` e persistenza

Nuovo tipo persistito (`core/simulation/OperationalState.ts`):

```ts
export interface MilitaryUnitState {
  id: string;              // `${armyId}-unit-00N` (numerazione stabile a tre cifre)
  armyId: string;          // armata di appartenenza
  name: string;            // «1ª Brigata», «2° Reggimento» (classificazione d'epoca)
  personnel: number;
  equipment: Record<string, number>;   // pezzi **assegnati al reparto**
  monthlyNeeds: { fuel: number; weapons: number; food: number };
  readiness: number;       // 0…1, derivata (`unitReadiness`): cache ricalcolabile
  status: 'forming' | 'operational' | 'degraded' | 'retreating' | 'destroyed';
  regionId: string | null;
  regionName: string | null;
  updatedDate: string;
  legacyDerived: boolean;  // materializzato da un aggregato legacy
}
```

Persistenza: nuova riga per reparto in `game_operational_objects` con `kind = 'unit'`
(tabella **già esistente**, nessuna migrazione: la colonna `kind` non ha `CHECK`).
L'allowlist del repository (`operational-object.repository.ts`) è stata estesa con
`'unit'`: senza di essa le righe verrebbero **scartate in lettura** (`parseKind` → `null`).
`read()/ensureSeeded()/persist()` dello store trattano il nuovo tipo come gli altri.

**Prova di sopravvivenza al ricaricamento:** `military-units.test.ts` §10
(`registry.removeSession(gameId)` → `getSession(gameId)` → i reparti sono identici,
`toEqual` strutturale).

---

## 5. P2 — Materializzazione lazy e idempotente

`materializeUnitsForArmy({ army, epoch, date, formations, existing })` (pura):

* **target** = `formations` dichiarate dal mondo (il `level` dell'oggetto `army` della
  mappa; il fallback è `army.formations`);
* **prima volta** (`existing.length === 0`): divide l'aggregato dell'armata fra N reparti
  **senza cambiarne la somma** — `splitExact(total, parts, decimals)` mette le parti
  uguali e **l'ultima assorbe il resto**: uomini, pezzi (interi) e fabbisogni (3 decimali);
* **idempotenza**: `existing.length >= target` ⇒ nessuna unità nuova, nessuna modifica
  (la seconda lettura restituisce esattamente lo stesso JSON — test §7);
* **rep parti aggiunti dal mondo** (`existing.length < target`, es. il livello è cresciuto
  fuori dal percorso del giocatore): i nuovi nascono **vuoti e `forming`** — *nessun uomo
  viene creato dal nulla*, la riserva si muove solo con `transferMenToArmy` (test §5);
* **stato del reparto** (`unitStatusFromCoverage`): dichiarato `forming` ⇒ `forming`;
  **nessun pezzo assegnato** ⇒ `forming` (la dotazione è nel deposito, non in mano ai
  soldati); dichiarato `degraded`/`maintenance` ⇒ `degraded`; altrimenti `operational` se
  la copertura d'armi individuali è ≥ 95%, `degraded` sotto;
* **prontezza** (`unitReadiness`, pura): `(organico × 0,5 + dotazione × 0,5) × fattore di
  stato`, con `menPerFormation` e `rifleRequirement(epoch, 1)` del motore. Fattori di
  stato dichiarati: `forming 0,5 · operational 1 · degraded 0,7 · retreating 0,45 ·
  destroyed 0`. Il **carburante non entra nel numero** (vedi §22).

La materializzazione avviene dentro `OperationalStateStore.syncArmies()`, cioè su una
**lettura** (come `refreshRecipes()`): scrive i reparti **solo quando l'insieme cambia**
(`JSON.stringify` prima/dopo), quindi una lettura non riscrive lo stato.

---

## 6. L'aggregato dell'armata è la somma dei reparti

`aggregateArmyFromUnits(army, units)` (pura):

* `formations = count(unità non distrutte)`;
* `personnel = Σ personnel` (arrotondato);
* `equipment = Σ pezzi` (somma per id);
* `monthlyNeeds = Σ fabbisogni` (3 decimali);
* `legacyDerived = false` (l'aggregato non è più una derivazione legacy).

`syncArmies()` applica la derivazione **dopo** la riconciliazione con la mappa, e
`saveUnits()` la applica a tutte le armate nella stessa scrittura dei reparti: **mai uno
stato a metà**.

**Invariante verificato** (`military-units.test.ts` §6, §20): per ogni armata
`Σ unit.personnel == army.personnel`, `Σ unit.monthlyNeeds == army.monthlyNeeds`,
`army.formations == count(unità attive)`.

---

## 7. P3 — `raiseFormation` crea un reparto **reale**

`raiseFormation()` (invariata nei passi economici: anteprima, riserva, deposito, cassa,
credito, `addArmyObject`) ora termina così:

1. il mondo ha già dichiarato **un reparto in più** (il `level` dell'armata è stato
   incrementato al passo 4);
2. la materializzazione lazy ha creato quel reparto **vuoto** (`forming`, 0 uomini, 0
   pezzi): è **quello** che riceve uomini e pezzi (la numerazione è naturale: il 5° reparto
   è `…-unit-005`, «5ª Brigata»);
3. il reparto riceve `personnel = preview.plan.men` (uomini **già trasferiti** dalla
   riserva), `equipment = pezzi mossi dal deposito` (il **delta** del trasferimento),
   `monthlyNeeds = needsForArmy(epoch, 1)` (un reparto vale un reparto), `status` e
   `readiness` ricalcolati, `legacyDerived: false`;
4. `store.saveUnits([...])` persiste i reparti **e** riallinea l'aggregato delle armate;
5. la risposta porta il nuovo campo `unit` (id, nome, uomini, pezzi, fabbisogni,
   prontezza, stato): la UI lo mostra senza inventare nulla.

Se il mondo **non** avesse creato il reparto (nessuna regione disponibile, livello non
incrementato) il reparto nasce comunque, con la numerazione libera successiva.

**Conservazione (test §12, §13):** `riserva − men == riserva'`, `activePersonnel + men ==
activePersonnel'`, `deposito + assegnato` invariato per ogni voce dell'arsenale.

---

## 8. P5 — Rinforza

`POST /api/games/:id/military/units/:unitId/reinforce` · `unitAction({ action:'reinforce', men? })`

* **massimo** = organico dottrinale (`menPerFormation`); `men` assente ⇒ il minimo fra il
  mancante e la riserva disponibile;
* **blocchi del motore**: organico già completo · riserva esaurita · riserva insufficiente
  (con i numeri reali nel messaggio);
* **applica**: `transferMenToArmy(personnel, wanted, doctrine)` → `savePersonnel` +
  reparto aggiornato (`refreshUnit`: stato e prontezza dai fatti) + `saveUnits` (aggregato
  riallineato);
* **righe PRIMA → DOPO**: `Uomini del reparto`, `Organico %`, `Riserva addestrata`,
  `Prontezza %`.

## 9. P5 — Riequipaggia

`POST …/units/:unitId/reequip` · `unitAction({ action:'reequip', equipmentId?, quantity? })`

* voce predefinita: **armi individuali** d'epoca (`rifleEquipmentId()`); per una voce
  qualsiasi la quantità è obbligatoria (`unit_invalid` se manca — nessun default inventato);
* **parziale o bloccata**: si assegna `min(mancante, disponibile nel deposito)`; se il
  deposito è vuoto l'azione resta visibile con il motivo;
* **applica**: `transferEquipment({ depot, assigned: unit.equipment, items })` →
  `saveArsenal` (deposito) + reparto (pezzi assegnati) + `saveUnits`;
* **righe**: `<voce> del reparto`, `Copertura armi individuali %`, `Deposito · <voce>`,
  `Prontezza %`;
* **conservazione**: `deposito + assegnato` resta il totale nazionale (misura: 126.000 →
  126.000 con 9.000 pezzi passati al reparto).

## 10. P5 — Trasferisci

`POST …/units/:unitId/transfer` · `unitAction({ action:'transfer', regionId })`

* destinazione: solo una **regione del paese** (`ctx.playerRegions()`); fuori dal paese →
  `region_unknown` (errore dichiarato, non silenzio); stessa regione → bloccato;
* **costo**: `movementCost(stock)` + `payMovement(stock, cost)` del **material flow** —
  nessuna seconda formula di movimento, nessun blocco: se le scorte non bastano si applica
  e si registra la carenza nella nota (comportamento del motore);
* **applica**: `saveResourceStock` + `unit.regionId/regionName` + `saveUnits`;
* **righe**: `Cibo (scorte)`, `Carburante (scorte)`, `Cassa`.

## 11. P5 — Cambia armata

`POST …/units/:unitId/reassign` · `unitAction({ action:'reassign', armyId })`

* il reparto cambia `armyId`; **l'id segue l'armata** (gli id sono unici nello stato):
  riceve la numerazione libera dell'armata di arrivo (`…-unit-00N`); il **nome** resta
  quello del reparto;
* le due armate si riallineano nella stessa scrittura: righe `Reparti · A`, `Uomini · A`,
  `Reparti · B`, `Uomini · B`;
* se il mondo continua a dichiarare per l'armata di partenza più reparti di quanti ne
  restano, la materializzazione crea un reparto **in formazione, senza uomini**: la nota
  dell'esito lo dice esplicitamente (nessun uomo viene creato dal nulla).

## 12. Anteprima `dryRun` (stessa tabella PRIMA → DOPO)

Ogni azione accetta `dryRun: true`: calcola tutto, **non scrive nulla** e restituisce le
stesse righe dell'anteprima di formazione. Lo verifica `military-units.test.ts` §21
(JSON dei reparti e riserva identici prima/dopo l'anteprima). La UI usa `dryRun` per il
pulsante «Anteprima» e ripete la chiamata senza `dryRun` alla conferma.

---

## 13. P4 — Read model: la gerarchia armata → reparto

`persistentObjects()` costruisce per ogni reparto un `OperatingObject` con
`kind: 'unit'` e `parentId = army.id` (l'armata è già `parentId: 'force'`): la gerarchia
`Forze armate → armata → reparto` nasce dallo stesso quadro, senza un secondo elenco.

* **fatti** (grammatica universale): `Uomini` (con l'organico d'epoca come nota),
  `Equipaggiamento assegnato` (con l'elenco dei pezzi), `Organico %`, `Copertura armi
  individuali %`, `Prontezza %` (con la spiegazione dei fattori), `Carburante`/`Armamenti`/
  `Cibo` al mese, `Spese del reparto` (quota delle spese militari in proporzione agli
  uomini), `Carburante (scorte)` in mesi;
* **problemi reali**: `Reparto senza uomini` · `Nessuna arma individuale assegnata` ·
  `Copertura armi individuali X%` (con quanti pezzi mancano) · `Organico incompleto X%` ·
  `Carburante: N mesi di operazioni` (sotto i 3 mesi del motore);
* **azioni reali** (`unitActions`): `Rinforza`, `Riequipaggia`, `Trasferisci`,
  `Cambia armata` con `enabled`/`blockedReason` calcolati da riserva e deposito
  (`availableReserve`, `depotUnits` passati dal servizio). **Nessuna azione inventata**:
  «Smobilita» non c'è perché non è implementata (§22);
* `counts.unit` e la scheda di settore **Forze armate** includono i reparti fra i suoi
  oggetti (il clic sul settore apre la gerarchia completa).

## 14. UI (`ObjectsBoard.tsx`)

* **gerarchia ricorsiva** (`renderBranch`): i figli si seguono nel quadro completo
  (reparti sotto l'armata, navi sotto la flotta), fino a tre livelli;
* **`UnitActionPanel`** sul reparto: i quattro pulsanti del motore, la **scelta della
  destinazione** (menù di regioni o armate costruito dal quadro, non da liste inventate),
  «Anteprima» → tabella PRIMA → DOPO → «Conferma»/«Chiudi»; i motivi di blocco restano
  visibili;
* `unitActionView()` formatta l'esito con la **stessa** tabella della creazione reparti;
* il pannello non calcola niente: `ObjectsBoard.tsx` non contiene `gameApi`/`fetch`
  (test di presentazione invariato) e riceve `onUnitAction` dall'esterno;
* cablaggio: `api.ts` (`militaryUnits`, `unitAction` con tipi) → `useNationSnapshot`
  (`unitAction`: ricarica `/arsenal` e `/national-state`, notifica l'esito) → `GameScreen`
  → `DeskContent` → `NationDock` (stato «in corso») → `ObjectsBoard`;
* CSS minimo (`.obj-unit-actions`, `.obj-unit-target`): niente ridisegno della sala.

---

## 15. Cosa **non** è stato fatto (e perché)

**«Smobilita» non è implementata.** Smobilitare un reparto significa (a) riportare gli
uomini nella riserva e (b) **decrementare il livello dell'oggetto `army` della mappa**,
che è la sorgente di `account.forces` nel motore: è una mutazione del mondo, cioè
motore/engine. Non essendoci un percorso inverso di `transferMenToArmy` né un'API di
`removeArmyObject`, l'azione richiederebbe regole nuove del motore → **fuori dal PR1**
(la specifica la ammette come «se la differenza resta piccola»). L'azione non compare
nella UI: meglio assente che finta.

---

## 16. FREEZE — file congelati toccati (nota obbligatoria)

La specifica richiede un **nuovo oggetto persistente**, e lo stato persistente vive nei
moduli del motore: toccarli è stato inevitabile. **Nessuna regola di simulazione è
cambiata**: nessun tocco a `WorldStateEngine`, `NationStateService` (tick materiale),
`MaterialEconomy`, `MilitaryProduction`, `MilitaryDoctrine`, `PersonnelStock`,
`IndustrialCapacity`, `PlaybackService`, `TurnPipelineService`, `crisis`, `NPC`,
`fazioni`, `branching/rewind`, schema/DB.

| File | Tipo di modifica |
|---|---|
| `core/simulation/OperationalState.ts` | **additiva**: tipo `MilitaryUnitState`, `unitNameFor/unitIdFor/unitNumberOf/unitReadiness/unitStatusFromCoverage/splitExact/emptyUnit/*materialize*/aggregateArmyFromUnits`, campo `units` nello snapshot, rendering dei reparti in `persistentObjects`. Unica correzione: id della guarnigione (§17). |
| `core/simulation/OperationalObjects.ts` | **additiva**: `OperatingKind` + `'unit'`, id delle azioni del reparto, `unit: 0` nel conteggio. |
| `repositories/operational-object.repository.ts` | **additiva**: `'unit'` nell'allowlist dei `kind`. |
| `game/OperationalStateStore.ts` | **additiva**: lettura/scrittura dei reparti, materializzazione in `syncArmies`, `units()/unitsOfArmy()/saveUnits()`. |
| `game/MilitaryService.ts` | **additiva**: `raiseFormation` crea il reparto; `militaryUnits()`, `unitAction()`, `refreshUnit()`; `persistentObjects` riceve reparti, riserva e deposito. |
| `game-session.ts` | **additiva**: due delegati (`militaryUnits`, `unitAction`). |
| `routes/games/state.routes.ts`, `helpers.ts` | **additiva**: due rotte + codici d'errore. |

Nessuna firma esistente è cambiata; nessun parametro obbligatorio è stato aggiunto. La
suite completa (158 file / 1519 test) è verde: se una regola del motore fosse cambiata,
i test di `op-objects-*`, `military-*`, `nation-*`, `world-*` sarebbero cambiati.

---

## 17. Correzione collaterale: id della guarnigione

`seedArmies()` creava la guarnigione con id `army-<polity>-garrison`, mentre
`syncArmies()` (e `OperationalObjects.deriveArmyObjects`) usano `<polity>-garrison`. Con i
reparti figli dell'armata la differenza diventa **visibile**: al primo ricaricamento della
sessione i reparti della guarnigione cambiavano id (righe cancellate e ricreate). Il seed è
stato allineato a `<polity>-garrison`. Prova: `military-units.test.ts` §10 (prima della
correzione il confronto strutturale falliva).

---

## 18. Test

**Nuovo file `backend-nest/tests/military-units.test.ts` — 25 test**, in quattro gruppi:

* *grammatica del reparto (puro)*: nomi d'epoca (`1° Reggimento`, `2ª Divisione`,
  `4ª Brigata`), id/numerazione, prontezza derivata (0 per un reparto distrutto),
  `splitExact` (somma esatta), reparto distrutto fuori dall'aggregato, top-up **vuoto** e
  idempotente;
* *materializzazione lazy e idempotente*: 4 reparti da 4 livelli con somma invariata,
  seconda lettura senza duplicati, l'aggregato azzerato non cancella i reparti (la fonte è
  il mondo), righe `kind='unit'` nel repository, **sopravvivenza al ricaricamento**;
* *`raiseFormation`*: reparto reale (`a1-unit-005`, `legacyDerived: false`), uomini dalla
  riserva (invariante dei totali), `deposito + assegnato` invariato;
* *azioni*: Rinforza (+500, riserva −500, righe PRIMA → DOPO) · Rinforza bloccato senza
  scrivere · Riequipaggia (deposito −= pezzi mossi, prontezza su) · senza deposito bloccato ·
  Trasferisci (costo del motore su cibo/carburante/cassa) · fuori dal paese rifiutato ·
  stessa regione bloccato · Cambia armata (id nuovo, entrambe le armate = somma dei
  reparti, nota sul reparto in formazione) · `dryRun` senza scritture · reparto inesistente
  → errore dichiarato;
* *read model*: i reparti sono oggetti `kind:'unit'` sotto l'armata con fatti,
  problemi e le **quattro** azioni del motore; reparto senza uomini → problema dichiarato.

**Frontend**: `operationalObjects.test.ts` (+3 test: gerarchia/scheda di settore, vista
dell'azione, destinazioni dal quadro) e `objectsBoard.test.tsx` (+1 test: i reparti sono
nel settore Forze e la vista li annida — SSR + verifica del componente).
**E2E mock** (`e2e/tests/op-objects.spec.mjs`, +2 test): i reparti sotto l'armata con
fatti, problemi e blocco dichiarato; l'azione con `Anteprima` → tabella PRIMA → DOPO →
`Conferma`. Il mock espone due reparti (uno operativo, uno in formazione) e le rotte
`military/units` (contratto reale).

**Aggiornamento di un test esistente**: in `op-objects-flow.test.ts` §40 il fabbisogno
dichiarato (2 di carburante/mese) è ora dichiarato **sui reparti** dell'armata, non
sull'aggregato: l'aggregato è derivato, quindi dichiararci sopra non ha più effetto. Il
senso del test (il tick applica **esattamente** ciò che la scheda dichiara) resta, e lo
rende più vero.

---

## 19. Quality gate (eseguito, non stimato)

| Comando | Esito |
|---|---|
| `backend-nest`: `npx tsc --noEmit` | ✅ pulito |
| `backend-nest`: `npm test` | ✅ **158 file / 1519 test** (era 157/1494: +1 file, +25 test) |
| `backend-nest`: `npm run build` | ✅ |
| `frontend`: `npx tsc --noEmit` | ✅ pulito |
| `frontend`: `npx vitest run` | ✅ **67 file / 492 test** (era 67/488: +4) |
| `frontend`: `npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **47/47** (era 45: +2) |

Nota onesta: durante le verifiche il test `op-objects-time-step.test.ts` §42 («la consegna
prevista si sospende…») è fallito **due volte** ed è poi passato 5 volte su 5 (file completo
e test isolato): è la fragilità già nota dal pacchetto SEED-DETERMINISM (l'id d'ordine è
casuale, quindi la sorte dell'ordine cambia di run). Non è introdotta da questo pacchetto
(il file non tocca armate né reparti) e non è stata modificata una soglia.

---

## 19-bis. Verifica di esecuzione reale (pre-merge)

Eseguita **dopo** l'apertura della PR #79, sul commit `c6b5a05` del branch
`feat/military-units` (working tree pulito, base `main` = `8113ab7`), con i comandi reali:

```
backend-nest$ npx vitest run tests/military-units.test.ts --reporter=verbose
backend-nest$ npx vitest run           # suite completa
backend-nest$ npx tsc --noEmit
```

**19/09/2026 08:57 CEST — esito: VERDE.**

| Comando | Esito reale |
|---|---|
| `tests/military-units.test.ts` | ✅ **25/25** in 4,90 s (1 file) |
| suite backend completa | ✅ **158 file / 1519 test** in 123 s |
| `npx tsc --noEmit` | ✅ pulito |

### I test di **conservazione** (manpower ed equipaggiamento), uno per uno

| # | Test | Controllo di conservazione | Esito |
|---|---|---|---|
| 3 | la divisione di un totale in N parti non ne cambia la somma | `Σ splitExact == totale` (uomini, pezzi, fabbisogni) | ✅ |
| 4 | un reparto distrutto non conta nell'armata | `army.formations == count(reparti attivi)` | ✅ |
| 6 | un'armata legacy di 4 reparti diventa 4 reparti reali | `Σ unit.personnel/equipment/monthlyNeeds == army.*` prima e dopo la materializzazione | ✅ |
| 8 | azzerare l'aggregato non cancella i reparti | la fonte di verità è il mondo: nessun uomo creato né perso | ✅ |
| 11 | il reparto nasce con gli uomini e i pezzi trasferiti | `activePersonnel + men` e `deposito + assegnato` invariati | ✅ |
| 12 | **gli uomini vengono dalla riserva, non dal nulla** | `Σ activePersonnel` invariato, `trainedReserve − men` | ✅ |
| 13 | **deposito + assegnato resta il totale nazionale** | per ogni voce dell'arsenale, prima = dopo | ✅ |
| 14 | Rinforza prende gli uomini dalla riserva | `riserva' = riserva − 500`, `reparto' = reparto + 500` | ✅ |
| 16 | Riequipaggia assegna le armi mancanti dal deposito | `deposito − q == reparto + q` (parziale compreso) | ✅ |
| 20 | Cambia armata | entrambe le armate = somma dei **loro** reparti | ✅ |
| 21 | l'anteprima `dryRun` non scrive nulla | JSON di reparti e riserva identico prima/dopo | ✅ |

Nessun test di conservazione è rosso: la condizione posta per procedere al merge è
soddisfatta. Nessuna soglia è stata modificata e nessun test è stato saltato.

**Preset non toccato:** la variante non committata di
`backend-nest/data/presets/modern_world_provinces/preset.json` **non è nel working tree**
di questo lavoro (`git status` pulito, `git diff main -- <path>` vuoto): è conservata nello
stash del repository (`stash@{0}` «preset cold_war_1951 - variante pax_modern»), che non è
stato toccato né applicato.

---

## 20. Misure su dati controllati (probe temporaneo, poi rimosso)

Mondo di prova 1951, una armata `a1` con `level = 4` e nessun pezzo assegnato:

* **materializzazione**: 4 reparti `a1-unit-001…004` = «1ª…4ª Brigata», 12.000 uomini
  ciascuno, `legacyDerived: true`; armata: `formations 4`, `personnel 48.000`,
  `monthlyNeeds {fuel 0,12 · weapons 0,8 · food 0,24}` = **esattamente** la somma dei
  reparti (`{0,03 · 0,2 · 0,06}` ciascuno), `legacyDerived: false`;
* **prontezza del reparto**: organico 100% e dotazione 0% ⇒ `0,5·1 + 0,5·0 = 0,5`, stato
  `forming` (nessun fucile in mano) ⇒ `0,5 × 0,5 = 0,25` (25%);
* **Rinforza** (`unit-001` da 3.000 a 3.500 uomini): `Uomini 3.000 → 3.500`,
  `Organico 25% → 29,167%`, `Riserva 151.200 → 150.700`, `Prontezza 6,3% → 7,3%`;
* **Riequipaggia** (`unit-001`): `Fucili del reparto 0 → 9.000`,
  `Copertura 0% → 100%`, `Deposito 126.000 → 117.000`, `Prontezza 7,3% → 64,6%`, stato
  `forming → operational`; **totale nazionale fucili 126.000 → 126.000** (invariato);
* **Trasferisci** (in «Italia centrale»): costo del motore `{food 0,15 · fuel 0 (non
  motorizzata) · money 0,05}`, scorte `food −0,15 · fuel −0,00 · money −0,05`;
* **Cambia armata**: `army-…-unit-003` nella 2ª Armata; righe `Reparti 4 → 3`,
  `Uomini 39.500 → 36.000` (1ª Armata) e `Reparti 2 → 3`, `Uomini 24.000 → 27.500` (2ª
  Armata), con la nota sul reparto in formazione lasciato dal mondo;
* **read model**: `counts {force 1 · army 3 · unit 17 · facility 19 · mine 4}`, con il
  reparto `2ª Brigata` sotto `a1`: fatti `Uomini 12.000`, `Organico 100%`,
  `Copertura 0%`, `Prontezza 25%`, `Carburante 0,03/mese`, `Spese 0,304 mld`,
  `Carburante (scorte) 4,3 mesi`; problema `Nessuna arma individuale assegnata`; azioni
  `Rinforza` bloccata («Organico già completo: 12.000 uomini per reparto.»),
  `Riequipaggia`/`Trasferisci`/`Cambia armata` abilitate.

Verifica live: **non eseguita e non dichiarata**: la PR non è mergiata e non è stato fatto
alcun deploy (§ la specifica chiede «non mergiare»).

---

## 21. File toccati

**Backend (src)**: `core/simulation/OperationalState.ts`, `core/simulation/OperationalObjects.ts`,
`game/OperationalStateStore.ts`, `game/MilitaryService.ts`, `game-session.ts`,
`repositories/operational-object.repository.ts`, `routes/games/state.routes.ts`,
`routes/games/helpers.ts`.
**Backend (test)**: `tests/military-units.test.ts` (nuovo), `tests/op-objects-flow.test.ts`,
`docs/implementation/q02-endpoint-inventory.json` (inventario rigenerato con `vitest -u`).
**Frontend**: `services/api.ts`, `hooks/useNationSnapshot.ts`, `components/Game/GameScreen.tsx`,
`components/Game/NationDock.tsx`, `components/Game/NationDock/types.ts`,
`components/Game/ObjectsBoard.tsx`, `components/Game/operationalObjects.ts`,
`components/Shell/DeskContent.tsx`, `index.css`, `components/Game/operationalObjects.test.ts`,
`components/Game/objectsBoard.test.tsx`.
**E2E**: `e2e/mock-api.mjs`, `e2e/tests/op-objects.spec.mjs`.

Non toccati: `preset.json`, schema/DB, migrazioni, `MaterialEconomy`,
`WorldStateEngine`, `MilitaryProduction`, `MilitaryDoctrine`, playback, crisi, NPC,
fazioni, progetti.

---

## 22. Limiti dichiarati

1. **Smobilita assente** (§15): richiede di decrementare il livello dell'oggetto mappa
   (sorgente di `forces`) e un percorso inverso della riserva → motore.
2. **Il livello della mappa resta la dichiarazione del mondo.** Le azioni sui reparti non
   lo modificano: spostare un reparto di armata o trasferirlo di regione **non** muove il
   contenitore. Conseguenze dichiarate: (a) un reparto che lascia un'armata può lasciare un
   **reparto in formazione senza uomini**, perché il mondo dichiara ancora quel numero
   (la nota dell'esito lo dice); (b) `account.forces` (mappa) e la somma dei reparti
   possono divergere finché non si tocca la mappa.
3. **Il carburante non entra nel numero di prontezza del reparto.** La prontezza è
   *persistita*: un fattore legato a ogni litro consumato la farebbe oscillare a ogni
   lettura. Il carburante resta un **fatto** (`Carburante (scorte)`, mesi) e un **problema**
   (sotto i 3 mesi di `OPERATION_MONTHS` del motore). La prontezza nazionale
   (`militaryReadiness`) è invariata e continua a includerlo.
4. **Stato del reparto vs stato dell'armata.** Senza pezzi il reparto è `forming`
   (specifica), mentre lo stato dell'*armata* nel read model segue la regola preesistente
   (`persistentObjects`, non modificata): i due possono divergere. È il reparto a dire la
   verità sulla propria dotazione.
5. **`Trasferisci` sposta il reparto, non l'armata.** Il movimento dell'armata sulla mappa
   resta quello di `WorldMutationService` (ordini/LLM): qui si aggiorna la regione del
   reparto e si paga il costo del motore.
6. **Il reparto è l'unità di consumo.** Un reparto sotto organico consuma come un reparto
   pieno (i fabbisogni sono per formazione, come nel motore): il rinforzo non cambia i
   consumi, li ripartisce fra i reparti.
7. **Nessuno storico delle azioni** (nessun log persistito per reparto): l'esito è
   restituito all'API e mostrato, non salvato come evento.
8. **`advancedDate` legacy**: il percorso `advanceDate()` (senza hook) resta com'è; i
   reparti seguono il tick materiale (già coperto da TIME-STEP/SEED-DETERMINISM).
