# MAP P3 — canonical thematic layers for politics, military, economy, infrastructure and diplomacy

Base: `main = 2e813d5772bbc0b64c02d68bf43f9bdd1eff0fc4` (MAP P1/P1.1/P1.2 + P2/P2.1/P2.2).

MAP P3 trasforma il selettore mappa da tre viste a **otto prospettive
tematiche**. Ogni layer risponde a una domanda precisa leggendo **solo stato
canonico**: la mappa resta una *view layer*, mai un secondo simulation layer.

```
stato canonico
      ↓
read model tematico puro (thematicMapModel.ts)
      ↓
stile / overlay MapLibre
```

Mai il percorso inverso: nessun indice inventato, nessun valore persistito,
nessuna allocazione geografica dedotta.

---

## 1. Layer e domanda

| Layer | Domanda |
|---|---|
| Political | chi controlla cosa? |
| Military | dove sono fronti, reparti e movimenti? |
| Economy | dove è concentrato il valore economico territoriale? |
| Resources | dove esistono risorse con sito canonico? |
| Infrastructure | dove sono le opere e capacità territoriali? |
| Diplomacy | quali territori sono di polity alleate, neutrali o ostili? |
| Changes | cosa è cambiato di recente? |
| Terrain | qual è la base geografica/fisica? |

`MapLayer` è una union esplicita a 8 valori; `MAP_LAYERS` (in `mapModel.ts`) è
l'unica fonte di label/descrizione, usata da `MapTools`/`MapLegend`/
`MapboxMapView` senza duplicazioni.

## 2. Matrice di presentazione centralizzata

`MAP_LAYER_PRESENTATIONS` in `thematicMapModel.ts` definisce, per ogni layer,
opacità del riempimento politico, riempimento tematico, enfasi militare/
infrastrutturale, zoom minimo delle opere e necessità di siti risorsa. Nessuna
condizione `if (layer === 'economy')` sparsa in dieci punti: la presentazione si
legge con `mapLayerPresentation(activeLayer)`.

## 3. Source of truth

| Layer | Source of truth | Presentazione derivata | Disponibilità | Refresh |
|---|---|---|---|---|
| Political | `Region.owner/color/polityName/status` | colori e confini politici | sempre | world refresh |
| Military | `MilitaryUnitState` + `WarFrontState` (via API P2) | counter, fronti, rotte P6 | dipende da P2 | lifecycle P2 + `useNationSnapshot` |
| Economy | `Region.gdp` | quantili → colore coropletico | se esiste ≥ 1 PIL > 0 | `regions` |
| Resources | solo siti con `regionId` canonico | marker/pannello per sito | quasi mai (vedi §4) | `regions` |
| Infrastructure | `Region.objects` geolocalizzati | marker opere + enfasi | se esistono opere | `regions` |
| Diplomacy | `GET /games/:id/relationships` | `relationships[player][owner]` → colore | se il refresh riesce | lifecycle partita (fail-closed) |
| Changes | `changedRegionIds` / `TemporalScarLayer` | highlight + cicatrici | sempre | invariato P1 |
| Terrain | base cartografica (tile Esri) | colori politici attenuati | sempre | — |

## 4. Risorse — limite esplicito

> **`NationalResourceSummary` non è un'allocazione geografica.**

Le risorse naturali sono registrate **per polity** (`ENDOWMENTS` in
`MilitaryIndustry.ts`, ledger per tipo in `ResourceMarket.ts`): nessuna porta un
`regionId`. L'unico `regionId` presente su un oggetto `mine` è **round-robin**
(`OperationalState.ts`) e non ha semantica di giacimento: non viene usato. Il
tipo dichiarativo `scenario.Deposit.regionId` è di fatto morto (nessun preset lo
popola).

Conseguenza: il layer Resources **non inventa** posizioni. Se nessun sito ha un
`regionId` canonico, la mappa resta funzionante e mostra:

> *Le risorse naturali sono registrate a livello nazionale: nessuna ha ancora
> una localizzazione territoriale canonica.*

`canonicalResourceSites()` accetta solo candidati con `regionId` **esistente**
nel mondo; tutto il resto viene scartato, mai posizionato.

## 5. Economia — nessun indice composito

Unica metrica: `Region.gdp`. Nessun «economic strength / strategic value».
`buildEconomyMapModel()` calcola **soglie di quantile** (robuste agli outlier) e
assegna un bucket; la scala è relativa al dataset corrente. `gdp` non viene mai
modificato. `0`, `NaN` e `undefined` legacy sono **no-data**, non povertà
estrema. La legenda mostra range numerici reali, mai giudizi («povero/ricco»).
Il **PIL per abitante non è mostrato**: le unità di `region.gdp` (colonna `n`) e
`population` non rendono il rapporto semanticamente verificabile, quindi è
omesso per scelta conservativa.

## 6. Diplomazia — relativa al player, fail-closed

Domanda: *qual è il rapporto tra la polity del giocatore e le altre?* Authority:
`relationships[playerPolityId][region.owner]`. Valori realmente supportati dal
motore: **`ally | neutral | hostile`** (`RelationshipMatrix`), più `player`,
`unknown`. Nessuna inferenza da feed, chat, commitments o agenda. Stati
presentati: *Il tuo Stato / Alleato / Neutrale / Ostile / Sconosciuto*.

Se il refresh delle relazioni fallisce, lo stato diventa `unknown` e il layer è
dichiarato non disponibile: **nessuna classificazione diplomatica stale**
(stesso principio fail-closed di MAP P2.1). Le relazioni sono integrate nel
lifecycle esistente (`useNationSnapshot`), senza polling autonomo.

## 7. Infrastrutture

Fonte: `Region.objects` geolocalizzati. Categorie civili/industriali:
`factory, port, infrastructure, power_plant, university, construction_site,
exchange, clearing`. Installazioni strategiche (`base, airbase, naval_base,
radar, fortification, missile_site`) restano infrastruttura ma gated dal filtro
unità. Le unità pure (`army, battalion, fleet, missile, mobilization`) **non**
diventano mai marker infrastrutturali (`objectIsVisibleForLayer`). Nessun
`infrastructureScore`.

Gli oggetti operativi (`OperatingPicturePayload.objects`) sono già esposti nella
sala di governo: non vengono duplicati sulla mappa e nessuna quantità nazionale
viene reinterpretata.

## 8. Comportamento di rendering

- Riempimento tematico via **`feature-state`** sulla source `regions` esistente:
  nessuna geometria duplicata, nessun rebuild del GeoJSON, nessun remount.
- `RegionFeatureIndex` + `diffRegionFeatures` invariati (P1).
- Cambio layer = solo `paint` + `feature-state`: **camera, zoom, selezione e
  ricerca restano invariati**; nessun `fitBounds`, nessun nuovo fetch.
- Sorgente dedicata `thematic-regions` non necessaria: si riusa `regions`.
- Tooltip contestuale per layer, con soli valori già derivati dai read model.
  Nessuna formula (combat strength, supply, risk, potential).

## 9. Accessibilità

Legenda testuale obbligatoria per ogni layer. Diplomazia e infrastrutture
distinguono le voci anche per forma/bordo/etichetta, non solo per colore.
Economia espone range numerici, non giudizi. Il selettore a 8 voci è un radio
group accessibile con griglia compatta (4 colonne, 2 su mobile) — nessuna nuova
libreria UI.

## 10. Fallback SVG

`MapView.tsx` continua a funzionare per Political/Changes/Terrain-like. Per i
layer avanzati mostra un avviso esplicito: la vista tematica completa richiede
geometrie GeoJSON/MapLibre. Il renderer SVG non è stato riscritto.

## 11. File

Nuovi:
- `frontend/src/components/Map/thematicMapModel.ts` — read model puro
- `frontend/src/components/Map/thematicMapModel.test.ts` — 15 test unitari
- `e2e/tests/map-p3-layers.spec.mjs` — 10 scenari A–J
- `docs/implementation/MAP-P3-report.md` — questo documento

Modificati:
- `frontend/src/components/Map/mapModel.ts` — union 8 layer, `MAP_LAYERS`,
  insiemi di tipi oggetto, `objectIsVisibleForLayer`
- `frontend/src/components/Map/MapboxMapView.tsx` — coropleth tematico,
  feature-state, tooltip contestuale, enfasi infrastrutture, avviso layer
- `frontend/src/components/Shell/MapLegend.tsx` — legende contestuali, range PIL
- `frontend/src/components/Map/map.css` — griglia layer, chiavi, avviso
- `frontend/src/components/Map/MapView.tsx` + `Game/GameMap.tsx` — fallback SVG
- `frontend/src/hooks/useNationSnapshot.ts` — `relationships` fail-closed
- `frontend/src/components/Game/GameScreen.tsx` + `GameMap.tsx` — wiring

**Nessun file backend modificato.**

## 12. Test

Unitari `thematicMapModel.test.ts` (15): presentazione 8 layer; economia
(basso/medio/alto, ordine-indipendente, no-data, outlier robusto, `gdp` non
modificato, range reali); diplomazia (player/ally/neutral/hostile/unknown,
owner→relationship, stabile); infrastrutture (opere civili sì, unità pure no,
strategiche marcate); risorse (sito canonico sì, riserva nazionale senza
`regionId` mai posizionata).

E2E `map-p3-layers.spec.mjs` (10): A sequenza layer + camera; B economia
(coropleth da feature-state, range reali, ritorno a Political); C diplomazia;
D risorse (nessun marker inventato + messaggio); E infrastrutture (opere sì,
armata no); F militare P2 integro; G camera invariata su 5 switch; H mobile 360;
I ricerca stabile; J selezione stabile.

### Esito gate

| Gate | Esito |
|---|---|
| Frontend `tsc --noEmit` | ✅ |
| Frontend `vitest run` | ✅ 70 file / 545 test |
| Frontend `npm run build` | ✅ |
| E2E `npm run test:e2e:mock` | ✅ 81/81 (71 + 10 P3) |
| A11y `npm run test:a11y` | ✅ 3/3 |
| Perf `npm run test:perf` | ✅ entro baseline |
| Backend | invariato (nessun file toccato) |

## 13. Limiti

- Risorse: nessun sito territoriale canonico nel motore → il layer è di norma
  dichiarato non disponibile (per progetto, non per bug).
- Economia: nessun PIL per abitante (unità non verificabili).
- Diplomazia: `unknown` per regioni senza owner (sentinella `neutral`).
- Cambio layer non apre azioni: la mappa resta *observe / understand / navigate*
  (MAP P4 è map-first gameplay).

## Conferme finali

- **nessun secondo motore mappa**
- **nessun secondo military read model**
- **nessun economic score inventato**
- **nessuna allocazione geografica inventata delle risorse nazionali**
- **diplomacy deriva dalle relationships canoniche**
- **GDP deriva esclusivamente da `Region.gdp`**
- **infrastructure deriva da oggetti geolocalizzati esistenti**
- **camera non viene resettata al cambio layer**
- **selection e search restano stabili**
- **MAP P1 invariata**
- **MAP P2 invariata**
- **MILITARY P4–P6 invariata**
- **nessun grande refactor**

---

## MAP P3.1 — thematic selection integrity and diplomacy refresh safety

Due difetti emersi in review, chiusi senza riaprire l'architettura P3: nessun
nuovo layer, nessuna modifica backend, nessuna modifica al motore.

### Fix A — la selezione non altera la semantica del layer

**Problema.** Nel layer tematico il `fill-color` dava precedenza a
`feature-state.selected` → colore politico. Selezionare una regione in Economy
ne cancellava il bucket; selezionare `AUT` in Diplomacy ne cancellava lo stato
`hostile`.

**Regola.** `selected ≠ political fill override`. La selezione è comunicata
dall'**outline** di `regions-line` (bianco, più spesso), mai dal riempimento.

**Fix.**

```text
prima:  ['case', selected → ['get','color'], hasThematic → thematicColor, NO_DATA]
dopo:   ['case', hasThematic → thematicColor, NO_DATA]        (selected assente)
```

Il riempimento tematico è ora costruito da `thematicFillExpression()` in
`thematicMapModel.ts`: un'unica funzione pura, testabile senza MapLibre, la cui
espressione **non contiene** `selected`.

Esiti verificati:

- regione Economy selezionata → stesso colore di bucket;
- regiona Diplomacy `hostile` selezionata → resta `hostile`;
- regione **no-data** (`gdp` 0/undefined) selezionata → resta `THEMATIC_NO_DATA_COLOR`,
  non diventa colore politico;
- relazione `unknown` selezionata → resta presentazione unknown/no-data.

### Fix B — la diplomazia invalida la matrice all'avvio del refresh

**Problema.** `refreshRelationships()` impostava `loading`/`error` ma lasciava la
matrice precedente nello state fino alla risposta: durante il pending il layer
mostrava una fotografia `neutral` come se fosse **corrente**, mentre il mondo era
già cambiato.

**Regola (già stabilita in MAP P2.1).** `CURRENT STATE ≠ LAST KNOWN STATE`.

**Fix.** All'avvio del refresh, subito dopo il request id:

```ts
const request = ++relationshipsRequest.current;
setRelationshipsLoading(true);
setRelationshipsError(null);
setRelationships(null);   // MAP P3.1: la matrice precedente è invalidata
```

Durante il pending: `relationships = null`, `relationshipsLoading = true`,
`data-diplomacy-available = false`, messaggio contestuale visibile, base map
disponibile. Il layer non mostra mai dati stale.

**Race / failure / recovery.** Il guard `if (request !== relationshipsRequest.current) return`
resta: una risposta lenta di un refresh superato non rientra nello state. Su
errore: `relationships = null` + `relationshipsError`. Un refresh successivo
valido riporta la matrice e rende il layer di nuovo disponibile. Cambio `gameId`:
`relationships`/`error` azzerati e richieste precedenti invalidate dal bump di
`relationshipsRequest.current` nel nuovo refresh.

Nessuna nuova prop di lifecycle: il renderer non ha bisogno di distinguere
`loading` da `error` per restare fail-closed (`relationships === null` basta).
Il messaggio resta unico («Relazioni diplomatiche non disponibili.»), come
consentito dalla specifica.

### Verifica

- **Unitari** `thematicMapModel.test.ts` (19 totali, +4 P3.1): l'espressione di
  riempimento non contiene `selected` né `['get','color']`; colore di bucket
  stabile; no-data resta no-data; `hostile` resta `hostile`, `unknown` resta
  no-data.
- **E2E** `map-p3-layers.spec.mjs` (+4: K/L/M/N):
  - **K** — Economy e Diplomacy: `feature-state.thematicColor` invariato dopo la
    selezione; `fill-color` non contiene `selected`;
  - **L** — refresh pending → `data-diplomacy-available=false`, `AUT` non più
    `neutral`, poi risposta → `hostile`;
  - **M** — refresh fallito → `AUT` non più `neutral`, layer non disponibile;
  - **N** — race A lenta/B veloce → B vince, A non sovrascrive.

### Conferme finali MAP P3.1

- **selected Economy region preserves GDP thematic fill**
- **selected Diplomacy region preserves relationship thematic fill**
- **no-data selected remains no-data**
- **relationships are invalidated at refresh start**
- **no stale diplomacy during pending requests**
- **race protection preserved**
- **failure remains fail-closed**
- **recovery works**
- **Resources semantics unchanged** (`OperatingObject kind='mine'` resta non
  canonico come sito geografico: nessun uso in P3.1)
- **MAP P2 unchanged**
- **no backend changes**
- **no large refactor**
