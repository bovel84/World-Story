# U01 — Shell operativa e migrazione CSS per componenti

## µ1 — `activeModule` enum: un solo modulo attivo (passo 2)

**Stato:** completata, da revisione indipendente.

### Fotografia iniziale
- HEAD `384dac7`, working tree con tutto il lavoro F00–M07 NON committato (riorganizzazione `docs/` dell'utente intoccata).
- Backend 60 file / 447 test verdi; frontend 14/14; build OK.
- `App.tsx` 2.531 righe; la gestione dei pannelli usava **booleans concorrenti**: `showActions` (uiStore), `panelOpen`/`panelSheetOpen` (stato locale), `panelTab` (chatStore).

### Requisiti audit / invarianti / test
- **A20** (accessibilità e composizione dei pannelli: z-index e dimensioni governati da regole concorrenti).
- **UI01** (ingresso/refresh/ritorno da menu/apertura modulo diverso → Nazione chiusa all'ingresso, un solo modulo attivo).
- Piano U01 passo 2: «Un `activeModule` enum al posto di booleans concorrenti. Ingresso/reset partita chiude Nazione; apertura Chat chiude il modulo precedente.»
- Maestro §10.3/§10.4: un solo modulo principale attivo; primo ingresso mappa libera, Nazione chiusa.

### File letti e modificati
- **Letti:** `App.tsx`, `stores/uiStore.ts`, `stores/chatStore.ts`, `stores/index.ts`, `components/Game/Fab.tsx`, `components/Game/HudBar.tsx`, `docs/AUDIT_CONFORMITA_PARITA_2026-09-08.md` (A19/A20), maestro §10.
- **Nuovi:** `frontend/src/stores/moduleState.ts` (stato puro dei moduli), `frontend/src/stores/moduleState.test.ts` (9 prove, UI01).
- **Modificati:** `frontend/src/stores/uiStore.ts` (stato `activeModule` + azioni `openModule`/`closeModule`/`toggleModule`, rimozione `showActions`), `frontend/src/App.tsx` (derivazione dei valori legacy da `activeModule`).

### Comportamento prima (test rosso o prova statica)
- Nessun concetto di «modulo attivo»: l'apertura di un pannello non chiudeva in modo garantito l'altro; Nazione e pannello flottante erano governati da due meccanismi indipendenti (`showActions` vs `panelOpen`). Prova statica: `grep -n "setShowActions\|setPanelOpen\|setPanelTab" App.tsx` → 15 occorrenze di setter concorrenti.

### Contratto API/schema e compatibilità
- **`ActiveModule`** = `'none' | 'orders' | 'diplomacy' | 'advisor' | 'news' | 'nation'`.
- **Stato puro** `moduleState.ts`: `initialModuleState`, `openModule(state, module)`, `closeModule(state)`, `toggleModule(state, module)`.
  - `openModule` chiude sempre il precedente (un solo modulo attivo); `openModule(none)` chiude.
  - `closeModule` → `'none'` (mappa libera).
  - `toggleModule` alterna (chiude se già attivo).
- **uiStore**: nuovo stato `activeModule` (default `'none'`), azioni `openModule`/`closeModule`/`toggleModule`; `resetUI` riporta `activeModule` a `'none'` (ingresso/reset partita chiude Nazione). Rimosso `showActions`/`setShowActions`.
- **App.tsx**: `showActions`, `panelOpen`, `panelTab` sono ora **derivati** da `activeModule` (mapping `moduleToPanelTab`). `panelSheetOpen` resta un dettaglio visivo locale del pannello Nazione.
- **Compatibilità:** nessun cambiamento di contratto API/backend; il comportamento UI resta identico (stessi pannelli, stesse etichette), cambia solo la sorgente di verità.

### Algoritmo e invarianti mantenute
- Invariante UI01: in ogni istante esiste al più un modulo attivo; `'none'` è l'unico stato senza pannello.
- Ingresso/ripristino partita (`currentView` → `'game'`) chiama `closeModule()` → Nazione chiusa.
- Apertura di un modulo (Fab, HudBar dispacci, archivio notizie) passa da `openModule`, che chiude il precedente.
- Chiusura pannello flottante e chiusura Nazione passano da `closeModule()`.

### Migrazioni eseguite solo su copie
- Nessuna migrazione DB. Solo refactor frontend (nessun dato toccato).

### Comandi test e risultato completo
- `cd frontend && ../node_modules/.bin/vitest run` → **2 file, 23 test verdi** (14 preesistenti + 9 nuovi `moduleState.test.ts`).
- `npm --prefix frontend run build` → OK (tsc + vite).
- `npm --prefix backend-nest test` → **60 file, 447/447 verdi** (regressione intatta).
- `git diff --check` → pulito.

### Screenshot/trace se UI
- Nessuno in questa µ: refactor di stato puro + derivazione, nessun cambiamento visivo atteso. Gli screenshot degli stati (chiuso/aperto/loading/empty/error/disabled) sono previsti in una µ successiva con il prototipo statico (passo 1) e la shell grid (passo 3).

### Cosa NON è implementato / dipendenze mancanti
- Passo 1 (prototipo statico con token del maestro e screenshot di tutti gli stati) — µ successiva.
- Passo 3 (shell grid, dialog con focus/inert/return, safe area, tastiera, registro z-index, portal con tema esplicito) — µ successiva.
- Passo 4 (migrazione CSS uno per volta di shell, Ordini, Chat, Nazione, Timeline/reader) — µ successive.
- Passo 5 (separazione blocco vendor minificato) — µ successiva.
- Test UI06–UI12 (tastiera, viewport, contrasto, reflow) — richiedono harness Q01/browser, non in questa µ.

### Decisione revisore
- **Da revisionare** (revisore ≠ implementatore): la rimozione di `showActions`/`setShowActions` da `uiStore` e la derivazione dei valori legacy in `App.tsx` (nessun cambiamento di comportamento atteso, ma è una modifica di contratto interno dello store).

---

## Prossima micro-consegna (µ2)
- **Passo 1:** prototipo desktop/mobile statico sui dati reali di esempio e token del maestro (§10.2), con screenshot di tutti gli stati (chiuso/aperto/loading/empty/error/disabled).
- Oppure **passo 3:** shell grid + registro z-index (map 0, shell 10, module 20, overlay 30, dialog 40, toast 50) + `GameShell`/`CommandSheet`/`AccessibleDialog` con focus/inert/return e safe area.
