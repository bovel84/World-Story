# MAP P1 — complete cartographic surface and geographic readability

Base: `main = d7dbc4a15cd693fe06bb94836f59ba5dbaec9871` (MILITARY P6 incluso).

MAP P1 è una fase di **consolidamento + completezza + UX + robustezza** della
superficie cartografica. Non introduce una nuova mappa, non tocca la
simulazione e non crea un secondo stato del mondo: la mappa resta un **read
model geografico** del canonical state (`regions`, `region.owner`,
`region.color`, `region.geojson`, `region.objects`).

---

## 1. Problemi reali trovati

L'audit della pipeline (`GameMap` → `MapboxMapView`/`MapView` → `MapTools`,
`MapLegend`, `ProvinceInspector`, `TemporalScarLayer`, `TacticalOverlay`) ha
individuato tre problemi concreti, non ipotetici.

1. **Validazione geometrica incompleta.** `parseRegionGeometry()` verificava
   solo il range di latitudine (`|lat| ≤ 90`) e la forma dei punti, ma **non la
   longitudine**: una coordinata con `lng` fuori da `[-180, 180]` (import
   corrotto/preset) passava come valida e finiva nella sorgente GeoJSON,
   potendo rompere l'intero layer — non solo la provincia sbagliata. Il
   requisito «una geometria corrotta non deve impedire il rendering del resto
   del mondo» era quindi soddisfatto solo a metà.

2. **Ricerca non allineata al rendering.** Il renderer disegna capitali e città
   anche quando **non** portano `lat/lng`, usando il punto canonico del registro
   (`fixedCityCoordinate`). La ricerca invece includeva un oggetto solo se aveva
   `lat/lng` finiti: una capitale/città visibile non era cercabile. C'era inoltre
   **duplicazione** della logica del registro geografico (renderer e ricerca
   tenevano due copie).

3. **Legenda non contestuale.** La legenda mostrava sempre le chiavi
   «Spostamento eseguito» e «Scontro segnalato», anche con il filtro «Unità e
   difese» disattivato: spiegava simboli non interpretabili nel layer corrente.

Nessun problema di **pan/zoom** è risultato riproducibile con il renderer
attuale (MapLibre, `renderWorldCopies` di default, nessun `maxBounds`): il
`fitBounds` iniziale avviene già **una sola volta per mondo montato**
(`fittedInitialView`) e gli aggiornamenti non recentrano. MAP P1 rende esplicito
`renderWorldCopies: true` e **blinda la promessa con una regressione E2E reale**
(vedi §6), così la vecchia classe di bug «la mappa non scorre a destra» non può
tornare senza un test rosso.

## 2. Causa di ciascun problema

1. `isValidRing`/`parseRegionGeometry` controllavano `Number.isFinite(p[1])` e
   `Math.abs(p[1]) <= 90`, dimenticando `p[0]`.
2. Due percorsi paralleli: `MapboxMapView` possedeva il proprio registro
   città/capitali (con `normalizePlaceName` locale), `mapModel.buildMapSearchIndex`
   ne ignorava l'esistenza e pretendeva `lng/lat` nel salvataggio.
3. `MapLegend` non leggeva il filtro `showUnits` per le chiavi dei simboli
   operativi.

## 3. Soluzione

- **`parseRegionGeometry` irrobustito**: validazione esplicita di **latitudine e
  longitudine** in WGS84, forma dei punti, e anelli con ≥ 4 vertici finiti. Una
  geometria non valida viene **scartata per quella provincia**, mai riparata
  inventando coordinate.
- **Registro geografico unico**: `fixedCityCoordinate()` è ora in `mapModel` ed è
  usato **sia** dal renderer **sia** da `buildMapSearchIndex`. La ricerca allega
  il punto canonico a capitali/città del registro anche senza `lat/lng`; gli
  oggetti fuori registro restano senza punto (nessuna coordinata arbitraria).
- **`regionLabelVisible()` pura**: la gerarchia di visibilità delle etichette
  (province solo da selezionate, nazioni per zoom, budget `REGION_LABEL_BUDGET`
  con selezione/hover prioritari) è estratta dal componente e resa testabile.
- **Legenda contestuale**: le chiavi di movimento/scontro compaiono solo con
  «Unità e difese» attivo.
- **`renderWorldCopies: true` esplicito** con commento: il pan non è mai chiuso
  a est/ovest e non esiste `maxBounds`.

## 4. File modificati

| File | Tipo |
|---|---|
| `frontend/src/components/Map/mapModel.ts` | validazione geometria, `fixedCityCoordinate`, `regionLabelVisible`, `REGION_LABEL_BUDGET`, ricerca arricchita |
| `frontend/src/components/Map/MapboxMapView.tsx` | usa i helper condivisi, rimuove il registro duplicato, `renderWorldCopies` esplicito, etichette via funzione pura |
| `frontend/src/components/Shell/MapLegend.tsx` | chiavi contestuali ai filtri |
| `frontend/src/components/Map/mapModel.test.ts` | test unitari MAP P1 |
| `e2e/tests/map-p1.spec.mjs` | **nuovo**, scenari E2E A–E |
| `docs/implementation/MAP-P1-report.md` | **nuovo**, questo report |

## 5. Componenti esistenti riusati

`GameMap` (dispatch GeoJSON vs SVG), `MapboxMapView`/MapLibre, `MapView` SVG
fallback, `RegionFeatureIndex`, `diffRegionFeatures`, `feature-state`,
`objectMinZoom`/`objectQualifiesAtZoom`/`objectIsVisible`, `MapTools` +
`buildMapSearchIndex`/`searchMap`/`normalizeMapSearch`, `MapLegend`,
`ProvinceInspector`, `TacticalOverlay`, `TemporalScarLayer`, `MarkerMotion`,
`cities.json`/`capitals.json`, `region.geojson`. **Nessuna primitiva
sostituita.**

## 6. Test aggiunti

**Unitari (`mapModel.test.ts`, +6 → 23 totali nel file):**
- Polygon valido, MultiPolygon valido, anello aperto ma con ≥ 4 vertici;
- rifiuto di `lng`/`lat` fuori WGS84 e di anelli con 3 vertici;
- una geometria invalida **non** impedisce l'indicizzazione delle regioni sane;
- `fixedCityCoordinate`: capitale per paese, città per nome (accenti/maiuscole),
  `null` per tipi/nomi sconosciuti;
- ricerca di capitali/città senza `lat/lng`, nessun punto arbitrario per oggetti
  fuori registro, normalizzazione accenti/maiuscole;
- `regionLabelVisible`: provincia solo da selezionata, gerarchia per zoom,
  budget rispettato, hover/selezione fuori budget.

**E2E (`map-p1.spec.mjs`, 7 test):**
- **A1** drag reale verso sinistra → scopre l'est (regressione «mappa non scorre
  a destra», verificata con sonda `unproject` a zoom 4, quindi senza ambiguità di
  normalizzazione);
- **A2** drag reale verso destra → scopre l'ovest;
- **A3** gli estremi `±170°` non sono bloccati (nessun `maxBounds`);
- **B** selezione provincia: `feature-state selected`, `ProvinceInspector` col
  nome corretto, chiusura che **non** perde la posizione della mappa;
- **C** ricerca città con accenti → zoom e selezione della regione, città nel
  viewport;
- **D** cambio `owner`/`color` senza remount: canvas identico, centro invariato,
  `updateData` **una sola volta**;
- **E** mobile 360px: drag, zoom, ricerca, selezione, inspector, nessun overflow
  orizzontale e porzione di mappa significativa.

## 7. Verifica desktop

- pan in ogni direzione (drag reale) e fino agli estremi est/ovest; nessun
  recentring dopo update; selezione stabile per `region.id`; `ProvinceInspector`
  coerente; ricerca con focus reale; cambio owner/colore a caldo.
- E2E `map-p1` A1/A2/A3/B/C/D + gli scenari `map-live` preesistenti.

## 8. Verifica mobile

- `map-p1 / E` a **360×740**: drag, click su controllo zoom MapLibre
  («Ingrandisci»), ricerca, selezione, `ProvinceInspector`; `scrollWidth ≤`
  viewport; mappa con larghezza > 300px e altezza > 400px (porzione
  significativa libera).
- Gli scenari `map-live` coprono anche 390px e 320px (tap target ≥ 44px,
  overflow).

## 9. Verifica mappa provinciale grande

- Il budget etichette (`REGION_LABEL_BUDGET = 90`) e la regola «province solo da
  selezionate» sono ora **testati come funzione pura**, non solo nel DOM: un
  mondo con migliaia di province non crea altrettante etichette visibili.
- Budget città (300 per viewport) e `RegionFeatureIndex` restano invariati; un
  cambio di statistica non ricostruisce la sorgente globale (test D lo prova:
  `updateData` una volta anche per un cambio `owner`+`color`).

## 10. Misure performance

- `npm run test:perf`: bundle **entro la baseline** (JS ~1.58 MB, CSS ~0.58 MB,
  totale ~2.16 MB).
- Nessun nuovo parsing globale: `hover` resta su `feature-state`; cambio
  statistiche non riemette il GeoJSON (dimostrato da test D e dallo scenario
  `map-live` «hover does not upload GeoJSON»).
- Il registro geografico è costruito **una volta** a livello di modulo
  (`CITY_POINTS`), non a ogni render.

## 11. Regressioni

- **MAP-COMPLETE / MAP-DETAIL / MAP-NATIVE / MAP-UI-POLISH**: non toccati
  (nessuna modifica a preset, generazione, `country_codes`, `map-detail`).
- **MILITARY P4 / P4.1 / P4.1.1 / P5 / P5.1 / P6**: invariati. MAP P1 non legge
  né scrive `game_operational_objects`, `MilitaryUnitState`, `movement`, fronti
  o arsenali. I marker mappa restano quelli di `region.objects`.
- **Persistenza** save/rewind/branch: intatta (nessuna scrittura canonica).
- **Zero mutation da rendering**: l'unica scrittura possibile resta la selezione
  di una regione (apertura inspector), invariata.

## 12. Limiti residui

- **Nessuna visualizzazione completa del movimento P6** sulla mappa: MAP P1 è
  solo **compatibile** con lo stato P6 (non elimina campi, non interpreta
  un'unità in movimento come nuova, non crea un proprio movement state). La
  rappresentazione dei movimenti persistenti è demandata alla fase militare
  della mappa.
- **Luci/geometrie molto dense**: l'audit ha confermato la robustezza per
  Polygon/MultiPolygon/isole, ma non è stata misurata una mappa reale con
  decine di migliaia di vertici (fuori dal perimetro E2E mock attuale).
- **Antimeridiano**: le geometrie che attraversano ±180° proiettano il centroide
  in modo approssimato (comportamento preesistente, nessuna regressione). Le
  etichette delle polity restano leggibili; eventuali artefatti sono obiettivo
  di MAP P2.
- **MapLibre resta il target**; l'SVG legacy (`MapView`) non riceve le nuove
  rifiniture (solo compatibilità garantita).

## 13. Cosa passa a MAP P2

MAP P1 è chiusa: la mappa è geograficamente completa, navigabile, leggibile,
stabile, responsive e performante, e pronta a ricevere MAP P2 — **fronti,
reparti persistenti, movimento P6 e stato militare attuale** — senza un secondo
stato della mappa.

---

## Test aggiunti — esito

| Gate | Esito |
|---|---|
| Backend `npx tsc --noEmit` | ✅ |
| Backend `npx vitest run` | ✅ **163 file / 1707 test** |
| Backend `npm run build` | ✅ |
| Frontend `npx tsc --noEmit` | ✅ |
| Frontend `npx vitest run` | ✅ **67 file / 503 test** |
| Frontend `npm run build` | ✅ |
| E2E `npm run test:e2e:mock` | ✅ **56/56** (49 preesistenti + 7 MAP P1) |
| A11y `npm run test:a11y` | ✅ 3/3 |
| Perf `npm run test:perf` | ✅ entro baseline |

Flaky/timeout preesistenti (non regressioni MAP P1): i test
`military-warfront-integrity` 34 e 50 hanno un timeout di 5s e sono andati in
timeout **solo** quando la suite backend girava in parallelo al build frontend
(carico elevato). Rilanciati da soli: **1707/1707 verdi**. Il test
`op-objects-time-step` 41 è il flaky già noto e documentato in MILITARY P5.
Nessun timeout è stato aumentato.

## Conferme finali

- **MapLibre resta il renderer principale**
- **SVG resta fallback legacy**
- **nessun secondo stato della mappa**
- **nessun nuovo motore geografico**
- **nessun grande refactor**
- **nessuna simulazione nuova**
- **il rendering non muta il canonical state**
- **MILITARY P4–P6 invariata**
- **nessun merge automatico** (PR lasciata aperta per review)
