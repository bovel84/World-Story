# PRESETS-REBUILD — Rimozione dei preset di contenuto e creazione di 4 nuovi scenari

Branch: `feat/preset-rebuild` · Base: `main` @ `7a712e4`.
Tipo di intervento: **contenuto dati** (preset `preset.json` + `lore.md` + `rules.md`) e aggiornamento dei test. Nessuna modifica al motore, alle mappe native o alla fixture.

---

## 1. Preset rimossi (e verifica su test/codice)

### Verifica preliminare (grep su `backend-nest/tests`, `frontend/src`, `e2e`, `backend-nest/src`)

| id | riferimenti trovati | nota |
| --- | --- | --- |
| `cold_war_1951` | `tests/presets.test.ts`, `tests/presets-zip.test.ts`, `tests/scenario-pilot.test.ts`, `tests/scenario-editor.test.ts` | pachetto + template legacy omonimo |
| `cold_war_1951_v2` | `tests/health-version.test.ts`, `tests/scenario-pilot.test.ts`, `tests/balance-mode.test.ts` | pilota M01 con catalogo `simulation/` |
| `modern_world` | `tests/preset-prompts.test.ts`, `tests/presets.test.ts` | pachetto + template legacy omonimo |
| `pax_arena` | nessuno in codice/test (solo log/DB/docs storici) | sicuro |
| `world-modern-nato-warsaw-1951` | nessuno in codice/test (solo log/DB/docs storici) | sicuro |
| `world_war_ii` | nessuno in codice/test (solo log/DB/docs storici) | sicuro |

Il task iniziale chiedeva di non cancellare un id usato dai test; la direttiva successiva di Andrea ha esplicitamente chiesto di rimuoverli **tutti e sei** aggiornando i test. Ho quindi rimosso tutti e sei **e** ho aggiornato i test che li citavano (§4), senza lasciare riferimenti pendenti.

### Rimosso

- Cartelle preset: `backend-nest/data/presets/{cold_war_1951, cold_war_1951_v2, modern_world, pax_arena, world-modern-nato-warsaw-1951, world_war_ii}` (incluso il catalogo `cold_war_1951_v2/simulation/*`).
- Template legacy omonimi: `backend-nest/data/templates/{cold_war_1951.json, modern_world.json}` (altrimenti i due scenari sarebbero rimasti nel catalogo come `source: 'legacy'`).
- Test del pilota M01: `backend-nest/tests/scenario-pilot.test.ts` (testava solo `cold_war_1951_v2` e il legacy `cold_war_1951`, ora inesistenti; il loader/validatore del catalogo resta coperto da `realism_test_world` in `scenario-editor.test.ts`, `scenario-catalog.test.ts`, `balance-mode.test.ts`, `economy-routes.test.ts`).

---

## 2. I 4 preset creati

Per ognuno: `preset.json` + `lore.md` + `rules.md`. Nessun catalogo `simulation/`.

| # | id | Nome | Data | Tema |
| --- | --- | --- | --- | --- |
| 1 | `europa_1815` | Europa 1815 — Il Concerto delle Potenze | 1815-06-09 | Diplomazia ottocentesca: equilibrio, congressi, restaurazione, imperi multi-etnici |
| 2 | `europa_1914` | Europa 1914 — La Polveriera | 1914-06-28 | Alleanze rigide, nazionalismi, guerra industriale, corsa agli armamenti |
| 3 | `mondo_1936` | Mondo 1936 — Il Mondo alla Deriva | 1936-01-01 | Totalitarismi, crisi economica, guerra civile, riarmo, espansionismo |
| 4 | `mondo_1989` | Mondo 1989 — Il Crollo dei Blocchi | 1989-06-04 | Fine della Guerra Fredda: collasso di imperi, transizioni, nuove nazioni |

| id | nazioni | `map_base` | `map_detail` effettivo | `base_prompt` | lore | regole |
| --- | --- | --- | --- | --- | --- | --- |
| `europa_1815` | 36 | `standard` | `nations` | 104 parole | 527 parole | 11 |
| `europa_1914` | 37 | `pax_modern_provinces` | `full` | 86 parole | 480 parole | 11 |
| `mondo_1936` | 42 | `pax_modern_provinces` | `grouped` | 101 parole | 514 parole | 11 |
| `mondo_1989` | 44 | `standard` | `nations` | 94 parole | 550 parole | 11 |

Nazioni: tutte ISO-A3 **reali** del registro (`backend-nest/data/countries.json`), uniche, 25–45 per preset. Esempi di scelta: per il 1815 le potenze del Congresso (GBR, FRA, RUS, AUT, DEU, …) e gli Stati minori europei; per il 1989 le repubbliche sovietiche in dissoluzione (UKR, BLR, LTU, LVA, EST, KAZ, GEO, ARM, AZE, UZB). La geografia è quella reale moderna (il gioco è dichiaratamente ucronia a geografia reale), la storia e le regole sono del periodo.

---

## 3. Prova di copertura territoriale completa

Metodo: per ogni preset carico la mappa nativa con `resolveMapSource`/`nativeMapInfo` (moduli reali del backend) e verifico che **nessun** `country_codes` resti fuori da `info.codes`. La proiezione delle regioni usa `resolveMapDetail` + `deriveGroups` (per paese), esattamente come la generazione mondo.

| id | `map_base` | feature mappa | paesi coperti dalla mappa | nazioni preset | **codici scoperti** | province coinvolte (feature dei paesi del preset) | regioni risultanti |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `europa_1815` | `standard` | 243 | 243 | 36 | **nessuno** | 36 | 36 (`nations`) |
| `europa_1914` | `pax_modern_provinces` | 4475 | 224 | 37 | **nessuno** | 1943 | 1943 (`full`) |
| `mondo_1936` | `pax_modern_provinces` | 4475 | 224 | 42 | **nessuno** | 2461 | 838 (`grouped`) |
| `mondo_1989` | `standard` | 243 | 243 | 44 | **nessuno** | 44 | 44 (`nations`) |

Garanzie verificate:
- `missing = country_codes.filter(c => !info.codes.includes(c))` → `[]` per tutti e quattro.
- `resolveMapSource(...)` restituisce `{ kind: 'native', id: <map_base dichiarata> }` (nessun `map.geojson` proprio).
- `grouped`/`full` sono usati **solo** su una mappa con province (`pax_modern_provinces.hasProvinces === true`); `nations` su `standard`.
- Ogni nazione del preset ha almeno una regione (`byCountry.size === country_codes.length`).
- Codici globalmente assenti dalle mappe e quindi **evitati** in tutti i preset: `SSD` (assente anche da `standard`), `MAC`, `MDV`, `SLB` (assenti da `pax_modern_provinces`), `BHR`, `FSM`, `SGP` (assenti da `paxh_ww2_provinces`).

Nota su `grouped` per `mondo_1936`: `pax_modern_provinces` non ha una proprietà di gerarchia raggruppabile (`pax_region_id` è univoca per provincia, 4475 valori distinti), quindi `map_grouping` non è dichiarato e il raggruppamento usa il **clustering geografico deterministico** già previsto da `deriveGroups` (target 3). Il risultato è 838 gruppi su 2461 province.

---

## 4. File creati / rimossi / modificati

### Creati
- `backend-nest/data/presets/europa_1815/{preset.json, lore.md, rules.md}`
- `backend-nest/data/presets/europa_1914/{preset.json, lore.md, rules.md}`
- `backend-nest/data/presets/mondo_1936/{preset.json, lore.md, rules.md}`
- `backend-nest/data/presets/mondo_1989/{preset.json, lore.md, rules.md}`
- `backend-nest/tests/preset-rebuild.test.ts` — 11 test: rimozione, fixture/mappe intatte, validità + copertura completa + conteggio regioni dei 4 preset.
- `backend-nest/data/templates/.gitkeep` — mantiene la cartella legacy (ormai vuota) per i test che vi scrivono preset sintetici.
- `docs/implementation/PRESETS-REBUILD-report.md` — questo report.

### Rimossi
- 6 cartelle `backend-nest/data/presets/*` (vedi §1) e `backend-nest/data/templates/{cold_war_1951.json, modern_world.json}`.
- `backend-nest/tests/scenario-pilot.test.ts`.

### Modificati (solo test)
- `tests/presets.test.ts` — `listPresets` ora verifica `europa_1815` e `mondo_1989`.
- `tests/presets-zip.test.ts` — export del pachetto di riferimento ora `europa_1914`; creato `LEGACY_TEMPLATES_DIR` prima di scrivere il legacy sintetico.
- `tests/scenario-editor.test.ts` — caso "senza catalogo" ora su `europa_1815`.
- `tests/health-version.test.ts` — `modelVersions` ora verificato su `realism_test_world` (v1, strict).
- `tests/balance-mode.test.ts` — fingerprint di catalogo ora sulla fixture `realism_test_world`.
- `tests/preset-prompts.test.ts` — il blocco sulla sezione `prompts` non dipende più da `modern_world`: usa un preset tecnico temporaneo con `prompts.simulation/suggestions`, mantenendo la copertura dell'override.
- `frontend/src/components/Game/presetMapDetail.test.ts` — rinominato un test che citava `modern_world` (era una funzione pura, nessun preset caricato).

---

## 5. Conferma: fixture e mappe native intatte

- `realism_test_world` presente e caricabile (fixture dei test, incluso il catalogo `simulation/`).
- `modern_world_provinces`, `pax_modern_provinces`, `paxh_ww2_provinces` presenti con il loro `map.geojson`; whitelist `map_base` in `native-maps.ts` invariata; `GET /templates/maps/native` invariato.
- Nessuna modifica a `native-maps.ts`, `map-detail.ts`, `preset-loader.ts`, `presets.routes.ts`, `worlds.routes.ts`, al motore o al DB.
- Il test `preset-rebuild.test.ts` verifica esplicitamente che i sei id rimossi restituiscano `null` e che fixture + mappe siano ancora presenti.

---

## 6. Test eseguiti (esito reale)

| Verifica | Comando | Esito |
| --- | --- | --- |
| Backend test | `cd backend-nest && npx vitest run` | **1126 passed / 131 file** |
| Frontend test | `cd frontend && npx vitest run` | **313 passed / 48 file** |
| TypeScript frontend | `cd frontend && npx tsc --noEmit` | exit 0 |
| TypeScript backend | `cd backend-nest && npx tsc --noEmit` | exit 0 |
| Build frontend | `cd frontend && npm run build` | OK |
| Build backend | `cd backend-nest && npm run build` | exit 0 |
| E2E mock (tutti) | `npm run test:e2e:mock` | **23 passed** |
| Accessibilità | `npm run test:a11y` | **3 passed** |
| Performance bundle | `npm run test:perf` | **2.04 MB** — entro baseline |

Nuovi test aggiunti: `backend-nest/tests/preset-rebuild.test.ts` (11 test). Il conteggio backend passa da 1138 a 1126 perché è stato rimosso `scenario-pilot.test.ts` (14 test del pilota eliminato) e sono stati aggiunti 11 test nuovi, con alcune asserzioni aggiornate.

Diagnostica reale dei 4 preset (stampata dal test, `--reporter=verbose`):

```
[PRESETS-REBUILD] europa_1815: 36 nazioni · map=standard (243 feature, 243 paesi) · detail=nations → nations · province coinvolte=36 · regioni=36 · copertura=OK
[PRESETS-REBUILD] europa_1914: 37 nazioni · map=pax_modern_provinces (4475 feature, 224 paesi) · detail=full → full · province coinvolte=1943 · regioni=1943 · copertura=OK
[PRESETS-REBUILD] mondo_1936: 42 nazioni · map=pax_modern_provinces (4475 feature, 224 paesi) · detail=grouped → grouped · province coinvolte=2461 · regioni=838 · copertura=OK
[PRESETS-REBUILD] mondo_1989: 44 nazioni · map=standard (243 feature, 243 paesi) · detail=nations → nations · province coinvolte=44 · regioni=44 · copertura=OK
```

---

## 7. Limiti residui

- I 4 preset sono **dichiaratamente storici a geografia moderna**: usano codici ISO-A3 attuali, quindi entità come la Confederazione germanica, l'Impero austro-ungarico o l'URSS non hanno un codice proprio e sono rappresentate dai successori territoriali moderni (DEU, AUT/CZE/HUN/SVK/HRV/SVN, RUS + repubbliche). Il `lore.md` lo dichiara e le `rules.md` guidano la simulazione del periodo.
- Nessun catalogo `simulation/` per i nuovi preset (come richiesto): usano la modalità di generazione standard (`BalanceAgent`), non quella strict/authored.
- `mondo_1936` usa `grouped` con clustering geografico automatico perché `pax_modern_provinces` non espone una gerarchia storica raggruppabile.
- La rimozione dei preset di contenuto non tocca le partite/salvataggi esistenti nel DB (che referenziano `world_id`, non il preset) né i `world_*` già generati; eventuali giochi avviati dai vecchi preset restano giocabili ma non ricreabili dal catalogo.
- `data/templates/` resta una cartella vuota (con `.gitkeep`) usata solo dai test per preset legacy sintetici: non ci sono più template legacy di contenuto.
