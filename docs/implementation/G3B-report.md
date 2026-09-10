# G3-B — Integrazione GameShell in renderGame

**Pacchetto:** G3 (shell in-game), seconda micro-consegna.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Intervento

Sostituzione del layout flex legacy (`game-container`, `Fab`, `floating-advisor-panel`, `game-panel`) con `GameShell` a griglia:

1. **HUD slot** → `HudBar` + `NewsFlash` + `turn-progress-banner` + `SimulationEventReader`
2. **Rail slot** → `CommandRail` con 5 moduli (Ordini, Diplomazia, Consulente, Notizie, Nazione), badge non letti, stati active
3. **Map slot** → `MapboxMapView` / `MapView` / fallback
4. **Desk slot** → `DeskContent` pilotato da `activeModule` (`none` | `orders` | `diplomacy` | `advisor` | `news` | `nation`)
5. `deskOpen` pilotato da `activeModule !== "none"`

## Componenti rimossi/non più usati in renderGame

- `Fab` (floating action button)
- `floating-advisor-panel` (pannello flottante con resize/maximize)
- `game-panel` / `panel-collapsed` / `panel-sheet-open` logica
- `actionsRef`, `actionsSize`, `actionsMaximized`, `isResizing`
- `panelTab`, `panelOpen`, `panelSheetOpen` (derivati legacy)

## Verifiche browser (Chrome DevTools)

| Modulo | Desk apre | Contenuto verificato |
|--------|-----------|---------------------|
| Ordini | ✓ | Piano, coda, registra ordine |
| Diplomazia | ✓ | Relazioni, alleati, chat |
| Consulente | ✓ | Streaming advisor (manuale) |
| Notizie | ✓ | Dispacci, feed vuoto con hint |
| Nazione | ✓ | Dossier, bilancio, progetti, diplomazia, save/load |

- Layout griglia desktop: rail 56px, mappa 1fr, desk 400px ✓
- HUD fisso in alto, rail a sinistra, mappa dominante ✓
- Breakpoint tablet/mobile nei token CSS (desk come sheet/bottom sheet) ✓

## Test

- Build: tsc + vite OK (10.75s)
- Test: 64 test verdi
- `git diff --check` pulito

## Invarianti

- Nessun API/backend/dato modificato.
- Tutti i callback (onBack, onRewind, onTimeSkip, onRestoreCheckpoint, ecc.) inalterati.
- `Fab` e stili legacy rimangono nel codice ma non più usati in `renderGame`.

## Prossimo passo (G3-C)

- Ispettore provincia persistente (click/tap su mappa → pannello contestuale)
- Legenda mappa e livelli (Politica, Terreno, Cambiamenti recenti)
- Cicatrice temporale: animazione confine precedente su cambiamento territoriale
- Pattern/tratto oltre al colore per selezione e cambiamento