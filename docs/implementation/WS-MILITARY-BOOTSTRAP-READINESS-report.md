# WS-MILITARY-BOOTSTRAP-READINESS — Report

**Obiettivo.** L'arsenale individuale iniziale di una nazione non deve restare nel
deposito mentre i reparti di partenza nascono senza fucili. La prontezza
nazionale deve derivare dallo **stato materiale reale** e non dalla stima del
profilo o dal reparto più debole.

---

## 1. Causa esatta del 25%

`seedArmies()` creava le armate iniziali con `equipment: {}`; l'intero
`equipmentProfile` del `CountryInitialProfile` (p.es. `fucili`) restava nel
deposito. `materializeUnitsForArmy()` divideva solo `army.equipment` (vuoto),
quindi **ogni reparto di partenza nasceva con uomini ma 0 fucili**:

```
unitStatusFromCoverage → 'forming'
unitReadiness = (staffing·0,5 + equipped·0,5) · formingFactor(0,5)
              = (1·0,5 + 0·0,5) · 0,5 = 0,25
```

Due errori di presentazione si sommavano:

1. `governmentSalienceContext()` usava `Math.min(...unit readiness)` come cifra
   **nazionale**: un solo reparto al 25% trascinava l'intero paese.
2. Al turno 1 preferiva la stima `military.initialReadinessPct` del profilo, che
   portava la stessa firma al 25%, e `GovernmentSalience` la trattava come una
   crisi.

Il 25% non era quindi un dato operativo: era l'artefatto di uomini nati senza
armi **più** una metrica nazionale sbagliata.

---

## 2. File modificati

### Motore / proiezione (sorgente)

| File | Modifica |
| --- | --- |
| `backend-nest/src/core/simulation/OperationalState.ts` | Nuova funzione pura `assignBootstrapIndividualWeapons()` (dopo `materializeUnitsForArmy`). |
| `backend-nest/src/game/OperationalStateStore.ts` | In `ensureSeeded()`, nel ramo `!hasLiveMilitary`, i reparti materializzati vengono armati dal deposito; `bootstrapDepot` propagato e `saveDepotUnits(bootstrapDepot)`. |
| `backend-nest/src/core/government/GovernmentSalienceSnapshot.ts` | `nationalReadinessPct()` pesata per personale; misura reale **prima**, stima solo come ripiego; `minReadinessPct` come dettaglio; `ongoingMilitaryOrders` = solo reparti schierati (`frontId != null`). |
| `backend-nest/src/core/government/GovernmentSalience.ts` | Trigger di prontezza protetto da `!initialReadinessEstimate`; testo nazionale «La prontezza operativa delle forze è X%»; dettaglio opzionale sui reparti deboli. |
| `backend-nest/src/core/government/RealitySignals.ts` | Rimosso l'hack `.replace('La prontezza osservata', 'La prontezza minima osservata tra i reparti')`. |
| `backend-nest/src/game/MilitaryService.ts` | `epoch()`: `worldStartDate?.() ?? currentDate()` → `|| currentDate()`, così un `worldStartDate` vuoto non scivola su `guerra_fredda`. |
| `backend-nest/src/game/WorldIntelService.ts` | `WorldIntelContext.nationalUnits?()` (opzionale) e `nationalEffectiveMilitaryPower()` usa il totale nazionale (deposito + assegnato), coerente con `getArsenal()`. |
| `backend-nest/src/game-session.ts` | Wiring di una riga: `nationalUnits: polityId => this.military.nationalUnits(polityId)`. |
| `backend-nest/src/core/government/OpeningNarrative.ts` | `buildDeterministicNationFraming()`: fallback di calma quando non ci sono situazioni misurate, così l'apertura deterministica del Consulente non è mai vuota (senza inventare una crisi). |

Nessuna modifica a schema/DB, pipeline del turno, checkpoint, fronti, produzione
militare o regole di combattimento.

### Test

- **Nuovo** `backend-nest/tests/military-bootstrap-readiness.test.ts` (casi A–F).
- Aggiornati: `government-salience-snapshot`, `country-initial-military`,
  `government-dossier-integration`, `mg05-agenda-reading`, `military-units`,
  `military-p4-npc-units`, `military-warfront-integrity`, `op-objects-integration`,
  `operational-state`, `war-fronts`, `arsenal-integration`, `preset-reality-smoke`.

---

## 3. Come vengono distribuiti i fucili al bootstrap

Solo per il **bootstrap del paese** (`!hasLiveMilitary`, cioè partita nuova senza
reparti vivi), per ciascuna armata seminata:

1. i reparti sono ordinati per `id` (distribuzione deterministica, indipendente
   dall'ordine della mappa);
2. `required = unitRifleRequirement(unit, epoch)` (= `round(establishment ×
   individualWeaponShareFor(epoch))`);
3. `have = equipmentQuantity(unit.equipment, rifleId)`;
4. `wanted = max(0, required − have)`, `available = equipmentQuantity(depot,
   rifleId)`, `quantity = min(wanted, available)`;
5. il trasferimento avviene con `transferEquipment({ depot, assigned, … })`, che
   conserva l'invariante `deposito + assegnato = totale nazionale` e cancella le
   voci a zero;
6. `status` è ricalcolato con `unitStatusFromCoverage({ assigned, required,
   declared })`, `readiness` con `unitReadiness(...)`.

**I reparti creati durante la partita** (`raiseFormation`) **non** passano da
questo percorso: restano `forming` finché uomini e armi non arrivano da
produzione/riarmo. Nessun pezzo è inventato: si muove solo ciò che è nel
deposito. Poiché il profilo deterministico ha `fucili ≈ round(active × share)`,
dopo il bootstrap il deposito resta ~0 (la riserva strategica non esisteva come
dato: quei fucili erano già «assegnati» ai reparti).

---

## 4. Formula della prontezza nazionale

Sui reparti non `destroyed`, con `readiness` finita in `[0,1]` e `personnel > 0`:

```
readinessPct = Σ(readiness_i · personnel_i) / Σ(personnel_i) · 100
```

Se nessun reparto ha personale misurabile, ripiego sulla **media semplice**
(un dato assente non vale zero).

`minReadinessPct = min(readiness valida) · 100` resta solo come **dettaglio
diagnostico** (`GovernmentSalience` lo cita solo se è sotto la media nazionale di
oltre 10 pp). Distrutti, reparti a personale zero e placeholder non pesano.

`ongoingMilitaryOrders` conta solo i reparti con `frontId != null`: l'ordine di
difesa di default di una guarnigione in pace non è un'operazione.

---

## 5. Stima iniziale vs misura reale

- **Ci sono reparti misurati** → `readinessPct` = misura pesata per personale,
  `initialReadinessEstimate` resta `false`: il trigger di prontezza è ammesso.
- **Non c'è ancora alcun reparto misurato** → si ripiega su
  `military.initialReadinessPct` e si imposta `initialReadinessEstimate = true`.
  `GovernmentSalience` richiede `!initialReadinessEstimate` per aprire una crisi:
  **una stima iniziale non diventa mai una crisi da sola**.

Anche il confronto col passato (`previous.readinessPct`) usa la stessa media
pesata, e il confronto è saltato quando la baseline è parziale o quando la firma
della stima iniziale è cambiata.

---

## 6. Test eseguiti e risultati

Solo test mirati + typecheck (nessuna suite completa).

- **`npx tsc --noEmit`**: pulito.
- **Set core (13 file, 306 test): 306/306 passati** —
  `military-bootstrap-readiness` (nuovo, A–F), `military-units`,
  `military-p4-npc-units`, `military-p5-npc-reconstitution`,
  `military-warfront-integrity`, `war-fronts`, `op-objects-integration`,
  `operational-state`, `arsenal-integration`, `government-salience-snapshot`,
  `government-dossier-integration`, `country-initial-military`,
  `mg05-agenda-reading`.
- **Set governo/WS (15 file, 173 test): 173/173 passati** — `gameplay-long-integration`,
  `p03-order-requirements`, `government-advisor-brief`, `government-situations`,
  `government-situation-opening`, `verified-world-session`, `ws-jev-w3-minister`,
  `ws-gov-minister-world-context`, `ws-minister-council`,
  `ws-minister-council-routes`, `ws-council-failure`, `council-issue-variety`,
  `council-proposal-anchors`, `government-dossier-consequences`,
  `government-prose-format`.
- **Set militare ampio (21 file, 345 test): 345/345 passati** — inclusi
  `arsenal-integration`, `world-intel-perf`, `world-intel-service`,
  `game-data-service`, `diplomacy`, `map-p2-military-api`,
  `military-establishment`, `military-industry`, `military-production`,
  `military-reaction`, `military-service`, `movement-orders`, `national-effects`,
  `op-objects-flow`, `operational-objects`, `industrial-capacity*`,
  `world-mutation-service`, `ws-jev-w6-factions`, `stage2`,
  `verified-world-snapshot`.

I casi A–F del nuovo test verificano esattamente il requisito:

- **A** — fucili sufficienti: i reparti iniziali sono equipaggiati, **non**
  `forming` al 25%.
- **B** — fucili insufficienti: la carenza è reale, nessun rifornimento
  inventato.
- **C** — assegnare due volte è idempotente: lo stesso totale non si muove di
  nuovo (invariante `deposito + assegnato`).
- **D** — la sola stima iniziale al 25% **non** genera `defence` né un segnale
  `military-readiness` critico.
- **E** — una prontezza misurata realmente bassa produce il segnale con il testo
  nazionale «prontezza operativa».
- **F** — un reparto debole tra molti non trascina la nazionale al 25%:
  nazionale ≈ 88%, `minReadinessPct === 25`, nessuna `defence`.

Nessun test è stato modificato per accettare il 25%: i fissaggi sono
`raiseFormation`/`reequip` (il deposito va rifornito perché il bootstrap ha
assegnato i pezzi ai reparti) e la conseguenza del combattimento (reparti ora
armati).

---

## 7. Compatibilità con i salvataggi legacy

- `ensureSeeded()` esce subito se `seeded()`/`seedDone` è vero o se esistono
  **reparti vivi** (`hasLiveMilitary`): un salvataggio con unità resta
  autorevole, nessuna rimaterializzazione e **nessun rifornimento al reload**
  (idempotente, coperto dal caso C).
- `assignBootstrapIndividualWeapons()` tocca solo il percorso di bootstrap
  iniziale; non gira mai su partite già seminate.
- Un salvataggio privo di `CountryInitialProfile` mantiene il percorso
  deterministico di sempre; i reparti legacy parziali restano autorevoli.
- `WorldIntelService.nationalUnits` è **opzionale**: i contesti senza stato
  operativo (test, intel sintetico) ripiegano su `arsenalUnits`.
- `MilitaryService.epoch()` con `worldStartDate` vuoto (`''`, p.es. save legacy o
  sessione prima del load) usa la data corrente invece di scivolare su
  `guerra_fredda`, evitando che la prontezza dei reparti venga ricalcolata con la
  quota d'armi sbagliata.
- Nessuna nuova tabella/colonna: l'invariante `deposito + assegnato = totale` e
  le righe `operationalState` restano le stesse.
