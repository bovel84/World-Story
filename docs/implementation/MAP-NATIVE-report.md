# MAP-NATIVE — Scegliere una mappa nativa nel preset

Branch: `feat/preset-native-maps` · Base: `main` = `56bb978`.
Classificazione: **C/D** — un campo opzionale, una piccola estensione di
configurazione e un endpoint read-only. **Nessuna migrazione DB.**

---

## 1. Problema trovato (con i file reali)

Nel tab «Mappa» del preset editor l'**unico** modo per avere una mappa
provinciale era **caricare un file `.geojson`** (bottone «Scegli GeoJSON»). Senza
file, i livelli «Regioni raggruppate» e «Massimo dettaglio» restavano
(correttamente) disabilitati: di fatto il giocatore **non poteva scegliere
nulla** per creare un mondo provinciale.

Le mappe native **esistono già** nel repository e non erano esposte:

| File | Feature | Province (`country` ≠ `code`) |
|---|---|---|
| `backend-nest/data/geojson/countries.geojson` | 243 | 0 → mappa **standard** (1 regione per paese) |
| `backend-nest/data/presets/modern_world_provinces/map.geojson` | 946 | 942 |
| `backend-nest/data/presets/pax_modern_provinces/map.geojson` | 4475 | 4475 (con `pax_region_id`, `adjacencies`) |
| `backend-nest/data/presets/paxh_ww2_provinces/map.geojson` | 223 | 0 (sono **paesi**: `code` univoci, nessun `country`) |
| `backend-nest/data/presets/realism_test_world/map.geojson` | 2 | **fixture tecnica → NON esposta** |

Generazione attuale: `worlds.routes.ts` usava `loadPresetMap(templateId)` se
`preset.has_custom_map`, altrimenti `countries.geojson`. Nessun modo di
referenziare una mappa nativa diversa dalla standard.

---

## 2. Soluzione applicata

### Campo `map_base` (classe D, riferimento non copia)

Campo **opzionale** in `preset.json`: **riferisce** una mappa nativa, **non la
copia** (il Pax pesa 7,3 MB).

| Valore | Mappa |
|---|---|
| `standard` | `data/geojson/countries.geojson` |
| `modern_world_provinces` | 946 regioni |
| `pax_modern_provinces` | 4475 regioni |
| `paxh_ww2_provinces` | 223 regioni (paesi) |

### Precedenza (retrocompatibile)

`resolveMapSource({ hasCustomMap, mapBase })` — funzione **pura**:

1. `map.geojson` proprio del preset → **vince** (comportamento attuale);
2. altrimenti `map_base` → la mappa nativa dichiarata;
3. altrimenti `standard` (come oggi).

Senza `map_base` nulla cambia.

### Whitelist rigida (sicurezza)

`isNativeMapId` / `normalizeMapBase` accettano **solo** gli id elencati in
`NATIVE_MAPS`. `nativeMapPath` risolve il file **solo** da un id in whitelist:
un id/path arbitrario (es. `../../etc/passwd`) non entra mai in `path.join`
→ nessun path traversal. `validatePresetJson` **rifiuta** con errore chiaro un
`map_base` non valido (incluso `realism_test_world`).

### Endpoint read-only

`GET /api/templates/maps/native` → `{ maps: [{ id, label, hasProvinces, features }] }`.
I metadati (`hasProvinces`, `features`) sono **calcolati dai file reali** con
cache (`nativeMapInfo`), quindi il livello `grouped`/`full` è abilitato **se e
solo se** la mappa scelta ha davvero province. Percorso a due segmenti: non
collide con `templatesRouter.get('/:id')`.

### UI (tab «Mappa»)

- **Selettore di mappa nativa** (radio, una voce per mappa) con nome leggibile e
  numero di province/regioni; `standard` marcata.
- Il **caricamento `.geojson`** resta come **opzione avanzata** (`<details>`), non
  è più l'unico modo.
- Scegliendo una mappa **provinciale**, «Regioni raggruppate» e «Massimo
  dettaglio» diventano **selezionabili** (la disabilitazione dipende da
  `hasProvinces` della mappa scelta o dalla mappa propria).
- Mostra **mappa attiva** e **livello effettivo**.
- Il file proprio, se presente, **vince**: i radio nativi si disabilitano con la
  nota esplicativa.

### Mobile (contesto della segnalazione)

`.preset-map-base-option` ha `min-height: 44px`, `cursor: pointer` e
`touch-action: manipulation`; nessun overlay in posizione assoluta intercetta i
tap (il drop del file è dentro un `<details>` chiuso di default).

---

## 3. File modificati

**Backend**
- `backend-nest/src/utils/native-maps.ts` — **nuovo**: catalogo, whitelist,
  `normalizeMapBase`, `resolveMapSource`, `nativeMapPath`/`loadNativeMap`
  (path-safe), `listNativeMaps` (metadati con cache).
- `backend-nest/src/utils/preset-loader.ts` — campo `map_base` + validazione.
- `backend-nest/src/routes/presets.routes.ts` — persiste/ritorna `map_base`;
  endpoint `GET /maps/native`.
- `backend-nest/src/routes/worlds.routes.ts` — scelta geometria via
  `resolveMapSource` + `loadNativeMap` (stessa proiezione di prima).
- `backend-nest/tests/native-maps.test.ts` — **nuovo**, 13 test.
- `backend-nest/tests/presets.test.ts` — validazione `map_base`.
- `docs/implementation/q02-endpoint-inventory.json` — rigenerato (nuovo endpoint
  read-only nell'inventario).

**Frontend**
- `frontend/src/services/api.ts` — `PresetMapBase`, `NativeMapInfo`, campo
  `map_base`, `templatesApi.getNativeMaps`.
- `frontend/src/components/Game/mapGrouping.ts` — `effectiveProvinceMap` (pura).
- `frontend/src/components/Game/PresetEditorModal.tsx` — selettore mappa nativa,
  sblocco dei livelli, opzione avanzata, mappa/livello attivi.
- `frontend/src/index.css` — stile `.preset-map-base*`, `.preset-map-advanced`.
- `frontend/src/components/Game/presetMapDetail.test.ts` — test di abilitazione
  con mappa nativa e del selettore.

**E2E**
- `e2e/mock-api.mjs` — mock dell'endpoint mappe native.

**Docs**
- `docs/implementation/MAP-NATIVE-report.md` — questo report.

---

## 4. Conferma CORE ENGINE FREEZE

**Nessun file del freeze è stato toccato.** Non sono stati modificati
`core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/database, `repositories`, la semantica dei
checkpoint, le simulation run, `useSimulationPlayback` né la pipeline di
avanzamento. La scelta della geometria avviene in **generazione mondo**
(`worlds.routes.ts`), come già oggi; `map_base` è una proprietà del preset e una
**proiezione di generazione**, non stato di gioco. Nessuna migrazione, nessuna
dipendenza nuova.

---

## 5. Test eseguiti (esito reale)

| Comando | Esito |
|---|---|
| `backend-nest` `tsc --noEmit` | **0 errori** |
| `backend-nest` `vitest run` | **1137 passed / 131 file** |
| `frontend` `tsc --noEmit` | **0 errori** |
| `frontend` `vitest run` | **300 passed / 48 file** |
| `npm run build` (frontend + backend) | **OK** |
| `npm run test:e2e:mock` | **21 passed** |
| `npm run test:a11y` | **3 passed** |
| `npm run test:perf` | **OK** (2.04 MB, entro baseline) |

Test mirati nuovi:
- `map_base` assente → comportamento invariato (`standard` / mappa propria);
- `map_base` provinciale → `resolveMapSource` seleziona la nativa e la
  proiezione produce il numero atteso di regioni per `nations`/`grouped`/`full`;
- `map.geojson` proprio **vince** su `map_base`;
- id non in whitelist → **rifiutato** (`validatePresetJson`), nessuna lettura di
  file; `nativeMapPath`/`loadNativeMap` con id arbitrario → `null`;
- elenco mappe native: standard + 3 provinciali, **fixture assente**;
- `hasProvinces` verificato sui **dati reali** (standard/paxh_ww2 = false,
  modern_world/pax_modern = true);
- frontend: `effectiveProvinceMap` (file proprio vince; nativa provinciale
  abilita i tre livelli; nativa senza province lascia solo «Solo nazioni») e
  presenza/accessibilità del selettore nativo (≥44px).

---

## 6. Risultati (regioni per mappa nativa e livello)

Proiezione reale (stessa logica della generazione, raggruppando per
`properties.country`):

| Mappa nativa | Feature | `nations` | `grouped` | `full` |
|---|---|---|---|---|
| `standard` | 243 | **243** | 243 (nessuna provincia → nations) | 243 |
| `modern_world_provinces` | 946 | **116** | **360** | **946** |
| `pax_modern_provinces` | 4475 | **224** | **1591** | **4475** |
| `paxh_ww2_provinces` | 223 | **223** | 223 (nessuna provincia → nations) | 223 |

- Scegliendo `modern_world_provinces` o `pax_modern_provinces`, nel tab Mappa i
  tre livelli diventano **selezionabili**.
- `standard` e `paxh_ww2_provinces` restano mappe a livello nazioni: nel loro
  caso `full`/`grouped` restano coerentemente disabilitati (nessuna provincia
  nei dati).
- Il file proprio continua a funzionare e **vince** su `map_base`.
- Senza `map_base` il comportamento è **identico a prima**.

---

## 7. Limiti residui

- **`paxh_ww2_provinces` è di fatto una mappa-paesi** (223 feature con `code`
  univoco e nessun `properties.country`), nonostante il nome contenga
  «provinces»: è esposta e funziona come mappa a livello nazioni; `full`/`grouped`
  non sono disponibili per essa. Per abilitarli servirebbe un dataset provinciale
  reale (che nel repo non esiste per il 1945).
- La scelta della mappa nativa è **per preset**, non per partita: non c'è ancora
  un override al momento della creazione del mondo.
- `grouped` su mappe native senza gerarchia (`modern_world_provinces`,
  `pax_modern_provinces`) usa il **clustering geografico deterministico**: i
  gruppi non coincidono con regioni amministrative reali. La gerarchia
  personalizzata (`map_grouping`) si applica alla mappa **propria**; per le
  native si può aggiungere in futuro.
- La selezione della mappa nativa non mostra un'anteprima grafica: solo nome e
  numero di regioni.

---

## 8. Proposte per la fase successiva

1. **Gerarchia nella mappa nativa**: mappare chiavi di raggruppamento note per le
   mappe native (es. un futuro `admin1`) così `grouped` usa regioni reali senza
   caricare file.
2. **Override `map_base` alla creazione partita** (piccola estensione di UI/API),
   per cambiare mappa per singola partita.
3. **Anteprima della mappa nativa** nell'editor (thumbnail/mini-render) per una
   scelta più consapevole.
4. **Dataset provinciale per il 1945** (Pax Historia WW2) se l'obiettivo è
   abilitare `full`/`grouped` anche su `paxh_ww2_provinces`.

---

## 9. Correzione — compatibilità mappa nativa / paesi del preset

Segnalazione: creando una partita da un preset con `map_base` provinciale la
```
generazione falliva con «Mappa dello scenario incompleta. Nessuna geometria per: KAZ»
```
(es. `cold_war_1951` salvato con `map_base: modern_world_provinces`).

### Causa reale
La mappa nativa scelta **non copriva tutti i paesi** del preset. `modern_world_provinces`
ha 112 paesi e **non contiene KAZ**, mentre `cold_war_1951` lo elenca. La
proiezione salta i paesi senza geometria e la guardia di generazione (corretta)
abortiva. Il selettore non avvisava dell'incompatibilità.

### Correzione applicata
- L'endpoint `GET /api/templates/maps/native` ora espone per ogni mappa i
  **codici ISO-A3 coperti** (`codes`, calcolati dalle feature reali: `country`
  per le province, altrimenti `code`).
- Nuove funzioni pure (frontend, `mapGrouping.ts`):
  - `requiredCountryCodes(country_codes, override, known)` → i codici che
    producono davvero una politia: con un override `countries` sono quelli, altrimenti
    i `country_codes` **filtrati sul registro noto** (un codice sconosciuto come
    `YUG` non genera politia e non richiede geometria); `null` se il registro non
    è disponibile (in quel caso non si blocca nulla).
  - `nativeMapMissingCodes(required, covered)` → i codici mancanti.
- **Editor**: le mappe native che non coprono i paesi richiesti sono
  **disabilitate** con l'elenco (`· non copre: KAZ`); se la mappa selezionata è
  incompatibile compare un avviso e il **salvataggio è bloccato** con un
  messaggio chiaro. Il registro si legge da `GET /api/countries` (endpoint già
  esistente).
- **Riparazione dati**: `cold_war_1951` è stato riportato alla mappa **standard**
  (l'edit precedente non era compatibile).

### File (correzione)
- `backend-nest/src/utils/native-maps.ts` — `codes` in `NativeMapInfo`.
- `backend-nest/tests/native-maps.test.ts` — copertura codici.
- `frontend/src/services/api.ts` — `NativeMapInfo.codes`, `PresetEditorData.countries`.
- `frontend/src/components/Game/mapGrouping.ts` — `requiredCountryCodes`,
  `nativeMapMissingCodes`.
- `frontend/src/components/Game/PresetEditorModal.tsx` — gating + blocco salvataggio.
- `frontend/src/components/Game/presetMapDetail.test.ts` — test compatibilità.
- `e2e/mock-api.mjs` — `codes` nel mock.

### Test e Quality Gate (esiti reali)
Backend **1138 / 131 file** · Frontend **306 / 48 file** · `tsc --noEmit` be+fe
**0 errori** · `npm run build` **OK** · E2E mock **21** · a11y **3** ·
`test:perf` **OK**. Test nuovi: codici coperti per mappa (standard ha KAZ,
`modern_world_provinces` no), filtro registro, caso reale Guerra Fredda
(`modern_world` manca KAZ, `pax_modern` è compatibile).

### CORE ENGINE FREEZE
Nessun file del motore toccato: solo catalogo mappe, validazione/presentazione e
rigenerazione dell'inventario endpoint. La guardia di generazione resta invariata.

### Limiti residui
- Il controllo richiede il registro dei paesi; senza di esso (fetch fallita) non
  blocca nulla e resta solo la guardia di generazione.
- Per `cold_war_1951` l'unica mappa provinciale compatibile sarebbe
  `pax_modern_provinces` (manca solo `YUG`, non risolvibile dal registro), ma è
  del mondo moderno: per un 1951 la scelta consigliata resta la mappa standard.
