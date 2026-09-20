# MAP P2 — persistent military fronts, units and strategic movement on the world map

Base: `main = b26170dc8547747500052ce95a157c6186db888f` (MAP P1/P1.1/P1.2 incluso).

MAP P2 rende visibile sulla mappa lo **stato militare persistente attuale**
costruito in MILITARY P4 / P4.1 / P4.1.1 / P5 / P5.1 / P6 — reparti, fronti,
status, ordini, obiettivo, pressione, iniziativa e trasferimenti in corso —
**senza** aggiungere un secondo motore militare.

---

## 1. Source of truth

La mappa non è authority militare. Le uniche fonti di verità restano:

```
MilitaryUnitState[]            (OperationalStateStore)
WarFrontState[]                (WarFrontService)
regions / GameSession / game_operational_objects
```

MAP P2 costruisce soltanto un **read model geografico derivato**, ricostruibile
per intero dalle API esistenti e mai persistito:

```
persistent military state
      ↓  GET /games/:id/military/{fronts,units}
existing read APIs
      ↓
pure military map model (militaryMapModel.ts)
      ↓
MilitaryStateOverlay (MapLibre + DOM + SVG)
```

Mai il percorso inverso: nessun marker della mappa scrive o sincronizza lo
stato militare.

## 2. Contratto API usato

Nessun nuovo endpoint. Riuso:

- `GET /games/:id/military/units` → `{ units: MilitaryUnitState[] }` (set
  **globale**, player + NPC, non filtrato per polity);
- `GET /games/:id/military/fronts` → `{ fronts: WarFrontState[] }`.

Il type frontend `MilitaryUnitPayload` è stato completato con il campo che il
motore pubblica già:

```ts
polityId: string;          // authority nazionale
order: UnitOrderPayload;   // non più opzionale
frontId: string | null;    // non più opzionale
movement?: { path, targetRegionId, pathIndex, estimatedArrivalDate, motorized, ... }
```

## 3. `polityId` governa la nazionalità

Regola assoluta, applicata in `militaryMapModel`:

```
unit.polityId = CHI È IL REPARTO
unit.regionId = DOVE È IL REPARTO
```

Una conquista territoriale cambia `region.owner`, **non** `unit.polityId`. La
presentazione della polity (`polityPresentation`) usa `polityId` e, in sua
assenza di territorio, un fallback cromatico stabile (hash di `polityId`), mai
l'owner della regione occupata. Vietato dedurre la nazionalità da
`region.owner`.

## 4. Reparti persistenti

`MilitaryStateOverlay` disegna un counter per reparto vivo:

- posizione canonica da `regionId` → anchor deterministico della geometria
  regionale (centroide dell'anello esterno più grande, fallback bounding-box);
- `status === 'destroyed'` escluso dai counter attivi (il fatto storico resta
  nel canonical state, nessuna scrittura);
- `forming`, `operational`, `degraded`, `retreating` riconoscibili per forma e
  testo, non solo per colore;
- stessa iconografia dei marker legacy (`createMilitarySymbol`): nessuna
  seconda iconografia;
- player e NPC usano **lo stesso** componente/modello.

Densità: a zoom mondo un counter aggregato per regione con il totale; a zoom
teatro fino a **3 counter + `+N`** (`militaryUnitDensity`), nessun reparto
scartato.

## 5. Fronti persistenti

L'overlay disegna il teatro con le geometrie reali delle `front.regionIds`
(MapLibre, fill 13% + linea tratteggiata, sotto i colori politici) e un badge
per fronte con l'indicatore di obiettivo su `objectiveRegionId`. Dettaglio
read-only: stato, attaccante/difensore con `attackerPressure`/`defenderPressure`
formattate (`0..1` → `%`), obiettivo, `momentumPolityId` («Iniziativa»), data
aggiornamento e reparti associati da `units.filter(unit.frontId === front.id)`.
`closed` non compare come fronte attivo. Nessun `regionIds` modificato dal
frontend; nessuna linea di fronte inventata.

## 6. Movimento P6

`movement.path` è **letto**, mai ricalcolato: nessun BFS, nessuna
`friendlyRegionPath()` nel frontend. Rotta derivata esattamente da:

```
movement.path.slice(movement.pathIndex)
```

La posizione canonica del counter resta `regionId` (ultima provincia
raggiunta); nessuna interpolazione fisica a metà tratta. Tooltip/pannello
mostrano destinazione, tratta corrente, tratte completate/totali, giorni al
prossimo hop, giorni per tratta, `estimatedArrivalDate` (letta, non ricalcolata)
e motorizzato sì/no. Un reparto in `movement` è **in trasferimento** e non è
conteggiato come forza attiva di fronte (`activeCombatUnitIds`), pur restando
elencato fra le unità del fronte.

## 7. Current state vs recent activity

Due livelli separati:

- **Stato operativo attuale**: `MilitaryStateOverlay` — reparti, fronti,
  trasferimenti P6 in corso (linea piena tratteggiata animata, frecce forti).
- **Cronaca recente**: `TacticalOverlay` invariato — spostamenti eseguiti negli
  ultimi 30 giorni e scontri segnalati (linea attenuata).

La legenda distingue «Reparto persistente (stato attuale)», «Fronte attivo e
obiettivo», «Trasferimento in corso (P6)» da «Spostamento eseguito (ultimi 30
giorni)» e «Scontro segnalato nei dispacci».

## 8. Legacy fallback

Per i mondi senza stato persistente (`units`/`fronts` vuoti) la mappa resta
identica: i marker `region.objects` di tipo militare e `TacticalOverlay`
continuano a funzionare. Un marker legacy viene soppresso **solo** quando il suo
`id` coincide esattamente con `unit.id` o `unit.armyId` di un reparto
persistente; nessuna soppressione per nome o coordinate, e nessun dato
cancellato. Mondi solo SVG (senza `geojson`) non montano l'overlay e restano
invariati.

## 9. Performance

- Il read model è memoizzato su `regions`, `militaryUnits`, `militaryFronts`.
- Un solo `requestAnimationFrame` per la proiezione, condiviso con il pattern
  esistente; le coordinate si ricalcolano solo a `move`/`resize`, non a ogni
  render React.
- Il teatro dei fronti è una singola sorgente GeoJSON MapLibre (diff-friendly),
  non decine di poligoni DOM.
- Niente polling: il refresh avviene nel lifecycle già esistente.
- Il cambio di `readiness` non re-emette il GeoJSON delle regioni (MAP P1
  invariata).

## 10. Mobile

A 360px i fronti e i counter restano visibili e cliccabili; il dettaglio usa
`AccessibleDialog` con layout a bottom-sheet; chiudere torna alla stessa
posizione della mappa; nessun overflow orizzontale. Il filtro «Unità e fronti»
nasconde insieme reparti, fronti, trasferimenti e cronaca recente, lasciando la
mappa base.

## 11. Test

- **Unitari** `frontend/src/components/Map/militaryMapModel.test.ts` (12):
  nazionalità da `polityId` (anche dopo conquista), anchor Polygon/MultiPolygon,
  rifiuto GeoJSON corrotto, `destroyed` escluso, stati conservati, rotta =
  `path.slice(pathIndex)` con ETA grezza, assegnazione fronte da `frontId`,
  movimento escluso dal combattimento, NPC–NPC, `closed` omesso, obiettivo e
  momentum copiati, densità deterministica 3+overflow, fallback legacy e
  soppressione per id esatto.
- **Contratto** `frontend/src/services/militaryApiContract.test.ts` (2):
  `polityId`/`order`/`frontId`/`movement` non opzionali e preservati.
- **Contratto route** `backend-nest/tests/map-p2-military-api.test.ts` (4):
  GET units/fronts reali via router Express, polityId + movement + fronte,
  conquista che non cambia la nazionalità.
- **E2E** `e2e/tests/map-p2-military.spec.mjs` (9): reparti persistenti,
  NPC–NPC, dettaglio read-only, conquista, trasferimento P6 (counter + rotta),
  hop successivo, arrivo (rotta attiva sparisce), filtro, mobile 360px.

### Esito gate

| Gate | Esito |
|---|---|
| Backend `npx tsc --noEmit` | ✅ |
| Backend `npx vitest run` | ✅ **164 file / 1711 test** (1 timeout flaky, verde in isolamento) |
| Backend `npm run build` | ✅ |
| Frontend `npx tsc --noEmit` | ✅ |
| Frontend `npx vitest run` | ✅ **69 file / 525 test** |
| Frontend `npm run build` | ✅ |
| E2E `npm run test:e2e:mock` | ✅ **66/66** (57 preesistenti + 9 MAP P2) |
| A11y `npm run test:a11y` | ✅ 3/3 |
| Perf `npm run test:perf` | ✅ entro baseline |

Flaky preesistenti, non regressioni MAP P2, nessun timeout aumentato:
`military-warfront-integrity` 34/50, `war-fronts` 35, `routes-playback` e
l'hook di `jobs` vanno in timeout da 5 s solo sotto carico e passano in
isolamento/seriale.

## 12. Regressioni

- **MAP P1 / P1.1 / P1.2**: invariate (mappa base, ricerca, geometria, pan).
- **MILITARY P4–P6**: invariati; nessuna modifica a `resolveFront()`,
  `advanceFronts()`, `advanceUnitMovements()`, `syncFronts()`,
  `maintainNpcUnits()`, `ensureNpcUnits()`, `unitOrder()`, `unitAction()`,
  formule di perdita/movimento, personale o arsenale.
- **Security**: le mutation player-facing restano protette da
  `unit.polityId` → `HTTP 403 unit_forbidden`; i reparti NPC restano
  **visibili** e non autorizzati alle azioni.
- **Persistenza** save/rewind/branch: intatta, nessuna scrittura nuova.

Limite residuo: l'E2E copre il **lifecycle di refresh** (cambio data/revisione
che rifetcha units+fronts) e non il flusso del pulsante di rewind, che resta
coperto dai test backend di P6 e dal refresh reattivo. Il rifetch segue
`gameId`, `currentTurn`, `currentDate`, `worldRevision`, `headBranchId`.

## 13. Limiti residui

- Nessuna azione militare dalla mappa (attacca/rinforza/…): è MAP P4. L'unica
  interazione è read-only, con focus sulla regione.
- Nessun nuovo `MapLayer = military` (è MAP P3): si riusa `showUnits`.
- La linea di contatto geometrica del fronte non è disegnata: la
  rappresentazione è teatro + obiettivo + badge, come da criterio
  «correttezza > decorazione».
- La rotta P6 è disegnata sugli anchor delle regioni; non interpola il reparto a
  metà tratta.

## Conferme finali

- **`MilitaryUnitState.polityId` resta l'authority nazionale**
- **`regionId` resta solo la posizione**
- **nessun secondo stato militare**
- **nessun nuovo combat engine**
- **nessun nuovo pathfinder**
- **la rotta P6 viene letta, non ricalcolata**
- **player e NPC usano lo stesso rendering**
- **fronti derivano da `WarFrontState`**
- **recent activity resta separata dal current state**
- **nessuna action militare nuova dalla mappa**
- **MAP P1 invariata**
- **MILITARY P4–P6 invariata**
- **nessun grande refactor**
