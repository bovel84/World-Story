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

Limite residuo: **chiuso da MAP P2.2** (vedi sezione dedicata). L'E2E ora
verifica direttamente che rewind e checkpoint restore rileggano lo stato
militare persistente attraverso gli stessi trigger del lifecycle reale
(`gameId`, `currentTurn`, `currentDate`, `worldRevision`, `headBranchId`).

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

---

# MAP P2.1 — stale-state safety and multi-polity aggregation

Correzioni mirate su MAP P2. Nessuna riapertura architetturale, nessuna nuova
feature militare, nessuna modifica al motore.

## 1. Il bug dello snapshot stale

`useNationSnapshot` pubblicava `militaryUnits`/`militaryFronts` in un unico
lifecycle con request-id guard. In caso di errore, però, il `catch` si limitava
a impostare `militaryStateError`: il **vecchio** snapshot restava nello state
React.

`MilitaryStateOverlay` riceveva quindi contemporaneamente:

```text
model = OLD MILITARY STATE
error = "Situazione militare non disponibile"
```

e continuava a disegnare counter, fronti e rotte P6 come **stato operativo
attuale**.

## 2. Perché era semanticamente pericoloso

L'overlay è dichiarato *CURRENT OPERATIONAL STATE*, non una cache. Dopo un
`advance`, un `rewind`, un `restore`, un cambio di branch o un `load`, lo
snapshot precedente può descrivere un mondo che non esiste più: reparti
distrutti, fronti chiusi, movimenti già conclusi. Mostrarlo come «attuale»
sarebbe una falsificazione silenziosa.

## 3. Soluzione fail-closed

Nel `catch` della richiesta militare, dopo il request-id guard:

```ts
setMilitaryUnits([]);
setMilitaryFronts([]);
setMilitaryStateError('Situazione militare non disponibile');
```

Regole rispettate:

```text
BASE MAP                 → resta disponibile
CURRENT MILITARY OVERLAY → non disponibile (units/fronts vuoti)
OLD SNAPSHOT             → mai mostrato come current
ERROR MESSAGE            → visibile
```

- **Atomicità**: `Promise.all()` resta l'unico punto di pubblicazione. Se uno
  dei due endpoint fallisce (`units ok / fronts ko` o viceversa) non viene mai
  pubblicato metà stato.
- **Nessuno stale fallback**: non esiste «mostriamo l'ultimo snapshot valido»;
  un eventuale storico/offline andrebbe etichettato esplicitamente, fuori scope.
- **Race protection intatta**: `militaryRequest.current` è preservato; una
  risposta lenta scartata non tocca lo state.
- **Cronaca recente intatta**: `TacticalOverlay` continua a mostrare gli eventi
  recenti anche se la fetch current-state fallisce.
- **Legacy dedupe intatto**: la soppressione per id esatto non è stata toccata.

## 4. Il bug dell'aggregazione multi-polity

A zoom mondo (`< 2.2`) lo stack era costruito solo per `regionId`:

```ts
const lead = stack.visible[0];
units.push({ unit: lead, aggregate: stack.total });
```

Il counter aggregato ereditava colore, bandiera, polity e aria-label dal `lead`.
Con `AAA 2 / BBB 1 / CCC 1` nella stessa provincia compariva `[AAA] 4`:
visivamente «4 reparti AAA», falso, e in violazione dell'invariante
`unit.polityId = nazionalità` di P4/P2.

## 5. Nuovo criterio `region + polity`

Il read model deriva `groupsByRegion: Record<regionId, MilitaryPolityGroup[]>`,
dove ogni gruppo ha `polityId`, `units`, `visible`, `overflow`, `total`. Ordine
deterministico: `polityId ASC`, poi `compareUnits()`. `stacksByRegion` resta per
il drill-down completo e per il teatro.

Proiezione visuale:

- **zoom mondo (`< 2.2`)**: un counter aggregato per polity, con offset
  deterministici `(index - (n - 1) / 2) * 44`. `[AAA 2] [BBB 1] [CCC 1]`.
- **teatro (`≥ 2.2`)**: resta la logica a 3 counter individuali + overflow. Il
  `+N` è un bottone **neutro** (nessun colore/bandiera di polity), con aria
  «Altri N reparti…»: nessuna attribuzione semantica errata.
- **aria-label aggregata**: `"2 reparti Italia in Lombardia"`, mai
  `"4 reparti Italia"` su uno stack misto.
- **click aggregato**: drill-down filtrato per polity (`Reparti Italia in
  Pianura`) con accesso esplicito a «Vedi tutti i N reparti della regione».
  Il counter non finge che gli altri reparti siano della propria polity.
- **conquista**: `region.owner = BBB` con reparti AAA non li naturalizza; i
  gruppi restano `AAA` e `BBB`.
- **fallback polity**: invariato, hash deterministico su `polityId`; mai
  `region.owner` della provincia corrente.
- **player/NPC/NPC–NPC**: stessa identica logica, ordine neutro, mai
  «player first».

## 6. Test

Frontend `militaryMapModel.test.ts` — nuovi casi A–E:

- **A** mixed polity (`AAA` 2 + `BBB` 1) → due gruppi 2/1, nessun gruppo da 3;
- **B** ordine deterministico con input invertito → `AAA, BBB`;
- **C** regione conquistata da `BBB` con reparti `AAA` → due gruppi distinti;
- **D** NPC–NPC (`AUT` 2 + `HUN` 2) → due aggregati;
- **E** polity singola `AAA` 4 → un gruppo con overflow 1 (nessuna regressione).

E2E `map-p2-military.spec.mjs` — nuovi scenari:

- **H** refresh fallito (units ok, fronts 500): counter/fronti/rotte spariscono,
  base map e messaggio d'errore restano; un refresh valido successivo ripristina
  l'overlay;
- **K** race: richiesta A lenta, richiesta B recente, A completa dopo e non
  sovrascrive B (request-id guard);
- **L** zoom mondo con `ITA 2 + AUT 1` nella stessa provincia: due counter
  aggregati distinti (`data-unit-polity="ITA"`/`"AUT"`), nessun `ITA 3`,
  drill-down filtrato per polity.

## 7. Gate

| Gate | Esito |
|---|---|
| Backend `npx tsc --noEmit` | ✅ (nessuna modifica backend) |
| Backend `npx vitest run` | ✅ 164 file / 1711 test |
| Backend `npm run build` | ✅ |
| Frontend `npx tsc --noEmit` | ✅ |
| Frontend `npx vitest run` | ✅ 69 file / 530 test |
| Frontend `npm run build` | ✅ |
| E2E `npm run test:e2e:mock` | ✅ 69/69 (66 + 3 P2.1) |
| A11y `npm run test:a11y` | ✅ 3/3 |
| Perf `npm run test:perf` | ✅ entro baseline |

## Conferme finali P2.1

- **refresh failure = fail closed**
- **nessuno stale snapshot mostrato come current**
- **units + fronts restano uno snapshot UI atomico**
- **world aggregation preserva `polityId`**
- **conquista non naturalizza i reparti**
- **player/NPC/NPC–NPC stessa logica**
- **P6 movement invariato**
- **TacticalOverlay invariato**
- **nessun backend military logic modificato**
- **nessun grande refactor**

---

# MAP P2.2 — rewind/checkpoint restore verification

Micro-fix di **sola verifica**: nessun bug noto, nessuna modifica architetturale,
nessun file produttivo toccato. L'unica modifica è di test E2E + report.

## Lacuna chiusa

Il report MAP P2 dichiarava che l'E2E copriva il lifecycle di refresh (cambio
data/revisione) ma non il flusso esplicito `movement progress → rewind/restore →
refetch → ritorno allo stato del checkpoint`. Questa sezione la chiude.

## Principio verificato

La mappa non possiede alcuno storico militare. Dopo rewind/restore il percorso è
sempre lo stesso:

```text
backend persistent state
      ↓
game state refresh (turno / data / revisione / branch)
      ↓
useNationSnapshot
      ↓
GET military/units + military/fronts
      ↓
MilitaryStateOverlay
```

Nessun rollback frontend del movimento, nessuna cache temporale militare,
nessuna copia dello stato precedente, nessuna logica speciale dentro
`MilitaryStateOverlay` o `militaryMapModel`.

## Test E2E

Fixture dedicata (`rewindGame`, regioni `A`/`B`/`C`) e helper `applyGameState`
che cambia **gli stessi trigger del lifecycle reale** (`currentTurn`,
`currentDate`, `worldRevision`, `headBranchId`) facendo rispondere alle API
militari lo snapshot del checkpoint. Nessun percorso privilegiato.

- **MAP P2.2 / M — rewind ripristina posizione e rotta P6 del checkpoint**
  - Snapshot A (checkpoint): `regionId = A`, `pathIndex = 0`, rotta `A,B,C`,
    `remainingDaysToNextHop = 15`, ETA `03.03.1951`;
  - avanzamento → Snapshot B: `regionId = B`, `pathIndex = 1`, rotta `B,C`,
    `remainingDaysToNextHop = 10`, ETA `26.02.1951`;
  - **rewind** → di nuovo A: counter in `A`, rotta `A,B,C`, dettaglio P6
    (`A → B`, `0 / 2`, 15 giorni, 03.03.1951) e **assenza** dei valori futuri.

- **MAP P2.2 / N — checkpoint restore rilegge il movimento dal nuovo branch**
  - partenza da Snapshot B;
  - restore con `headBranchId = branch-restored`, `worldRevision`/`currentDate`
    riavvolti al checkpoint e API che restituiscono A;
  - atteso: counter in `A`, rotta `A,B,C`, e nessuna traccia del branch futuro.

Verificato esplicitamente nel DOM, oltre al counter:

- `data-unit-region` = posizione ripristinata;
- `data-route-path` = rotta ripristinata (`path.slice(pathIndex)`);
- dettaglio P6: destinazione, tratta corrente, `Tratte` (`pathIndex / totalHops`),
  `remainingDaysToNextHop`, `estimatedArrivalDate`;
- **nessun ghost counter**: `[data-unit-id="ita-move"]` sempre `toHaveCount(1)`,
  mai A e B insieme;
- **nessuna ghost route**: `[data-movement-unit-id="ita-move"]` sempre
  `toHaveCount(1)` e `[data-route-path="B,C"]` assente dopo il ripristino.

## Race safety

Il test **K** di P2.1 (risposta lenta che non sovrascrive quella recente) resta
verde e convive con rewind/restore senza workaround: `militaryRequest.current`
non è stato modificato.

## Gate P2.2

| Gate | Esito |
|---|---|
| Frontend `npx tsc --noEmit` | ✅ |
| Frontend `npx vitest run` | ✅ 69 file / 530 test |
| Frontend `npm run build` | ✅ |
| E2E `npm run test:e2e:mock` | ✅ 71/71 (69 + 2 P2.2) |
| A11y `npm run test:a11y` | ✅ 3/3 |
| Perf `npm run test:perf` | ✅ entro baseline |
| Backend | invariato (nessun file toccato) |

## Conferme finali P2.2

- **rewind non usa stato militare frontend**
- **checkpoint restore non ricostruisce movement nel browser**
- **`MilitaryUnitState` persistente resta authority**
- **P6 path viene riletto, non ricalcolato**
- **nessuna cache temporale militare nuova**
- **P2.1 fail-closed invariata**
- **P2.1 multi-polity aggregation invariata**
- **MILITARY P4–P6 invariata**
- **nessun grande refactor**
