# REPORT — PLAYBACK-ATOMIC-OVER (il collasso nel completion non deve sopravvivere al rollback)

Base: `origin/main` = `3ccae3c` (PLAYBACK-CRISIS-LEG merged, PR #52). Task `/tmp/pi-task-playback-atomic-over.md`.
Nessun refactor ampio: non sono stati toccati la logica temporale della crisi, le soglie 90/180,
`NationCrisis`, branching, save/load/rewind, FactionMemory, NpcAgenda, Commitments, PeacetimePressures,
WorldStateEngine, interfaccia. Il fix sta in `PlaybackService` (staging + guardia della conclusione) e
nella gestione dell'ending in `game-session`.

---

## 1. Causa del bug

`evaluateCrisis` nel tratto finale (riga 738 di `PlaybackService`) è corretto temporalmente, ma può
far **cadere la nazione**: `NationStateService.evaluateCrisis` → `advanceCrisis` → `onCrisisEnding` →
`GameSession.finishGame`, che modifica **subito la RAM** e diffonde l'evento:

```ts
// game-session.ts, finishGame (prima del fix)
this.ending = ending;              // RAM
this.status = 'finished';          // RAM
gameRepository.setStatus(...);     // DB (transazione)
this.pendingNationalNotes.push(`⛔ …`);   // RAM
this.broadcast('game_over', { … });       // CLIENT — durante la transazione!
```

Subito dopo, il completion può ancora fallire (`compareAndSwapTurnAndDate` → `world_anchor_conflict`).
La transazione DB viene rollbackata, **ma la RAM no**: la sessione restava `finished` con l'epilogo
presente, la nota del collasso fra le note nazionali, e il client aveva **già ricevuto** un `game_over`
che il rollback aveva cancellato. Tre stati incoerenti fra loro (DB, RAM, client).

---

## 2. Fix applicato

Due parti, entrambe minime, senza nuova infrastruttura.

### a) RAM ripristinabile — si estende lo **staging esistente**
Nello staging di `completePausedRunUnlocked` (e di `commitPausedStepUnlocked`, che può collassare
anch'esso in un passo per-evento) entrano i campi di stato che il collasso tocca:

```ts
ending: this.state.ending,
status: this.state.status,
pendingNationalNotes: [...this.state.pendingNationalNotes],
```

Nel `catch` già esistente — quello che riporta mappa, economia, turno/data e coda al checkpoint —
si ripristinano gli stessi campi. Nessun secondo sistema di snapshot: solo l'oggetto staging che c'era.

### b) `game_over` solo dopo il commit — finestra di rinvio sul pattern già presente
`finishGame` non pubblica più l'evento «a mano»: lo **deposita** se una finestra di rinvio è aperta.

```ts
// game-session.ts
private gameOverDeferDepth = 0;
private deferredGameOver: { ending; turn; date } | null = null;
private deferGameOver(): { flush(): void; discard(): void } { … }
```
```ts
// finishGame
const payload = { ending, turn: this.currentTurn, date: this.currentDate };
if (this.gameOverDeferDepth > 0) this.deferredGameOver = payload;
else this.broadcast('game_over', payload);      // percorsi fuori transazione: invariati
```

`PlaybackService` apre la finestra prima della transazione e la chiude **dove già si pubblicano i
broadcast post-commit** (il commento storico «F02/M06: SSE solo dopo il commit riuscito»):

```ts
const endingGuard = this.ctx.deferGameOver();
try { withCanonicalTransaction(() => { … }); … }
catch (e) { …ripristino staging…; endingGuard.discard(); throw e; }
// F02/M06: SSE solo dopo il commit riuscito
endingGuard.flush();   // ← qui esce il game_over, una sola volta
for (const payload of chatBroadcasts) this.ctx.broadcast('chat_message', payload);
```

Nessun event bus, nessuna coda, nessuna transazione nuova: un flag di profondità e un payload in attesa,
esattamente lo stesso schema dei `chatBroadcasts` raccolti nella transazione e pubblicati dopo.
Gli altri percorsi (pipeline del turno, `advanceDate`, battito del mondo) restano con il broadcast
immediato: la profondità è 0 e il comportamento è identico a prima.

---

## 3. File modificati

| File | Modifica |
|---|---|
| `backend-nest/src/game-session.ts` | `gameOverDeferDepth`/`deferredGameOver` + `deferGameOver()`; `finishGame` deposita invece di pubblicare quando la finestra è aperta; hook `deferGameOver` nel contesto del playback |
| `backend-nest/src/game/PlaybackService.ts` | ctx `deferGameOver()`; staging esteso (`ending`, `status`, `pendingNationalNotes`) nel completion **e** nel passo per-evento; `flush()` dopo il commit, `discard()` + ripristino RAM nel `catch` |
| `backend-nest/tests/playback-crisis-leg.test.ts` | test di atomicità esteso/rafforzato + 2 nuovi test (game_over post-commit, collasso per-evento) |

Nessuna modifica a frontend, schema DB, migrazioni, `NationCrisis`, soglie, branching, save/load/rewind.

---

## 4. Comportamento per caso

| Caso | DB | RAM | Client |
|---|---|---|---|
| **1. completion riuscito con collasso** | crisi ≥ soglia + `ending` + `status='finished'` committati | `isFinished()=true`, `getEnding()!=null`, nota `⛔` presente | `game_over` **una volta**, dopo il commit |
| **2. completion fallito dopo il collasso** | crisi e `status` tornano al checkpoint (`updatedDate` ultimo evento, `ending=null`) | `isFinished()=false`, `getEnding()=null`, `getStatus()='playing'`, nessuna nota `⛔` | **nessun** `game_over` |
| **3. retry** | tratto finale ricalcolato una sola volta (79 + 12 = 91) e committato | `finished` con l'epilogo vero | `game_over` **una volta** (totale: 1, non 2) |

Il caso 1 è verificato anche nell'ordine: quando l'evento esce, `isFinished()` è già `true` (commit
prima, evento dopo). Il **collasso in un passo per-evento** segue la stessa regola (finestra aperta
attorno alla transazione del passo), quindi l'invariante «nessun `game_over` sopravvive a un rollback»
vale per tutto il playback scaglionato.

---

## 5. Test aggiunti / modificati

`tests/playback-crisis-leg.test.ts` (9 test, tutti verdi):

| # | Test | Cosa prova |
|---|---|---|
| 8 | **atomicità: un completion fallito dopo il collasso non lascia epilogo né game_over** (esteso) | il tratto finale produce **davvero** il collasso (79 + 12 = 91 ≥ 90) **prima** del CAS fallito; dopo il rollback: crisi DB al checkpoint precedente (`giorni`, `episodes`, `updatedDate`, `ending=null`), `games.status='playing'`, `session.isFinished()===false`, `session.getEnding()===null`, `getStatus()==='playing'`, **nessuna nota `⛔`**, **0 `game_over`**; al retry: 91 giorni, un solo collasso, **1 `game_over`** |
| 9 | **completion riuscito con collasso: il game_over esce una sola volta, dopo il commit** | nessun `game_over` nei passi per-evento; sul completion esattamente **1**, con lo stato già `finished` al momento dell'evento e `date = destinazione` |
| 10 | **collasso in un passo per-evento: il game_over esce una volta, a commit avvenuto** | la nazione cade su una svolta oltre soglia: crisi committata, `isFinished()===true`, **1** `game_over` |

I broadcast sono intercettati con l'API già esistente `session.setSSEBroadcaster(fn)` (nessun metodo
nuovo); le note nazionali si leggono dal campo interno già presente (nessun getter pubblico aggiunto).

**Prova che i test catturano il bug** (fix disattivato temporaneamente):

| Fix disattivato | Esito |
|---|---|
| ripristino RAM nello staging | `atomicità…` fallisce: `expected true to be false` (la sessione restava `finished`) |
| rinvio del `game_over` | `atomicità…` fallisce: `expected [ { type: 'game_over' … } ] to have a length of +0 but got 1` (il client lo aveva ricevuto) |

---

## 6. Risultati del quality gate (eseguito)

| Verifica | Esito |
|---|---|
| `tests/playback-crisis-leg.test.ts` | **9 test verdi** |
| `tests/routes-playback.test.ts` + `tests/crisis-residual.test.ts` (+ `gameplay-long-integration`) | **23 test verdi** (4 file / 28 con l'integrazione) |
| suite backend completa | **147 file / 1292 test verdi** |
| `tsc --noEmit` backend | pulito |
| build backend (`tsc`) | OK |
| frontend (solo regressione, **nessuna modifica**, nessun file frontend toccato) | **57 file / 399 test verdi**, `tsc` pulito, `vite build` OK |

---

## 7. Criterio di chiusura

```
collasso nel tratto finale → errore CAS → rollback DB → rollback RAM
→ nessun game_over → retry → commit riuscito → game_over UNA sola volta
```
Verificato end-to-end nel test #8 (e #9/#10 per il percorso riuscito).

---

## 8. Limiti residui

1. **Finestra di rinvio, non una coda**: il payload è **uno** (l'ultimo collasso vince) e la profondità
   gestisce l'annidamento. È sufficiente perché un collasso è definitivo (`finishGame` esce subito se
   un epilogo esiste già) e il playback apre una finestra per transazione.
2. **Percorsi fuori dal playback**: la pipeline del turno, `advanceDate` e il battito del mondo
   pubblicano il `game_over` come prima (profondità 0). La stessa incoerenza teorica (broadcast dentro
   la transazione, poi rollback) resta là dove il DB è transazionale: è **fuori** dal perimetro di
   questo task e non è stato toccato; il meccanismo di rinvio è riusabile se in futuro si volesse
   estendere.
3. **Run in pausa dopo un collasso per-evento**: la partita è chiusa e il run resta in pausa
   (comportamento preesistente, dichiarato in PLAYBACK-CRISIS-LEG). Il `game_over` esce una volta, a
   commit avvenuto; non c'è chiusura automatica del run.
4. **Nessuna verifica live con LLM**: il backend locale risponde ancora `HTTP 401 — Unauthorized` su
   `https://ollama.com/v1` perché in `backend-nest/.env` manca `LLM_API_KEY` (preesistente). I test con
   provider stub esercitano lo stesso percorso del job `jump`.
