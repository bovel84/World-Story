# REPORT — CRISIS-RESIDUAL (i due difetti residui P0 della crisi nazionale)

Base: `origin/main` = `18bb111` (GAMEPLAY-LONG merged, PR #50). Task `/tmp/pi-task-crisis-residual.md`.
Nessun refactor ampio: non sono stati toccati memoria delle fazioni, agenda NPC, commitments,
pressioni di pace, diplomazia, eventi causali, interfaccia generale. Di `TurnPipelineService` è
stato cambiato **solo il passaggio dei giorni** alla crisi.

---

## 1. Problema

Dopo GAMEPLAY-LONG la crisi nazionale è tempo-calendariale (giorni critici verso 90/180), ma due
difetti la rendevano inaffidabile proprio nei punti che contano: **l'inizio di una partita** e **il
ritorno indietro**.

**P0.1 — il primo salto non contava nulla.** `NationStateService.crisisElapsedDays()` misurava il
tempo trascorso solo dalla **data dell'ultima valutazione persistita**. In una partita nuova non
esiste alcuno stato di crisi precedente (`previous === null`) → `0` giorni. Un primo salto di 180 o
365 giorni non accumulava **niente**: la crisi partiva con un anno di ritardo, e con essa il conto
verso il collasso.

**P0.2 — il rewind azzerava la crisi invece di ripristinarla.** `game-session.rewind()` chiamava
`gameRepository.resetCrisisState(this.id)`: giorni critici, avvertimenti, livello ed epilogo tornavano
a zero. Inoltre `game_crisis_state` aveva la **chiave primaria sul solo `game_id`**: due rami della
stessa partita condividevano lo stesso stato di crisi — il ramo che risolveva cancellava la crisi
dell'altro.

### FASE 1 — diagnosi (obbligatoria)

**a) File coinvolti**

| File | Ruolo nella diagnosi |
|---|---|
| `src/game/NationStateService.ts` | `crisisElapsedDays` (solo `previous.updatedDate`) e `evaluateCrisis(advance)` |
| `src/game-session.ts` | `rewind()` → `resetCrisisState`; `SaveData`; `captureCheckpointData()`; `advanceDate()`; `afterRestoreState()`; wiring dei contesti |
| `src/repositories/game.repository.ts` | `getCrisisState`/`saveCrisisState`/`resetCrisisState` con PK `game_id` |
| `src/database.ts` | `game_crisis_state` (PK `game_id`) |
| `src/game/TurnPipelineService.ts` | `evaluateCrisis()` senza giorni del periodo |
| `src/game/PlaybackService.ts` | percorso scaglionato: avanzava il mondo ma **non** la crisi |
| `src/game/LiveTickService.ts` | battito del mondo (7 giorni): avanzava il mondo ma **non** la crisi |
| `src/game/GamePersistenceService.ts` | `afterRestore()` senza payload: nessuno stato da ripristinare |

**b) Strutture già esistenti e riutilizzabili (nessun secondo motore)**

| Struttura | Uso |
|---|---|
| `game_crisis_state` (`*_streak` = giorni critici, `*_episodes`, `overall`, `ending_*`, `updated_turn`, `updated_date`) | stato canonico della crisi, già persistito |
| `advanceCrisis()` (`core/simulation/NationCrisis.ts`) | calcolo puro, deterministico, invariato |
| `daysBetween()` (`core/simulation/calendar.ts`) | misura in giorni fra due date |
| `resolvePeriod()` → `period.elapsedDays` | **la** misura dei giorni simulati, già usata dall'economia (`advanceWorldState(period.elapsedDays, …)`) |
| `SaveData` + `captureCheckpointData()` + `afterRestore()` | il canale con cui ogni altra grandezza di ramo entra nel checkpoint |
| `games.head_branch_id` + pattern `branch_id` di agenda/commitments/memoria fazioni | identificatore canonico del ramo |
| `LIVE_TICK_DAYS` | giorni del battito del mondo |

**c) Le due cause, confermate**

1. **P0.1** — la funzione aveva una sola sorgente di tempo (la data persistita) e **nessuna misura del
   periodo** quando quella data non esisteva. Il periodo simulato però è già noto a chi chiama:
   `advanceDate(days)`, il `period.elapsedDays` della pipeline, il battito live. Nessun orologio nuovo:
   basta passare quel numero al primo passo.
2. **P0.1-bis (emerso in diagnosi, non segnalato)** — due percorsi avanzavano il tempo **senza valutare
   la crisi**: il **playback scaglionato** (un giorno alla volta, con "Continua"/"Intervieni") e il
   **battito del mondo** in modalità live. Stesso difetto di sostanza: tempo che passa e non conta.
3. **P0.2** — il rewind non ripristinava perché non c'era **niente da cui ripristinare**: la crisi non
   faceva parte del checkpoint. E il `resetCrisisState` di sicurezza azzerava l'unica copia esistente.
   La PK su `game_id` completava il quadro: la crisi era per partita, non per ramo.

**d) Rischi di regressione individuati**

- le soglie (`CRISIS_COLLAPSE_DAYS = 90`, `CRISIS_ABRUPT_DAYS = 180`, `CRISIS_MIN_EPISODES = 2`);
- i **salvataggi precedenti** (`*_streak` erano turni: 0–3, innocui per la soglia a 90 giorni; nessuna
  riga poteva essere persa);
- il **collasso brusco**: un salto unico di 180 giorni in piena criticità è game over immediato;
- l'ordine `rewind → reset → load → afterRestore` (chi scrive per ultimo);
- l'hash del salvataggio (`semanticStateHash`): aggiungendo la crisi al checkpoint l'hash cambia per i
  salvataggi **nuovi**, che è esattamente ciò che si vuole (lo stato di crisi è parte dello stato).

**e) Piano minimo adottato**

1. la crisi riceve i **giorni realmente simulati** da chi li conosce (4 chiamanti, 4 righe);
2. la crisi entra nel **checkpoint** come ogni altra grandezza di ramo e viene **ripristinata** dopo il
   commit del restore (non azzerata);
3. `game_crisis_state` diventa **per (partita, ramo)** con migrazione **additiva** e ripiego legacy;
4. il playback scaglionato e il battito live valutano la crisi come gli altri percorsi.

---

## 2. Intervento

### P0.1 — i giorni realmente simulati

`crisisElapsedDays(previous, periodDays)`:

```ts
if (previous?.updatedDate) {
  const elapsed = daysBetween(previous.updatedDate, this.ctx.currentDate());
  if (Number.isFinite(elapsed) && elapsed >= 0) return elapsed;   // ancora autorevole
}
return Math.max(0, Math.floor(Number(periodDays) || 0));          // primo passo
```

La data persistita resta la misura dopo il primo passo (e impedisce di contare due volte lo stesso
tempo: dopo un playback che ha già valutato i suoi giorni, la pipeline misura `0` — verificato). Al
**primo** passo, quando una data non esiste, la misura autorevole è il periodo simulato che il
chiamante già conosce. Nessun secondo orologio, nessuna data letta *dopo* il salto.

| Percorso | Chi passa i giorni | Valore |
|---|---|---|
| salto con ordini (senza eventi scaglionati) | `TurnPipelineService` (`processActionBatchUnlocked` / `processWorldAdvance`) | `period.elapsedDays` — **lo stesso numero già usato dall'economia** |
| salto senza ordini / auto-jump | stesso punto della pipeline (il batch parte anche con coda vuota) | `period.elapsedDays` |
| `advanceDate(days)` (salto puro del tempo) | `game-session.advanceDate` | `days` |
| playback scaglionato | `PlaybackService` per ogni evento | `elapsedDays` del passo |
| battito del mondo (live) | `LiveTickService.worldTick` | `LIVE_TICK_DAYS` (7) |

Caso verificato: nuova partita + salto di 7 giorni → `criticalDays = 7` (prima: `0`); salto di 180
giorni in piena criticità → 180 (e collasso, se la regola scatta).

### P0.2 — la crisi nel checkpoint e per ramo

1. **Nel checkpoint.** `SaveData.crisis?: CrisisSnapshot | null`. Tre stati distinti:
   `undefined` = snapshot precedente a questa versione (non si ripristina nulla);
   `null` = nessuna crisi registrata a quel punto (**è un fatto**: partita giocabile);
   oggetto = stato esatto da ripristinare.
2. **Al restore.** `GamePersistenceService.loadFromSave` chiama `afterRestore({ crisis })` **dopo il
   commit** e dopo l'eventuale apertura del nuovo ramo; `restoreCrisisState()` scrive giorni, avvertimenti,
   livello, epilogo, turno e data **sul ramo ora corrente** e riallinea `ending`/`status`
   (`replaceEnding: true`: l'assenza di epilogo nello snapshot non è un dato mancante da conservare).
3. **Rewind.** `resetCrisisState` resta **solo** come rete di sicurezza per gli snapshot legacy
   (che non contengono la crisi): un rewind moderno ci scrive subito sopra lo stato esatto.
4. **Per ramo.** `game_crisis_state` → `PRIMARY KEY (game_id, branch_id)`, `branch_id` risolto da
   `games.head_branch_id` (`crisisBranchId`, ripiego `main`) — **lo stesso identificatore** di agenda
   NPC, commitments e memoria delle fazioni. Nessun secondo modello di branching. Due rami dallo stesso
   checkpoint hanno crisi indipendenti (verificato).
5. **Retrocompatibilità di lettura.** `getCrisisState` ripiega su `main` quando il ramo corrente non ha
   ancora il proprio stato: una riga rimasta su `main` continua a essere leggibile.

### Collasso brusco — percezione prima del game over

La regola non è stata cambiata: `CRISIS_COLLAPSE_DAYS = 90`, `CRISIS_ABRUPT_DAYS = 180`,
`CRISIS_MIN_EPISODES = 2` restano. Il collasso **non è più improvviso** nei percorsi scaglionati:
valutando la crisi **dentro** il passo e **prima** della cattura del checkpoint, lo stato aggiornato
finisce nel checkpoint che il giocatore vede, quindi il pericolo è leggibile (e il checkpoint
ripristinabile con "Intervieni") prima dell'eventuale caduta. Con un **salto unico** da 180 giorni in
piena criticità il game over resta immediato: è una **scelta intenzionale**, non un difetto (test
dedicato: 179 giorni non bastano, 180 sì).

---

## 3. File modificati

**Motore e stato**
- `src/game/NationStateService.ts` — `crisisElapsedDays(previous, periodDays)`, `evaluateCrisis(advance, periodDays)`
- `src/game-session.ts` — `SaveData.crisis`, `crisisSnapshot()`, `restoreCrisisState()`, `afterRestoreState(restored)`, `evaluateCrisis(advance, periodDays)`, `advanceDate` → `evaluateCrisis(true, days)`, wiring dei quattro contesti
- `src/database.ts` — `game_crisis_state` con `branch_id` + PK composta, colonne `*_episodes` nella definizione, migrazione additiva
- `src/repositories/game.repository.ts` — `crisisBranchId`, `getCrisisState(gameId, branchId?)` (con ripiego `main`), `saveCrisisState(record, { replaceEnding })`, `resetCrisisState(gameId, branchId?)`, tipo `CrisisSnapshot`
- `src/repositories/index.ts` — export `CrisisSnapshot`
- `src/game/GamePersistenceService.ts` — `afterRestore({ crisis })`
- `src/game/TurnPipelineService.ts` — `evaluateCrisis(advance?, periodDays?)`; la crisi riceve `period.elapsedDays`
- `src/game/PlaybackService.ts` — la crisi avanza nei giorni del passo, prima del checkpoint
- `src/game/LiveTickService.ts` — la crisi avanza di `LIVE_TICK_DAYS`

**Test**
- `tests/crisis-residual.test.ts` (nuovo, 10 test)
- `tests/crisis-migration.test.ts` (nuovo, 3 test)
- `tests/routes-playback.test.ts` (+1: la crisi nel playback scaglionato)
- `tests/gameplay-long-integration.test.ts` (fixture con codici senza fatti moderni: vedi §7)

Nessuna migrazione distruttiva, nessuna tabella nuova, nessun motore parallelo, nessun orologio nuovo.

---

## 4. Migrazione del database

Additiva, idempotente, con ripiego per le righe legacy:

1. `CREATE TABLE IF NOT EXISTS` con `branch_id TEXT NOT NULL DEFAULT 'main'` e `PRIMARY KEY (game_id, branch_id)`;
2. le colonne `revolt_episodes`/`insolvency_episodes`/`invasion_episodes` sono aggiunte **prima** della
   ricostruzione, così la tabella legacy è già completa quando la si copia;
3. se `branch_id` manca (`PRAGMA table_info`): `RENAME TO game_crisis_state_legacy` → ricreazione →
   `INSERT … SELECT` copiando **tutte** le colonne e assegnando `COALESCE(games.head_branch_id, 'main')`
   → `DROP TABLE game_crisis_state_legacy`. Nessuna riga cancellata, nessun giorno perso.

**Verifica su dati reali** (copia di `data/open-pax.db`, sonda temporanea poi rimossa): **9 righe su 9
conservate**, ciascuna passata al ramo corrente della propria partita (`head_branch_id`), con
`overall`/giorni/avvertimenti intatti; nessuna riga finita su `main` perché tutte le partite avevano già
un ramo (la partita `c535d3348283` conservava 1 giorno critico su rivolta e 1 su insolvenza, che il
difetto P0.1 non aveva contato).

Nota di limite: prima della separazione per ramo la crisi era **una per partita**; la riga legacy va al
ramo corrente della partita. Non esisteva nulla da distribuire fra più rami, quindi non si perde storia.

---

## 5. Test

**Nuovi — `tests/crisis-residual.test.ts` (10)**

| # | Test |
|---|---|
| 1 | partita nuova in crisi + salto di 180 giorni → 180 giorni critici (non 0) |
| 2 | partita nuova + salto di 7 giorni → 7 giorni |
| 3 | stessa semantica per salto con ordini e battito del mondo (7 giorni) |
| 4 | partita nuova non critica + salto di 180 giorni → nessun accumulo a pieno regime (al massimo il logoramento d'allarme), nessun game over, `updatedDate` = data raggiunta |
| 5 | T10 = 55 → T11 = 85 → rewind torna **esattamente** a 55, con avvertimenti e data del punto |
| 6 | rewind da game over → partita di nuovo giocabile, collasso rimosso, crisi precedente ripristinata (non azzerata) |
| 7 | save/load conservano giorni, avvertimenti e data |
| 8 | due rami dallo stesso checkpoint: A peggiora, B no → giorni diversi, nessuno tocca l'altro |
| 9 | scenario di accettazione completo: nuova partita → salto → save → turno → rewind → rami A/B → load |
| 10 | regola del collasso brusco: 179 giorni critici non bastano, 180 sì (intenzionale) |

**Nuovi — `tests/crisis-migration.test.ts` (3)**: PK `(game_id, branch_id)` e nessuna riga persa;
riga legacy passata al ramo corrente con giorni/avvertimenti/epilogo intatti; riga rimasta su `main`
ancora leggibile dal ramo corrente.

**Estesi**: `tests/routes-playback.test.ts` (+1) — il playback scaglionato fa avanzare la crisi dei
giorni di **ogni** passo e aggiorna la data della valutazione al checkpoint mostrato.

**Quality gate realmente eseguito**

| Verifica | Esito |
|---|---|
| test mirati (`crisis-residual`, `crisis-migration`, `routes-playback`, `nation-crisis`, `player-levers`, `gameplay-long-integration`) | **6 file / 54 test verdi** |
| suite backend completa | **146 file / 1282 test verdi** |
| suite frontend completa | **57 file / 399 test verdi** |
| `tsc --noEmit` backend e frontend | puliti |
| build backend (`tsc`) e frontend (`vite build`) | OK |
| e2e mock (Playwright) | **33/33 verdi** |
| migrazione su copia del DB reale | 9 righe su 9 conservate |
| frontend | **non modificato** (nessun file): la crisi esposta non cambia forma |

---

## 6. Freeze

- `core/simulation/NationCrisis.ts`: **non toccato** (calcolo puro invariato) — le costanti
  `CRISIS_COLLAPSE_DAYS`/`CRISIS_ABRUPT_DAYS`/`CRISIS_MIN_EPISODES` restano quelle autorizzate da
  GAMEPLAY-LONG.
- `TurnPipelineService`: toccato **al minimo** — solo la firma di `evaluateCrisis` e il passaggio di
  `period.elapsedDays` (nessun cambio di flusso, ordine o transazione).
- `GameSession`, schema DB, `repositories`, semantica dei checkpoint: toccati **per il minimo**
  autorizzato dal task (la crisi entra nel checkpoint e diventa per ramo); nessun'altra grandezza
  cambiata, nessuna migrazione distruttiva, nessun `branch_id` nuovo altrove.
- Non toccati: memoria delle fazioni (**non modificata** — nessun file), agenda NPC, commitments,
  pressioni di pace, diplomazia, eventi causali, interfaccia generale.
- `PlaybackService` e `LiveTickService`: due righe ciascuno, con la stessa semantica degli altri
  percorsi (nessuna nuova architettura).

---

## 7. Limiti dichiarati

1. **Salvataggi precedenti**: uno snapshot senza `crisis` non ripristina la crisi (per lui resta il
   `resetCrisisState` di sicurezza). Caricare un salvataggio molto vecchio in una partita la cui crisi
   è più avanti lascia la crisi dov'era: **non** un azzeramento. Documentato, non aggirato.
2. **Partite moderne e debito baseline**: la fixture `ITA` con fatti moderni è **strutturalmente critica
   sull'insolvenza** dal primo turno, quindi con la correzione P0.1 una partita moderna nuova **cade
   dopo 90 giorni critici**. È il comportamento voluto della regola; per non rendere fragili i test di
   integrazione GAMEPLAY-LONG (che non riguardano la crisi) la loro fixture usa ora codici **senza
   fatti moderni** (`ROM`/`GAL`/`GER`). La bilanciatura del debito baseline di un mondo moderno è una
   scelta di design **fuori** da questo task.
3. **Playback e battito live**: valutano la crisi per passo/battito. Se la nazione cade durante un run
   in pausa, il run resta in pausa e la partita è chiusa: l'epilogo è diffuso subito, il tick successivo
   non parte più. Nessun automatismo nuovo per chiudere il run.
4. **Doppio conteggio**: impossibile per costruzione (dopo il primo passo la data persistita è l'ancora
   e il secondo passo misura `0`). Verificato nel test del playback.
5. **Due rami sullo stesso checkpoint**: la crisi è indipendente, ma l'hash del salvataggio include lo
   stato di crisi: un salvataggio scritto prima di questa versione resta caricabile (niente da
   ripristinare) mentre i nuovi salvataggi portano la crisi nello stato firmato.
6. `world advance`/job in background, coda autorevole e outbox: **non toccati**.

---

## 8. Cosa cambia in una partita vera

- **Inizio partita**: un salto lungo di 7, 30, 90, 180 o 365 giorni **conta i giorni veri** dal primo
  avanzamento. La crisi non parte più con un anno di ritardo.
- **Salto scaglionato**: ogni checkpoint porta con sé la crisi aggiornata a quella data → il giocatore
  vede il pericolo salire e può "Intervieni" **prima** del collasso.
- **Rewind**: T10 con 55 giorni critici → T11 con 85 → rewind torna a **55**, con gli stessi
  avvertimenti, lo stesso livello e la stessa data. Da game over si torna a giocare con lo stato di
  crisi precedente, non con un foglio bianco.
- **Rami**: due diramazioni dallo stesso punto possono divergere — una risolve la crisi, l'altra
  peggiora — senza toccarsi.
- **Salvataggi**: `criticalDays`, `episodes`, `overall`, `updatedTurn`, `updatedDate` ed epilogo sono
  parte dello stato firmato e tornano identici al load.
