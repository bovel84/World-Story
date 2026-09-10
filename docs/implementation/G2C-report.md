# G2-C — Scelta paese: dossier, ricerca, difficoltà e legenda mappa

**Pacchetto:** G2 (ingresso al gioco), §5.3 del piano.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Intervento

`frontend/src/components/Game/CountrySelector.tsx`:

- **Ricerca paese**: input `type="search"` per filtrare per nome o codice ISO.
- **Difficoltà integrata**: il selettore riceve `difficulty` (story/easy/normal/hard/very_hard) e mostra etichetta leggibile + effetto verificabile nel dossier (es. "Equilibrio storico, conseguenze piene").
- **Dossier strategico**: quando un paese è selezionato, appare un pannello con colore, nome, codice, posizione (potenza regionale), difficoltà, effetto, punti di forza e sfide iniziali.
- **Legenda mappa**: nella mappa SVG, legenda inline (Selezionato/Disponibile/Non disponibile) con swatch colorati.
- **CTA contestuale**: il pulsante diventa «Avvia come {Nome}» quando c'è una selezione.
- **Elenco filtrato**: sia la lista compatta (con mappa) sia la griglia fallback usano `filteredCountries`.

`frontend/src/App.tsx`: passa `difficulty` al CountrySelector.

`frontend/src/styles/foundations.css`: token per `country-search`, `world-select-legend`, `country-dossier`.

## Test

- Suite completa: **64 test verdi**.
- Build tsc + vite OK.
- Verifica browser: ricerca presente, legenda mappa visibile, dossier appare al click su paese, difficoltà "Normale" con effetto corretto, CTA "Avvia come United States".

## Invarianti

- Nessun API/backend/dato modificato.
- Fallback senza mappa preservato e filtrato.
- `Country` type invariato (code, name, color).

## Prossimo passo (G3)

Shell in-game (mappa dominante, rail persistente, desk in griglia) — per §5.5 e §5.6 del piano.