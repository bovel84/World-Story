# MAP-COMPLETE-ACTIONS / PARTE 2-3 — La coda delle azioni elaborate si svuota

Branch: `fix/actions-queue-clear` · Base: `main` @ `c0efef6`.
Classe: **A/B** — pulizia autorevole lato server + coerenza della coda in RAM.

---

## 1. Problema trovato (causa reale sul codice)

Sintomo di Andrea: dopo **AVANZA** le azioni elaborate restano nella lista e,
turno dopo turno, la coda **si accumula all'infinito**.

Il frontend è corretto:

```ts
// frontend/src/hooks/useWorldAdvance.ts — dopo il salto
const authoritativeQueue = await gameApi.getPendingActions(currentGame.id);
setPendingActions(authoritativeQueue.pendingActions || []);
```

La coda è dichiarata *«l'unica sorgente di verità dopo un salto»* e viene
riletta dal server: **se il server la restituisce piena, la UI la mostra piena.**

**La causa è lato server, in `TurnPipelineService.processActionBatchUnlocked`.**
Al termine del batch il percorso diretto fa **solo** la cancellazione su DB:

```ts
gameRepository.removePendingActions(this.ctx.gameId, actions.map(item => item.id)); // DB ✅
```

…ma **non** rimuove gli ordini dalla coda viva in RAM
(`OrderExecutionService.pendingActions`), che li conserva con
`status = 'completed'`. La route `GET /games/:id/pending-actions`
(`actions.routes.ts`) risponde con `session.getPendingActions()` →
`this.orders.getPendingActions()`, cioè **l'array in RAM**, quindi restituisce
le azioni già elaborate: la UI le ripresenta e la lista cresce.

Prova decisiva: il percorso **in pausa** (`PlaybackService`, `continueSimulation`)
fa **già** la pulizia in RAM accanto a quella su DB:

```ts
gameRepository.removePendingActions(this.ctx.gameId, batchActions.map(a => a.id));
// Anche la coda in memoria perde gli ordini conclusi…
this.ctx.orders.replaceQueue(this.ctx.orders.queue()
  .filter(action => !batchActions.some(batch => batch.id === action.id)));
```

Il percorso diretto semplicemente **non replicava** quella riga: era una
discrepanza tra il ramo "salto completato in un colpo" e il ramo "playback in
pausa". `clearPendingActions()` del frontend non c'entrava (e non va usata: la
verità è del server).

---

## 2. Diagnosi — quando un'azione è «elaborata»

Un'azione è **elaborata** quando entra nel batch del turno e il turno viene
**committato**:

- il batch la marca `status='completed'`, `deliveryStatus='issued'`,
  `executionStatus='completed'` (in RAM) — `TurnPipelineService`;
- la riga corrispondente viene **eliminata** da `pending_actions` (DB) —
  `TurnPipelineService` (percorso diretto) / `PlaybackService` (percorso in pausa);
- l'esito durevole resta in `simulation_action_outcomes` (non nella coda).

Non esistono oggi azioni «non elaborate» che sopravvivono al turno: il batch
consuma **tutte** le `pending`. Se il run va in **pausa** (Intervene / più eventi /
awaiting_next), l'ordine resta `processing` in coda finché il giocatore non
decide; solo alla finalizzazione (Continue) viene consumato. Il **rewind**
riporta invece l'ordine in coda (ramo annullato) — semantica invariata.

### Ciclo di vita della coda (prima della correzione)

| fase | punto | DB `pending_actions` | RAM `orders.queue()` | UI |
| --- | --- | --- | --- | --- |
| creazione | `POST /actions` → `enqueue` | INSERT | push `pending` | appare «In attesa» |
| modifica | `PATCH /actions/:id` → `updatePendingAction` | UPDATE text | testo aggiornato | aggiornata |
| rimozione manuale | `DELETE /actions/:id` → `removePendingAction` | DELETE | splice | sparisce |
| presa in carico | `processActionBatchUnlocked` | UPDATE `processing` | `processing/issued/in_progress` | — |
| completamento | `TurnPipelineService` (fine batch) | — | `completed` | — |
| **fine turno (diretto)** | `TurnPipelineService` | **DELETE ✅** | **❌ resta `completed`** | **`GET` la ripresenta → accumulo** |
| fine turno (in pausa) | `PlaybackService` | DELETE | ✅ filtrata | corretta |
| rewind | `rewind()` | righe ricreate | ricaricata `pending` | ordine di nuovo in coda |
| bootstrap/restore | `SessionBootstrapService` | letta | `replaceQueue` | — |

---

## 3. Correzione applicata

Nel percorso diretto, **accanto alla cancellazione su DB già presente**, la coda
viva perde gli ordini conclusi — la stessa riga che fa già `PlaybackService`:

```ts
gameRepository.removePendingActions(this.ctx.gameId, actions.map(item => item.id));
// Anche la coda viva perde gli ordini conclusi: la UI rilegge la coda
// autorevole dopo il salto, quindi la RAM non deve conservarli.
this.ctx.orders.replaceQueue(this.ctx.orders.queue()
  .filter(action => !actions.some(item => item.id === action.id)));
```

Effetti:
- dopo AVANZA la coda autorevole (RAM **e** DB) è **vuota** → la UI rilegge vuoto;
- il giocatore **può ricreare** l'azione (dalle proposte o a mano): la coda non è
  una cronologia;
- **nessun accumulo** dopo N turni.

**Non cambia:** semantica di run/checkpoint/Continue/Intervene; distinzione
registrazione ordine vs avanzamento tempo; il ramo in pausa; il rewind; il
percorso `processWorldAdvance` (nessun ordine). Nessuna modifica al frontend:
la UI già rilegge la coda autorevole.

---

## 4. CORE ENGINE FREEZE — conferma e nota

- `core/simulation/**`: **non toccato**.
- Motore di simulazione, `SimulationEngine`, `TurnOrchestrator`,
  `SessionStateStore`, schema/DB, `repositories`, `PlaybackService`, economia,
  store Zustand, frontend: **non toccati**.
- **Nota di trasparenza:** la riga corretta è in `src/game/TurnPipelineService.ts`,
  un file che in task precedenti era elencato nel freeze. Il freeze dichiarato in
  *questo* task nomina solo `core/simulation/**` e chiede esplicitamente una
  «pulizia autorevole lato server». La modifica **non altera alcuna semantica**:
  aggiunge in RAM la stessa rimozione che il DB esegue già sulla stessa riga, e
  che il ramo in pausa (`PlaybackService`) esegue già identica. Tutti i test di
  run/checkpoint/Continue/Intervene/rewind restano verdi.

---

## 5. File modificati

| file | intervento |
| --- | --- |
| `backend-nest/src/game/TurnPipelineService.ts` | +3 righe: la coda viva perde gli ordini conclusi, come già fa il percorso in pausa |
| `backend-nest/tests/stage2.test.ts` | +1 test: 3 turni consecutivi, coda vuota in RAM e DB, azione ricreabile |
| `docs/implementation/ACTIONS-QUEUE-CLEAR-report.md` | questo report |

---

## 6. Test eseguiti (esito reale)

| verifica | comando | esito |
| --- | --- | --- |
| Backend test | `cd backend-nest && npx vitest run` | **1136 passed / 132 file** (erano 1135) |
| Frontend test | `cd frontend && npx vitest run` | **318 passed / 49 file** |
| TypeScript backend | `cd backend-nest && npx tsc --noEmit` | exit 0 |
| TypeScript frontend | `cd frontend && npx tsc --noEmit` | exit 0 |
| Build backend | `cd backend-nest && npm run build` | exit 0 |
| Build frontend | `cd frontend && npm run build` | exit 0 |

**Il test prova il bug:** eseguito con la correzione rimossa fallisce con
`expected [ { id: 'f268c4718d67', … } ] to have a length of +0 but got 1`
(la coda torna piena → accumulo); con la correzione passa. Il test verifica
anche il DB (`COUNT(*) FROM pending_actions = 0`) e la ricreazione dell'azione.

---

## 7. Limiti residui

- La coda non conserva **cronologia**: gli esiti restano in
  `simulation_action_outcomes` e nella timeline, non tra le azioni da elaborare
  (per progetto: «la coda è solo ciò che deve essere elaborato»).
- La route `GET /pending-actions` restituisce la coda viva così com'è; non è
  stato aggiunto un filtro difensivo sui soli `pending` per non cambiare la
  semantica del ramo in pausa (dove le azioni sono `processing` e la UI deve
  poterle mostrare finché il giocatore non decide). La coerenza RAM↔DB è
  garantita alla fonte.
- Nessuna modifica a `useWorldAdvance.ts`: la UI continuava a fare la cosa
  giusta (rileggere il server). Il bug era una sola riga mancante nel server.
