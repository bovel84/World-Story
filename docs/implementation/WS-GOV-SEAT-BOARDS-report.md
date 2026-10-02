# WS-GOV-SEAT-BOARDS — La Tavola è infrastruttura del Governo, non del Tesoro

Branch: **`feat/ws-gov-seat-boards`** (da `main` aggiornato). Base verificata:
`origin/main` **`e265b9b`** (merge PR #166, WS-GOV-DIALOGUE-TO-ACT). Task letto
integralmente: `/tmp/pi-task-ws-gov-seat-boards.md` (B21–B29). Deliverable: questo
report + PR. **Nessun merge, nessun deploy.**

Esito: **completato**. La Tavola è diventata un'infrastruttura **generica e
seat-aware**; ogni ministro ha la sua Tavola; la riunione di Consiglio aggrega le
contribuzioni senza duplicare la proposta. Il gate di qualità è verde (§5) e il
flusso `Lavori → Convoca il Tesoro → Tavola comune` è provato end-to-end (§6).

---

## 1. Problemi trovati (causa reale)

La base era il task precedente (`DecisionBoard.tsx` + `decisionWorkspace.ts`,
PR #166). Il difetto non era «manca un componente»: era **dove il Tesoro era
cablate nel read model della Tavola**.

1. **Il blocco del bilancio era per tutte le sedie.**
   `deriveSeatCanvasBlocks` (`seatCanvasModel.ts`) costruiva il grafico
   `bilancio` (`budgetChart`: «Dove va il denaro», con le voci di spesa, fra cui
   l'ammortamento del debito) **per ogni sedia** che avesse un budget. Un ministro
   dei Lavori vedeva automaticamente il bilancio del Tesoro: la B28 lo vieta
   esplicitamente. Stessa cosa per il grafico `trend` e, per l'Esteri, per la
   mappa del paese.
2. **La Tavola aveva una struttura sola.**
   `DecisionBoard` rendeva un unico schema — «Obiettivo», «Proposta corrente» con
   le misure in piano — **uguale per tutte le sedie**. Non esisteva alcuna
   nozione di «sezione di competenza»: la stessa misura si presentava allo stesso
   modo al Tesoro, ai Lavori, alla Sanità, alla Guerra. Manca la lettura
   seat-aware richiesta da B21/B22/B23.
3. **La riunione multi-ministro non esisteva come stato.**
   Ogni sedia aveva il suo `DecisionWorkspace`, ma non c'era alcun modo di
   **promuovere** una proposta al Consiglio né di aggregare le competenze in una
   Tavola comune (B25/B26). L'unico «consiglio» esistente (`CabinetSession`
   `variant="pick"`) è la schermata di scelta dei ministri, non una riunione con
   contribuzioni.
4. **Lo stato non era isolato per `game + branch + turn`.**
   `workspaces` era keyato per sedia (bene), ma non veniva azzerato al cambio di
   partita, ramo o turno: una decisione di un altro mondo poteva sopravvivere
   (B24).

**Causa**: la Tavola era nata come funzione del Tesoro (`WS-GOVOFFICE-07`) e la
sua infrastruttura di lettura non era mai stata resa generica.

---

## 2. Correzioni applicate

### B23 — `SeatDecisionBoardConfig`: la lettura diventa seat-aware

Nuovo modulo puro **`seatDecisionBoards.ts`**:

- `SeatDecisionBoardConfig` per sedia: `title`, `competence`, `objectiveLabel`,
  `primarySections`, `secondarySections`, `availableEvidence`,
  `defaultCollapsedSections`;
- `SEAT_DECISION_BOARDS` per **tutte e sette** le sedie (`tesoro`, `lavori`,
  `istruzione`, `sanita`, `esteri`, `interno`, `guerra`). Le sezioni sono la
  **trascrizione** di `SEAT_READS` del motore (come `seatDomains.ts`); il
  catalogo di evidenze è la **stessa** `EvidenceKey` di `presentation.ts`, non
  una tassonomia parallela;
- `groupProposalMeasures(proposal, config)`: compone le misure della proposta
  nelle sezioni della sedia, con l'etichetta di competenza. Le sezioni senza
  misure **non compaiono**;
- helper `seatBoardConfig`, `seatAllowsEvidence`, `sectionForKind`,
  `isCollapsedSection`, `CABINET_SEATS`.

**Nessun dato nuovo**: la configurazione decide solo **come leggere e
presentare** i read model esistenti.

### B21/B28 — Nessun blocco estraneo alla competenza

`deriveSeatCanvasBlocks` (`seatCanvasModel.ts`) ora limita i blocchi al catalogo
di evidenze della sedia:

- il blocco `bilancio` («spesa») entra **solo per il Tesoro**;
- la `mappa` non entra per l'**Esteri** (la diplomazia non ha un blocco
  territoriale);
- `trend`, `cifre`, `piano`, `idee` restano per tutte le sedie che li dichiarano.

Così la Tavola dei Lavori **non mostra più automaticamente** il bilancio del
Tesoro, e il Tesoro non eredita blocchi di altre competenze.

### B21/B22/B24 — `DecisionBoard` generico, stato isolato

- `DecisionBoard` accetta `seat?: CabinetSeat` (default: la sedia del workspace,
  retro-compatibile). Titolo, etichetta dell'obiettivo, **raggruppamento e
  ordinamento delle sezioni**, e **filtro delle evidenze** vengono dalla
  configurazione della sedia.
- `SeatTable` passa `seat={seat}` e rende la Tavola comune quando c'è una
  riunione.
- `GovernmentOffice` azzera `workspaces`, `council` e la bozza d'atto quando
  cambia lo **scope** `${gameId}|${branchId}|${turn}`: lo stato di una sedia
  appartiene a `game + branch + turn + seat`, e sedie diverse restano
  indipendenti **nello stesso turno**.

### B25/B26 — Il Consiglio e la Tavola comune

Nuovo modulo puro **`councilWorkspace.ts`**:

- `CouncilWorkspace`: `objective`, `originSeat`, `promotedProposalIds`, `seats`,
  `revision` — **solo riferimenti**, nessuna copia;
- `canPromoteToCouncil`, `promoteToCouncil`, `conveneSeat` (idempotente,
  immutabile), `seatsNotConvened`;
- `councilContribution` / `councilContributions` / `councilLines`: derivano le
  contribuzioni dal `DecisionWorkspace` **vivo** di ogni sedia (una sedia
  convocata senza workspace porta una contribuzione vuota, non sparisce);
- `councilStatus` / `councilReadyForAct`: la riunione è `ready-for-act` solo
  quando **ogni** sedia convocata ha portato la sua parte e non resta nulla in
  sospeso.

Nuovo componente **`CouncilBoard.tsx`**: la Tavola comune. Mostra «Il Consiglio»,
i partecipanti, il **piano comune**, una riga per competenza (`LAVORI`, `TESORO`,
…) con misure e domande aperte, i pulsanti per convocare le sedie mancanti, e
«Apri» per tornare alla seduta di una sedia.

`DecisionBoard` espone i due comandi di B26 — **«Porta la proposta in
Consiglio»** e **«Convoca il Tesoro»** — attivi quando c'è una proposta (anche
non ancora pronta: è proprio quando manca la copertura che serve convocare il
Tesoro).

### B27 — Il flusso completo

Lavori → fabbrica siderurgica → Sarajevo → «Convoca il Tesoro» → la Tavola comune
mostra `LAVORI` (opera, regione) e `TESORO` (in attesa); il Tesoro aggiunge la
copertura e la riga `TESORO` si riempie, fino a «pronta per l'atto». La proposta
promossa **non è duplicata**: il Consiglio legge lo stesso workspace della sedia,
che continua a vivere.

---

## 3. File modificati

| File | Classe | Perché |
|---|---|---|
| `frontend/src/components/Game/seatDecisionBoards.ts` | **A — nuovo modulo puro** | Configurazione seat-aware (B23) |
| `frontend/src/components/Game/councilWorkspace.ts` | **A — nuovo modulo puro** | Consiglio e promozione senza duplicazione (B25/B26) |
| `frontend/src/components/Game/CouncilBoard.tsx` | **A — nuovo** | La Tavola comune (B25) |
| `frontend/src/components/Game/DecisionBoard.tsx` | **A** | Tavola seat-aware + promozione (B21/B22/B26) |
| `frontend/src/components/Game/seatCanvasModel.ts` | **A** | Gate dei blocchi sul catalogo della sedia (B28) |
| `frontend/src/components/Game/SeatTable.tsx` | **A** | Passa `seat`, rende la Tavola comune |
| `frontend/src/components/Game/GovernmentOffice.tsx` | **A** | Stato del Consiglio, isolamento `game+branch+turn+seat` |
| `frontend/src/editorial.css` | **A** | Stile `.council-*`, `.decision-sections`, `.decision-promote` |
| `frontend/src/components/Game/seatDecisionBoards.test.ts` | **C — nuovo** | Config, gating, raggruppamento (12) |
| `frontend/src/components/Game/seatDecisionBoardRender.test.tsx` | **C — nuovo** | Resa per sedia (7) |
| `frontend/src/components/Game/councilWorkspace.test.ts` | **C — nuovo** | Promozione, contribuzioni vive, stato (8) |
| `e2e/tests/ws-gov-seat-boards.spec.mjs` | **B — nuovo** | E2E Lavori → Convoca Tesoro → Tavola comune |
| `e2e/mock-api.mjs` | **B** | Trigger `decision` per il flusso Lavori/Tesoro |
| `docs/implementation/assets/ws-gov-seat-boards/390x844-council-tavola.png` | **D** | Reperto visivo |
| `docs/implementation/WS-GOV-SEAT-BOARDS-report.md` | **D** | Questo report |

**Riusati senza riscriverli**: `decisionWorkspace.ts` (invariato), `SeatCanvas`/
`seatCanvasConfig.ts`, `presentation.ts` (invariato), `treasuryAct.ts`,
`seatProposals.ts`, `consequenceBoard`, memoria ministro, JEV, canvas, mappe,
confronto, firma idempotente, coda ordini. **Nessun backend toccato.**

---

## 4. Conferma CORE ENGINE FREEZE

**Intatto.** Il diff tocca solo `frontend/src/**` (read model puro e UI),
`e2e/**` e `docs/implementation/**`. Nessuna modifica a:

- `backend-nest/src/core/simulation/**`;
- `GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`;
- schema/database e repositories (nessuna migrazione);
- semantica checkpoint, simulation run, `useSimulationPlayback`;
- pipeline di avanzamento del tempo, RNG, code eventi.

La Tavola continua a **leggere** i read model del motore; non li scrive e non li
ricalcola. Nessuna chiamata LLM nuova. Nessuna azione E classificata: non è
servita né un'estensione di schema né una migrazione.

---

## 5. Test eseguiti (esito reale)

Ambiente: macOS, Node v26.10.0 (locale), Chrome di sistema headless. Log in
`/tmp/ws-seat-boards-*.log`.

| Comando | Esito reale |
|---|---|
| `cd frontend && ../node_modules/.bin/vitest run` (suite intera) | **137 file / 1169 passati, 1 saltato** (1170), exit 0 |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | exit 0 |
| `cd frontend && npm run build` | exit 0 (warning chunk >500 kB, non occultato) |
| `cd backend-nest && ../node_modules/.bin/vitest run` (suite intera, `dist/` assente) | **219 file / 2338 passati**, exit 0 |
| `cd backend-nest && npm run build` (poi `rm -rf dist`) | exit 0 |
| `cd e2e && … playwright test tests/ws-gov-seat-boards.spec.mjs` | **1/1 passato**, ~8 s |
| `cd e2e && … playwright test modules + govux p1/p4/p7 + cancellation + signatures + dialogue-to-act + seat-boards` | **23/23 passati**, 2,7 min |

### 5.1 I test nuovi (B28)

`seatDecisionBoards.test.ts` (12) — tutte e sette le sedie hanno una
configurazione con titoli distinti; **solo il Tesoro** ammette l'evidenza
«spesa»; le sezioni primarie differiscono per competenza; `deriveSeatCanvasBlocks`
non produce il blocco `bilancio` per Lavori/Sanità/Guerra; l'Esteri non ha la
mappa; la stessa misura «opera» si raggruppa come «Opera» per i Lavori e «Forze
e unità» per la Guerra; una «copertura» è «Copertura e obiettivi» al Tesoro e
«Bisogno sanitario» alla Sanità.

`seatDecisionBoardRender.test.tsx` (7) — resa seat-aware: titolo, etichetta
dell'obiettivo, sezioni; una sedia senza competenza finanziaria **non** mostra
«Dove va la spesa» mentre il Tesoro sì; promozione e convocazione compaiono per i
non-Tesoro e il Tesoro non si convoca da solo.

`councilWorkspace.test.ts` (8) — promozione con lineage; convocazione idempotente
e immutabile; **nessuna copia**: se il workspace avanza dopo la promozione, il
Consiglio lo vede; lo stato resta `open` finché una sedia convocata non porta la
sua parte; `ready-for-act` solo con tutte le competenze al loro posto.

### 5.2 Non eseguiti (dichiarati, non verdi)

- Nessun test con **provider LLM reale**: il canale `decision` resta verificato
  col mock (limite ereditato da PR #166).
- Nessuna matrice multi-viewport oltre al reperto mobile dell'E2E.
- Audit `a11y` dedicato.

---

## 6. Risultati

L'E2E (`ws-gov-seat-boards.spec.mjs`) prova il criterio di successo:

1. **Tavola diversa per ministro** — aprendo i Lavori la Tavola si intitola «La
   tavola dei Lavori», l'obiettivo è «Obiettivo dell'opera», la sezione «Opera»
   accoglie «Fabbrica siderurgica»; **non** compare «La tavola del Tesoro».
2. **La decisione si specializza** — «A Sarajevo» porta la sezione «Regione».
3. **Promozione senza duplicazione** — «Convoca il Tesoro» porta la proposta nel
   Consiglio e apre la seduta del Tesoro; la Tavola comune mostra le righe
   `LAVORI` (con l'opera e la regione) e `TESORO` (vuota: «Nessuna misura ancora
   portata»).
4. **Contribuzione viva** — il Tesoro aggiunge la copertura; la riga `TESORO` si
   riempie («Copertura finanziaria», «2,00 mld») e la riunione diventa «pronta
   per l'atto»; il piano comune resta quello promosso dai Lavori.

Reperto:
`docs/implementation/assets/ws-gov-seat-boards/390x844-council-tavola.png`.

**Regola finale aggiunta al criterio di completamento (B29):**

> **La Tavola è un'infrastruttura del Governo, non del Tesoro.** Ogni ministro
> possiede una Tavola coerente con la propria competenza; nelle riunioni
> multi-ministro queste Tavole confluiscono in una Tavola comune condivisa.

E la scorciatoia è esclusa: il requisito **non** è stato risolto riusando la
Tavola del Tesoro per tutte le sedie. La struttura è generica (`DecisionBoard`
accetta `seat`) e seat-aware (`SEAT_DECISION_BOARDS`), e una sedia non può
mostrare l'evidenza di un'altra.

---

## 7. Limiti residui

- **Il Consiglio è stato di UI, non persistito.** `workspaces` e `council`
  vivono nel client; un ricarico pagina li perde. Il task non chiedeva
  persistenza e il freeze vieta il database: lo dichiaro.
- **La promozione referenzia il workspace di sessione.** Se in futuro un
  workspace venisse persistito o ricaricato, la promozione dovrà puntare a un id
  stabile (oggi `originSeat` + `promotedProposalIds` sono sufficienti perché la
  sessione è viva).
- **Il raggruppamento dipende dal `kind` della misura.** Una misura con `kind`
  `other` finisce in «Altre misure»: è la coda, non una sezione inventata. Se il
  modello sbaglia il `kind`, la misura resta visibile ma nella sezione generica.
- **«Convoca il Tesoro» è il percorso rapido richiesto da B26; le altre sedie**
  si convocano dalle pastiglie «Convoca nel Consiglio» della Tavola comune.
- **`ready-for-act` del Consiglio è conservativo**: una sedia convocata che
  legittimamente non ha misure blocca la prontezza. È preferibile a firmare un
  atto con una competenza muta.
- **L'Esteri non ha l'evidenza mappa** (scelta deliberata). Se servisse una
  mappa delle relazioni, va aggiunta una chiave di evidenza al catalogo di
  `presentation.ts` — è una modifica di presentazione, non di schema.
- **L'E2E usa il mock**, non un provider reale (limite ereditato).

---

## 8. Proposte per la fase successiva

1. **Sessioni per turno e riunioni di Consiglio dedicate** — è il passo naturale
   già accodato dalla regia (`WS-GOV-TURN-SESSIONS` + `WS-GOV-COUNCIL-MEETINGS`):
   dare al workspace e al Consiglio un ciclo di vita per turno e una modalità
   riunione con verbale.
2. **Persistenza del workspace e del Consiglio** — solo con il via della regia e
   con migrazione compatibile (filtro obbligatorio `game_id` **e**
   `branch_id`), sullo stampo di `jev_memory`.
3. **Più proposte promosse** — oggi `promotedProposalIds` è una lista ma la
   promozione parte da una proposta: estendere a più contribuzioni per sedia.
4. **Verifica reale del canale `decision`** con provider reale, per misurare
   quanti blocchi validi produce il modello (limite comune a PR #166).
5. **E2E multipiattaforma** del flusso Consiglio a 390×844 e 1366×768 come parte
   del gate completo di fine blocco.
