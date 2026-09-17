# MAP-DETAIL — Livelli di profondità della mappa nei preset

Obiettivo: permettere a un preset di dichiarare **quanto dettaglio** ha la
mappa, con tre livelli — `nations` (solo nazioni) · `grouped` (regioni
raggruppate) · `full` (massimo dettaglio) — con **default retrocompatibile**.

Branch: `feat/map-detail-levels` · Base: `main` = `0deff63`.

Classificazione dei cambi: **campo preset + loader/route = D** (piccola
estensione di configurazione, **nessuna migrazione DB**); **proiezione e
derivazione confini = B** (read model derivato dal motore esistente);
**selettore UI = A** (presentazione). Nessun **E**.

---

## 1. Problemi trovati (FASE 1 — verifiche sul codice reale)

1. **Il preset non ha alcun campo di granularità.** `PresetPackage`
   (`backend-nest/src/utils/preset-loader.ts`) espone solo id, name, description,
   start_date, country_codes, base_prompt, historical_accuracy, countries,
   country_colors, prompts, simulation_rules, lore, author, version. Confermato:
   nessun campo di dettaglio mappa.

2. **Il livello è implicito.** In `backend-nest/src/routes/worlds.routes.ts`
   `ingestFeature` mette una feature in `provinceFeaturesByCountry` solo quando
   `properties.country` esiste **ed è diverso** da `properties.code`; altrimenti
   la feature è una regione-paese (`geojsonFeatures`). Quindi oggi esistono solo
   due comportamenti rigidi: **paesi** (Natural Earth) oppure **tutte le
   province**. Manca il livello intermedio e la scelta.

3. **Gerarchia intermedia: verifica sui dati reali.**
   - `pax_modern_provinces/map.geojson` (4475 feature): proprietà
     `code, country, name, pax_region_id, centroid, adjacencies, surface_type,
     tags, is_capital`. **`pax_region_id` è unico per feature** (4475 valori
     distinti) → **non è una gerarchia**. **`adjacencies` è una lista reale di
     adiacenza** tra province (per `pax_region_id`).
   - `modern_world_provinces/map.geojson` (946 feature): `code, country, name,
     area_km2`. **Nessuna gerarchia, nessuna adiacenza.**
   - `paxh_ww2_provinces/map.geojson` (223 feature): `code, name, provinces,
     tags` — sono **paesi** (MultiPolygon), `country` assente → mondo "nazioni".
   - Conclusione: **oggi nessun preset porta una gerarchia intermedia
     utilizzabile**; `grouped` deve quindi usare il raggruppamento geografico
     deterministico. Il codice è pronto a preferire una gerarchia reale se un
     preset futuro la dichiarerà.

4. **Confini delle province mai calcolati.** In modalità province
   `computeBorders` era invocato solo su `geojsonFeatures` (vuoto in quella
   modalità): i mondi provinciali nascevano con `borders = []`. È la causa per
   cui `pressureNeighbours()` (hotfix precedente, adiacenza reale) non trovava
   vicini nei mondi provinciali.

---

## 2. Soluzione applicata

### Campo `map_detail` (classe D)

Campo **opzionale** in `preset.json`:

| Valore | Significato | Risultato |
|---|---|---|
| `nations` | Solo nazioni | 1 regione per paese (province dissolte) |
| `grouped` | Regioni raggruppate | gruppi deterministici di province |
| `full` | Massimo dettaglio | 1 regione per provincia (**come oggi**) |

- Validazione: `isMapDetail` / `normalizeMapDetail`; `validatePresetJson`
  rifiuta valori diversi dai tre. Assente = nessun errore.
- **Default retrocompatibile** (`resolveMapDetail`): senza campo, un preset con
  mappa provinciale → `full`; senza → `nations`. `full`/`grouped` richiesti su
  un preset **senza** mappa provinciale ricadono su `nations`.
- Il campo vive in `preset.json` (proprietà del preset), **non** è stato di
  gioco: non viene persistito in DB e non tocca il motore.

### Proiezione (classe B) — `backend-nest/src/utils/map-detail.ts`

Modulo **puro e deterministico** (stesso input → stesso output), senza nuove
dipendenze (riusa `geometryAreaDeg2`, `largestRingCentroid`, `computeBorders`):

- `hasProvinceFeatures` — riconosce le mappe provinciali (`country` ≠ `code`).
- `deriveGroups(features, level, {owner, countryName})`:
  - `full` → 1 gruppo per feature (proprietà originali preservate);
  - `nations` → 1 gruppo per paese, geometria **MultiPolygon** dei membri,
    capitale preservata (`hasCapital`);
  - `grouped` → **prima la gerarchia reale** (chiavi `region`, `admin1`,
    `macroregion`, `group`, `parent`, … presenti e capaci di raggruppare);
    altrimenti **clustering geografico deterministico**.
- `distributeCountryStats(totals, groups)` — calcola le statistiche per feature
  con la **formula storica** (peso d'area, capitale ×1.6, bonus militare ×1.25)
  e i gruppi aggregati **sommano i membri**: `nations`/`grouped` restano coerenti
  con `full`.
- `buildProvinceAdjacency` — adiacenza tra province: usa `adjacencies` esplicite
  quando presenti su tutte le feature (mappa Pax), altrimenti la **deriva dalla
  geometria** con `computeBorders`.
- `deriveGroupBorders` — due gruppi sono confinanti se **almeno una provincia di
  A confina con una di B**; nessuna adiacenza inventata. Confini ordinati e
  deterministici.

### Perché questo algoritmo di raggruppamento

Il clustering geografico deterministico è stato scelto perché **nessun preset
attuale porta una gerarchia**:

- **K = ceil(n / 3)** (circa 3 province per gruppo, come da indicazione del task).
- **Niente casualità**: le feature sono ordinate per `code`; i semi iniziali
  sono presi a indici regolari; l'assegnazione usa distanza al quadrato con
  correzione della longitudine per la latitudine (`cos(lat)`); 12 iterazioni
  fisse; i cluster sono riordinati per codice membro minimo. Tie-break per
  indice inferiore.
- Se una feature non ha punto rappresentativo (centroide da `properties.centroid`
  o dal poligono più grande), si ricade su un **chunking** deterministico (stesso
  ordine per codice).

### Statistiche e metadati

`somma di popolazione/GDP/potenza` dei membri, con capitale preservata.
`objects` = capitale reale sul gruppo che la contiene + città dell'area
(`full` mantiene il comportamento storico con limite illimitato; i gruppi
aggregati usano un tetto di 24 città per contenere il payload — il frontend le
filtra già per zoom, `objectMinZoom`/`objectQualifiesAtZoom`).
Il GeoJSON del gruppo **preserva `surface_type`** (letto da `coastalFromGeojson`
per la capacità navale) e i `tags`.

### UI (classe A)

`PresetEditorModal.tsx` (scheda «Mappa»): selettore con etichette chiare «Solo
nazioni / Regioni raggruppate / Massimo dettaglio», salvato in `preset.json`.
Senza una mappa provinciale solo `nations` è disponibile (le altre opzioni sono
disabilitate con spiegazione). `PresetEditorData.map_detail` in
`frontend/src/services/api.ts`.

---

## 3. File modificati

**Backend**
- `backend-nest/src/utils/map-detail.ts` — **nuovo** modulo puro di proiezione.
- `backend-nest/src/utils/preset-loader.ts` — campo `map_detail` + validazione.
- `backend-nest/src/routes/presets.routes.ts` — salva/ritorna `map_detail`.
- `backend-nest/src/routes/worlds.routes.ts` — usa la proiezione e deriva i
  confini delle province (a ogni livello).
- `backend-nest/tests/map-detail.test.ts` — **nuovo**, 15 test.
- `backend-nest/tests/presets.test.ts` — validazione `map_detail`.

**Frontend**
- `frontend/src/services/api.ts` — tipo `PresetMapDetail` + campo.
- `frontend/src/components/Game/PresetEditorModal.tsx` — selettore e
  disponibilità.
- `frontend/src/components/Game/presetMapDetail.test.ts` — **nuovo**, test UI.
- `frontend/src/index.css` — stile `.preset-map-detail`.

**Docs**
- `docs/implementation/MAP-DETAIL-report.md` — questo report.

---

## 4. Conferma CORE ENGINE FREEZE

**Nessun file del freeze è stato toccato.** Per questa PR non sono stati
modificati: `backend-nest/src/core/simulation/**`, `GameSession`,
`TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema/database,
`repositories`, semantica checkpoint, simulation run, `useSimulationPlayback`,
pipeline di avanzamento del tempo.

Il raggruppamento è una **proiezione di generazione** nel route
`worlds.routes.ts`; il motore riceve le regioni già proiettate, come sempre.
Nessun nuovo stato di gioco persistito, nessuna migrazione DB.

---

## 5. Test eseguiti (esito reale)

| Comando | Esito |
|---|---|
| `backend-nest` `vitest run` | **1119 passed / 130 file** |
| `frontend` `vitest run` | **285 passed / 48 file** |
| `tsc --noEmit` backend | **0 errori** |
| `tsc --noEmit` frontend | **0 errori** |
| `npm run build` (frontend + backend) | **OK** |
| `e2e` `playwright test` (mock) | **21 passed** |
| `e2e` `playwright test --config=playwright.a11y.config.mjs` | **3 passed** |
| `npm run test:perf` | **OK** (bundle 2.03 MB, entro la baseline) |

Nuovi test (`map-detail.test.ts`, tutti verdi):
- validazione/default: `full` per mappa provinciale, `nations` altrimenti,
  fallback di `full`/`grouped` senza mappa provinciale;
- `nations`: N province → 1 regione MultiPolygon, capitale preservata, somma
  popolazione/GDP/potenza **coerente con `full`**;
- `grouped` con gerarchia reale → raggruppa per la proprietà dichiarata;
- `grouped` senza gerarchia → **determinismo** (stesso input, due esecuzioni
  identiche) e K = ceil(n/3);
- `full`: 1 regione per provincia e statistica **identica alla formula storica**
  (confronto con implementazione di riferimento);
- confini derivati: gruppi confinanti adiacenti, geometria quando manca
  `adjacencies`, `adjacencies` esplicite mappate per `pax_region_id`;
- `pressureNeighbours()` su mondo `nations`: vicino reale presente, potenza
  lontana (Finlandia) assente;
- `surface_type` preservato (capacità navale).
- UI: i tre livelli presenti, `full`/`grouped` disabilitati senza mappa
  provinciale, `map_detail` salvato.

---

## 6. Risultati (conteggi reali sui preset del repo)

Proiezione eseguita sui `map.geojson` reali (script usa le funzioni pure):

| Preset | Feature | Paesi | `nations` | `grouped` | `full` | Confini |
|---|---|---|---|---|---|---|
| `pax_modern_provinces` | 4475 | 224 | **224** | **1591** | **4475** | `adjacencies` esplicite: 62 ms, 3485 archi |
| `modern_world_provinces` | 946 | 112 | **112** | **356** | **942** | dalla geometria (`computeBorders`): ~14.8 s, 474 archi |
| `paxh_ww2_provinces` | 223 | — (paesi) | 223 | n/d | n/d | paese = regione (nessuna mappa provinciale) |

- `full` resta **1 regione per provincia** (4475, 942) con le stesse statistiche.
- `nations` produce **1 regione per paese** (224, 112).
- `grouped` riduce a ~1/3 (1591, 356).
- Retrocompatibilità: per `paxh_ww2_provinces` e per i preset senza mappa il
  comportamento è identico a oggi (`nations`).

---

## 7. Limiti residui

- **`grouped` senza gerarchia è un clustering geografico**, non un
  raggruppamento amministrativo: i gruppi possono non coincidere con regioni
  reali. Quando un preset dichiarerà `region`/`admin1`/… il codice li userà
  automaticamente.
- **Confini cross-tipo**: se un mondo mescola un paese provinciale e un paese
  non provinciale, l'adiacenza tra la provincia e il paese "a feature unica" non
  è derivata (le due fonti di adiacenza sono distinte). Nei mondi puramente
  provinciali (il caso reale) i confini sono completi.
- **`modern_world_provinces` senza `adjacencies`**: i confini si calcolano dalla
  geometria in ~15 s durante la generazione del mondo (job asincrono, già lungo
  per il bilanciamento). Accettabile, ma migliorabile con un indice spaziale.
- **`full` ora ha confini reali** (prima `[]` per i mondi provinciali): è un
  miglioramento richiesto da «adiacenza e pressioni corrette a ogni livello» e
  coerente con l'hotfix dell'adiacenza reale. Regioni e statistiche restano
  identiche a prima.
- Il limite città dei gruppi aggregati è 24 (contro illimitato di `full`): scelta
  di payload, il frontend filtra comunque per zoom.
- `map_detail` **non** è esposto alla creazione partita: è una proprietà del
  preset, applicata lato server. Vedi proposte.

---

## 8. Proposte per la fase successiva

1. **Dichiarare una gerarchia nei preset**: esporre nel preset editor (o nella
   pipeline di import) una mappa `region`/`admin1` per i preset che la
   possiedono, così `grouped` usa il raggruppamento amministrativo reale.
2. **Override per-partita**: aggiungere `map_detail` alla richiesta di creazione
   mondo (serve un piccolo cambio di API/UI: oggi non esiste un passaggio di
   granularità per partita).
3. **Indice spaziale per i confini dalla geometria** (griglia/quadtree) per
   abbattere il tempo su mappe da centinaia di province, senza nuove dipendenze.
4. **Backfill dei confini dei mondi legacy**: rigenerazione dei `borders` per i
   salvataggi provinciali con `borders = []` (migrazione dati, da pianificare a
   parte).
