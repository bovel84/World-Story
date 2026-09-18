# PLAYBACK-INTERMEDIATE-OVER — Il game over a un evento intermedio chiude il run

**Stato:** completato. Branch `fix/playback-intermediate-over`, PR verso `main`.
Nessun refactor ampio; toccati solo `PlaybackService`, il minimo cableaggio
(`GameSession.continueSimulation`, union di tipo, `respondTimeSkipResult`) e i test.

---

## 1) Problema

Nel playback scaglionato «un evento alla volta» la crisi veniva valutata **a ogni
checkpoint** (`PlaybackService.commitPausedStepUnlocked`, introdotto da
CRISIS-RESIDUAL: `if (elapsedDays > 0) this.ctx.evaluateCrisis(elapsedDays);`
prima del checkpoint), ma il passo restituiva **sempre**
`{ paused: true, type: 'awaiting_next', … }` perché la chiusura del run era
legata soltanto a `remainingEvents === 0`:

```ts
remainingEvents = state.remainingEvents.length;
if (remainingEvents === 0) {                       // ← solo qui si chiudeva
  if (state.incomplete) closeReason = 'paused_budget';
  else if (eventDate >= state.destination) closeReason = 'completed';
}
```

Conseguenza, se il collasso cadeva su un **evento intermedio**:

```
evento applicato → evaluateCrisis() → collasso → state.ending != null
→ games.status = 'finished' → game_over pubblicato dopo il commit
→ ma il run restava 'awaiting_next' con remainingEvents > 0
```

Cioè: **una partita già terminata restava con un run aperto**, pronto ad
applicare eventi futuri e ad avanzare fino alla destinazione. Difetto aggravato da
`GameSession.continueSimulation()`, che **non** verificava `isFinished()`: il
percorso `game over → Continua → evento successivo applicato` era possibile
(la difesa esisteva solo su altre porte, es. `processNextAction`/`advanceDate`).

Il test di PLAYBACK-ATOMIC-OVER fotografava proprio lo stato incoerente:
`expect(first.type).toBe('awaiting_next')` **insieme a**
`expect(session.isFinished()).toBe(true)`.

## 2) Intervento

### a) Il collasso chiude il run dentro la stessa transazione del checkpoint

`PlaybackService.commitPausedStepUnlocked`, subito dopo la valutazione della crisi
e la persistenza del checkpoint (nessun `await` in transazione):

```ts
if (this.state.ending) {
  gameRepository.finishSimulationRun(runId, 'game_over', {
    checkpointDate: eventDate, checkpointId, turn: state.jumpTurn,
  });
  this.state.pausedRun = null;
  closeReason = 'game_over';                        // precedenza sul resto
} else if (remainingEvents === 0) {
  if (state.incomplete) closeReason = 'paused_budget';
  else if (eventDate >= state.destination) closeReason = 'completed';
}
```

Punti chiave:

- **Precedenza**: `finished` vince su `awaiting_next` (e su budget/destinazione). Lo
  stato terminale non è mai «finished + awaiting_next».
- **Il run si chiude lì**, nella transazione del checkpoint: anche un fallimento
  della chiusura del lotto (`world_anchor_conflict` sul CAS del completion) non
  può lasciare un run aperto su una partita finita; `pending_state` è azzerato da
  `finishSimulationRun`.
- **Nessun avanzamento al futuro**: il passo non tocca la data (resta `eventDate`)
  e il completion è invocato con `reason = 'game_over'`, per cui
  `destinationReached = false` → nessun tratto finale, nessun `advanceWorldState`
  verso la destinazione, nessun tempo futuro simulato (le stesse garanzie già
  valide per «Intervieni»/budget esaurito).
- **`pausedRun = null`**: l'accessor `getPausedRunInfo()` (e quindi
  `pausedSimulation` in `GET /games/:id`) è già vuoto; la RAM non sopravvive al
  caso di fallimento perché lo staging di PLAYBACK-ATOMIC-OVER cattura
  `pausedRun` ormai nullo.
- Il `deferGameOver` di PLAYBACK-ATOMIC-OVER resta invariato: l'unico `game_over`
  esce **dopo il commit** del passo.

Il completion del lotto (`completePausedRunUnlocked(state, 'game_over')`) chiude
poi il giro con le semantiche esistenti: ordini risolti/voidati, checkpoint
finale alla data del collasso, outbox, narrazione dedicata
(`'La nazione è caduta: la cronaca si ferma al collasso'`) e risultato
`{ paused: false, type: 'game_over', … }`.

`startPausedPlaybackUnlocked` non lancia più l'errore «stato incoerente» quando il
**primo** evento chiude il run (collasso immediato): restituisce l'esito
terminale del playback — che è la risposta corretta, non un'incoerenza.

### b) Difesa server-side su «Continua»

`GameSession.continueSimulation()` inizia con `this.assertPlayable()`: se la
partita è finita rilancia **`GameOverError`**, l'errore di game over già usato
altrove (nessun secondo contratto d'errore, nessun evento applicato, nessun
secondo `game_over`). Con il punto (a) il run è già chiuso, quindi
`continueSimulation` normalmente fallisce prima con «run non in pausa»; la difesa
copre i client rimasti indietro, i restore e le corse.

### c) L'esito terminale arriva al client (cableaggio minimo)

- `CompletedBatchResult.type` e `finishSimulationRun(status)` accettano
  `'game_over'`; il `turn_complete` del playback espone `gameOver: true`.
- Le firme di `processActionBatchUnlocked` / `processAllPendingActions` /
  `processWorldAdvance` (pipeline e sessione) includono `CompletedBatchResult`:
  il tipo era già quello reale a runtime (il playback poteva chiudere il lotto al
  primo evento per budget/intervento), ora è dichiarato.
- `respondTimeSkipResult` (helpers delle rotte) riconosce la chiusura del playback
  e risponde con l'esito così com'è, **come già fa `POST /simulations/:runId/next`**.
  Prima un salto chiuso al primo evento cadeva nel ramo `world_advanced` con
  `narration`/`periodEnd` `undefined`.
- **Nessun file frontend modificato**: `useWorldAdvance` gestisce i tipi non
  riconosciuti con il refresh autorevole finale (`gameApi.get`), `useSimulationPlayback`
  tratta qualunque tipo diverso da `awaiting_next` come chiusura del salto e il
  `game_over` SSE mostra l'epilogo.

## 3) File modificati

| File | Modifica |
| --- | --- |
| `backend-nest/src/game/PlaybackService.ts` | chiusura del run al collasso nel passo per-evento; `closeReason 'game_over'`; narrazione/headline dedicata; `gameOver` nel `turn_complete`; niente errore sul primo evento terminale |
| `backend-nest/src/game-session.ts` | `assertPlayable()` in `continueSimulation`; union `CompletedBatchResult.type`; firme di ritorno con `CompletedBatchResult` |
| `backend-nest/src/game/TurnPipelineService.ts` | union di ritorno con `CompletedBatchResult` (3 firme + import di tipo) |
| `backend-nest/src/repositories/game.repository.ts` | `finishSimulationRun` accetta lo stato `'game_over'` |
| `backend-nest/src/routes/games/helpers.ts` | `respondTimeSkipResult`: la chiusura del playback è restituita verbatim |
| `backend-nest/tests/playback-intermediate-over.test.ts` | **nuovo**, 6 test |
| `backend-nest/tests/playback-crisis-leg.test.ts` | il test del collasso per-evento ora verifica l'esito terminale (non più `awaiting_next`) |
| `backend-nest/tests/routes-playback.test.ts` | mappatura HTTP dell'esito terminale del salto |

## 4) FREEZE

`core/simulation/**` non toccato (calcolo temporale della crisi, soglie **90/180**,
`NationCrisis`, `PeacetimePressures`, `FactionMemory`, `NpcAgenda`, `Commitments`,
`WorldStateEngine` invariati), branching/save/load/rewind non toccati, rollback
transazionale e `deferGameOver` non toccati, nessuna migrazione, nessun nuovo
motore: **riuso delle semantiche di run esistenti** (`finishSimulationRun` con lo
stato già previsto per «interrotto/chiuso», stesso `closeReason`, stesso
completion). Le uniche modifiche fuori dal playback sono l'unione di tipo, la
difesa su `continueSimulation` e la mappatura HTTP dell'esito. UI non toccata.

## 5) Test

`backend-nest/tests/playback-intermediate-over.test.ts` — fixture critica ITA
(`startDate 2026-01-01`), evento 1 `2026-01-20`, evento 2 `2026-02-15`,
destinazione `2026-03-10`, crisi seminata a **89 giorni** (sotto soglia all'avvio,
sopra al primo evento: collasso esattamente all'evento intermedio).

1. **Checkpoint terminale**: `paused === false`, `type === 'game_over'`,
   `isFinished() === true`, `getEnding() !== null`, `getStatus() === 'finished'`,
   `getCurrentDate() === '2026-01-20'` (≠ destinazione), `getPausedRunInfo() === null`,
   crisi a `89 + 19` giorni.
2. **Evento futuro mai applicato**: la cronaca del run contiene l'evento del
   collasso e **nessuna** riga al `2026-02-15` (tutte ≤ data del collasso);
   crisi e data di gioco ferme al 20 gennaio.
3. **«Continua» bloccata**: `continueSimulation(runId)` rifiuta con `game_over: …`,
   data/crisi/cronaca identiche, nessun `jump_event`, **un solo** `game_over`.
4. **Nessun tratto finale**: `simulation_runs.status = 'game_over'`,
   `checkpoint_date = '2026-01-20'`, `pending_state` nullo,
   `games.status = 'finished'`, giorni esattamente `89 + 19` (né `+LEG_2` né `+LEG_3`).
5. **Nessuna regressione**: percorso normale `evento 1 → awaiting_next →
   evento 2 → run_completed` a destinazione, crisi a 19 + 26 + 23 = 68 giorni.
6. **«Intervieni» a partita finita**: nessun run da chiudere
   (`tryIntervenePausedRun` → `null`), `requestIntervene` non accettato, data,
   crisi e riga del run invariate.

Prova di sensibilità (fix disattivato): il test 1 fallisce (`paused === true`), il
3 su `getPausedRunInfo()` non nullo, il 4 su `'awaiting_next' ≠ 'game_over'`.
Disattivando solo `assertPlayable()`: il test 3 fallisce perché l'errore diventa
«run non in pausa» invece di `game_over: …`.

## 6) Quality gate (eseguito)

| Verifica | Esito |
| --- | --- |
| `npx vitest run tests/playback-intermediate-over.test.ts` | **6/6** |
| `playback-crisis-leg` + `routes-playback` + `crisis-residual` + `crisis-migration` + nuovo file | **5 file / 32 test** |
| Suite backend completa | **148 file / 1298 test** (prima 147/1292) |
| `npx tsc --noEmit` (backend) | pulito |
| `npm run build` (backend `tsc`) | OK |
| Frontend: `npx vitest run` | **57 file / 399 test** |
| Frontend: `tsc --noEmit` + `vite build` | puliti (nessun file frontend toccato) |
| `npm run test:e2e:mock` | 33/33 |

## 7) Limiti dichiarati

- **Chiusura del lotto dopo il collasso**: se il completion del lotto fallisce
  (`world_anchor_conflict` sul CAS), il run è **comunque** già chiuso e la partita
  finita — coerente lato DB (lo stato terminale è quello commitato dal passo) e
  lato RAM (lo staging cattura `pausedRun` nullo), ma la risposta HTTP del salto è
  un errore e il client deve riconciliare con `GET /games/:id`. Preferibile al
  difetto opposto (run aperto su partita finita).
- **Endpoint legacy `processNextAction`**: mappa qualunque esito non-array a
  `null` (comportamento preesistente per i run chiusi dal playback); la partita
  risulta `finished` dal refresh autorevole, ma l'esito terminale dettagliato non
  è nella risposta. Il percorso reale (job/time-skip e `/next`) non è affetto.
- **Nessuna etichetta dedicata nella cronaca del client**: `applyRunCompletion`
  scrive in cronaca l'azione generica «Salto temporale»; l'epilogo è mostrato dal
  `game_over` SSE. Scelta deliberata per non toccare la UI come richiesto.
- **Nessuna verifica live con LLM**: il backend di sviluppo è bloccato dal
  **401 del provider** (`LLM_API_KEY` assente per `https://ollama.com/v1`, vedi
  CRISIS-RESIDUAL). La verifica è quindi a livello di motore, rotte e DB.
- Il caso «collasso su un passo per-evento con `incomplete`» non è testato
  separatamente: con il collasso la precedenza rende irrilevante il motivo di
  budget, e i test coprono comunque `incomplete` nel percorso normale
  (`playback-crisis-leg`, `routes-playback`).
