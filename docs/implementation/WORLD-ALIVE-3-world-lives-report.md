# WORLD-ALIVE / PARTE 3 — Il mondo deve vivere: diagnosi e intervento minimo

Branch: `feat/world-alive-conflicts` · Base: `main` @ `56cc7e4`.
Classe: **B/C** — riuso di sistemi esistenti + un'estensione deterministica
piccola nel livello `src/game/`. **Nessuna modifica a `core/simulation/**`.**

---

## FASE 1 — DIAGNOSI (prima di scrivere codice)

### 1. Dove e con che frequenza viene chiamato `processNPCTurns`

| punto | evidenza | verità |
| --- | --- | --- |
| `NpcTurnService.processNPCTurns(limit=3, days=30)` | `src/game/NpcTurnService.ts:54` | implementazione completa (sviluppo/guerra via LLM + `canNpcCapture`) |
| `GameSession.processNPCTurns` | `src/game-session.ts:1803` | **wrapper privato mai chiamato in produzione** |
| chiamate reali | `grep -rn processNPCTurns src` | **solo test** (`tests/stage2.test.ts:369`, `tests/npc-turn-service.test.ts`) |
| tick live | `LiveTickService.worldTick` (`src/game/LiveTickService.ts`) | **non chiama gli NPC**: commento esplicito «Il battito live non deve attendere una chiamata LLM» |
| parametri tick live | `GameSession.LIVE_TICK_MS = 30000`, `LIVE_TICK_DAYS = 7` (`game-session.ts:465-466`) | 7 giorni di gioco ogni 30 s reali |
| turno del giocatore | `TurnPipelineService` (`src/game/TurnPipelineService.ts:561-562`) | `npcEvents` e `randomEvents` sono **array vuoti hardcoded** |

**Conclusione 1:** in produzione `processNPCTurns` **non viene mai eseguito**. Il
mondo non prende turni NPC né nel tick live né nel turno del giocatore.

### 2. Come nasce oggi lo stato `hostile`

| sorgente | evidenza | runtime? |
| --- | --- | --- |
| diplomazia del giocatore (`improve`/`degrade`) | `game-session.ts` (effetto pressione `relationship`) | ✅ sì |
| `SimulationEngine.resolveAttack`/`processNPCTurn` (`relationships.degrade`) | `src/core/simulation/SimulationEngine.ts:271,615` | ❌ **no**: `new SimulationEngine` compare **solo nei test** |
| simulazione LLM del turno (`relationshipChanges`) | `TurnPipelineService.ts:480` → `matrix().set(...)` | ✅ sì (solo su turno del giocatore) |

Quindi: **una relazione diventa `hostile` solo se la imposta il giocatore o la
LLM durante un turno con ordini.** Nel tick live (nessun ordine) non nasce mai
nuova ostilità.

### 3. Una guerra può essere *dichiarata* dal mondo?

- **No, per politica dichiarata:** `src/npc-agents.ts:147` —
  *«"war" è ammesso solo contro vicini con rapporto "hostile" già registrato;
  non dichiarare nuove guerre»*; e `src/core/simulation/npc-policy.ts:41-45`
  (`canNpcCapture`) richiede `relationship === 'hostile'`.
- **Sì, indirettamente, via LLM:** il prompt di simulazione
  (`src/prompts/simulation/prompt.ts:148,151`) chiede iniziative NPC offensive e
  `mapChanges.transfer` → `worldChanges.regionOwners`. Quindi durante un turno
  con ordini la LLM *può* far muovere il mondo.
- **No, in modo deterministico:** l'unico motore deterministico che lo farebbe
  (`SimulationEngine.processNPCTurn`) **non è istanziato**.

### 4. Gli NPC spostano truppe / fanno offensive?

- Nessun movimento di truppe come meccanica deterministica. Le formazioni
  esistono solo come `objects` prodotti dalla LLM (`WorldMutationService.applyFrontierPlacements`).
- La conquista esiste come effetto reale: `transferRegion` + `regionOwners`
  (`WorldMutationService.applyWorldChanges`). Percorso completo
  decisione → effetto: **solo LLM → `mapChanges`/`worldChanges` → `transferRegion`**.
- Nel tick live, `changedRegions` cambia **solo** popolazione/PIL/prontezza: mai
  `owner`. La mappa non si muove mai da sola.

### Cosa esiste già / cosa manca davvero

| esiste | manca |
| --- | --- |
| `NpcTurnService` con azioni, timeout, `transferRegion` | **una chiamata** a `processNPCTurns` dal ciclo di gioco |
| `canNpcCapture` (confine reale + ostilità) | la capacità degli NPC di **aprire** nuove ostilità |
| `RelationshipMatrix.degrade` (API esistente) | un passo **deterministico** che degrada le relazioni ai confini |
| `transferRegion`, diff `changedRegions`, SSE `world_event`, mappa, timeline, dispacci | nulla: la visibilità c'è già, **non arrivano eventi da mostrare** |
| `SimulationEngine` (motore causale) | il wiring a runtime (oggi è codice morto) |

**Causa reale del mondo statico:** il battito live è un battito **solo
economico**; gli NPC non agiscono e nessuno crea nuove ostilità fuori dal turno
del giocatore. Non è un bug: è una scelta di progetto (evitare la latenza LLM nel
tick), che però lascia il mondo militarmente immobile.

---

## FASE 2 — INTERVENTO MINIMO

**Il mondo si muove nel tick live, in modo deterministico e senza LLM**, riusando
le politiche esistenti. Nessun nuovo motore, nessuna duplicazione.

### `NpcTurnService.processWorldConflictTick(days)` — nuovo metodo

1. **Escalation (aprire nuove guerre):** al più **una per tick**, solo fra
   politie **NPC** (mai aperta contro il giocatore), quando il rapporto è
   `neutral`, l'attaccante ha un vantaggio militare reale
   (`> 1.4×`, `WAR_OPEN_ADVANTAGE`) e il tiro deterministico passa
   (`WAR_OPEN_CHANCE = 0.05`). Effetto: `degradeRelationship` (cioè
   `RelationshipMatrix.degrade`, API **già esistente**).
2. **Continuazione (conquista):** al più **una per tick**, su un rapporto
   realmente `hostile` e un **confine reale**, con le **stesse** politiche del
   percorso LLM — `canNpcCapture(...)` e rapporto di forze
   (`difensore < attaccante × 0.7`) — e lo **stesso** `transferRegion`.

Determinismo: semi `stableRoll(`${gameId}|war-open|${turn}`)` e
`|conquest|${turn}` (`stableRoll` è la funzione pura già usata da
`game-session.ts`). Nessun `Math.random`, riproducibile per partita+turno.

### Visibilità (riuso totale del plumbing esistente)

`LiveTickService.worldTick` chiama il nuovo passo **dentro il lock**, dopo
l'economia e **prima** del diff: le conquiste finiscono quindi in
`changedRegions` → SSE `world_event` → `useSimulationStream` aggiorna mappa,
timeline e dispacci. **Zero modifiche al frontend.**

---

## CORE ENGINE FREEZE — conferma

`core/simulation/**` **non è stato modificato**:

- `src/core/simulation/npc-policy.ts` → **solo import** di `indexPolities` e
  `canNpcCapture` (funzioni pure esportate);
- `stableRoll` → **solo import** da `core/simulation/MilitaryProduction.ts`;
- `SimulationEngine`, `TurnOrchestrator`, `TurnPipelineService`,
  `SessionStateStore` e le semantiche dei checkpoint: **intatti**;
- nessuna migrazione, nessun cambio di schema, nessuna modifica agli store
  Zustand o all'economia.

L'estensione vive in `src/game/NpcTurnService.ts` (non congelato) e usa le
relazioni e `transferRegion` già esistenti. **Non è servito sbloccare il freeze.**

---

## File modificati

| file | intervento |
| --- | --- |
| `backend-nest/src/game/NpcTurnService.ts` | nuovo `processWorldConflictTick`; contesto esteso con `seed` e `degradeRelationship` (opzionali) |
| `backend-nest/src/game/LiveTickService.ts` | chiama `applyWorldConflicts()` dentro il tick e unisce gli eventi a dispacci/timeline (dettagli per riga) |
| `backend-nest/src/game-session.ts` | wiring di `seed`/`degradeRelationship`; nuovo `applyWorldConflicts()` |
| `backend-nest/tests/world-conflict-tick.test.ts` | **nuovo** — 7 test deterministici (escalation, conquista, limiti, replay) |
| `backend-nest/tests/stage2.test.ts` | +1 test d'integrazione: conflitto ostile → conquista visibile in mappa e dispacci |
| `docs/implementation/WORLD-ALIVE-3-world-lives-report.md` | questo report |

---

## Test eseguiti (esito reale)

| verifica | comando | esito |
| --- | --- | --- |
| Backend test | `cd backend-nest && npx vitest run` | **1135 passed / 132 file** (erano 1127/131) |
| Frontend test | `cd frontend && npx vitest run` | **318 passed / 49 file** |
| TypeScript backend | `cd backend-nest && npx tsc --noEmit` | exit 0 |
| TypeScript frontend | `cd frontend && npx tsc --noEmit` | exit 0 |
| Build backend | `cd backend-nest && npm run build` | exit 0 |
| Build frontend | `cd frontend && npm run build` | exit 0 |
| E2E mock | `npm run test:e2e:mock` | **23 passed** |

Copertura nuova (reale, non dichiarata):
- `tests/world-conflict-tick.test.ts`: nessuna frontiera → nessun evento;
  escalation NPC↔NPC con vantaggio reale; **mai** nuova guerra contro il
  giocatore; conquista su fronte ostile con `transferRegion`; nessuna conquista
  se il difensore non è più debole; **al più una guerra e una conquista per
  tick**; stesso seme+turno ⇒ stesso esito (determinismo).
- `tests/stage2.test.ts` (integrazione): con POL ostile e confinante, il tick
  live produce la conquista, la regione cambia `owner`, il cambio compare in
  `changedRegions` e nei dispacci, e `eventDetails.length === events.length`.

---

## Limiti residui

1. **Le nuove guerre fra NPC richiedono un vantaggio militare e passano con
   probabilità bassa** (5%/tick ≈ una ogni ~10 min reali): il mondo è vivo ma
   graduale, non caotico. Le soglie (`WAR_OPEN_CHANCE`, `CONQUEST_CHANCE`,
   `WAR_OPEN_ADVANTAGE`) sono costanti di classe, facili da tarare.
2. **Il giocatore non è mai attaccato «a freddo»**: solo la *continuazione* di un
   conflitto già `hostile` può conquistare una sua provincia. Le nuove guerre
   NPC→giocatore restano compito della simulazione LLM/diplomazia.
3. **Nessuna diplomazia NPC→NPC al di fuori della guerra** (patti, tregue,
   negoziati) in questo passo: `improve` resta solo LLM/giocatore.
4. **`SimulationEngine` resta codice morto a runtime.** È il candidato naturale
   per un mondo *causale* più ricco (marcia, perdite, fronti), ma il wiring al
   ciclo di gioco è un intervento sul motore: **non fatto**, come da freeze. Se
   si vuole, è una fase a sé con propria valutazione.
5. **`processNPCTurns` (LLM) resta non chiamato in produzione.** È
   voluto: la LLM nel tick bloccherebbe il lock per fino a 12 s per politia.
   Riattivarlo (es. in un tick separato fuori dal lock) è una fase a sé.

### Nota tecnica — esbuild (classe D, valutata e non applicata)

Verificato il blocco: `backend-nest/node_modules/@esbuild/darwin-x64/bin/esbuild`
è la **0.27.4** (richiede macOS ≥ 12) mentre la macchina è 11.7.10; l'`overrides`
del `package.json` **root** (`esbuild: 0.21.5`) non raggiunge il workspace
`backend-nest`. Non ho modificato la toolchain in questa PR per non riscrivere il
lockfile/mischiare un tema di build con il motore del mondo. Proposta per una PR
dedicata: aggiungere `"overrides": { "esbuild": "0.21.5" }` in
`backend-nest/package.json` e reinstallare. I test (vitest) **non** sono
bloccati: sono stati eseguiti realmente.
