# GAMEPLAY-LONG — Gameplay di medio-lungo periodo (partite 30–50+ turni)

Branch: `feat/gameplay-long` (da `8716d26`, CHAT-ORDER). Commits:
`40ee966` (P0) · `a14239a` (P0.2 pressioni + P2) · `c3a2f62` (P1 fazioni) ·
`271b058` (P1/P2 agenda NPC) · `ed5468b` (P1 impegni) · `0f1a87a` (P2 eventi
causali) · `812c49b` (e2e).

Principio rispettato in ogni passo: **ENGINE DATA → SIMULAZIONE → LLM COME
INTERPRETE/NARRATORE → UI**. Nessun motore parallelo, nessun secondo stato del
mondo, nessuna riscrittura di `GameSession` o della UI: solo estensioni
incrementali di codice esistente più funzioni pure testabili.

---

## 1. DIAGNOSI INIZIALE (FASE 1)

**File coinvolti (letti prima di scrivere codice).** `core/simulation/NationCrisis.ts`,
`core/simulation/PeacetimePressures.ts`, `core/simulation/GovernmentFactions.ts`,
`core/simulation/WorldStateEngine.ts`, `game/NationStateService.ts`,
`game/NpcTurnService.ts`, `game/WorldIntelService.ts`, `game/HistoryService.ts`,
`game/TurnPipelineService.ts`, `game/PlaybackService.ts`, `game/DiplomacyService.ts`,
`game-session.ts`, `repositories/game.repository.ts`, `prompts/simulation/*`,
`data/presets/modern_world_provinces/*`, `frontend/src/components/Game/*`.

**Strutture già riutilizzabili.** `WorldStateEngine.advance` (tempo→cifre),
`TurnPipelineService` (pipeline del turno e punto di innesco), `NationStateService`
(lifecycle delle pressioni), `HistoryService` (consolidamento cronaca),
`GovernmentFactions.governmentSnapshot` (stato derivato dai numeri),
`NpcTurnService` (politiche NPC e eventi del tick), `WorldIntelService`
(contesto strategico già calcolato), pattern append-only dei repository
(`game_pressures`, checkpoint/rewind), read model puri già usati dalla UI.

**Rischi di regressione individuati.** (a) cambiare la semantica
`turni→giorni` poteva rompere i salvataggi (`*_streak` già in tabella);
(b) il collasso su soglia di giorni poteva produrre game over improvvisi;
(c) qualunque nuova chiamata LLM per turno avrebbe inciso su costo/latency;
(d) mutare cifre del mondo dentro il generatore di eventi avrebbe creato un
secondo motore economico silenzioso; (e) allargare il contesto narrativo non è
possibile (consolidamento a ~220 parole).

**Piano minimo di implementazione (eseguito).** 1) coerenza temporale del preset;
2) crisi e pressioni misurate in **giorni di calendario** con fallback
retro-compatibile; 3) memoria politica delle fazioni come **termine di pressione
limitato**, non sostituto dei dati; 4) agenda NPC derivata dallo stato,
rivalutata **una volta per turno** e memoizzata; 5) **registro strutturato**
degli impegni (la cronaca racconta, il registro ricorda); 6) priorità/rumore nel
briefing; 7) eventi **causali** al posto del dado; 8) test integrati su partita
lunga. Ogni passo con suite verde prima del successivo.

---

## 2. PROBLEMA

Dopo 30–50 turni la partita perdeva spessore, per sei cause concrete:

1. **Tempo incoerente.** Il preset moderno partiva dal `2026-01-01` ma si
   presentava come «mondo del 2024». Crisi e pressioni si misuravano in *turni*:
   un salto di 7 giorni e uno di 365 valevano uguale.
2. **Nessuna memoria politica.** `GovernmentFactions` diceva come stava una
   fazione *oggi* (dai numeri), ma non che il governo l'aveva tradita tre turni
   prima: la fazione «dimenticava».
3. **NPC senza strategia.** Ogni chiamata al modello produceva intenzioni del
   turno, non una linea perseguita: «ridurre la dipendenza» al T1 e al T7 erano
   due azioni scollegate.
4. **Impegni dimenticati.** Il consolidamento riduce la cronaca a ~220 parole:
   trattati, promesse e ultimatum firmati venti turni prima sparivano.
5. **Micro-management.** Ogni turno poteva presentare più questioni di pari
   peso, senza distinzione fra ordinario, rilevante e strategico.
6. **Storia costruita sul dado.** Il tick senza ordini estraeva un evento casuale
   (15%) **e ne mutava le cifre**: terremoti e invenzioni dal nulla, mentre
   debito, carestie e ostilità reali non producevano nulla.

## 3. INTERVENTO

**P0.1 — Coerenza temporale del preset** (`lore.md`, `preset.json`, nuovo
`rules.md`): la data canonica è `start_date` (2026-01-01); i dati economici sono
dichiarati **baseline di riferimento**, non «l'anno in cui si vive». Nessun
«2026» hardcodato nel motore: la data del mondo resta quella del preset/partita.

**P0.2 — Crisi in giorni di calendario** (`NationCrisis.ts`): giorni critici
accumulati per dimensione (`criticalDays`), episodi contati (`episodes`),
soglie in giorni (collasso 90 gg critici, collasso brusco 180), ritmo di
sorveglianza 0.3 e recupero 1.2, minimo 2 episodi, tetto 3650 giorni. Nuova
`calendar.daysBetween(from,to)` pura; `NationStateService.crisisElapsedDays()`.
Il DB aggiunge `revolt_episodes`/`insolvency_episodes`/`invasion_episodes` e le
colonne `*_streak` ora contengono **giorni** (fallback retro-compatibile).

**P0.2 — Pressioni con finestra** (`PeacetimePressures.ts`): ogni sfida dura
**giorni** (`PRESSURE_DURATION_DAYS` 120/90/60 per severità), con
`pressureDeadline()`; oltre la scadenza l'inazione si applica comunque; una
sfida grave peggiora **una volta** al 60% della finestra (metà dell'effetto
dell'inazione); nuove sfide solo se c'è posto e il modello non è già aperto
(max 3). Colonne `duration_days`, `deadline_date`, `escalated`,
`escalated_date` con fallback sulla severità.

**P1 — Memoria politica delle fazioni** (nuovo `FactionMemory.ts` + tabella
`game_faction_memory`): eventi `favor|grievance|ignored|promise|kept|broken`
con **decadimento** (emivita 180 giorni), `trust` (base 50), `resentment`,
`trend`, ultimo evento significativo. La memoria entra nella fotografia del
governo come **termine di pressione limitato** (max ±18, scalato sull'influenza)
e come `resentful`/`trustIndex`: **soddisfazione e posizione restano derivate
dai dati reali**. Lettura politica deterministica di ogni decisione (fazione
primaria, più `finanza`/`opinione`/`militari` secondo l'effetto applicato).

**P1 — Agenda strategica degli NPC** (nuovo `NpcAgenda.ts` + `game_npc_agenda`
append-only + `NpcAgendaService`): 1–3 obiettivi per polity (contenere un
ostile, preservare un'alleanza, accesso commerciale, capacità militare,
stabilizzare l'economia, ridurre la dipendenza, isolare un rivale), **derivati**
da profilo strategico, relazioni, forze e minacce. Finestra di revisione di 120
giorni (niente cambi di linea a ogni chiamata), chiusura solo con condizione
**verificabile**, progresso misurato sugli indicatori. Una revisione **per
avanzamento**, memoizzata su `turno:data` dentro il dossier già esistente →
**zero chiamate LLM aggiuntive**. Versioni append-only: il rewind fa riemergere
la strategia precedente.

**P1 — Registro strutturato degli impegni** (nuovo `Commitments.ts` + tabella
`game_commitments` append-only + `CommitmentService`): trattati, promesse,
garanzie, ultimatum, accordi commerciali, accesso territoriale, cessate il
fuoco, impegni militari, obblighi futuri con stato
`active|fulfilled|broken|expired|superseded`, scadenza, importanza e catena
causale (`sourceEventId`). Il **motore è l'autorità**: gli ultimatum nascono dal
campo strutturato `kind: 'ultimatum'` delle chat (scadenza fissata dal motore,
30 giorni); il modello può solo **proporre** (`commitments[]`) o aggiornare con
id esatto (`commitmentUpdates[]`), tutto validato e difensivo. Un impegno
contraddittorio (stesso tipo + controparte) **sostituisce** il precedente; le
scadenze scorrono a ogni turno anche senza proposte. Il registro entra nel
prompt (`[Impegni in vigore]`), nelle chat diplomatiche, nel Dossier e (max due
righe) nel briefing.

**P2 — Priorità e rumore.** Le pressioni hanno una priorità dichiarata
(critica/rilevante/ordinaria): **max 2 in evidenza**, le altre nel dossier
(`<details>`). Nel briefing entrano solo le più urgenti: fino a 2 fazioni
risentite, una riga per l'agenda più urgente, fino a 2 impegni che stringono.
Niente nuovi sistemi amministrativi: solo gerarchia di lettura.

**P2 — Eventi causali.** Il tick senza ordini ora **osserva** lo stato: carestia
dove il PIL per abitante non basta, sforzo militare che mangia le casse,
escalation fra confinanti ostili con squilibrio di forze, tensioni territoriali
fra molte province povere, innovazione dove la ricchezza è diffusa. Gli eventi
causali sono **di sola lettura** (le cifre le muovono già `WorldStateEngine`,
economia e conflitti: nessuna doppia verità, nessun effetto che si accumula),
hanno un raffreddamento di 4 turni per non ripetersi e al massimo due per
dispaccio. L'evento casuale legacy resta solo come **rumore secondario** quando
lo stato non offre alcuna causa.

## 4. FILE

Backend — nuovi: `core/simulation/{FactionMemory,NpcAgenda,Commitments}.ts`,
`repositories/{faction-memory,npc-agenda,commitment}.repository.ts`,
`game/{NpcAgendaService,CommitmentService}.ts`. Modificati:
`core/simulation/{NationCrisis,PeacetimePressures,calendar,GovernmentFactions}.ts`,
`game/{NationStateService,NpcTurnService,WorldIntelService,GameDataService,
TurnPipelineService,PlaybackService,DiplomacyService}.ts`, `game-session.ts`,
`database.ts`, `prompts/simulation/{parse,prompt}.ts`, `prompts/types.ts`,
`prompt-builder.ts`, `routes/games/state.routes.ts`,
`repositories/game.repository.ts`, `data/presets/modern_world_provinces/*`.

Frontend — nuovi: `components/Game/{pressureWindow.ts,powersAgenda.ts,
commitments.ts}` (+ test). Modificati: `components/Game/{strategicBriefing.ts,
governmentDossier.ts}`, `components/Game/NationDock/{widgets.tsx,types.ts}`,
`NationDock.tsx`, `components/Shell/DeskContent.tsx`, `GameScreen.tsx`,
`hooks/useNationSnapshot.ts`, `services/api.ts`, `index.css`.

E2E: `e2e/mock-api.mjs` (payload impegni), `e2e/tests/gameplay-long.spec.mjs`.
Docs: questo report.

## 5. NUOVE STRUTTURE DATI E MIGRAZIONI

Nuove tabelle (backward-compatible, nessuna distruzione di dati):
`game_faction_memory` (PK `game_id+branch_id+id`, `INSERT OR IGNORE` →
idempotente), `game_npc_agenda` (versioni append-only per `objective_key`),
`game_commitments` (versioni append-only per `commitment_id`). Colonne aggiunte:
`game_pressures.duration_days|deadline_date|escalated|escalated_date`;
`game_crisis_state.revolt_episodes|insolvency_episodes|invasion_episodes` e
semantica **giorni** per `*_streak` (con fallback sui vecchi valori).
Tutte le letture hanno oggi un fallback legacy: un salvataggio precedente si
apre, mostra e prosegue.

## 6. TEST

Backend **144 file / 1268 test verdi** (`npx vitest run`), frontend **57 file /
399 verdi** (`npx vitest run`), `tsc --noEmit` pulito su entrambi, build backend
(`tsc`) e frontend (`vite build`) ok, **E2E mock 33 verdi**.

Test aggiunti/riscritti (tutti i casi obbligatori coperti):
tempo (`nation-crisis.test.ts` 21, incluso 7 giorni vs 180); scadenza di
pressione (`peacetime-pressures.test.ts` 15, `player-levers.test.ts` 11, 60
giorni → aperta a 30, `expired` oltre con inazione); fazioni
(`faction-memory.test.ts` 16: favorita poi danneggiata **senza** sostituire la
soddisfazione derivata, decadimento, save/load, rewind); NPC
(`npc-agenda.test.ts` 16: obiettivo persistente fra i turni, progresso
misurabile, chiusura verificabile, finestra di revisione); impegni
(`commitments.test.ts` 12: **disponibile dopo il consolidamento della cronaca**,
ultimatum strutturato, sostituzione, save/load, rewind); integrazione
(`gameplay-long-integration.test.ts` 6: tempo e crisi in giorni, finestra di
pressione, memoria che decade, obiettivi stabili fra i turni, impegno vivo
dopo il consolidamento, save/load/rewind/branch); eventi causali
(`npc-turn-service.test.ts`); frontend `pressureWindow`, `powersAgenda`,
`commitments`, `governmentDossier`.

## 7. FREEZE

- Modifiche **autorizzate dal task** in `core/simulation`: `NationCrisis.ts`,
  `PeacetimePressures.ts`, `calendar.ts`. `GovernmentFactions` esteso in modo
  additivo (parametro opzionale `memory`: chiamanti esistenti invariati).
- Nessuna riscrittura di `GameSession`, nessun secondo motore economico o
  diplomatico, nessun secondo stato del mondo, nessuna riscrittura UI.
- `TurnPipelineService`, `PlaybackService`, `game-session.ts`, `repositories`
  e `database.ts` toccati **solo** per collegare i nuovi servizi (iniezione di
  contesto + hook già esistenti): nessuna semantica di checkpoint, di
  avanzamento turno o di commit modificata.
- `ReactionContext.ts` resta **congelato**: le proposte di refactor prestazionale
  restano documentate e non applicate.

## 8. LIMITI DICHIARATI

- Le nuove date/effetti non ricostruiscono la storia passata: le partite già
  avanti ereditano i nuovi comportamenti dal turno in cui vengono calcolati.
- L'agenda NPC è ricalcolata una volta per avanzamento e memoizzata in memoria:
  dopo un riavvio del processo la prima lettura del turno può produrre una
  revisione in più (nessuna chiamata LLM aggiuntiva, nessun doppio stato).
- Il raffreddamento degli eventi causali è in memoria: dopo un riavvio la stessa
  condizione può essere registrata di nuovo (è una notizia, non uno stato).
- Il registro impegni non sostituisce la cronaca: la lettura `attention` è
  euristica (scadenza vicina, importanza alta, stato rotto), non una gerarchia
  perfetta.
- La memoria delle fazioni non copre le decisioni prese fuori dalle pressioni
  (ordini, chat) se non tramite gli eventi che il motore già registra.
- `chat_message` non è ancora durevole in `simulation_outbox`, la chat-list non
  deriva `lastMessage` dalla timeline sul server, i GeoJSON storici
  (1815/1914) e la memoizzazione di `mapPolitiesForPreset` restano fuori scope.

## 9. COSA CAMBIA IN UNA PARTITA DA 50 TURNI

- **Il mondo ricorda**: una fazione favorita al turno 8 e tassata al 12 arriva al
  turno 40 con fiducia più bassa, risentimento residuo e una riga nel briefing —
  mentre la sua soddisfazione resta quella dei numeri reali.
- **Le nazioni perseguono strategie**: «ridurre la dipendenza» resta la *stessa*
  linea dal turno 5 al 20, con progresso visibile e una data di revisione; il
  giocatore legge perché.
- **Gli accordi non si dimenticano**: un trattato firmato al turno 6 è ancora nel
  registro al turno 45, dopo dieci consolidamenti della cronaca, con stato,
  controparte, importanza e scadenza — e vincola il prompt e le chat.
- **La crisi evolve col tempo**: 3 settimane critiche pesano più di 7 giorni; un
  anno non equivale a un passo; il collasso arriva solo dopo giorni critici
  osservabili, con avvisi prima.
- **7 giorni ≠ 1 anno**: uno stop di tre mesi fa scadere una sfida di pace (con
  inazione), non un avanzamento di una casella.
- **Non ogni problema richiede il giocatore**: due questioni in evidenza, le
  altre nel dossier.
- **Economia, politica, diplomazia e guerra sono la stessa storia**: le cifre le
  muove il motore, gli eventi le raccontano, il registro le conserva.
- **Il controllo resta del giocatore**: il modello propone, il motore dispone.
