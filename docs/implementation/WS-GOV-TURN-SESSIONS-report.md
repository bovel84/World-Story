# WS-GOV-TURN-SESSIONS — Report di Fase A

**Workstream:** WS-GOV-TURN-SESSIONS + WS-GOV-COUNCIL-MEETINGS (roadmap `pi-task-ws-gov-turn-sessions-council.md`)
**Fase:** A — la seduta appartiene al turno
**Branch:** `feat/ws-gov-turn-sessions-council`
**Base:** `feat/ws-gov-seat-boards` (PR #167, non ancora unita a `main` al momento della PR di Fase A — vedi §8)

---

## 1. Problemi trovati (causa reale)

Lo stato operativo della seduta del Governo era indicizzato **per sola sedia**:

```ts
const [workspaces, setWorkspaces] = useState<Partial<Record<CabinetAddressView['seat'], DecisionWorkspace>>>({});
const [canvases,   setCanvases]   = useState<Partial<Record<CabinetAddressView['seat'], PresentationCanvas>>>({});
```

Il difetto si manifestava avanzando il turno:

1. **La proposta non ripartiva da zero.** `workspaces[tesoro]` sopravviveva al cambio di
   `currentTurn`: si apriva la seduta del turno T+1 con la proposta, la revisione e le misure
   del turno T ancora sul tavolo. Il Presidente decideva il turno nuovo con i numeri del vecchio.
2. **La chat era cumulativa.** `chatMessages = ministerChats[seat]` conteneva **tutti** i turni;
   la cronologia inviata al ministro cresceva senza limite e non distingueva «cosa è successo» da
   «cosa stiamo decidendo adesso».
3. **L'atto non aveva origine storica.** Bozza e canvas non erano legati a turno/seduta: preparare
   un atto nel turno T+1 poteva riusare lo stato del turno T, senza distinguere Atto A da Atto B.
4. **La Tavola mostrava troppa informazione fissa.** «LA DECISIONE IN CORSO», piano strategico,
   strade ed evidenze erano tutti aperti insieme; l'evidenza non era uno strumento temporaneo ma
   un blocco permanente.

La causa comune: **il turno non faceva parte dell'identità dello stato**. Un `decisionScope`
(`game|branch|turn`) azzerava i workspace, ma non la tela, la bozza, la chat e la messa a fuoco;
e non consolidava nulla in memoria.

---

## 2. Correzioni applicate

### A1 — Identità della seduta (`governmentSession.ts`, modulo puro)
Nuova identità `game + branch + turn + kind (+ seat)`:

- `governmentSessionId(key)` → `game|branch|turn|kind|seat` (branch `null` → `main`);
- `sessionSeatKey(sessionId, seat)` / `seatFromSessionSeatKey(key)`: lo stato di una sedia vive
  **dentro** la seduta (`sessionId::seat`), non più per sola sedia;
- `actIdentity(sessionId, turn, seat, revision)`: l'identità storica di un atto (`sourceTurn`,
  `sourceRevision`, `sourceSeat`, `sourceSessionId`).

In `GovernmentOffice` le mappe `workspaces` e `canvases` sono passate da
`Partial<Record<seat, …>>` a `Record<string, …>` indicizzate con `stateKey(seat)`.

### A2 — Reset al cambio turno
Un effetto su `sessionId` fa ripartire da zero: `workspaces`, `canvases`, `council`, `actDraft`,
`actPreview`, `actPreviewError`, `actBusy`, `seenVersion`, `pendingFocus`, `mobilePane`. La nuova
seduta riparte da `emptyWorkspace(...)` con `revision = 0`.

### A3/A4 — Consolidamento in memoria, prima del reset
Nello **stesso** effetto, prima dell'azzeramento, la seduta precedente viene letta dal ref
(`workspacesRef.current`) e consolidata in `MinisterMemory`:

- `consolidateSessionMemory(workspace, seat, ref)` produce solo ricordi narrativi:
  `queued-decision` (decisione/proposta confermata) e `open-question` (questioni rimaste aperte);
- **non** salva il `DecisionWorkspace` come stato futuro.

Il ministro del turno nuovo riceve questa memoria tramite il canale `memory` esistente (JEV/P6),
non riaprendo la vecchia Tavola.

### A5 — Chat della seduta corrente
`AdvisorMessage` ha un campo `turn?`; ogni messaggio aggiunto viene etichettato col turno corrente.
La chat visibile (e la cronologia inviata) è filtrata al turno corrente; al ministro viaggia
`chat del turno + memoria selettiva + stato verificato`, **non** tutta la conversazione.

### A6 — Atti storici, senza toccare il motore
`actIdentity(...)` viene applicata alle bozze preparate (da strada e da proposta). `ProposalActDraft`
espone i metadati opzionali `sourceTurn/sourceRevision/sourceSeat/sourceSessionId`; `ActDraftPanel`
li rende come `data-source-turn` / `data-source-revision` (sola UI, nessun campo inviato al motore).

### A7 — Gerarchia della Tavola e approfondimenti chiusi
`DecisionBoard` ha ora la gerarchia: QUESTIONE → OBIETTIVO → PROPOSTA CORRENTE → DA DECIDERE →
CONSEGUENZE/RISCHI → **APPROFONDIMENTI ▶** (chiusi di default) → REVISIONI ▶ → ATTO. Approfondimenti
e Revisioni sono `<details>` non aperti.

### A8 — Evidenza temporanea
L'evidenza conserva **solo il riferimento** (`evidenceIds`, già esistente): aprirla dalla Tavola
aggiunge la chiave via `withEvidenceRefs` e mette a fuoco il blocco reale; richiuderla toglie il
riferimento. Nessuna copia del dato, nessun effetto di gioco.

### Classificazione A/B/C/D/E
Tutte le modifiche sono di tipo **A/B** (UI + read model di sessione), con una **C** dichiarata:
`AdvisorMessage.turn` è un campo nuovo nello store di chat **in memoria** (nessuna persistenza, nessuna
migrazione). **Nessuna modifica E, nessuna migrazione di schema.**

---

## 3. File modificati

Nuovi:
- `frontend/src/components/Game/governmentSession.ts` — identità di seduta, consolidamento, identità d'atto (puro)
- `frontend/src/components/Game/governmentSession.test.ts` — 8 test (identità, consolidamento, atto A≠B)
- `e2e/tests/ws-gov-turn-sessions.spec.mjs` — E2E verticale su due turni
- `docs/implementation/assets/ws-gov-turn-sessions/390x844-nuova-seduta.png`
- `docs/implementation/assets/ws-gov-turn-sessions/390x844-atto-b.png`

Modificati:
- `frontend/src/components/Game/GovernmentOffice.tsx` — `sessionId`/`stateKey`, reset+consolidamento, chat per turno, `sourceTurn`, apertura/chiusura approfondimenti
- `frontend/src/components/Game/DecisionBoard.tsx` — gerarchia A7 + `<details>` approfondimenti + `onOpenEvidence`/`onCloseEvidence`
- `frontend/src/components/Game/SeatTable.tsx` — passa `onOpenEvidence`/`onCloseEvidence`
- `frontend/src/components/Game/ActDraftPanel.tsx` — `data-source-turn` / `data-source-revision`
- `frontend/src/components/Game/actDraft.ts` — metadati opzionali di origine sull'atto
- `frontend/src/components/Game/MinisterChat.tsx` — prop `sessionId` (reset della vista al cambio seduta)
- `frontend/src/stores/chatStore.ts` — `AdvisorMessage.turn?`
- `frontend/src/editorial.css` — stile degli approfondimenti
- `frontend/src/components/Game/seatDecisionBoardRender.test.tsx` — 2 test A7/A8
- `e2e/mock-api.mjs` — trigger `orientali` per il secondo turno
- `e2e/tests/ws-gov-dialogue-to-act.spec.mjs` — asserzione aggiornata alla nuova gerarchia A7
  («Approfondimenti» apre le evidenze)

Nessun file backend è stato modificato.

---

## 4. Conferma CORE ENGINE FREEZE

`backend-nest/src/core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/DB/migrazioni, repository, checkpoint/playback e la pipeline di
avanzamento del tempo **non sono stati toccati**. La Fase A è interamente UI + read model puro:
nessun numero ricalcolato, nessuna chiamata al modello, nessuna prenotazione. Il motore resta
l'unica autorità su costi, risorse, esecuzione e conseguenze.

---

## 5. Test eseguiti (esito reale)

| Gate | Comando | Esito |
|---|---|---|
| Frontend unit | `cd frontend && ../node_modules/.bin/vitest run` | **138 file, 1179 passati, 1 skip** |
| Frontend tsc | `cd frontend && ../node_modules/.bin/tsc --noEmit` | **0 errori** |
| Frontend build | `cd frontend && npm run build` | **0 errori** |
| Backend test | `cd backend-nest && ../node_modules/.bin/vitest run` | **219 file, 2338 passati** |
| Backend build | `cd backend-nest && npm run build` (+ `rm -rf dist`) | **0 errori** |
| E2E Fase A | `playwright test tests/ws-gov-turn-sessions.spec.mjs` | **1/1** |
| E2E regressione aree toccate | turn-sessions + dialogue-to-act + seat-boards + p1 + p7 + signatures | **9/9** |

Test nuovi (unit, puri):
- `governmentSession.test.ts` (8): identità distingue turno/sedia/ramo; chiave di sedia nella seduta;
  consolidamento estrae decisione + questione aperta; seduta vuota non produce ricordi; i record non
  espongono il workspace; `actIdentity` distingue Atto A e Atto B.
- `seatDecisionBoardRender.test.tsx` (+2): approfondimenti chiusi di default; evidenza aperta elencata
  e richiudibile.

E2E Fase A (`ws-gov-turn-sessions.spec.mjs`): turno 1 → discussione → 80/20 → atto A **firmato**
(`accodato`) → avanza turno → turno 2: nessuna proposta (`.decision-board` assente), nessun atto
(`.act-draft` assente), chat visibile vuota, memoria con la decisione del turno 1 → nuova discussione
sulle province orientali → atto B con `data-source-turn="2"` e testo diverso dall'atto A.

**Non eseguito / non dichiarato verde:** matrice E2E completa a 4 viewport; suite E2E completa
(verrà eseguita una volta sola a fine blocco). Il literal `npm test` del frontend resta assente
(`Missing script: "test"`): il runner reale è `vitest run`.

---

## 6. Risultati

- La seduta è identificata da `game + branch + turn + kind (+ seat)`: due turni sono due sedute.
- Al cambio turno lo stato operativo (workspace, tela, bozza, preview, focus, chat visibile) riparte
  da zero; il passato diventa **memoria** selettiva.
- La chat inviata al ministro è quella del turno corrente + memoria; non l'intera conversazione.
- Gli atti portano turno e revisione di origine: Atto A ≠ Atto B.
- La Tavola ha gerarchia ridotta e approfondimenti chiusi; l'evidenza è un riferimento temporaneo.
- Nessuna regressione nelle aree toccate (9 E2E verdi) e nelle suite complete.

---

## 7. Limiti residui

- **Stacking:** la Fase A è impilata su `feat/ws-gov-seat-boards` (PR #167), ancora aperta. La PR di
  Fase A ha come base quel branch, non `main`. Una volta unita #167 la PR può essere ripuntata a `main`.
- I messaggi di chat **senza** `turn` (compatibilità con lo store già esistente nella stessa pagina)
  non vengono filtrati: sono storia legacy, non persistita (lo store non ha `persist`).
- L'atto A/B è distinto per origine e contenuto, ma **non** esiste ancora una funzione di
  emendamento/revoca/sostituzione: è una meccanica futura distinta (fuori dallo scope di Fase A).
- `sourceTurn`/`sourceRevision` sono metadati di UI, non viaggiano al motore: il motore non
  conserva la genealogia degli atti.
- «Alternative» (confronto) e «Fonti» non sono un approfondimento dedicato della Tavola: restano
  rispettivamente il blocco di confronto sulla tela e le etichette di provenienza delle misure.

---

## 8. Proposte per la fase successiva (Fase B)

1. Introdurre `CouncilMeeting` + `CouncilWorkspace` + `MinisterContribution` (§B1–B3) riusando
   `councilWorkspace.ts`/`seatDecisionBoards.ts` di WS-GOV-SEAT-BOARDS e i workspace di seduta
   introdotti qui (una sola riunione, non chat libere).
2. Selettore **determinista** dei partecipanti a partire dalla competenza e dalla proposta
   (§B4–B5), lead minister e orchestrazione controllata (§B6).
3. Lettura dei **read model reali** del motore (Lavori/Tesoro) con **preview ≠ commit**: nessuna
   prenotazione prima della firma; riuso di `check-feasibility` e della plancia P7.
4. Atto con **work declaration reale** (mai degradato a `text-order`) e E2E verticale fabbrica +
   caso cassa insufficiente + narrativa multi-ministro (§B18–B19).
5. Ripuntare Fase A e Fase B a `main` dopo l'unione di #167, ed eseguire una sola volta la suite
   E2E completa a fine blocco.
