# PRESET MILLENNIUM DAWN — il mondo al 2000 come preset canonical-assets ready

**Branch**: `feat/preset-millennium-dawn` · **Base**: `main = d3792cc`
**Stato**: preset + catalogo strict + test dedicati · PR aperta per review.

---

## 1. Origine della richiesta

Andrea ha chiesto di riprodurre in World Story il preset **«Millennium Dawn»** di Pax Historia
(`paxhistoria.co/presets/V2ZpBgNDUR6LA06POlVl?versionID=38`), la versione del mod HOI4 omonima:
il mondo al **1° gennaio 2000**.

L'API di Pax Historia per i preset è **protetta** (401/404) e la pagina è renderizzata lato client:
i dati non erano recuperabili. Il preset è quindi stato **ricostruito da zero** con dati storici
reali del 2000, nel formato World Story — **nessun dato copiato**.

## 2. Lo scenario

Un nuovo millennio si apre. La Guerra Fredda è finita da un decennio ma il mondo è tutt'altro che
pacifíco: Afghanistan in guerra civile sotto i talebani con Al-Qaeda in ascesa, la Russia combatte
in Cecenia, i Balcani portano le ferite degli anni '90. Gli USA sono l'unica superpotenza; la Cina
cresce e si prepara all'ingresso nell'OMC; l'UE va verso l'euro e l'allargamento. Internet si
diffonde rapidamente, con esso polarizzazione e radicalizzazione.

## 3. Struttura creata

```
backend-nest/data/presets/millennium_dawn/
├── preset.json                      (mondo: 2000-01-01, 101 paesi)
└── simulation/                      (catalogo strict, formato SimulationCatalog)
    ├── manifest.json                 mode "authored" · regionIdBinding "world_scoped"
    ├── resources.json                crude_oil · coal · iron_ore
    ├── facilities.json               refinery · steel_plant · coal_power_plant
    ├── actors.json                   15 attori economici
    ├── polities.json                 14 politie
    ├── initial-state.json            20 giacimenti + 14 impianti
    └── authorities.json · recipes.json · technologies.json   (vuoti)
```

`preset.json`: `start_date 2000-01-01` · `map_base: modern_world_provinces` · `map_detail: full` ·
`historical_accuracy 0.8` · nessun `map.geojson` proprio (usa la mappa nativa, come `mondo_1936`).

## 4. Asset authored — il vertical slice del 2000

**14 paesi** coinvolti: USA, SAU, RUS, IRN, VEN, NGA, DZA, CHN, IND, DEU, BRA, AUS, ZAF, NLD.

**Giacimenti (20)** — petrolio, carbone, minerale di ferro su giacimenti storici reali:
Ghawar (SA04), Siberia occidentale (RUKHM), Khuzestan (IR10), Texas (USTX), Alaska (USAK),
Venezuela (VEN), Nigeria (NGBO), Hassi Messaoud (DZ30); carbone: Queensland (AUQLD),
Mongolia Interna (CNNM), Jharkhand (INJH), Sudafrica (ZANW), Ruhr (DENW); ferro: Carajás (BRPA),
Pilbara (AUWA), Odisha (INOR), Hebei (CNHE), Minas Gerais (BRMG).

**Impianti (14)**: raffinerie (SAU, RUS, IRN, USA-TX, VEN, NLD), acciaierie (CHN, IND, DEU, BRA),
centrali a carbone (CHN, ZAF, IND).

**Casi limite inclusi per la verifica**:
- **2 giacimenti `hidden`** (Russia `RUKYA`, `RUSA`) → **non pubblicati** sulla mappa.
- **1 caso `ownerActorId ≠ controllerActorId`**: `facility:NLNH:refinery:1`
  (proprietario `usa_gulf_refining`, controllore `nld_port_authority`) → entrambi i fatti preservati.
- **1 impianto `operational: false`**: `facility:NLNH:refinery:2` → resta pubblicato, classificato
  **Non operative** (semantica P6.1).

Tutte le quantità sono `known: null` (ignoto ≠ zero, §P6): nessun valore inventato.

## 5. Binding geografico

`manifest.regionIdBinding = { space: "world_scoped", source: "map.geojson:properties.code" }`.
`regionIdResolver` costruisce `<worldId>_<codice>` (es. `<worldId>_SA04`): mai una somiglianza,
e la verifica di esistenza avviene **prima** della pubblicazione. Gli id nel catalogo sono i codici
`properties.code` di `modern_world_provinces`.

## 6. Comportamento endpoint

Per una partita strict creata con `millennium_dawn`, `GET /games/:id/map-assets` risponde con
`canonical: true` e array popolati: **18 giacimenti** pubblicati (20 meno i 2 `hidden`) e
**14 impianti**. Nessun asset orfano.

## 7. Test aggiunti

`backend-nest/tests/preset-millennium-dawn.test.ts` — **19 test**, tutti verdi. Puro: nessuna
sessione, nessun LLM, nessun bootstrap di mondo. Verifica:
- `loadPreset` carica il preset; data `2000-01-01`; `country_codes` ISO-A3 reali;
- `loadSimulationCatalog` lo valida (`mode: authored`, zero errori);
- **ogni** `regionId` di giacimenti e impianti esiste tra i codici della mappa → **zero orfani**;
- ogni `ownerActorId`/`controllerActorId` ∈ registro attori;
- i due giacimenti `hidden` **non** vengono pubblicati;
- l'impianto `operational: false` resta presente e classificato;
- il caso `owner ≠ controller` preserva entrambi;
- `buildWorldMapAssets` è **puro e deterministico** (due chiamate → stesso esito, nessuna scrittura).

## 8. Gate

| Gate | Comando | Esito |
|---|---|---|
| Test dedicati | `npx vitest run tests/preset-millennium-dawn.test.ts` | ✅ **19/19** |
| Test dei preset | `presets` · `preset-time-coherence` · `preset-rebuild` · `scenario-catalog` · `native-maps` · `map-p6-real-preset` | ✅ **69/69** |
| `npx tsc --noEmit` (backend) | — | ✅ |
| frontend build | `npm run build` | ✅ |

**Flaky noto**: `military-warfront-integrity.test.ts` test 50 può andare in timeout (5000ms) su
macchina carica → **ri-eseguito**, mai rilassata la soglia.

## 9. Vincoli rispettati

- **Nessun secondo motore**, nessuna scrittura da GET, nessuna mutazione del catalogo.
- Motore, rewind, schema DB, playback, branching/checkpoint, MAP P1–P6, MILITARY P4–P6: **intatti**.
- Gli altri preset: **non toccati**. `llm.config.json` e il preset `modern_world_provinces`
  (entrambi modificati fuori dal task): **non committati**.

## 10. Limiti residui

1. **Vertical slice, non l'intera economia mondiale**: 14 paesi su 101 hanno asset. Gli altri
   restano senza geografia economica (mostrano `legacy`/`[]` sul layer Risorse, correttamente).
2. Il catalogo copre 3 risorse e 3 tipi di impianto; ricette, tecnologie, workforce e tesorerie
   sono **vuoti** per scelta (come la vertical slice P6.2).
3. Gli altri preset reali (`mondo_1936`, `mondo_1989`, `europa_1914`, …) **non hanno ancora** un
   catalogo strict equivalente: fase separata.
4. Nessuna importazione automatica da Pax Historia: i dati sono autorevoli per World Story ma
   **stime dichiarate** (`declaration: historical_estimated`).
