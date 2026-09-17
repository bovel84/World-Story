# WORLD-ALIVE / PARTE 1 — Le azioni proposte sono deselezionabili (toggle)

Branch: `fix/suggestion-action-toggle` · Base: `main` @ `77324bc`.
Classe: **A/B** — sola presentazione + riuso di logica esistente.

---

## 1. Problema trovato (causa reale sul codice)

In `frontend/src/components/Shell/DeskContent.tsx` la lista delle proposte
(`suggestions.map(...)`) rendeva ogni azione così:

```tsx
const queued = pendingActions.some(item => item.text.trim() === content);
<button
  className={`suggestion-action${queued ? ' queued' : ''}`}
  disabled={queued || !content}
  onClick={() => void queuePlayerAction(content)}
>
```

**Causa reale:** quando l'azione era già in coda, `queued` era `true` e il
bottone diventava `disabled`. Quindi la proposta aggiunta **non era più
clicabile**: da lì non si poteva togliere. L'unica via di rimozione era il
pulsante `×` della sezione «In attesa di elaborazione» più in basso. Inoltre
il CSS base `.suggestion-action.queued { cursor: default }` la comunicava
esplicitamente come non interattiva, e la CTA diceva «Aggiunta» (stato, non
azione).

Non c'era alcun bug nel motore né nella coda: `removeQueuedAction` esisteva già
ed era già usata dal pulsante `×`.

---

## 2. Correzione applicata

**Toggle bidirezionale sulla stessa proposta, con le funzioni esistenti.**

- Nuova funzione **pura** `resolveSuggestionToggle(pendingActions, content)`
  in `frontend/src/components/Game/suggestionToggle.ts`:
  - proposta non in coda → `{ kind: 'add' }` → il desk chiama la
    `queuePlayerAction(content)` **già esistente**;
  - proposta in coda → `{ kind: 'remove', id }` → il desk chiama la
    `removeQueuedAction(toggle.id)` **già esistente** (nessun percorso nuovo,
    stessa API `useOrderQueue` → `gameApi.removePendingAction`).
  - La corrispondenza usa la stessa normalizzazione di prima (confronto sul
    testo con `trim`), quindi nessun cambio di semantica sui duplicati.
- In `DeskContent.tsx`: rimosso `disabled={queued || !content}` → ora
  `disabled={!content}` (resta disabilitato solo se la proposta è vuota).
  - `aria-pressed={queued}` comunica lo stato attivo/inattivo agli screen reader;
  - `title` distingue «Aggiungi questa proposta al piano» / «Rimuovi questa
    proposta dal piano»;
  - CTA `queued ? 'Rimuovi' : 'Usa'`; glifo `✓`/`+` invariato.
- `index.css`: `.suggestion-action.queued { cursor: pointer }` (era `default`) e
  hover verde localizzato per la rimozione. L'unico `!important` aggiunto è
  locale e serve solo a vincere il blocco legacy
  `.action-desk .suggestion-action:hover:not(:disabled)`.

**Cosa NON è cambiato:** la distinzione *registrazione ordine* vs *avanzamento
tempo* resta identica — si resta nella fase «piano»; nessun costo, nessuna
presa in carico, nessun passaggio di tempo.

---

## 3. File modificati

| file | intervento |
| --- | --- |
| `frontend/src/components/Game/suggestionToggle.ts` | **nuovo** — funzione pura del toggle |
| `frontend/src/components/Game/suggestionToggle.test.ts` | **nuovo** — test del ciclo add → remove |
| `frontend/src/components/Shell/DeskContent.tsx` | il bottone smista add/remove sulle funzioni esistenti; `aria-pressed`; non più `disabled` per `queued` |
| `frontend/src/components/Game/suggestionsDisplay.test.ts` | aggiornata l'asserzione della CTA (`Rimuovi`) |
| `frontend/src/index.css` | cursore + hover dello stato `queued` |
| `docs/implementation/WORLD-ALIVE-1-actions-toggle-report.md` | questo report |

Nessuna modifica a `useOrderQueue.ts`, agli store, alle API o al backend.

---

## 4. Conferma CORE ENGINE FREEZE

`core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/DB, `repositories`, semantica dei checkpoint,
`useSimulationPlayback`, pipeline di avanzamento turno, store Zustand ed
economia: **non toccati**. Intervento di sola interfaccia + riuso di logica
esistente (classe A/B).

---

## 5. Test eseguiti (esito reale)

| verifica | comando | esito |
| --- | --- | --- |
| Frontend test | `cd frontend && npx vitest run` | **318 passed / 49 file** (erano 313/48) |
| TypeScript frontend | `cd frontend && npx tsc --noEmit` | exit 0 |
| Build frontend | `cd frontend && npm run build` | OK |
| E2E mock | `npm run test:e2e:mock` | **23 passed** |
| Backend test | `cd backend-nest && npx vitest run` | **1126 passed / 131 file** |
| TypeScript backend | `cd backend-nest && npx tsc --noEmit` | exit 0 |
| Build backend | `cd backend-nest && npm run build` | exit 0 |

Il nuovo test `suggestionToggle.test.ts` (5 casi) verifica in particolare il
**ciclo completo aggiungi → rimuovi → ri-aggiungi** sulla stessa proposta e che
dopo la rimozione l'azione sparisca dalla coda (`queue.filter(a => a.id !== id)`).

---

## 6. Limiti residui

- Il toggle riconosce l'azione **dal testo normalizzato**: due proposte con lo
  stesso testo sono la stessa azione (comportamento preesistente, non introdotto
  qui). Se in futuro il motore ammettesse due ordini identici distinti, servirà
  un id stabile lato proposta.
- La rimozione resta **server-authoritative**: se l'azione è già in elaborazione
  il server rifiuta e l'errore è mostrato (`removeQueuedAction` già gestiva il
  caso). Il bottone non anticipa ottimisticamente la rimozione.
- Lo stile `queued` è locale al desk; il pannello floating usa le proprie regole
  già esistenti (invariate).
