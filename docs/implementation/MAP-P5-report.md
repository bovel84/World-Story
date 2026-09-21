# MAP P5 — living world strategic context and thematic drill-down

**Stato**: completato · **Base**: `main = ef56418` (MAP P4.1 mergiata) · **Branch**: `feat/map-p5-thematic-context` · **PR aperta per review, nessun merge automatico.**

## 1. Obiettivo

I layer di MAP P3 coloravano la mappa; MAP P5 li rende **strumenti di comprensione**: selezionando un territorio il context inspector spiega il layer attivo con dati canonici, e distingue sempre il **fatto della provincia** dal **contesto della potenza**.

```
MAP LAYER → CLICK TERRITORIO → REGION CANONICA
          → read model tematico (modello P3 condiviso) → CONTEXT INSPECTOR
```

Nessun nuovo motore, nessuna nuova `MapLayer` (restano le 8 di MAP P3), nessuna modifica backend, nessun fetch al click.

## 2. Source-of-truth matrix

| Sezione dossier | Fonte canonica | Non usato / vietato |
|---|---|---|
| Political | `region.owner`, `region.status`, `region.borders`, `polityName` | ideologie, stabilità regionale, controllo amministrativo |
| Economy | `region.gdp` **via `buildEconomyMapModel`** (stessi `edges`/`bucket`/colore del layer) | PIL pro capite, reddito, produttività, crescita |
| Resources | `canonicalResourceSites` (solo candidati con `regionId` presente nel mondo) | `NaturalResourceSummary` senza `regionId`, stockpile distribuiti |
| Infrastructure | `buildInfrastructureMapModel` + `infrastructureKind()` + `constructionReport()` | classificazioni duplicate, reparti fra le opere |
| Diplomacy | `diplomaticRegionStatus({ owner, playerPolityId, relationships })` | deduzione da eventi/timeline, `unknown` come `neutral` |
| Changes | `changedRegionIds` | cause dedotte, `TimelineEvent.headline/detail` |
| Terrain | `metadata.surface_type` + allowlist di chiavi fisiche **presenti** | altitudine, clima, bioma, difesa del terreno |
| Polity → Agenda | `strategicAgenda.powers` con `polityId` **esatto** | obiettivi attribuiti per nome/similarità |
| Polity → Commitments | `Commitment.actor`/`counterparty` **esatti** | alleanze/guerre non dichiarate dal registro |
| Military | invariato: MAP P2/P4 (`units`, `fronts`, P6, dryRun, authority) | secondo pannello militare |

## 3. Geographic truth — che cosa è territoriale

Ammessi perché esiste un collegamento verificabile:
`region.id` · `object.regionId` · `unit.regionId` · `front.regionIds` · `region.objects[].id` (opere e cantieri) · candidati risorsa con `regionId` valido nel mondo.

## 4. Volutamente **non** geolocalizzato

| Dato | Perché resta fuori dalla provincia |
|---|---|
| `PowerAgenda` (`strategicAgenda.powers`) | appartiene alla **polity**: mostrata in «CONTESTO DELLA POTENZA» con l'avviso «non descrivono questa provincia» |
| `Commitment[]` (`actor`/`counterparty`) | registro **nazionale**: mostrato per la polity, mai come fatto provinciale |
| `NaturalResourceSummary` senza `regionId` | riserva nazionale: nessuna allocazione inventata (messaggio esplicito) |
| `TimelineEvent` senza `regionId` | non geolocalizzato: nessun match su testo/headline |
| `ongoingProcesses` senza collegamento canonico | se non è già un `construction_site` in `region.objects`, non compare in mappa né in dossier |
| crisi nazionale, fazioni, bilancio, pressioni interne | restano nel Dossier Nazione (nessuna copia in ogni provincia) |
| GDP per capita, indici sintetici | unità non pubblicate dal motore |

## 5. Implementazione

- **`frontend/src/components/Map/mapThematicContext.ts`** (nuovo, puro): `buildRegionThematicContext()`, `polityLabel()`, `layerHasThematicSection()`, `resourceCandidatesFromNational()`, allowlist `TERRAIN_FACT_KEYS`, limite `COMMITMENTS_RECENT_LIMIT`. Nessun fetch/mutazione/stato.
- **`ProvinceInspector.tsx`**: nuovo blocco `[data-thematic-layer]` **prima** delle informazioni secondarie, con sezione per layer (political/economy/resources/infrastructure/diplomacy/changes/terrain) e blocco `[data-polity-context]` per agenda + impegni (attivi / storico recente). Il layer `military` **non** mostra la sezione tematica: resta prioritaria l'esperienza P4 (reparti/fronti/azioni).
- **`GameScreen.tsx`**: `thematicModel` costruito **una volta** con `useMemo` e condiviso da mappa e dossier; `resourceCandidates` dagli stati nazionali (senza `regionId` non producono siti); passati a `ProvinceInspector` anche `activeLayer`, `relationships`, `changedRegionIds`, `strategicAgenda`, `commitments`.
- **`MapboxMapView.tsx` / `GameMap.tsx`**: nuova prop opzionale `resourceCandidates` (stessi input della mappa ⇒ stesso modello del dossier).
- **`ProvinceInspector.css`**: `.thematic-context`, `.thematic-facts`, `.thematic-swatch`, `.thematic-group`, `.thematic-hint`, `.thematic-change`, `.polity-context` + regole mobile a colonna singola.
- **Selezione invariata**: `MapContextSelection` resta `region | unit | front | null` — `activeLayer` **non** entra nella selection, nessuna copia di oggetti, nessuno snapshot del territorio.
- **Cambio layer**: la selezione e la camera restano ferme; cambia solo il contenuto del dossier. Cambio territorio: il layer resta quello scelto.

## 6. Test

### Unitari — `frontend/src/components/Map/mapThematicContext.test.ts` (**20**)
political owner/neutrale · economy = bucket/edges/colore del modello P3 · economy no-data senza valore inventato · resources solo siti canonici · riserve nazionali non localizzate · infrastructure opere sì / reparti no · `construction_site` come cantiere con stato del motore · installazioni strategiche distinte · diplomacy player/ally/hostile/unknown · fail closed con `relationships: null` · changes solo da `changedRegionIds` · terrain solo metadati presenti · agenda con match esatto di `polityId` e mai fra i fatti del territorio · impegni per `actor`/`counterparty` con esclusione dei non pertinenti · etichette layer canoniche.

### E2E — `e2e/tests/map-p5-context.spec.mjs` (**13**)
A Economia (bucket dal modello P3 + colore identico al `feature-state` della mappa; regione no-data) · B Risorse (sito canonico visibile, riserva nazionale senza `regionId` assente da dossier e marker) · C Infrastrutture (fabbrica, cantiere, radar; reparto escluso) · D Diplomazia (ostile/alleato/player testuali) · E Agenda strategica come contesto della potenza, obiettivi di altre polity esclusi · F Impegni (attivi + storico recente, impegni di altre polity esclusi) · G Diplomazia sconosciuta fail-closed (mai «Neutrale») · H Cambio layer (stessa selezione, camera invariata, contenuto aggiornato, layer militare senza sezione tematica) · I Cambio territorio (layer invariato) · J Regressione militare P4 (reparto + anteprima azione, fronte) · K Modifiche senza causa inventata · L Nessuna geografia inventata da processi senza `regionId` · M Mobile 360×740 (nessun overflow, blocco scrollabile, mappa visibile).

Nota di copertura: nel caso «regione cambiata» lo scenario E2E K verifica lo stato *non modificato* e l'assenza di cause inventate (il flusso di avanzamento simulato non è disponibile nel mock senza nuova infrastruttura); la sensibilità a `changedRegionIds` è coperta dai test unitari (`['ROM'] → changed`, `['FIR'] → unchanged`).

## 7. Gate

| Gate | Esito |
|---|---|
| `frontend: npx tsc --noEmit` | ✅ pulito |
| `frontend: vitest run` | ✅ **74 file / 588 test** (+1 file, +20) |
| `frontend: npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ **117/117** (104 + 13 P5) |
| `npm run test:a11y` | ✅ 3/3 |
| `npm run test:perf` | ✅ **2.23 MB** entro baseline |
| Backend (**0 file modificati**) | ✅ `tsc`/`build` · **1714/1714** |

## 8. Regressioni verificate

MAP P1 · MAP P2 / P2.1 / P2.2 · MAP P3 / P3.1 · MAP P4 / P4.1 · MILITARY P4 / P5 / P5.1 / P6: tutte le suite restano verdi (E2E mock 117/117 include gli scenari P1, P2, P2.1, P2.2, P3, P3.1, P4, P4.1).
*Nota*: la specifica cita «MILITARY P4.1.1», fase che non esiste nel repository (le fasi reali sono MILITARY P4, P5, P5.1, P6): nulla da verificare oltre a quanto sopra.

## 9. File modificati

| File | Modifica |
|---|---|
| `frontend/src/components/Map/mapThematicContext.ts` | **nuovo** — read model del contesto tematico |
| `frontend/src/components/Map/mapThematicContext.test.ts` | **nuovo** — 20 test |
| `e2e/tests/map-p5-context.spec.mjs` | **nuovo** — 13 scenari A–M |
| `frontend/src/components/Shell/ProvinceInspector.tsx` | blocco layer attivo + contesto della potenza; nuove prop |
| `frontend/src/components/Shell/ProvinceInspector.css` | stili tematici + mobile |
| `frontend/src/components/Game/GameScreen.tsx` | `thematicModel` e `resourceCandidates` condivisi (useMemo), prop P5 |
| `frontend/src/components/Game/GameMap.tsx` | inoltro `resourceCandidates` |
| `frontend/src/components/Map/MapboxMapView.tsx` | prop `resourceCandidates` (mappa e dossier sugli stessi input) |
| `docs/implementation/MAP-P5-report.md` | **nuovo** — questo report |

## 10. Conferme

Nessun secondo motore e nessuno stato parallelo: il dossier legge solo read model derivati (`buildThematicMapModel` di P3 + `buildRegionThematicContext`), non effettua fetch, non scrive, non calcola simulazione. Nessun backend toccato, nessuna nuova azione, nessuna nuova `MapLayer`, nessun N+1, nessun deep clone del mondo, nessuna ricostruzione GeoJSON al cambio inspector. Selezione e camera non cambiano al cambio layer; la selezione resta composta di soli ID.
