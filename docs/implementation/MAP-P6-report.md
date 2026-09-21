# MAP P6 — canonical worldwide resources and infrastructure

## 1. Obiettivo e asimmetria chiusa

Dopo MAP P1–P5 la mappa era cartograficamente completa, militare globale, tematica
e contestuale, ma con un'asimmetria: Political / Economy / Military / Diplomacy /
Infrastructure leggevano informazioni **mondiali**, mentre il layer **Resources**
dipendeva dal quadro operativo `/arsenal`, che è **player-scoped**. Le risorse di
una potenza estera erano invisibili per costruzione.

MAP P6 chiude l'asimmetria pubblicando la **geografia economica canonica già
presente nel motore** (`SimulationCatalog.initialState`): giacimenti e impianti di
**tutte** le potenze, quando il motore possiede una posizione canonica.

```
SimulationCatalog.initialState (deposits / facilities)
        ↓
WorldMapAssets — read model puro (backend-nest/src/game/WorldMapAssets.ts)
        ↓
GET /api/games/:id/map-assets   (una fotografia per snapshot, sola lettura)
        ↓
useNationSnapshot (snapshot-scoped, fail-closed)
        ↓
ThematicMapModel P3 — buildResourceMapModel / buildInfrastructureMapModel
        ↓
mappa + ProvinceInspector (stesso read model)
```

## 2. Fonte canonica usata

| Dato | Fonte esclusiva |
|---|---|
| Giacimenti | `catalog.initialState.deposits` (`Deposit.regionId` = geografia) |
| Nome risorsa | `catalog.resources[].name` via `resourceId` (**mai** dal testo del giacimento) |
| Impianti | `catalog.initialState.facilities` (`FacilityInstance.regionId`) |
| Nome tipo impianto | `catalog.facilityTypes[].name` via `typeId`; fallback tecnico `typeId` |
| Proprietà economica | `FacilityInstance.ownerActorId → catalog.actors[].polityId` |
| Controllo | `FacilityInstance.controllerActorId → catalog.actors[].polityId` |
| Esistenza geografica | `world_regions.id` del mondo della partita |

**Mai usate**: `region.owner` per la proprietà economica, `NaturalResourceSummary`
per la geografia, il nome dell'oggetto per dedurre il tipo, il nome per deduplicare.

## 3. Contratto `WorldMapAssets`

```ts
interface WorldMapAssets {
  resources: WorldResourceSite[];   // id, resourceId, resourceName, regionId,
                                    // accessibility, known, knownQuantity, estimated?
  facilities: WorldFacilitySite[];  // id, typeId, typeName, regionId,
                                    // ownerActorId/Name, controllerActorId/Name,
                                    // polityId, controllerPolityId, operational
  canonical: true;
}
```

Deterministico (ordinamento per `id`), puro, nessun side effect: stessi input ⇒
stessi output. `canonical: false` con array vuoti per mondo legacy/catalogo non
disponibile.

## 4. Derivazione `polityId`

Solo dal registro attori canonico:

```ts
ownerActorId → actorById.get(ownerActorId).polityId
```

Se l'attore non esiste nel registro, `polityId = null`: **nessuna** inferenza da
`region.owner`. Un test unitario costruisce un mondo in cui `region.owner` è
`GEO_OWNER` mentre gli impianti appartengono ad ALPHA/BETA e verifica che **nessun**
sito esponga `GEO_OWNER`, e che il read model e l'endpoint non riscrivano la
geografia politica.

## 5. Semantica della conoscenza

| Stato del catalogo | Pubblicazione | Significato esposto |
|---|---|---|
| `accessibility: 'open'` / `'requires_extraction'` | ✅ pubblicato | accessibile / richiede estrazione |
| `accessibility: 'hidden'` | ❌ **escluso** | non osservabile: il motore non lo considera estraibile |
| `known: Quantity` | `known: true` + `knownQuantity` | «dato noto» |
| `known: null` | `known: false`, `knownQuantity: null` | «quantità non determinata» — **mai `0`** |
| `estimated` | passato **come dal catalogo** | stima dichiarata dal motore |

**Policy su `hidden` (verificata nel motore, non ipotizzata).** In
`src/scenario/loader.ts` le fonti estraibili sono esattamente
`dep.accessibility !== 'hidden'`; un giacimento `hidden` non alimenta nessuna
filiera e nel catalogo fixture convive con `known: null` + `estimated`. Il motore
lo tratta quindi come **non disponibile e non osservabile**: pubblicarlo
rivelerebbe informazione che lo scenario considera non pubblicabile. La policy vive
**nel read model backend**, non nel frontend, ed è coperta da test.

Le riserve nazionali (`NaturalResourceSummary`) non hanno `regionId` e restano
fuori dalla geografia: il messaggio P5 «Le riserve nazionali non vengono
distribuite arbitrariamente sulla mappa.» resta valido.

## 6. Strict vs legacy

| Scenario | Comportamento |
|---|---|
| **Strict** con catalogo valido | `canonical: true` + siti canonici mondiali |
| **Legacy** (nessun catalogo bindato) | `200 { resources: [], facilities: [], canonical: false }` |
| Catalogo bindato assente/invalido | come legacy: array vuoti, mai geografia inventata |
| Partita inesistente | `404 { error: 'Game not found' }` (coerente con le altre route) |

Il fallback **player-scoped** di MAP P5.1 resta funzionante e non si somma mai alla
sorgente canonica: se `worldMapAssets` è presente si usano i giacimenti canonici,
altrimenti (legacy) si usano gli oggetti operativi `kind: 'mine'` con `regionId`
pubblicato. Mai due sorgenti insieme, quindi nessuna miniera mostrata due volte e
nessuna deduplicazione per nome. La deduplicazione tra impianti canonici e
`region.objects` avviene **solo a id identico**.

## 7. Endpoint

`GET /api/games/:id/map-assets` — sola lettura, accanto alle route militari in
`state.routes.ts`:

- binding del catalogo **senza** materializzare sessioni o idratare regioni:
  nuova `gameRepository.getWorldBinding(gameId)` (una query `games ⟶ worlds`) e
  `worldRepository.regionIds(worldId)` (solo `SELECT id`), perché
  `worldRepository.findById/getRegions` **scrive** oggetti geografici alla prima
  lettura di un mondo;
- nessun endpoint per regione: **una sola fotografia mondiale per snapshot**
  (nessun N+1, nessun fetch al click);
- inventario endpoint rigenerato: `+1` route **non mutante**
  (`total 106 → 107`, `reading 49 → 50`).

## 8. Snapshot consistency e fail-closed (frontend)

In `useNationSnapshot` gli asset P6 seguono lo stesso lifecycle di MAP P3.1/MAP P2:

- il refresh dipende da `gameId · currentTurn · currentDate · worldRevision ·
  headBranchId`: advance, checkpoint, **rewind**, restore e branch change
  invalidano la fotografia precedente;
- **all'avvio** del refresh `worldMapAssets` viene azzerato (`CURRENT STATE ≠ LAST
  KNOWN STATE`) e un contatore di richiesta impedisce a una risposta lenta di un
  ramo precedente di sovrascrivere quella nuova;
- in **errore**: `worldMapAssets = null` + `worldMapAssetsError`, quindi il layer
  torna al fallback player-scoped e, se non c'è nemmeno quello, mostra
  «**Dati territoriali non disponibili.**» — mai asset stale di un altro turno;
- `canonical: false` **non** è un errore: è «nessun dato canonico in questo mondo».

## 9. Frontend (diff minimo, nessun secondo modello)

| Punto | Intervento |
|---|---|
| `services/api.ts` | tipi `WorldMapAssetsPayload` + `gameApi.mapAssets` |
| `mapThematicContext.ts` | `resourceCandidatesFromWorldAssets()` (kind = `resourceId`, label = `resourceName`) e `canonicalFacilitiesFromWorldAssets()` |
| `thematicMapModel.ts` | `buildInfrastructureMapModel(regions, canonicalFacilities?)` (dedup a id esatto, filtro regione esistente, reparti mai opere) + campi proprietà/controllo sugli item + `unavailableReason` esplicito |
| `GameScreen.tsx` | sorgente primaria canonica, fallback P5.1, `worldFacilities` nel modello condiviso |
| `GameMap.tsx` / `MapboxMapView.tsx` | inoltro `worldFacilities` + `resourcesUnavailableReason` |
| `ProvinceInspector.tsx` | risorse: accessibilità + «dato noto» / «quantità non determinata»; impianti: Proprietario · Controllore · Potenza · Controllo · stato operativo |

Nessuna nuova `MapLayer` (restano le 8 di MAP P3), nessuna nuova azione, nessun
nuovo stato persistente, nessuna migrazione. `MapContextSelection` è invariata
(`region | unit | front | null`): gli asset non aggiungono kind alla selezione.

**Marker.** I giacimenti canonici usano la presentazione risorse già esistente di
MAP P3 (conteggio in legenda, tooltip di regione, dossier); gli impianti entrano
nel layer Infrastrutture, dove la visibilità è già governata da zoom e layer. Non è
stata introdotta una nuvola di nuovi marker: la densità (§22) resta quella
esistente, e l'aggregazione a zoom basso resta un candidato per P6.1.

## 10. Test aggiunti

**Backend — `tests/map-p6-world-assets.test.ts` (12)**
read model: giacimento estero pubblicato con `resourceId`/`resourceName` dal
catalogo · `hidden` non pubblicato · `known: null` → `knownQuantity: null` (mai
`0`) · `estimated` passato come dal catalogo · `polityId` da `ownerActorId` con
`region.owner` deliberatamente diverso · owner ≠ controller entrambi preservati ·
`typeName` sconosciuto → `typeId` tecnico · `regionId` inesistente → escluso ·
persistente con precedenza **solo** a id identico e **solo** su `operational`
(geografia dal catalogo).
endpoint: fotografia mondiale non player-scoped · legacy → array vuoti +
`canonical: false` · partita inesistente → 404 · **due GET identiche** non cambiano
`game_operational_objects` e non creano impianti NPC.

**Frontend — `src/components/Map/worldMapAssets.test.ts` (10)**
giacimento estero nel modello P3 con `kind`/`label` dal catalogo e stessi siti per
mappa e dossier · `known: false` senza zeri e senza `baseUnits` esposti ·
`regionId` inesistente esclusa · legacy → layer non disponibile · motivo
fail-closed esplicito · `resourceId` senza definizione resta tecnico · impianto
estero in Infrastrutture con proprietà canonica · dedup solo a id esatto (l'opera
del territorio vince) · reparti mai opere e niente bucket fantasma · il modello non
riscrive `owner`/`polity` delle regioni (immutabilità dell'input).

**E2E — `e2e/tests/map-p6-world-assets.spec.mjs` (9)**
A giacimento estero visibile in Risorse (accessibilità dal motore) · B riserve
nazionali mai geolocalizzate · C `known: null` → «quantità non determinata», non
`0` · D impianto estero in Infrastrutture · E Proprietario/Controllore/Potenza
distinti e mappa politica non riscritta · F isolamento dei layer · G cambio
snapshot → nuova fotografia, rewind → asset dello snapshot ripristinato · G2 errore
della sorgente → «Dati territoriali non disponibili.», nessun asset canonico
lasciato a schermo · H mobile 360×740 con dossier leggibile.

**Discriminazione.** Disattivando la sola selezione della sorgente canonica in
`GameScreen`, gli scenari **A** e **D** falliscono (nessun giacimento/impianto
estero): i test provano davvero la chiusura dell'asimmetria, non il fallback.

## 11. Gate

| Gate | Esito |
|---|---|
| `backend: npx tsc --noEmit` | ✅ |
| `backend: npm run build` | ✅ |
| `backend: npx vitest run` | ✅ **165 file / 1726 test** (164 → 165, +12) |
| `frontend: npx tsc --noEmit` | ✅ |
| `frontend: npx vitest run` | ✅ **75 file / 608 test** (74 → 75, +10) |
| `frontend: npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **128/128** (119 → 128) |
| `npm run test:a11y` | ✅ 3/3 |
| `npm run test:perf` | ✅ **2.24 MB** entro baseline |

Regressioni verdi: MAP P1 · MAP P2/P2.1/P2.2 · MAP P3/P3.1 · MAP P4/P4.1 ·
MAP P5/P5.1 · MILITARY P4–P6. `map-p3-layers.spec.mjs` scenario D resta verde
perché il mock E2E ora risponde `/map-assets` con `canonical: false` — il
comportamento **reale** di un mondo legacy, non un'eccezione di test.

## 12. Limiti residui (dichiarati)

1. **Allineamento degli id di regione.** La geografia è pubblicata solo se
   `Deposit.regionId`/`FacilityInstance.regionId` **esiste** nel mondo della
   partita (nessun sito orfano). L'unico catalogo con giacimenti/impianti nel
   repository è la fixture tecnica `realism_test_world`, i cui `regionId`
   (`ALPHA-nord`, …) non coincidono con gli id generati dai mondi reali
   (`<worldId>_<codice>`). Finché un catalogo non viene autorevolezzato contro gli
   id di regione di un mondo reale, MAP P6 è **strutturalmente attivo ma senza
   contenuto** in produzione: nessuna euristica di similarità è stata introdotta
   per "far comparire" i dati (sarebbe geografia inventata). Serve una fase di
   contenuto (o un alias canonico pubblicato dal motore), non una patch di UI.
2. **Persistente vs catalogo.** L'overlay dello stato persistente è implementato
   con identità esatta e solo su `operational`, ma oggi è un **no-op**: gli
   impianti persistiti sono `{kind}-{polityId}-{n}` (profilo nazionale) e non
   condividono l'id spazio `fac_*` del catalogo. La regola è quindi pronta ma non
   ancora esercitata su dati reali.
3. **Densità dei marker.** Nessuna aggregazione per zoom è stata aggiunta: i
   giacimenti usano la presentazione risorse esistente (legenda/tooltip/dossier).
   Un clustering dedicato, se un catalogo denso lo renderà necessario, appartiene a
   P6.1 (§22).
4. **Persistenza storica.** Il read model è una fotografia dello snapshot corrente:
   non esiste (per scelta) uno storico degli asset economici nel frontend.

## 13. Conferme

- **Nessuna GET materializza stato NPC**: l'endpoint non tocca
  `OperationalStateStore`, non chiama `ensureSeeded`, non crea sessioni (niente
  `getSessionOrThrow`) e non idrata regioni; legge il catalogo e, in sola lettura,
  eventuali righe già persistite. Il test di endpoint esegue due GET e verifica che
  `game_operational_objects` resti identico e che nessun impianto NPC compaia.
- **Nessun secondo motore**: MAP P6 è un read model. Non calcola produzione, non
  estrae, non modifica scorte, non crea impianti, non cambia ownership, non
  simula NPC, non avanza il tempo. L'unico codice nuovo è proiezione di dati che il
  motore possiede già.
