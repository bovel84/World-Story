# G3-A — GameShell e CommandRail: fondazioni della shell operativa

**Pacchetto:** G3 (shell in-game), prima micro-consegna.  
**Data:** 9 settembre 2026.  
**Stato:** fondazioni create e compilate, integrazione in `renderGame` da completare (G3-B).

## Componenti creati

| File | Scopo |
|------|-------|
| `frontend/src/components/Shell/GameShell.tsx` | Layout a griglia (HUD, Rail, Mappa, Desk) con breakpoint tablet/mobile |
| `frontend/src/components/Shell/CommandRail.tsx` | Barra comandi sinistra con icone moduli, badge, stati active |
| `frontend/src/components/Shell/DeskContent.tsx` | Contenuto desk per modulo (Ordini, Consulente, Diplomazia, Notizie, Nazione) |

## Token CSS aggiunti in `foundations.css`

- `--ws-rail-w: 56px` — larghezza rail
- `--ws-desk-w: 400px` — larghezza desk
- `--ws-hud-h: 56px` — altezza HUD
- Layout desktop: `grid-template-columns: 56px 1fr 400px`
- Tablet: desk come sheet laterale animato
- Mobile: rail nascosto, desk come bottom sheet

## Breakpoint implementati

| Breakpoint | Comportamento |
|------------|---------------|
| ≥1024px | Rail fisso 56px, Mappa 1fr, Desk 400px |
| 768–1023px | Rail fisso, Desk come sheet laterale (slide-in da destra) |
| <768px | Rail nascosto, Desk come bottom sheet (slide-up) |

## Verifiche

- **Build**: tsc + vite OK (8.65s)
- **Test**: 64 test verdi
- **Lint**: `git diff --check` pulito

## Prossimo passo (G3-B)

Integrare `GameShell`, `CommandRail` e `DeskContent` nel `renderGame` di `App.tsx`:
1. Sostituire `game-container` flex con `GameShell` grid
2. Spostare `HudBar` nello slot `hud`
3. Sostituire `Fab` con `CommandRail` nello slot `rail`
4. Spostare mappa nello slot `map`
5. Sostituire `floating-advisor-panel` + `game-panel` con `DeskContent` nello slot `desk` (controllato da `activeModule`)
6. Rimuovere `Fab` e stili legacy `.floating-advisor-panel`, `.game-container` flex

Il verticale da validare: **Landing → Guerra Fredda → Italia → ordine → Avanza → evento causale → cicatrice mappa → dispaccio**.