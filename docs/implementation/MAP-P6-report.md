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

---

# MAP P6.1 — real map markers, strict fail-closed, production-ready canonical assets

## 14. Obiettivo e i tre blocker affrontati

MAP P6 aveva chiuso l'**asimmetria dei dati** (giacimenti/impianti canonici
mondiali leggibili nel dossier) ma non l'**asimmetria della superficie**: i
marker sulla mappa continuavano a nascere solo da `region.objects`, quindi un
giacimento estero pubblicato dall'endpoint era invisibile finché non lo si
cercava nel dossier. P6.1 affronta tre blocker, tutti e tre con una prova
discriminatoria:

| Blocker | Difetto | Correzione |
|---|---|---|
| **A** | gli asset P6 non sono **disegnati**: nessun marker reale, nessun click, nessuna tastiera | overlay cartografico derivato dal modello tematico (`thematicAssetMarkers.ts`) |
| **B** | `null` confondeva «mondo legacy» con «sorgente in errore» → un errore mostrava il fallback player-only e **sembrava corrente** | macchina a 4 stati `canonical · legacy · error · loading`, `error` **fail-closed senza fallback** |
| **C** | DoD «almeno un preset reale pubblica asset canonici»: **impossibile** con i dati presenti | blocco **documentato con evidenza**, nessun dato inventato, nessun match testuale; fase di authoring/import separata (P7) |

## 15. Blocker A — marker reali, dal modello tematico

**Nuovo modulo puro** `frontend/src/components/Map/thematicAssetMarkers.ts`:

- `buildThematicAssetMarkers({ activeLayer, resourceSites, infrastructureByRegion, regionIds })`
  → `ThematicAssetMarker[]` con `id`, `kind` (`resource | facility`), `regionId`,
  `label`, `detail`, `slot`;
- il **layer attivo** decide l'enfasi: `resources` → giacimenti,
  `infrastructure` → **solo** impianti `source === 'canonical'`, ogni altro layer
  → `[]` (la separazione dei layer di P3 è conservata: nessun marker su
  Politica/Economia/Militare/Dossier/Terreno);
- **fonte unica**: `thematic.resources.sites` e `thematic.infrastructure.byRegion`
  — lo **stesso** modello che alimenta tooltip e dossier. Il renderer non legge
  l'API grezza e non reimplementa `canonicalFacilitiesFromWorldAssets()`;
- un asset la cui regione non esiste nel mondo è **escluso**: nessun marker orfano;
- `markerSlotOffset(slot)` → offset in **pixel** deterministici (anello di raggio
  crescente, ≤ 30 px). **Mai** lat/lng, mai `Math.random`, mai `hash → coordinate`,
  mai `nome → coordinate`: l'offset è presentazione, non geografia;
- `markerAriaLabel(marker, regionName)` → «Carbone — Germania · richiede estrazione · dato noto».

**Rendering** (`MapboxMapView.tsx`, effetto dedicato keyed sugli id degli asset):

- anchor = `getLabelPoint(feature.geometry)`, il **representative point già usato
  dalle etichette** di regione: è un ancoraggio visivo riusato, non una nuova
  affermazione geografica. La source of truth resta `regionId` (il marker dichiara
  «asset localizzato nella regione X»);
- l'effetto osserva il modello: cambio layer → i marker del layer precedente sono
  rimossi; cambio snapshot/rewind → i marker sono ricreati dagli asset correnti;
- **niente decluttering/clustering**: la macchina zoom/densità degli oggetti
  territoriali non è stata toccata (vedi §18).

**Accessibilità e interazione** (§8):

- ogni marker è un **`<button type="button">` reale** → attivabile con `Enter` e
  `Space` senza handler aggiuntivi, `tabindex` naturale, focus visibile
  (`:focus-visible` con outline dedicato), `aria-label` semantica;
- target: 18 px, **24 px** con `@media (pointer: coarse)`;
- click → `onRegionClickRef.current(regionId)` → **region context esistente**.
  Nessuna variante `{ kind: 'resource' }`/`{ kind: 'facility' }` introdotta in
  `MapContextSelection`: la selezione è ancora solo un id. Nessun fetch al click
  (§32): il dossier legge il modello già costruito.

## 16. Blocker B — errore ≠ legacy (fail-closed reale)

`WorldMapAssetsStatus = 'loading' | 'canonical' | 'legacy' | 'error'` (tipo in
`services/api.ts`, popolato da `useNationSnapshot`):

- `canonical` → asset del catalogo; `legacy` (`canonical: false`) → fallback
  player-scoped P5.1; `error` (HTTP/rete/parsing) → **nessun** fallback;
  `loading` → nessun asset corrente (mai quello dello snapshot precedente).
- La regola vive in **un unico punto**, `assetsForStatus()` in
  `mapThematicContext.ts`, consumata da `GameScreen` per risorse **e** impianti:
  non esistono due nozioni di sorgente. Le due sorgenti non si sommano mai.
- In errore il layer Risorse mostra «Dati territoriali non disponibili.»
  (`data-resources-available="false"`) e il dossier non elenca alcun sito.

**Prova discriminatoria**: con la semantica precedente (`worldMapAssets === null`
→ fallback) lo scenario E2E **G2 fallisce** — la miniera del giocatore ricompare
dopo l'errore. Con la correzione passa. Il test è quindi in grado di distinguere
le due implementazioni (verificato eseguendo la suite contro il codice pre-fix).

## 17. Blocker C — preset reale: blocco documentato, nessun dato inventato

Verifica eseguita sui preset presenti nel repository (`data/presets/`):

| Preset | `simulation/` | chiavi asset in `preset.json` |
|---|---|---|
| `modern_world_provinces` | assente | nessuna |
| `mondo_1936` · `mondo_1989` · `europa_1914` · `europa_1815` | assente | nessuna |
| `pax_modern_provinces` | assente | nessuna |
| `paxh_ww2_provinces` | assente | nessuna |

- `preset.json` contiene `countries: [{ code, name, color }]` (presentazione) e
  testo libero (`description`, `prompts`, `map_base`, `map_detail`): **nessun**
  `objects`/`mines`/`factories`/`industries`/`resources`/`deposits`.
- `map.geojson` contiene proprietà **geografiche/politiche**
  (`code`, `name`, `country`, `is_capital`, `area_km2`, `surface_type`, `tags`,
  `adjacencies`, `centroid`): nessuna geografia economica. Un `centroid` non è un
  asset e non è stato usato per generarne uno.

**Regola applicata (§20–22)**: nessun dataset inventato, nessuna distribuzione di
riserve nazionali, nessuna stima di giacimenti, **nessun string matching a
runtime** (`country`/`name` del GeoJSON non sono stati confrontati con gli id di
regione o con i nomi del catalogo). Non essendo disponibile una fonte
strutturata, la procedura si ferma al passo (1) e **dichiara il blocco**.

Nuovo test backend `tests/map-p6-real-preset.test.ts` (4 test) che rende il blocco
verificabile e non retorico:

1. **evidenza**: per tutti i 7 preset reali asserisce l'assenza di `simulation/`,
   l'assenza di chiavi asset e la forma stretta di `countries`
   (`['code','color','name']`). Se un giorno un catalogo verrà aggiunto, questo
   test **fallisce di proposito** e obbliga ad aggiornare la fase di authoring;
2. `loadSimulationCatalog(preset reale)` → `catalog === null` (nessun dato
   sintetizzato dal loader);
3. **endpoint** su una partita reale (`modern_world_provinces`) →
   `{ resources: [], facilities: [], canonical: false }`: la UI dirà «nessuna
   geografia economica canonica», non mostrerà una mappa parziale;
4. invariante di significatività geografica: gli id di regione del mondo reale
   (`<worldId>_<codice>`) sono distinti dallo spazio id della fixture tecnica — la
   pubblicazione resta vincolata all'esistenza della regione, senza similarità.

**Prossima fase (P7, proposta)**: authoring/import **a monte** di una fonte
strutturata per un preset reale (mappa `regionId` del catalogo ↔ id di regione del
mondo), con normalizzazione deterministica in fase di authoring (§21). Fino ad
allora il DoD §39 è soddisfatto nella parte verificabile (il percorso canonico
pubblica dati reali quando esistono e non ne inventa quando non esistono) e
**limitato** nella parte di contenuto.

## 18. Densità: offset deterministici, clustering fuori scope

Un catalogo denso è un problema di presentazione, non di geografia. P6.1 risolve
la **sovrapposizione locale** (più asset nella stessa provincia) con `slot` +
`markerSlotOffset()`: pixel, deterministici, stabili tra snapshot identici.
L'aggregazione per zoom (clustering) resta **fuori scope** e non è stata
simulata: nessun raggruppamento finto, nessuna soglia arbitraria.

## 19. Test aggiunti da P6.1

| Livello | File | Test |
|---|---|---|
| frontend unit | `Map/thematicAssetMarkers.test.ts` (nuovo) | **7** — layer→tipo marker, esclusione regioni inesistenti, altri layer vuoti, slot deterministici, quantità ignota mai `0`, `aria-label`, offset pixel |
| frontend unit | `Map/worldMapAssets.test.ts` | **+4** — `canonical` (catalogo, mai fallback) · `legacy` (fallback P5.1) · `error` (fail-closed anche con payload residuo) · `loading` (nessuno stale) |
| backend | `tests/map-p6-real-preset.test.ts` (nuovo) | **4** — evidenza preset reali, catalogo assente, endpoint `canonical:false`, invariante geografica |
| E2E | `e2e/tests/map-p6-world-assets.spec.mjs` | **+1**, e **6 riscritti sui marker reali**: A marker cliccabile→region context→dossier · A2 `<button>`+Enter/Space+focus+`aria-label` · C quantità non determinata · D marker impianto · F isolamento layer **sui marker** (Politica 0/0 · Economia 0/0 · Risorse >0/0 · Infrastrutture 0/>0) · G cambio snapshot e **rewind verificati nel DOM** · G2 errore (nessun canonico, nessun fallback player-only) · H mobile 360×740 |

Totale P6.1: **+11 test frontend**, **+4 backend**, **+1 E2E**.

## 20. Gate (dopo P6.1)

| Gate | Esito |
|---|---|
| `backend: npx tsc --noEmit` | ✅ |
| `backend: npm run build` | ✅ |
| `backend: npx vitest run` | ✅ **166 file / 1730 test** (165 → 166, +4) |
| `frontend: npx tsc --noEmit` | ✅ |
| `frontend: npx vitest run` | ✅ **76 file / 619 test** (75 → 76, +11) |
| `frontend: npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **129/129** (128 → 129) |
| `npm run test:a11y` | ✅ 3/3 |
| `npm run test:perf` | ✅ **2.24 MB** entro baseline |

Regressioni verdi: MAP P1 · P2/P2.1/P2.2 · P3/P3.1 · P4/P4.1 · P5/P5.1 ·
MILITARY P4–P6. `map-p5-context.spec.mjs` resta verde perché il mock E2E risponde
`canonical: false` (mondo legacy reale) → stato `legacy` → fallback P5.1.

## 21. Do-not-touch rispettato (§36) e conferme (§31–34, §41)

- **Nessun nuovo endpoint** (§31): riuso di `GET /games/:id/map-assets`
  (inventario endpoint invariato: 107). **Nessun fetch al click** (§32): il
  dossier legge `thematicModel`/`assetSources` già in memoria.
- **Nessuna scrittura**: `WorldMapAssets` resta read model puro; nessun seed NPC,
  nessuna materializzazione di stato, nessun secondo motore. Anche il nuovo test
  sul preset reale usa il percorso di lettura.
- **Rewind/branch** (§33): verificati nel **DOM** — i marker dello snapshot
  precedente spariscono, quelli dello snapshot ripristinato ricompaiono.
- **Mobile 360×740** (§34): marker visibili e cliccabili (≥ 16 px misurati),
  dossier leggibile, nessun traboccamento orizzontale.
- Non modificati: `resolveFront()`, ownership guard, `403 unit_forbidden`,
  contratti degli endpoint militari, motore economico, scheduler, pathfinder,
  `MilitaryUnitState`, tabelle di persistenza. Nessun refactor ampio: le modifiche
  sono additive e confinate a mappa/overlay/hook/stato sorgente.

## 22. Limiti residui aggiornati (P6.1)

1. **Contenuto canonico in produzione**: invariato e ora **documentato da test**
   (§17). Nessun preset reale contiene oggi geografia economica strutturata; serve
   la fase P7 di authoring/import. Nessuna euristica di similarità è stata
   introdotta per «far comparire» i dati.
2. **Clustering**: fuori scope, non simulato (§18).
3. **Overlay persistente**: la regola a identità esatta resta pronta ma non
   esercitata su dati reali (gli impianti persistiti sono `{kind}-{polityId}-{n}`).
4. **Flicker legacy transitorio**: durante il refresh lo stato è `loading` (nessun
   asset); per un mondo legacy il fallback P5.1 si attiva al termine della
   richiesta. Comportamento voluto (mai asset stale), costo di un frame.
