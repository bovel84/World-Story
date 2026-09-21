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

1. **Allineamento degli id di regione** — *chiuso in P6.2 (§23)*. Il catalogo di
   `modern_world_provinces` dichiara il binding
   `manifest.regionIdBinding: { space: 'world_scoped' }` e nomina le regioni con
   `map.geojson:properties.code`; il read model risolve `<worldId>_<codice>` e
   pubblica solo se la regione esiste. Restano non migrati gli altri preset reali
   (`mondo_1936`, `mondo_1989`, `europa_1914`, `europa_1815`,
   `pax_modern_provinces`, `paxh_ww2_provinces`): per loro l'endpoint continua a
   rispondere `canonical: false`, senza euristiche di similarità.
2. **Persistente vs catalogo.** L'overlay dello stato persistente è implementato
   con identità esatta e solo su `operational`, ma oggi è un **no-op**: gli
   impianti persistiti sono `{kind}-{polityId}-{n}` (profilo nazionale) e non
   condividono l'id spazio `fac_*` del catalogo. La regola è quindi pronta ma non
   ancora esercitata su dati reali.
3. **Densità dei marker.** Nessuna aggregazione per zoom: la sovrapposizione
   locale è risolta con offset in pixel deterministici e una spaziatura
   (`MARKER_SLOT_SPACING = 27 px`) ≥ al target di tocco, così due asset della
   stessa provincia restano entrambi cliccabili. Un clustering dedicato, se un
   catalogo denso lo renderà necessario, resta fuori scope (§18, §23).
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
- `markerSlotOffset(slot)` → offset in **pixel** deterministici (anelli di raggio
  `MARKER_SLOT_SPACING = 27 px`, ≥ al target di tocco, da P6.2). **Mai** lat/lng,
  mai `Math.random`, mai `hash → coordinate`, mai `nome → coordinate`: l'offset è
  presentazione, non geografia;
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
| `modern_world_provinces` | **presente da P6.2** (vedi §23) | nessuna (il catalogo è la fonte, non `preset.json`) |
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
regione o con i nomi del catalogo).

> **Aggiornamento P6.2**: la procedura non si ferma più al passo (1) per il preset
> moderno. Il blocco è stato risolto **a monte**, con authoring esplicito e un
> contratto di id dichiarato (`manifest.regionIdBinding`): `modern_world_provinces`
> è oggi il preset reale di riferimento con un catalogo `simulation/` valido
> (§23). Gli altri preset reali restano non migrati: per loro il blocco è ancora
> dichiarato, non aggirato.

Il test backend `tests/map-p6-real-preset.test.ts` rendeva il blocco verificabile
e non retorico (evidenza sui preset reali: nessun `simulation/`, nessuna chiave
asset, `countries` nella forma stretta `['code','color','name']`;
`loadSimulationCatalog` → `null`; endpoint → `canonical: false`; spazio id del
mondo distinto da quello della fixture).

> **P6.2 ha invertito questa prova** per il preset di riferimento: il file ora
> verifica che il catalogo moderno è valido, che l'endpoint pubblica asset reali e
> che ogni `regionId` esiste nel mondo (§23). L'evidenza "preset senza catalogo"
> resta solo per i preset **non migrati**.

**Prossima fase (P7, proposta)**: estendere l'authoring agli altri preset reali e
alle quantità verificabili (fonti esterne). Il contratto di id e la pipeline sono
ora provati su un preset reale (§23): quello che resta è **contenuto**, non
meccanismo.

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

1. **Contenuto canonico in produzione**: *risolto per il preset di riferimento in
   P6.2 (§23)* — `modern_world_provinces` ha un catalogo valido e l'endpoint
   pubblica asset reali. Gli altri preset reali restano non migrati (dichiarato,
   con test). Nessuna euristica di similarità è stata introdotta per «far
   comparire» i dati.
2. **Clustering**: fuori scope, non simulato (§18).
3. **Overlay persistente**: la regola a identità esatta resta pronta ma non
   esercitata su dati reali (gli impianti persistiti sono `{kind}-{polityId}-{n}`).
4. **Flicker legacy transitorio**: durante il refresh lo stato è `loading` (nessun
   asset); per un mondo legacy il fallback P5.1 si attiva al termine della
   richiesta. Comportamento voluto (mai asset stale), costo di un frame.

---

# MAP P6.2 — modern preset canonical assets (chiusura di MAP P6)

## 23. `modern_world_provinces` è il preset reale di riferimento

### 23.1 Contratto degli id di regione (verificato, non assunto)

Il problema che P6.1 aveva solo *dichiarato* era l'allineamento fra gli id del
catalogo e gli id delle regioni del mondo. Il contratto effettivo, letto nel
codice che genera i mondi, è:

| Passo | Dove | Fatto |
|---|---|---|
| 1 | `map.geojson` del preset | ogni feature porta `properties.code` (es. `USTX`, `ZANW`, …): è l'unico codice autorevole **a monte** della generazione |
| 2 | `partitionMapFeatures()` | le feature con `country ≠ code` sono **province** del paese `country` |
| 3 | `resolveMapDetail(preset.map_detail, hasProvinceMap)` | senza `map_detail` una mappa provinciale usa il livello `full` |
| 4 | `deriveGroups()` livello `full` | `group.code = feature.properties.code` |
| 5 | `worlds.routes` | `region.id = <worldId>_<code>` — `worldId` nasce **a runtime** (`shortId()`) |

Quindi il catalogo **non può** contenere l'id finale: può contenere il codice del
preset. La soluzione adottata è una dichiarazione esplicita, non una convenzione
nascosta:

```json
"regionIdBinding": { "space": "world_scoped", "source": "map.geojson:properties.code" }
```

- gli asset nominano la regione con `properties.code` (`"regionId": "USTX"`);
- il read model risolve `${worldId}_${code}` (`regionIdResolver()` in
  `WorldMapAssets.ts`) e **pubblica solo se l'id esiste** in `world_regions`;
- il loader valida il binding (`validateCatalog`): una `space` non supportata o una
  `source` mancante sono **errori bloccanti** — un binding sbagliato non può
  restare silenzioso;
- assente il binding, gli id del catalogo valgono come id del mondo (legacy);
  `world_scoped` senza `worldId` → **nessun asset** (meglio nessun asset che un
  asset nella regione sbagliata).

Nessuna somiglianza fra stringhe, nessun confronto per nome: la risoluzione è una
**costruzione di id** più una verifica di appartenenza.

### 23.2 Struttura aggiunta al preset

```
data/presets/modern_world_provinces/simulation/
  manifest.json          id/version/schemaVersion/startDate, mode, declaration,
                         currency, sources, regionIdBinding
  polities.json          8 politie (USA SAU RUS NLD DEU CHN IND ZAF)
  resources.json         3 risorse: crude_oil · coal · iron_ore
  facilities.json        3 tipi: refinery · steel_plant · coal_power_plant
  actors.json            9 attori economici (pubblici e privati) con polity reale
  technologies.json []   recipes.json []   authorities.json []
  initial-state.json     22 giacimenti · 10 impianti (inventario/tesoreria: vuoti)
```

Formato **esattamente** quello del motore (`SimulationCatalog`): nessun formato
parallelo, nessun nuovo motore, nessuna nuova tabella. `mode: "authored"`:
il catalogo è authored, non sourced; `declaration: "historical_estimated"`.

**Perché `authored` e non `strict`.** `economy_mode` di una partita deriva solo da
`manifest.mode` (`session-registry`): dichiarare `strict` avrebbe convertito
**ogni nuova partita** sul mondo moderno all'economia strict, che richiede un
catalogo completo per tutte le politiche (tesorerie, attori, filiere). Un vertical
slice non può sostenerlo senza inventare un database mondiale — esattamente ciò
che il task vieta. Con `authored` il mondo mantiene il comportamento economico
attuale e la **geografia autorevole** viaggia lo stesso, perché la sua validità
viene dal catalogo validato. Per questo `loadWorldMapAssets()` non usa più
`economy_mode` come condizione: pubblica quando **il preset ha un catalogo
valido**. Era una proxy sbagliata (il layer di lettura non è il percorso
economico della partita); il test lo fissa (`economyMode === 'legacy'` **e**
`canonical: true`).

### 23.3 Vertical slice: asset, distribuzione, casi discriminanti

**12 paesi · 22 giacimenti · 10 impianti** (authored, rappresentativi):

| Risorsa | Giacimenti (regioni reali) |
|---|---|
| `crude_oil` | `USTX` Texas · `USAK` Alaska · `SA04` Ash Sharqiyah · `RUKHM` Khanty-Mansiy · `IR10` Khuzestan · `CAAB` Alberta · `RUSA` Sakha (**hidden**) |
| `coal` | `USWY` Wyoming · `CNNM` Inner Mongol · `INJH` Jharkhand · `ZANW` North West · `ZAMP` Mpumalanga · `DENW` Nordrhein-Westfalen · `DEBB` Brandenburg · `AUQLD` Queensland · `RUKYA` Krasnoyarsk |
| `iron_ore` | `AUWA` Western Australia · `BRPA` Pará · `BRMG` Minas Gerais · `ZANC` Northern Cape · `INOR` Odisha · `CLCO` Coquimbo |

| Tipo | Impianti |
|---|---|
| `refinery` | `USTX` · `SA04` · `RUKHM` · `NLNH` ×2 (uno **non operativo**) |
| `steel_plant` | `DENW` · `CNHE` · `INOR` |
| `coal_power_plant` | `CNNM` · `ZANW` |

Casi discriminanti richiesti dal task, tutti presenti e verificati:

- **territorio ≠ proprietario economico ≠ controllo**:
  `facility:NLNH:refinery:1` sta in Noord-Holland (Paesi Bassi) ma è posseduto da
  `usa_gulf_refining` (**USA**) e controllato da `nld_port_energy` (**NLD**);
  l'endpoint pubblica `polityId: USA` e `controllerPolityId: NLD`, e il marker non
  riscrive `region.owner`;
- **impianto non operativo**: `facility:NLNH:refinery:2` è `operational: false` nel
  catalogo;
- **giacimento non pubblicabile**: `deposit:RUSA:crude_oil:1` è
  `accessibility: "hidden"` — il motore non lo rende estraibile, P6 non lo
  pubblica (21 dei 22 giacimenti escono, e il test lo asserisce per numero).

**Dati deliberatamente NON creati** (mancano le fonti, non l'implementazione):
quantità note (`known: null` su **ogni** giacimento: 22 `unknown_quantity`, unico
warning del catalogo), stime `estimated`, tesorerie/saldi, inventari, ricette,
tecnologie, regole di autorità, manutenzione degli impianti. Nessuna azienda
reale è nominata: gli attori hanno nomi funzionali (es. «Raffinazione privata
(USA)») e sono dichiarati authored.

### 23.4 Classificazione degli impianti non operativi (fix)

Riscontro: in `mapThematicContext.ts` i gruppi erano costruiti come
`!underConstruction && !strategic` → un asset canonico con `operational: false`
finiva in **«Operative»**. Correzione con precedenza **mutuamente esclusiva** in
un unico punto:

```ts
infrastructureGroupOf(item): 'underConstruction' | 'strategic' | 'inactive' | 'operative'
// cantiere → strategica → canonical && operational === false → operativa
```

- nuovo gruppo `inactive` → **«Non operative»** nel Province Inspector
  (`[data-infrastructure-state="inactive"]`), **prima** di «In costruzione»;
- `operational === undefined` (opere legacy del territorio) **non** è `false`:
  comportamento invariato;
- l'impianto fermo **resta visibile** (mappa, marker, dossier) con proprietario,
  controllore, polity di proprietà e polity di controllo.

**Prova discriminatoria**: con la classificazione precedente lo scenario E2E
`MAP P6.2 / C` **fallisce** (l'impianto non compare sotto «Non operative»); con la
correzione passa. Verificato eseguendo la suite contro il codice pre-fix.

### 23.5 Test P6.2

| Livello | File | Test |
|---|---|---|
| backend (invertito) | `tests/map-p6-real-preset.test.ts` | **18** — catalogo valido senza errori e con la sola ignoranza dichiarata · 3 risorse/3 tipi/più paesi · proprietà ≠ territorio · attori e polity integri · `known: null` ovunque · **binding**: ogni regione del catalogo esiste nella mappa (derivata con le funzioni pure di `worlds.routes`) · l'endpoint pubblica tutto tranne gli `hidden` (nessuno scarto silenzioso) · ogni `regionId` pubblicato esiste nel mondo · regione rinominata → asset **escluso, non spostato** · senza binding → 0 asset · senza `worldId` → 0 asset · endpoint popolato · proprietà/controllo distinti · `operational:false` pubblicato · `hidden` escluso · due GET identiche senza scritture · `authored` + `canonical:true` · gli altri preset restano non migrati (dichiarato) |
| frontend unit | `Map/mapThematicContext.test.ts` | **+5** — `operational:false` → «Non operative» (mai «Operative») · `operational:true` → «Operative» · legacy senza campo → invariato · precedenza mutuamente esclusiva (cantiere/strategica/ferma/operativa) · il fermo conserva proprietario, controllore e potenze |
| frontend unit | `Map/thematicAssetMarkers.test.ts` | **+1** — spaziatura ≥ target di tocco: due asset della stessa provincia non si coprono |
| E2E (dati reali) | `e2e/tests/map-p6-modern-assets.spec.mjs` (nuovo) | **6** — A marker reale `deposit:ZANW:coal:1` + region context + «quantità non determinata» · B `facility:NLNH:refinery:1` con proprietario/controllore/polity · C `operational:false` visibile sotto «Non operative» e **non** in «Operative» · D isolamento layer sugli asset reali · E fail-closed invariato (errore ≠ legacy) · F mobile 360×740 |

L'E2E moderno non usa una fixture sintetica come prova di produzione: la geometria
del mondo viene dalla **`map.geojson` reale** (`ZANW`, `NLNH`, `USTX`, `AUWA`) e il
payload `/map-assets` è **costruito dai file del catalogo** (risorse, tipi,
attori, nomi compresi). Se il catalogo cambia, il test cambia con lui.

### 23.6 Gate (P6.2)

| Gate | Esito |
|---|---|
| `backend: npx tsc --noEmit` / `npm run build` | ✅ |
| `backend: npx vitest run` | ✅ **166 file / 1744 test** (+14) |
| `frontend: npx tsc --noEmit` / `npm run build` | ✅ |
| `frontend: npx vitest run` | ✅ **76 file / 625 test** (+6) |
| `npm run test:e2e:mock` | ✅ **135/135** (+6) |
| `npm run test:a11y` | ✅ 3/3 |
| `npm run test:perf` | ✅ **2.24 MB** entro baseline |

Regressioni verdi: MAP P1 · P2/P2.1/P2.2 · P3/P3.1 · P4/P4.1 · P5/P5.1 · P6 ·
P6.1 · MILITARY P4–P6.

### 23.7 DoD P6.2

| Requisito | Esito |
|---|---|
| catalogo `simulation/` valido per `modern_world_provinces` | ✅ `report.ok`, 0 errori |
| preset reale di riferimento di P6 | ✅ è quello usato dai test reali |
| `/map-assets` → `canonical: true` su partita della mappa moderna | ✅ |
| ≥ 1 risorsa authored reale | ✅ 21 pubblicate (22 dichiarate, 1 `hidden`) |
| ≥ 1 impianto authored reale | ✅ 10 pubblicati (1 non operativo) |
| tutti i `regionId` verificati sulle regioni effettive | ✅ test di binding |
| ≥ 1 marker Risorse visibile sulla mappa moderna | ✅ scenario A |
| ≥ 1 marker Infrastrutture visibile | ✅ scenari B/C/F |
| click marker → regione → Province Inspector | ✅ A/B/C |
| nessuna geografia dedotta a runtime | ✅ nessun match/nome/similarità |
| `operational:false` non sotto «Operative» | ✅ unit + E2E (discriminante) |
| l'impianto non operativo resta visibile | ✅ marker + dossier |
| compatibilità legacy preservata | ✅ preset non migrati + fixture |
| fail-closed P6.1 preservato | ✅ scenario E |
| test verdi | ✅ tutti i gate |

### 23.8 Limiti residui (P6.2)

1. **Quantità ignote per scelta.** `known: null` su tutti i giacimenti: nel
   repository non esiste una fonte autorevole e il catalogo non fabbrica numeri.
   Con `authored`, inoltre, i giacimenti **non sono estratti dal motore**: il
   layer li mostra come geografia autorevole, non come stock simulato. Le
   quantità (e l'attivazione `strict`) richiedono una fase di **dati** con fonti.
2. **Copertura**: 12 paesi su 112 della mappa. Un vertical slice, non un atlante.
3. **Altri preset reali** non migrati: `canonical: false`, dichiarato e testato.
4. **Clustering**: ancora fuori scope; la densità è gestita con offset in pixel.
5. **Overlay persistente** (P6 §12.2): invariato, gli id persistiti restano
   `{kind}-{polityId}-{n}` e non intersecano gli id del catalogo.
