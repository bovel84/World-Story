# REPORT — SUGGESTIONS-RESET (le proposte elaborate devono resettarsi a ogni turno)

Base: `main` = `9f7f976` (MILITARY-REACTION merged). Segnalazione: turno 8, 05/05/1816 — il
pannello «Pianifica la prossima mossa» mostra ancora le proposte dei turni precedenti.

---

## 1. Problema trovato (confermata la causa ipotizzata nel task)

- `frontend/src/stores/actionsStore.ts` espone `clearSuggestions: () => set({ suggestions: [] })`
  (riga 46) ed è il **percorso di stato già esistente**, usato da `useResumeSave` (riga 89) quando
  si riprende un salvataggio.
- In `frontend/src/hooks/useWorldAdvance.ts` — l'unico punto in cui il client chiude un turno —
  **non esisteva alcuna chiamata**: le proposte restavano nello store e ricomparivano identiche al
  turno successivo, mentre mappa, cronaca e coda venivano riallineate al server.
- Il pannello non aveva uno **stato vuoto**: `DeskContent` rendeva la lista solo con
  `suggestions.length > 0`, quindi con proposte azzerate sarebbe rimasto un'intestazione con il
  solo bottone, senza spiegare perché non c'è nulla da leggere.
- Il server non conserva proposte: `GET /games/:id/suggestions` → `GameSession.getSuggestions()`
  genera su richiesta (nessuna cache). Quindi l'azzeramento lato client è sufficiente e la
  rigenerazione resta **solo su richiesta esplicita** («Elabora proposte»).

Verifica del percorso di avanzamento: `handleTimeSkip` è l'unico ingresso
(`HudBar` → `TimeDesk` → `onTimeSkip(days)` → `handleTimeSkip`), e al termine rilegge la coda
autorevole (`gameApi.getPendingActions`) e il gioco (`gameApi.get`): è il punto esatto in cui il
client sa che il turno è chiuso — e dove va azzerata anche la fotografia delle proposte.

## 2. Intervento minimo

- **Nuovo modulo puro** `frontend/src/components/Game/suggestionsLifecycle.ts`:
  - `shouldResetSuggestions(outcomeType)`: `true` per ogni esito che committa un turno
    (`world_advanced`, `actions_processed`, `awaiting_next`, `date_advanced`,
    `simulation_replayed`); `false` **solo** per `no_event_found`, che non ha committato nulla
    (`lastCommittedResult === null`, turno e data ripristinati a `periodStart`: verificato in
    `TurnPipelineService` righe 448-450) e quindi conserva proposte, data, mappa, cronaca e coda;
    un esito assente o sconosciuto è trattato come cambiamento (fail-safe: meglio un pannello
    vuoto che proposte stantie);
  - `suggestionsEmptyHint()`: il testo dello stato vuoto.
- **`useWorldAdvance.ts`** (`clearSuggestions` dallo store esistente, nessun nuovo store):
  - dopo `setPendingActions(authoritativeQueue…)` → `if (shouldResetSuggestions(result.type)) clearSuggestions()`;
  - nel percorso **409**: il client era indietro e il turno è già committato lato server → azzera;
  - in `handleRestoreCheckpoint` e `handleRewindConfirmed`: entrambi **sostituiscono la fotografia
    del mondo** (ramo nuovo / turno annullato), quindi le proposte del ramo abbandonato non
    descrivono più nulla.
- **`DeskContent.tsx`**: stato vuoto coerente (`<p className="suggestions-empty" role="status">`)
  quando il modulo Ordini è aperto e non c'è nulla da leggere, con la chiamata all'azione
  («Elabora proposte») e la spiegazione della regola per turno. Stile in `editorial.css`
  (superficie navy, inchiostro chiaro come il resto del modulo).
- Nessun cambio di contratto API, nessun nuovo endpoint, `core/simulation/**` **non toccato**.

## 3. File modificati

- `frontend/src/components/Game/suggestionsLifecycle.ts` — **nuovo**, puro.
- `frontend/src/components/Game/suggestionsLifecycle.test.ts` — **nuovo**, 7 test.
- `frontend/src/hooks/useWorldAdvance.ts` — 4 punti di azzeramento + commenti.
- `frontend/src/components/Shell/DeskContent.tsx` — stato vuoto del modulo Ordini.
- `frontend/src/editorial.css` — `.suggestions-empty`.
- `e2e/mock-api.mjs` — proposte fittizie non vuote + mock dell'avanzamento
  (`simulation-jobs` → stato → esito; `GET /games/:id` riflette il turno nuovo) + opzione
  `advanceResult` per il caso senza eventi.
- `e2e/tests/suggestions-reset.spec.mjs` — **nuovo**, 2 test E2E nel browser.

## 4. CORE ENGINE FREEZE

Nessun file congelato toccato: l'intervento è interamente client (store già esistente + hook di
avanzamento + presentazione). Il server resta l'unica fonte di verità per la coda; le proposte non
sono mai state uno stato del motore.

## 5. Test eseguiti (esito reale)

- `frontend/src/components/Game/suggestionsLifecycle.test.ts` (7): tutti gli esiti che committano
  azzerano; `no_event_found` conserva; esito sconosciuto/assente azzera; il testo dello stato vuoto
  indica come rigenerare; ciclo dello store — azzerare non tocca la bozza d'ordine, tre turni
  consecutivi non accumulano, «Elabora proposte» ripubblica una lista unica e fresca.
- **E2E mock** `e2e/tests/suggestions-reset.spec.mjs` (2), nel browser con API mockate:
  1. pannello Ordini → stato vuoto spiegato → «Elabora proposte» pubblica 2 temi → avanzo il turno
     → la lista **sparisce**, resta lo stato vuoto con la spiegazione, il badge passa a **TURNO 2**
     → le proposte **non** riappaiono da sole e si rigenerano solo cliccando «Elabora proposte»;
  2. con `no_event_found` (nessun turno committato) le proposte **restano**: «una ricerca senza
     eventi non cambia la fotografia».
- Suite frontend completa: **50 file / 325 test verdi** (erano 318).
- Suite E2E mock completa: **25 test verdi** (erano 23).
- `tsc --noEmit` pulito; build frontend verde. Backend non toccato in questa parte (suite verde
  dalla PR precedente).

## 6. Limiti

- L'azzeramento è **client-side**: se la pagina viene ricaricata a metà turno, lo store parte vuoto
  (comportamento voluto: le proposte non sono uno stato del motore e non vengono persistite). Non
  esiste ancora una memoria delle proposte per turno/ramo: la Parte 4 (impatto delle decisioni)
  lavora sui dati del motore, non sulle proposte.
- Il pannello non ricorda che le proposte sono **scadute** vs **mai chieste**: mostra la stessa riga
  informativa nei due casi (differenza minima, nessun dato inventato).
- `no_event_found` conserva le proposte perché il server non ha committato nulla: se in futuro quel
  percorso avanzasse comunque l'economia o la data, l'eccezione va rivista (il test E2E la copre).
