# LW06.1 — Correzioni e immersione: report

**Obiettivo.** Correggere i bug residui di LW01–LW06 e aumentare l'immersione
usando **solo** dati già prodotti dal motore, portando le informazioni vicino al
momento decisionale. Principio: `ENGINE DATA → READ MODEL → UI`. Nessun nuovo
motore, nessuna migrazione, nessun refactor del core.

Branch: `fix/lw061-correzioni-immersione` · Base: `main`.

---

## 1. Problemi trovati

### BUG 1 — Falsa tesoreria nel briefing
`frontend/src/components/Game/strategicBriefing.ts`, sezione «Cassa, saldo e
debito»: la tesoreria veniva letta con `num(account.money)`, dove
`num(undefined) === 0`. In una partita in cui la cassa è pubblicata solo dal
magazzino materiale (`resources.money`, come fa `recordAccountSnapshot` →
`materialEconomy`), `account.money` è assente: il briefing vedeva `0` e
generava **«Tesoreria quasi esaurita» / «Tesoreria in scoperto»** senza alcun
dato reale.

### BUG 2 — Delta associati al turno sbagliato
`frontend/src/components/Game/checkpointImpact.ts`, `impactsByTurn()`,
confrontava coppie adiacenti e usava come chiave il `turn` dello snapshot
**successivo**. Verifica sul codice reale e sul DB (`backend-nest/data/open-pax.db`):

| Percorso | Quando cresce `currentTurn` | `turn` dello snapshot | `turn` Timeline | Esito |
|---|---|---|---|---|
| `TurnPipelineService` (turno ordinario) | **dopo** lo snapshot (`this.state.currentTurn++` a riga ~716) | T | T | ok |
| `PlaybackService` (run/checkpoint per-evento) | **prima** (`state.currentTurn = state.jumpTurn + 1`) | jumpTurn + 1 | jumpTurn | **off-by-one** |
| `GameSession.advanceDate` (legacy) | **prima** (`this.currentTurn++` prima di `recordAccountSnapshot`) | T + 1 | T | **off-by-one** |

Inoltre il playback registra **più snapshot per lo stesso turno** (uno per
evento, `advanceWorldState(elapsedDays, eventDate)`), mentre la Timeline ha più
entry con lo stesso `jumpTurn`: la vecchia `impactsByTurn` sovrascriveva le
transizioni intra-turno e le attribuiva al turno incrementato. Requisito violato:
aprendo un evento comparivano gli effetti del turno sbagliato.

### BUG 3 — World Presence usava gli eventi più vecchi
`frontend/src/components/Game/worldPresence.ts` usava
`feedItems.slice(0, limit)`. Il feed (`hooks/useFeed.ts`) è **cronologico
vecchio → nuovo**: gli elementi nuovi sono aggiunti in coda (`[...prev, item]`).
Quindi venivano scelti i dispacci **più vecchi**, non i recenti.

### Gap di immersione (MIGLIORIE)
- **M1**: il briefing viveva solo nel Dossier Nazione.
- **M2**: la Timeline mostrava delta, ma il `SimulationEventReader` (il momento
  in cui il tempo si ferma e si sceglie «Evento successivo»/«Intervieni») no.
- **M3**: da verificare che il «Piano» mostrasse ordini realmente pending e che
  la CTA usasse `onTimeSkip`.
- **M4**: `worldPresence` emetteva messaggi territoriali generici anche quando
  esisteva un dispaccio reale più informativo.

---

## 2. Correzioni applicate

### BUG 1 — Fix (classe **A**)
Introdotto `optionalNumber()` (`null` quando il campo non è pubblicato) e
precedenza di lettura esplicita: `resources.money` → `account.money` → nessuno.
Il warning sulla tesoreria compare **solo** se esiste un valore reale.

- **Prima:** `resources.money` ignorato; `account.money` assente → cassa `0` → warning falso.
- **Dopo:** `resources.money` preferito; fallback a `account.money`; nessun warning se assenti.

### BUG 2 — Fix (classe **A/B**)
`impactsByTurn(history, timeline?)`:
1. raggruppa gli snapshot consecutivi con lo **stesso** `turn` (aggregazione del turno);
2. associa la transizione BEFORE → AFTER al turno della Timeline la cui **data di
   fine coincide** con la data dello snapshot (`turnByDate`), indipendente dalla
   convenzione di `turn` (niente `turn - 1` hardcoded);
3. senza Timeline (retrocompatibile) ripiega sul turno dello snapshot.

Aggiunta `deriveImpactAtDate(history, date)` per il checkpoint in lettura: delta
**solo** se il motore ha registrato un punto a quella data, altrimenti `null`.

- **Prima:** chiave = `snapshot.turn` (incrementato nel playback/legacy) → effetti spostati; turni con più snapshot collassati.
- **Dopo:** chiave = turno reale che ha prodotto la transizione; aggregazione per turno; nessun effetto del turno successivo.

### BUG 3 — Fix (classe **A**)
Il feed viene letto dalla coda (`[...feedItems].reverse()` = dal più recente) e si
raccolgono fino a `limit` eventi rilevanti dai più nuovi.

- **Prima:** `slice(0, limit)` → i più vecchi.
- **Dopo:** gli ultimi `limit` rilevanti, presentati dal più recente.

### MIGLIORIA 1 — Briefing compatto (classe **B**)
- Derivazione **unica** in `GameScreen` (`deriveStrategicBriefing` chiamata una
  sola volta); `NationDock` è ora puramente presentazionale (`briefing` prop).
- Nuovo `CompactBriefing.tsx`: striscia compatta sotto la HUD, stato
  («RICHIEDE ATTENZIONE» / «DA MONITORARE» / «SOTTO CONTROLLO»), massimo 3 voci
  (critiche/attenzione/opportunità, ordinate per gravità), CTA **«Apri dossier»**
  (`openModule('nation')`), dismissibile; **nascosta** quando non c'è nulla di
  azionabile. Nessun «Agisci» (avrebbe richiesto nuova architettura).
- Nuova funzione pura `compactBriefing(briefing, maxItems)`.

### MIGLIORIA 2 — Variazioni nel SimulationEventReader (classe **B**)
- `GameScreen` deriva `checkpointImpact` con `deriveImpactAtDate(nationalHistory,
  pausedReader.event.date)` e lo passa come prop `impact`.
- `SimulationEventReader` mostra «**Variazioni registrate nel periodo**» con i
  delta reali, **solo** quando `impact.hasChanges`. Dicitura e nota esplicita
  **non causali** («Delta del turno dai conti registrati dal motore; non un
  giudizio di causa»).
- **Nessun** cambiamento a checkpoint / revision / simulationId / continue /
  intervene / restore / proprietà del run; nessuna nuova API.

### MIGLIORIA 3 — Ordini: verifica, nessuna modifica
Verificato: `pendingOrders` in `TimeDesk` proviene da `pendingActions`
(`gameStore`, popolato da `useOrderQueue` con gli ordini realmente registrati);
la CTA «Esegui piano e avanza» continua a chiamare `beginSkip(0)` → `onTimeSkip`;
registrazione (`registerOrder`) e avanzamento restano distinti. **Non
rifattorizzato.**

### MIGLIORIA 4 — World Presence (classe **A/B**)
Ordine di preferenza: **evento reale dal feed** (scontri, poi diplomazia) →
**cambiamento territoriale** (solo se il feed non offre notizie) → nessun fatto
inventato. Etichette territoriali più informative (luoghi + eventuale potenza
ostile). Nessuna nuova simulazione internazionale.

---

## 3. File modificati

**Modificati**
- `frontend/src/components/Game/strategicBriefing.ts` — BUG 1 + `compactBriefing`.
- `frontend/src/components/Game/checkpointImpact.ts` — BUG 2 + `deriveImpactAtDate`.
- `frontend/src/components/Game/worldPresence.ts` — BUG 3 + MIGLIORIA 4.
- `frontend/src/components/Game/GameScreen.tsx` — derivazione unica briefing, `CompactBriefing`, prop `impact`, `briefing` a `DeskContent`.
- `frontend/src/components/Game/HudBar.tsx` — `impactsByTurn(history, timelineRefs)`.
- `frontend/src/components/Game/NationDock.tsx` + `NationDock/types.ts` — briefing come prop.
- `frontend/src/components/Shell/DeskContent.tsx` — `briefing` prop (rimosso `worldFacts`).
- `frontend/src/components/Game/SimulationEventReader.tsx` — prop `impact` + sezione variazioni.
- `frontend/src/index.css` — stili `.compact-briefing`, `.simulation-reader-impact`.
- Test aggiornati: `strategicBriefing.test.ts`, `checkpointImpact.test.ts`, `worldPresence.test.ts`, `timeDeskPlan.test.ts`.

**Aggiunti**
- `frontend/src/components/Game/CompactBriefing.tsx`
- `frontend/src/components/Game/compactBriefingUi.test.ts`
- `frontend/src/components/Game/simulationReaderImpact.test.ts`
- `docs/implementation/LW06-1-report.md`

---

## 4. Conferma CORE ENGINE FREEZE

**Nessun componente congelato è stato toccato.** Per questa PR **non** è stato
modificato alcun file backend: nessuna modifica a
`backend-nest/src/core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, `repositories`, schema/DB, semantica
checkpoint, simulation run, `useSimulationPlayback` né alla pipeline di
avanzamento. Nessun nuovo motore, nessun nuovo stato di gioco, nessuna
migrazione.

---

## 5. Test eseguiti (esito reale)

| Comando | Esito |
|---|---|
| `npm --prefix backend-nest test` | **1097 passed / 129 file** |
| `frontend ../node_modules/.bin/vitest run` | **279 passed / 46 file** |
| `frontend ../node_modules/.bin/tsc --noEmit -p tsconfig.json` | **0 errori** |
| `npm run build` (frontend + backend) | **OK** |
| `e2e: playwright test` (mock) | **17 passed** |
| `e2e: playwright test --config=playwright.a11y.config.mjs` | **3 passed** |

Nuovi test mirati:
- **strategicBriefing**: preferenza `resources.money`; negativa da resources;
  fallback `account.money`; tesoreria assente → nessun warning.
- **checkpointImpact**: allineamento (snapshot al turno successivo → turno 1),
  sequenza multipla, evento più recente, aggregazione multi-snapshot, percorso
  legacy `advanceDate`, assenza di `turn`, `deriveImpactAtDate` (match/null).
- **worldPresence**: feed cronologico → ultimi eventi (5 eventi, limit 3),
  filtro guerra/diplomazia, precedenza della notizia reale sul territoriale,
  cambiamento territoriale con luoghi.
- **SimulationEventReader**: impatto presente/assente, dicitura non causale,
  continue/intervene/revision/checkpoint invariati.
- **Briefing compatto**: massimo voci, priorità ordinate, CTA «Apri dossier»,
  nessuna duplicazione della derivazione (una sola chiamata in `GameScreen`).

---

## 6. Risultati

Tutti i criteri di successo soddisfatti:
- briefing **senza falsi warning** sulla tesoreria;
- effetti Timeline **allineati al turno corretto** (date-match, aggregazione);
- World Presence usa gli **eventi recenti** e preferisce le notizie reali;
- briefing **percepibile senza aprire il Dossier** (striscia compatta in HUD);
- `SimulationEventReader` mostra **variazioni reali** quando disponibili;
- **nessuna causalità inventata**; **nessun nuovo motore**; core **congelato**;
- **tutti i test verdi** (backend, frontend, tsc, build, E2E mock, a11y).

---

## 7. Limiti residui

- **BUG 2 — dati storici sporchi**: partite con snapshot registrati durante run in
  pausa poi abbandonati (es. `3c74d67d81c8` nel DB locale) possono contenere punti
  con date future rispetto a `current_turn`; la presentazione li ignora o li
  aggancia per data, ma **la pulizia dello storico è responsabilità del motore**
  (congelato) e **non** è stata toccata.
- Il match per data richiede che la Timeline esponga le entry; la chiamata senza
  Timeline ripiega sul turno dello snapshot (comportamento legacy documentato).
- La striscia compatta mostra al massimo 3 voci e non offre azioni dirette
  («Agisci» rimandato per non introdurre nuova architettura).
- Il `deriveImpactAtDate` mostra i delta **solo** per date esatte presenti nello
  storico; per checkpoint senza punto non mostra nulla (scelta intenzionale,
  niente stime).
- E2E eseguiti in locale su Chrome di sistema; la CI esegue gli stessi con
  Chromium.

---

## 8. Proposte per la fase successiva (non implementate)

1. **Pulizia/segmentazione dello storico conti** sul ramo attivo (motore), per
   eliminare i punti dei run abbandonati.
2. **Causalità esplicita opzionale dal backend** (`eventId` → effetti) per poter
   usare diciture causali solo quando il motore le conosce davvero.
3. **CTA «Agisci»** dal briefing compatto (bozza d'ordine contestuale) — richiede
   un piccolo ponte verso il compositore, da progettare.
4. Memoria NPC, fog of war, intelligence completa, treaty engine, agenda
   strategica AI, obiettivi di vittoria: **rinviati**, come da vincolo.
