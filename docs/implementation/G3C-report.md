# G3-C — Ispettore provincia, legenda mappa, livelli

**Pacchetto:** G3 (shell in-game), terza micro-consegna.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.  
**Limitazione nota:** il backend restituisce `regions: {}` vuoto alla generazione mondo → la mappa mostra "Caricamento mappa…" e l'ispettore non può essere testato end-to-end. Il codice frontend è corretto.

## Componenti creati

| File | Scopo |
|------|-------|
| `frontend/src/components/Shell/ProvinceInspector.tsx` | Dossier contestuale persistente: click su mappa → pannello destro con proprietario, superficie, popolazione, PIL, forze, INFRA, asset, tag, confini cliccabili |
| `frontend/src/components/Shell/MapLegend.tsx` | Legenda interattiva nel rail: 3 livelli (Politica, Terreno, Cambiamenti), filtri checkbox, proprietari con swatch colore, provincia selezionata |

## Integrazione in `App.tsx` / `GameShell`

- `selectedProvinceId` state: click su mappa → imposta provincia + chiude modulo aperto
- `desk` slot: se `selectedProvinceId && activeModule === 'none'` → `ProvinceInspector`; altrimenti `DeskContent`
- `deskOpen`: `activeModule !== 'none' || selectedProvinceId !== null`
- `rail` slot: `CommandRail` + `MapLegend` (livello `political` | `terrain` | `changes`, filtri, provincia selezionata)
- `handleCountryChange`: imposta `selectedRegion` + `selectedProvinceId` + chiude modulo

## Token CSS aggiunti in `foundations.css`

- `.province-inspector` e sottoclassi (header, meta, assets, tags, borders)
- `.map-legend` e sottoclassi (layers, filters, owners, terrain/changes swatches, selected)

## Breakpoint

- Desktop: inspector nel desk a destra (400px)
- Tablet: inspector come sheet laterale
- Mobile: inspector come bottom sheet (gestito da `GameShell` `deskOpen`)

## Test

- Build: tsc + vite OK (7.74s)
- Test: 64 test verdi
- `git diff --check` pulito

## Limitazione nota (backend)

Il job di generazione mondo (`/worlds/generate`) restituisce `regions: {}` vuoto per tutti i template testati (`cold_war_1951`, `modern_world`, `provincial_modern`). Di conseguenza:

- `regions.some(r => r.geojson)` è false → MapboxMapView mostra fallback "Caricamento mappa…"
- `ProvinceInspector` non riceve regione → non testabile end-to-end
- `MapLegend` mostra proprietari ma da `regions` vuoto → lista vuota

Il codice frontend è corretto e funzionerebbe con `regions` popolati (geojson + properties). Lato backend va indagato perché la generazione geografia restituisce regions vuoto.

## Correzione — 10 settembre 2026: diagnosi regioni

La limitazione annotata sopra non era generalizzata: la risposta di `POST /worlds/generate` restituisce intenzionalmente `regions: {}` perché la UI carica la mappa da `GET /games/:id`, che restituisce le regioni complete con `geojson`.

L'ispezione del DB reale ha confermato geometrie per gli scenari normali (Guerra Fredda 40/40, Mondo provinciale moderno 942/942). Il solo `realism_test_world` produceva 0 regioni: dichiara le politie fittizie `ALP` e `BET`, assenti da Natural Earth, senza un `map.geojson` proprio.

Correzione applicata:

- aggiunto `data/presets/realism_test_world/map.geojson` con ALP e BET;
- il generatore ora rifiuta prima della persistenza un mondo privo di geometria, con errore azionabile;
- `tests/repro-regions.test.ts` verifica persistenza e copertura fra codici del preset e mappa della fixture;
- la UI segnala esplicitamente un vecchio mondo senza geometrie invece di mostrare un caricamento infinito.

## Prossimo passo (G4)

- Ciclo Ordini → Tempo → evento causale → cicatrice mappa → dispaccio (G4 del piano)
- Animazione "cicatrice temporale" su cambiamento confine
- Pattern/tratto oltre al colore per selezione
- Point-on-surface per etichette, decluttering