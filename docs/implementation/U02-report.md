# U02 — Ordini guidati e catena della fattibilità

## µ1 — Compositore libero con bozza preservata e «Registra ordine» (passo 1)

**Stato:** completata, da revisione indipendente.

### Fotografia iniziale
- HEAD `384dac7`, working tree con tutto il lavoro F00–M07/U01 NON committato (riorganizzazione `docs/` dell'utente intoccata).
- Backend 60 file / 447 test verdi; frontend 23 test verdi; build OK.
- Il compositore d'ordine era **inline in `App.tsx`** (2.531 righe): textarea + «Migliora formulazione» + bottone **«Invia ordine»**, con stato locale `newActionText` (actionsStore), `enhanceLoading`/`enhancedPreview` (useState). Nessun concetto di «bozza preservata» né di «limiti espliciti»; l'etichetta «Invia» suggeriva esecuzione immediata.

### Requisiti audit / invarianti / test
- **UI02** (ordine registrato, preview e suggerimento scartato → nessun tempo/asset/costo materiale cambiato).
- **UI13** (offline/timeout mentre si valuta o registra → bozza conservata; retry idempotente, stato tecnico non notizia).
- Piano U02 passo 1: «Compositore libero e chiarimenti senza perdita bozza; review dell'intento e limiti espliciti.»
- Maestro §10.6: etichette univoche «Registra ordine», «Modifica», «Rimuovi dalla coda», «Avanza»; evitare «Invia» se sembra esecuzione immediata.

### File letti e modificati
- **Letti:** `App.tsx` (compositore inline, `enhanceOrder`, `queuePlayerAction`), `stores/actionsStore.ts`, `stores/index.ts`, maestro §10.2/§10.6, `docs/implementation/U01-report.md`.
- **Nuovi:** `frontend/src/stores/orderDraft.ts` (reducer puro), `frontend/src/stores/orderDraft.test.ts` (10 prove, UI02/UI13), `frontend/src/stores/orderDraftStore.ts` (store Zustand), `frontend/src/components/Game/ActionsPanel.tsx` (compositore estratto).
- **Modificati:** `frontend/src/App.tsx` (import + uso di `useOrderDraftStore`/`ActionsPanel`, `registerOrder`, `enhanceOrder` sul reducer), `frontend/src/index.css` (regola `.order-limits-note` scoped).

### Comportamento prima (test rosso o prova statica)
- Nessun test per la bozza d'ordine; la bozza era gestita da `useState`/`actionsStore` senza invarianti. Prova statica: `grep -n "Invia ordine" App.tsx` → etichetta «Invia ordine» presente; `grep -n "setEnhancedPreview" App.tsx` → 4 occorrenze di stato locale non testato. Nessuna nota esplicita che registrare non avanza tempo/cassa.

### Contratto API/schema e compatibilità
- **`OrderDraftState`** (puro): `{ text, enhancedPreview, enhanceLoading, enhanceError }`.
- **Reducer** `orderDraft.ts`: `updateDraft`, `startEnhance`, `enhanceSuccess`, `enhanceFailure`, `acceptEnhanced`, `rejectEnhanced`, `clearDraft`. Invarianti: la bozza non è mai persa su errore di rete o rifiuto anteprima; `acceptEnhanced` senza anteprima è no-op; `clearDraft` svuota tutto.
- **`useOrderDraftStore`** (Zustand): avvolge il reducer, nessuna logica.
- **`ActionsPanel`** (componente controllato): props `text/onTextChange/enhancedPreview/enhanceLoading/enhanceError/onEnhance/onAcceptEnhanced/onRejectEnhanced/onRegister`. Etichetta **«Registra ordine»**; nota esplicita «Registrare l'ordine non avanza il tempo né spende risorse»; errore tecnico in `role="alert"`; anteprima da confermare con «Usa questa formulazione»/«Scarta».
- **Compatibilità:** nessun cambiamento di contratto API/backend; stesse classi CSS (`manual-action-input`, `btn-enhance-pending`, `btn-add-pending`, `enhance-preview`, `suggestions-error`) così lo stile è preservato. `actionsStore.newActionText`/`setNewActionText` rimossi dall'uso in App (restano nello store per compatibilità, non più letti).

### Algoritmo e invarianti mantenute
- `registerOrder(text)`: accoda via `queuePlayerAction`; **svuota la bozza solo dopo l'accodamento riuscito** (UI13: bozza conservata su errore di rete).
- `enhanceOrder(text)`: `startOrderEnhance()` → chiamata API → `orderEnhanceSuccess(enhanced)` oppure `orderEnhanceFailure(msg)` (la bozza resta intatta).
- «Usa questa formulazione»: `acceptOrderEnhanced()` (sposta l'anteprima nella bozza) + `registerOrder(enhancedPreview)`.
- Nessuna mutazione di tempo/cassa/asset in questa µ: registrare accoda soltanto (UI02).

### Migrazioni eseguite solo su copie
- Nessuna migrazione DB. Solo refactor frontend (nessun dato toccato).

### Comandi test e risultato completo
- `cd frontend && ../node_modules/.bin/vitest run` → **3 file, 33 test verdi** (23 preesistenti + 10 nuovi `orderDraft.test.ts`).
- `npm --prefix frontend run build` → OK (tsc + vite).
- `npm --prefix backend-nest test` → **60 file, 447/447 verdi** (regressione intatta).
- `git diff --check` → pulito.

### Screenshot/trace se UI
- Nessuno in questa µ: refactor di stato puro + estrazione componente, nessun cambiamento visivo atteso oltre all'etichetta «Registra ordine» e alla nota limiti. Gli screenshot degli stati (chiuso/aperto/loading/empty/error/disabled) sono previsti in una µ successiva con il prototipo statico (passo 1 completo) e la shell grid (passo 3).

### Cosa NON è implementato / dipendenze mancanti
- Passo 2 (catena della fattibilità con dati/deficit/fonti, diagramma accessibile) — richiede M03 (FeasibilityService) per i dati reali; in questa µ solo il compositore.
- Passo 3 (conflitti batch e priorità modificabile) — µ successiva.
- Passo 4 (alternative a confronto) — µ successiva.
- Passo 5 (preview stale e ricalcolo) — µ successiva.
- Test UI03/UI07/UI10/UI15 e MAT03/MAT05 — richiedono harness Q01/browser e/o M03, non in questa µ.

### Decisione revisore
- **Da revisionare** (revisore ≠ implementatore): la rimozione dell'uso di `newActionText`/`setNewActionText` da `actionsStore` in App (restano nello store per compatibilità) e l'estrazione del compositore in `ActionsPanel` (nessun cambiamento di comportamento atteso, ma è una modifica di struttura del componente).

---

## Prossima micro-consegna (µ2)
- **Passo 2:** catena della fattibilità (`FeasibilityChain`) con dati/deficit/fonti; dettaglio a elenco su mobile, diagramma accessibile e lista equivalente su desktop; leggibilità anche senza colori. Dipende da M03 per i dati reali; in assenza, mock congelati dichiarati.
- Oppure **passo 3:** conflitti batch e priorità modificabile con bottoni/tastiera, «Registra» non muta tempo/cassa, date/costi stimati distinguibili dai fatti.
