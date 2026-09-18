# REPORT — PLAYBACK-CRISIS-LEG (la crisi non avanzava dall'ultimo evento alla destinazione)

Base: `origin/main` = `38ea49f` (CRISIS-RESIDUAL merged, PR #51). Task `/tmp/pi-task-playback-crisis-leg.md`.
Nessun refactor ampio: **non** sono stati toccati FactionMemory, NpcAgenda, Commitments, PeacetimePressures,
Diplomacy, WorldStateEngine, interfaccia, soglie crisi 90/180, schema di branching di CRISIS-RESIDUAL.
Il fix è di **una riga** in `PlaybackService`, più il commento che ne spiega l'ordine.

---

## 1. Causa esatta del bug (righe)

`PlaybackService.commitPausedStepUnlocked()` aggiornava la crisi a **ogni evento** — riga **263**:

```ts
if (elapsedDays > 0) this.ctx.evaluateCrisis(elapsedDays);
```

`PlaybackService.completePausedRunUnlocked()` — la chiusura del run — portava invece **economia,
popolazione, risorse** fino a `finalDate` senza toccare la crisi:

```ts
// riga 559
const elapsedDays = Math.round((Date.parse(finalDate) - Date.parse(lastEventDate)) / 86_400_000);
// riga 560
const bulletins = this.ctx.isStrictGame() || elapsedDays > 0 ? this.ctx.advanceWorldState(elapsedDays, finalDate) : [];
```

`evaluateCrisis` era **assente** in tutto `completePausedRunUnlocked`. Conseguenza misurata su uno
scenario reale (1951-01-01 → eventi 20 gen / 10 feb → destinazione 1 apr): economia e mondo al
**1° aprile**, crisi ancora ferma al **10 febbraio**, con il suo `updatedDate` non aggiornato.
Viola il principio **stesso tempo simulato → stesso orologio per tutti i sottosistemi**: il tratto
finale era tempo narrativo morto per la crisi, che è tempo di calendario come tutti gli altri.

---

## 2. Fix applicato e ordine scelto

Una sola riga, dentro la transazione canonica già esistente e **prima** del CAS/checkpoint, riusando
la variabile `elapsedDays` già calcolata (righe 559-560) — nessun secondo calcolo del tempo:

```ts
// riga 729 (data definitiva del run)
this.state.currentDate = finalDate;
// riga 738
if (destinationReached && elapsedDays > 0) this.ctx.evaluateCrisis(elapsedDays);
```

**Ordine scelto = l'ordine già usato dal progetto.** Negli altri percorsi la crisi viene valutata
quando `state.currentDate` è **già** la data di fine periodo:

| Percorso | Sequenza |
|---|---|
| `TurnPipelineService.processActionBatchUnlocked` | economia a `period.end` (riga 562) → … → `currentTurn++`/`currentDate = period.end` (riga 763) → `evaluateCrisis(true, period.elapsedDays)` (riga 770) |
| `GameSession.advanceDate` | `currentDate = newDate` → `evaluateCrisis(true, days)` |
| `commitPausedStepUnlocked` (per evento) | `currentDate = eventDate` → `advanceWorldState(elapsedDays, eventDate)` → `evaluateCrisis(elapsedDays)` |
| **`completePausedRunUnlocked` (tratto finale, ora)** | economia a `finalDate` (riga 560) → `currentDate = finalDate` (riga 729) → **`evaluateCrisis(elapsedDays)` (riga 738)** → CAS data/stato (riga 742) → checkpoint finale (riga 745, che contiene anche la crisi) → commit |

La data va impostata **prima** della crisi perché `NationStateService.evaluateCrisis` persiste
`updatedDate: this.ctx.currentDate()`: è l'ancora autorevole da cui i turni successivi misurano il
tempo. Valutare la crisi con `currentDate` fermo all'ultimo evento avrebbe scritto un'ancora vecchia e
il tratto finale sarebbe stato **riconteggiato** al turno dopo.

---

## 3. Perché non c'è doppio conteggio

`crisisElapsedDays(previous, periodDays)` preferisce l'ancora persistita:

```ts
if (previous?.updatedDate) return daysBetween(previous.updatedDate, currentDate());
return Math.max(0, periodDays);
```

Al completion `previous.updatedDate` = data dell'ultimo evento e `currentDate` = `finalDate` → i giorni
contati sono **esattamente** il tratto finale (`daysBetween(ultimo evento, destinazione)`), che è lo
stesso numero passato all'economia (`elapsedDays`). I tratti già contabilizzati dai passi per-evento
hanno spostato l'ancora in avanti, quindi **non possono rientrare**. Verificato a numeri interi su un
mondo con crisi **critica** (1 giorno per giorno):

```
9 (periodo → evento 1) + 10 (evento 1 → evento 2) + 12 (evento 2 → destinazione) = 31 ✅
alternative sbagliate: 19 + 31 = 50 ❌ (riparte dal primo evento) · 31 + 31 = 62 ❌ (tutto due volte)
```

Anche il caso "completion fallito e poi rieseguito" resta a 91 giorni (79 + 12), **non** 79 + 12 + 12.

E il percorso per-evento **non** è stato toccato: la riga 263 è invariata, quindi ogni passo continua
a contare solo i propri giorni.

---

## 4. Comportamento `completed` / `intervened` / `paused_budget`

| Esito | `destinationReached` | `finalDate` | `elapsedDays` | Crisi |
|---|---|---|---|---|
| `completed` | true | `state.destination` | giorni ultimo evento → destinazione | **avanza** di quegli stessi giorni |
| `intervened` | false | data dell'ultimo checkpoint | 0 | non avanza: nessun tempo futuro simulato |
| `paused_budget` | false | data dell'ultimo checkpoint | 0 | non avanza: idem |

La condizione `destinationReached && elapsedDays > 0` rende i tre casi espliciti e simmetrici con
l'economia (`advanceWorldState` è già chiamata solo quando c'è tempo o in strict): su «Intervieni» e
budget esaurito **non** viene simulato un solo giorno in più.

**Game over nel tratto finale.** Non c'è nessuna scorciatoia: `evaluateCrisis` chiama
`NationStateService.evaluateCrisis` → `advanceCrisis` → se la dimensione è critica e l'arretrato
supera `CRISIS_COLLAPSE_DAYS` con `episodes >= CRISIS_MIN_EPISODES`, scatta `onCrisisEnding` →
`finishGame` (epilogo, `status = finished`, evento `game_over`). Quindi il collasso può maturare
**anche senza un altro evento narrativo**: 79 giorni a fine evento 2 + 12 giorni finali = 91 ≥ 90 →
partita chiusa. Il motore resta l'autorità, il tratto finale non nasconde il game over.

**Atomicità.** La valutazione è dentro la **stessa** `withCanonicalTransaction` già aperta dal
completion, nella posizione "advance economy → advance crisis → persist final date/state → checkpoint →
commit": un fallimento successivo (es. CAS `world_anchor_conflict` sul mondo mutato altrove) rolla
anche la riga di crisi. Nessuna seconda transazione dedicata, nessuna valutazione doppia. Verificato:
dopo un completion fallito la crisi resta esattamente al valore dell'ultimo evento (giorni,
avvertimenti, `updatedDate`, nessun epilogo) e un successivo «Continua» rieseguito conta il tratto una
sola volta.

---

## 5. File modificati

| File | Modifica |
|---|---|
| `backend-nest/src/game/PlaybackService.ts` | **+1 riga** (riga 738) + commento: `evaluateCrisis(elapsedDays)` nel completion a destinazione |
| `backend-nest/tests/playback-crisis-leg.test.ts` | **nuovo**: 7 test (tratto finale, doppio conteggio, collasso, intervieni, budget, atomicità, invariante) |
| `backend-nest/tests/routes-playback.test.ts` | esteso: scenario della segnalazione (1951, 55 giorni) fino alla destinazione + «Intervieni» senza futuro |

Nessun file frontend, nessuno schema DB, nessuna migrazione, nessun wiring nuovo
(`evaluateCrisis` era già nel contratto del ctx di `PlaybackService` da CRISIS-RESIDUAL).

---

## 6. Test aggiunti

**`tests/playback-crisis-leg.test.ts` (nuovo, 7)** — mondo con polity a crisi **critica**, quindi
totale lineare e doppio conteggio immediatamente visibile:

| # | Test | Copre |
|---|---|---|
| 1 | invariante: primo salto (`advanceDate`), battito (`worldTick`), salto con ordini, salto senza ordini → crisi alla **stessa data** e stessi giorni del tempo mosso | requisito "WorldStateEngine elapsedDays == NationCrisis elapsedDays" |
| 2 | completamento a destinazione: 9 → 19 → 31 giorni, `updatedDate = 2026-02-01` = data del mondo | Test 1 |
| 3 | nessun doppio conteggio: totale 31 = 9+10+12 e **non** 50/62 | Test 4 |
| 4 | collasso solo nel tratto finale: 79 a fine evento 2, 91 con i 12 giorni finali → `ending !== null`, partita chiusa | Test 3 + game over |
| 5 | «Intervieni qui»: crisi ferma al checkpoint, `updatedDate = 2026-01-20`, nessun giorno fino al 1° febbraio | Test 2 |
| 6 | budget esaurito (NDJSON senza record di chiusura → `paused_budget`): chiusura all'ultimo evento, `periodEnd` = data evento | Test 3 |
| 7 | atomicità: completion fallito (CAS) → crisi invariata; rieseguito → 91 giorni una sola volta | Test 5 |

**`tests/routes-playback.test.ts` (+1, 2 estesi)** — scenario della segnalazione con
`startDate 1951-01-01`, **crisi iniziale 55 giorni**, evento 1 `1951-01-20`, evento 2 `1951-02-10`,
destinazione `1951-04-01`: dopo ogni passo la crisi è alla data del passo; dopo il completion
`updatedDate === '1951-04-01'` e i giorni includono il tratto finale, calcolati con la **regola del
motore** (`critical` 1 g/g, `watch` = `CRISIS_WATCH_RATE`, `calm` = recupero `CRISIS_RECOVERY_RATE`)
sul livello osservato a ogni passo — nessun numero hardcodato. Secondo test: «Intervieni» dopo il
secondo checkpoint → `updatedDate === '1951-02-10'`, **non** la destinazione.

**Regressione del percorso per-evento**: coperta dal test esteso di `routes-playback` (19 → 21 giorni
senza doppioni) e dal test di CRISIS-RESIDUAL già in `main`.

**I test catturano il bug**: disattivando la nuova riga, **5 test falliscono** con i valori esatti del
difetto (`expected '2026-01-20' to be '2026-02-01'`, `expected 19 to be 31`, `expected 79 to be 91`,
`expected '1951-02-10' to be '1951-04-01'`).

---

## 7. Risultati del quality gate (eseguito)

| Verifica | Esito |
|---|---|
| test mirati (`routes-playback`, `crisis-residual`, `playback-crisis-leg`, `gameplay-long-integration`, `crisis-migration`, `nation-crisis`) | **6 file / 50 test verdi** |
| suite backend completa | **147 file / 1290 test verdi** (erano 146/1282) |
| `tsc --noEmit` backend | pulito |
| build backend (`tsc`) | OK |
| frontend (solo regressione, **nessuna modifica**) | **57 file / 399 test verdi**, `tsc` pulito, `vite build` OK |
| e2e mock (Playwright) | **33/33 verdi** |

---

## 8. Criterio di chiusura

```
ultimo evento → tempo rimanente fino alla destinazione → economia aggiornata
             → crisi aggiornata → checkpoint finale coerente
```

- crisi ed economia arrivano **alla stessa data** (`finalDate` = `updatedDate` = `currentDate`);
- «Intervieni» e budget esaurito **non** simulano tempo futuro;
- il game over nel tratto finale **è possibile** e verificato;
- `evaluateCrisis` è **dentro** la transazione canonica, senza doppie valutazioni;
- soglie 90/180 **invariate**, nessun refactor, test verdi.

---

## 9. Limiti residui

1. **`paused_budget` e `intervened` non aggiornano l'ancora**: la crisi resta al checkpoint, quindi se
   il giocatore riprende il tempo con un nuovo salto l'ancora è la data del checkpoint — corretto per
   costruzione, ma il run chiuso **non** registra i giorni non simulati (per definizione: non sono
   stati simulati).
2. **Un solo punto di valutazione**: il tratto finale è valutato una volta sola, alla destinazione. Un
   giocatore non vede un checkpoint intermedio nel tratto finale (non c'è narrativa lì): il pericolo
   resta visibile **prima** (ai checkpoint per-evento) e il game over arriva con l'epilogo. Se in
   futuro servisse una finestra di intervento *dentro* il tratto finale, servirebbe un evento narrativo
   o un checkpoint dedicato — fuori dal perimetro di questo task.
3. **Livello calmo**: su un polity calmo il tratto finale **riduce** l'arretrato (`CRISIS_RECOVERY_RATE`)
   e può saturare a 0; la data viene comunque aggiornata, ma il numero resta 0. Il mondo di prova a
   crisi critica (test nuovo) è quello che rende il conteggio verificabile a numeri interi.
4. Nessuna verifica live con LLM in questo task: il backend locale risponde ancora
   `HTTP 401 — Unauthorized` su `https://ollama.com/v1` perché in `backend-nest/.env` manca
   `LLM_API_KEY` (preesistente, non introdotto qui). La verifica end-to-end del completion è coperta dai
   test con provider stub, che esercitano lo stesso percorso del job `jump`.
