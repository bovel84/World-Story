# WS-GOV-COUNCIL-HARDENING — Chiusura del modulo Governo

Report di consegna. Branch `feat/ws-gov-council-hardening`, base `main = c7ee2f6` (post PR #167,
#168, #169). Obiettivo: correggere i **quattro problemi residui** del modulo Governo — localizzazione
canonica delle opere, Tesoro allineato alla disponibilità autorevole, memoria del turno precedente
datata correttamente, interventi dei ministri narrativi ma senza autorità LLM sui dati — **senza
riscrivere l'architettura esistente** e senza toccare il CORE ENGINE FREEZE.

---

## 1. Problemi trovati (causa reale)

### 1.1 La localizzazione della riunione non era canonica
Nella lettura della riunione (`meetingReadFromFeasibility`, inline in `GovernmentOffice.tsx`) i campi
`regionLabel` e `regionId` erano **letteralmente `null`**: la frase «…a Sarajevo» restava nel testo
dell'ordine, ma la riunione non conosceva alcun luogo. L'atto nasceva senza `regionId`, quindi il
cantiere finiva nella regione dell'ordine o in nessun posto. **Causa**: non esisteva un passaggio
dalla frase alla geografia canonica della partita; l'ID non poteva essere inventato dal client.

### 1.2 Il Tesoro mostrava il conto nazionale, non la disponibilità del preflight
La cifra di «disponibile» della riunione veniva da `pictureSources.account?.money` (il conto
nazionale), mentre `funded` è calcolato **server-side** da `measureDeficits` sul ledger del ramo. I
due numeri potevano divergere: la Tavola poteva dire «coperta» mentre `workDeclaration.funded` era
`false`. **Causa**: `check-feasibility` non esponeva la disponibilità monetaria netta quando il
fabbisogno era coperto (nessun deficit da cui ricavarla), e il client ripiegava sul conto nazionale.

### 1.3 La memoria del turno precedente perdeva la sua origine
Al cambio `turno 5 → turno 6`, l'effetto di consolidamento in `GovernmentOffice.tsx` chiudeva il
workspace **vecchio** passando `{ gameDate: currentDate ?? '', turn: currentTurn ?? undefined }`, cioè
la data e il turno **nuovi** (6). La decisione nata al turno 5 veniva salvata come se fosse del turno
6. **Causa nel chiamante**: `consolidateSessionMemory()` (in `governmentSession.ts`) usa
correttamente il `ref` ricevuto; era il chiamante a fornirgli il tempo sbagliato.

### 1.4 Gli interventi erano bollettini, e la voce era duplicata
I contributi deterministici (`lavoriContribution`, `tesoroContribution`) sono corretti ma meccanici
(«L'opera è… La distinta è coperta…»). Nel tentativo di dare voce alle sedie era stata introdotta una
mappa di stile **nel frontend** (`SEAT_STYLE`), che **duplicava** i profili di personalità già
esistenti nel backend (`MinisterPersona.ts`). **Causa architetturale**: fatti e voce erano composti
insieme, e la persona veniva replicata invece che riusata.

---

## 2. Correzioni applicate

Classificazione usata: **A** = read model/presentazione (pura, nessun nuovo stato); **B** = campo
additivo di contratto server (retro-compatibile); **C** = comportamento additivo entro un percorso
esistente; **D** = orchestrazione/UI dentro il modulo Governo; **E** = motore/schema/migrazione
(**vietata**). In questa fase: **nessuna E, nessuna migrazione**.

### 2.1 Localizzazione canonica (punto 1) — A + C
- **Nuovo modulo puro** `frontend/src/components/Game/meetingLocalization.ts`: confronta la frase con
  la **geografia canonica** (`Region.id`/`Region.name`, la stessa della mappa) e produce
  `resolved | ambiguous | missing`. Nessun ID dal testo; nomi composti risolti per toponimo; nessun
  tie-break arbitrario. In caso **ambiguo** la localizzazione resta `ambiguous` e la riunione **non è
  pronta** (`ambiguousLocationQuestion` chiede al Presidente di sciogliere).
- **Nuovo modulo puro** `frontend/src/components/Game/meetingEngineRead.ts`: traduce
  `check-feasibility` in `MeetingEngineRead`; `regionId`/`regionLabel` arrivano **solo** dalla
  localizzazione canonica.
- `councilMeeting.ts`: `MeetingExecutionPlan.regionId` popolato **solo** se `location.status !==
  'ambiguous'`; `meetingActDraft` rimanda `regionId` nella `workDeclaration`; nuovo requisito
  `kind: 'location'` come blocco quando manca la scelta.
- **Backend (C, additivo)**: `WorkCommitTurn.ts` usa `declaration.regionId ?? input.regionId`, quindi
  la regione decisa nell'atto **vince** su quella dell'ordine e arriva a `context_json` del progetto.
  `schemas.ts` accetta `regionId` opzionale nella dichiarazione; `cabinetOrder.ts`/`api.ts` lo
  propagano. **Non toccata la logica di commit** (punto 12): la dichiarazione continua a essere
  prenotata solo alla firma.

### 2.2 Tesoro allineato alla disponibilità autorevole (punto 2) — B + A
- **Backend (B)**: `Availability.measureDeficits` espone ora `availableMoney` **anche quando copre**;
  `FeasibilityService` copia `deficits`/`unknownRequirements`/`availableMoney` nell'`OrderAssessment`;
  la rotta `check-feasibility` restituisce `deficits` e `availability: { money }`. È la **stessa**
  `measureDeficits` che produce `workDeclaration.funded`: Tavola, Feasibility e `funded` non possono
  più contraddirsi.
- **Frontend (A)**: `moneyCoverageFromFeasibility` compone `required/available/missing/holder/unit` dai
  campi del motore; `margin` è l'unica cifra derivata (differenza fra due numeri del motore, marcata
  di visualizzazione). Sparita la dipendenza dal conto nazionale per la riunione.
- Invariante difesa: mai «coperta» con `funded=false` senza un blocco — `meetingRequirementsFromRead`
  aggiunge un blocco di copertura quando manca.

### 2.3 Memoria del turno precedente (punto 3) — A (nel chiamante)
- **Corretto il chiamante**, non la funzione: `GovernmentOffice.tsx` conserva un
  `PreviousGovernmentSessionRef` (turno/data **di origine**) e consolida con
  `previousSessionMemory`/`originMemoryRef`; `consolidateSessionMemory()` in `governmentSession.ts`
  resta **intatta**. I ricordi portano il turno e la data di origine (5/D5), e la nuova seduta
  riparte a turno 6 / revisione 0.

### 2.4 Voce narrativa senza autorità sui dati, con persona riusata (punti 4–11) — D
- **Nuovo modulo puro** `frontend/src/components/Game/meetingNarrative.ts`: contratto
  `MinisterMeetingBrief` (fatti con provenienza, blocchi, contesto politico, obiettivo, contributi
  precedenti), `narrativePrompt`, e `narrativeContribution` che **prova l'LLM, valida la prosa contro
  i fatti e ricade sul contributo deterministico del motore** in caso di errore o cifra inventata.
- **Persona riusata, non duplicata**: la voce arriva dal percorso esistente
  `government/minister → briefingFor() → personaSection()` del backend. Nel frontend **non esiste**
  alcun profilo di sedia (rimossa `SEAT_STYLE`); il fallback è il contributo deterministico già
  composto in `councilMeeting.ts`.
- `GovernmentOffice.tsx`: `runMeeting` usa la geografia canonica (`pictureSources.regions`), chiede la
  lettura al motore, applica la lettura e per ogni contributo **esistente** (selettore invariato,
  niente sette risposte) chiede la voce con timeout (12 s) e fallback deterministico. La
  conversazione resta **una** (`AdvisorMessage.speaker`).

### Path reale di `MinisterPersona` (FASE 1)
Il file **esiste** in `backend-nest/src/core/government/MinisterPersona.ts` (non nel frontend) e
contiene `MinisterPersona`, `MINISTER_PERSONAS` (7 personalità), `personaFor()`, `personaSection()`,
`firstMessage()`. È stato **riusato** tramite il percorso `briefingFor()`; nessun secondo
`MinisterPersona` è stato creato.

---

## 3. File modificati

**Nuovi (frontend, moduli puri + test):**
- `frontend/src/components/Game/meetingLocalization.ts` / `.test.ts`
- `frontend/src/components/Game/meetingEngineRead.ts` / `.test.ts`
- `frontend/src/components/Game/meetingNarrative.ts` / `.test.ts`
- `backend-nest/tests/ws-gov-council-hardening.test.ts`

**Modificati (frontend):**
- `frontend/src/components/Game/GovernmentOffice.tsx` — lettura dal modulo puro, localizzazione
  canonica, narrativa con fallback, provenienza della seduta precedente
- `frontend/src/components/Game/councilMeeting.ts` / `.test.ts` — copertura monetaria strutturata,
  localizzazione in esecuzione, requisito `location`, `regionId` nell'atto
- `frontend/src/components/Game/governmentSession.ts` / `.test.ts` — `PreviousGovernmentSessionRef`,
  `originMemoryRef`, `previousSessionMemory` (funzione esistente intatta)
- `frontend/src/components/Game/cabinetOrder.ts` — `regionId` nella dichiarazione
- `frontend/src/services/api.ts` — tipi `deficits`/`availability` e `regionId` nella coda

**Modificati (backend, additivi, fuori dal freeze):**
- `backend-nest/src/core/feasibility/Availability.ts` — `availableMoney` misurato anche da coperto
- `backend-nest/src/core/feasibility/FeasibilityService.ts` — `DeficitFact`, copia di
  `deficits`/`unknownRequirements`/`availableMoney`
- `backend-nest/src/game/OrderExecutionService.ts` — `PendingWorkOrder.regionId`, passaggio di
  `availableMoney`
- `backend-nest/src/game/WorkCommitTurn.ts` — `declaration.regionId ?? input.regionId`
- `backend-nest/src/routes/games/actions.routes.ts` — `deficits` + `availability.money` nel response
- `backend-nest/src/routes/games/schemas.ts` — `regionId` opzionale

**E2E / asset:**
- `e2e/mock-api.mjs` — regione canonica `SARAJEVO`, `deficits`/`availability`, voce della riunione
- `e2e/tests/ws-gov-council-meetings.spec.mjs` — test localizzazione + fallback provider
- `docs/implementation/assets/ws-gov-council-meetings/390x844-riunione-fabbrica.png` (rigenerato)
- asset E2E rigenerati dalle suite richieste (`ws-gov-dialogue-to-act`, `ws-gov-seat-boards`)

**Deliverable:** `docs/implementation/WS-GOV-COUNCIL-HARDENING-report.md` (questo file).

---

## 4. Conferma CORE ENGINE FREEZE

`backend-nest/src/core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/database, repository, semantica checkpoint/simulation-run/playback e la
pipeline di avanzamento del tempo **non sono stati toccati**. Le uniche modifiche backend sono
**additive** in `core/feasibility/**` (misura, nessuna nuova regola di gioco) e due punti di
passaggio (`OrderExecutionService`, `WorkCommitTurn`) che **non cambiano** la logica di prenotazione:
la dichiarazione continua a essere prenotata solo alla firma, e nessuna risorsa è impegnata durante la
riunione. Nessuna modifica E, nessuna migrazione.

---

## 5. Test eseguiti (esito reale)

| Suite | Comando | Esito |
|---|---|---|
| Backend vitest (full) | `npx vitest run` (backend-nest) | **220 file / 2344 test verdi** |
| Backend type-check + build | `npm run build` (tsc) | **verde** |
| Frontend vitest (full) | `../node_modules/.bin/vitest run` | **143 file / 1218 test verdi** |
| Frontend type-check | `tsc --noEmit` | **verde** |
| Frontend build | `npm run build` (vite) | **verde** |
| E2E richiesti | council meetings, dialogue-to-act, seat boards, turn sessions, signatures, consequence board (+ P1 council) | **12/12 verdi** |
| E2E mappa/smoke/moduli | map-p1, map-p2, mock-smoke, modules, preset-map-ui | **38/38 verdi** |

Test mirati nuovi:
- `meetingLocalization.test.ts` — risoluzione, ambiguità, toponimi, nessun ID inventato.
- `meetingEngineRead.test.ts` — Tesoro `240/270/0` e `240/180/60`, accordo con `funded`,
  localizzazione e ambiguità (punto 16).
- `meetingNarrative.test.ts` — brief/fatti, validazione anti-cifra-inventata, fallback
  deterministico (punti 18/19).
- `governmentSession.test.ts` — provenienza temporale turno 5/D5 al cambio a turno 6 (punto 17).
- `ws-gov-council-hardening.test.ts` (backend) — `availableMoney` da coperto/scoperto, copia in
  `evaluate`, e `regionId` canonico fino a `context_json` del progetto.
- E2E: `regionId === 'SARAJEVO'` nel payload accodato; fallback con provider 500 → voce
  deterministica, atto e firma continuano.

---

## 6. Risultati

- **Localizzazione**: `meeting.execution.regionId` è popolato solo con una regione canonica risolta;
  la dichiarazione d'opera porta `regionId` e il commit lo scrive nel contesto del progetto. Con più
  candidati l'atto è bloccato finché il Presidente non chiarisce.
- **Tesoro**: una sola verità. Tavola, `check-feasibility` e `workDeclaration.funded` vengono dalla
  stessa `measureDeficits`; impossibile «coperta» con `funded=false` senza blocco.
- **Memoria**: la decisione del turno 5 resta datata 5/D5; la nuova seduta riparte a turno 6,
  revisione 0. `consolidateSessionMemory()` invariata.
- **Narrativa**: gli interventi sono narrativi e attribuiti nel flusso unico, con i fatti separati
  dalla voce; la personalità è quella del backend (`MinisterPersona`), non una copia frontend; il
  fallback deterministico tiene la riunione in piedi se l'LLM manca o inventa cifre.
- Nessun nuovo motore, core engine congelato, nessuna migrazione.

---

## 7. Limiti residui

- **Quantità (punto 13)**: «Facciamone due invece di una» **non** è supportato. Il motore non accetta
  una quantità strutturata e il progetto vieta esplicitamente un moltiplicatore client-side dei costi
  (`cost * 2`, `materials * 2`). Resta `unresolved: "Il motore non supporta ancora la quantità
  richiesta."` Sarà un task successivo con supporto nel motore.
- **Localizzazione per sinonimi/geografia storica**: il resolver confronta il testo con
  `Region.name` (più toponimo). Non risolve esonimi o nomi storici non presenti nella geografia della
  partita; in quel caso la localizzazione resta `missing` (nessun blocco, comportamento precedente)
  invece di risolvere. L'ambiguità, invece, blocca.
- **Persistenza della voce narrativa**: la chiamata narrativa usa il percorso esistente
  `government/minister`, che registra lo scambio in JEV/memoria (best-effort). È voluto (la riunione
  entra nella memoria della sedia) ma non è un effetto neutro; se in futuro si vorrà una narrativa
  «usa e getta» servirà un percorso senza side-effect.
- **`margin`** è un valore derivato di sola visualizzazione, non un dato del motore.

---

## 8. Proposte per la fase successiva

1. **Quantità strutturata nel motore**: estendere `workDeclaration` con una quantità e far calcolare
   al motore costi/materiali (non al client), chiudendo il punto 13.
2. **Localizzazione canonica estesa**: risolvere esonimi e nomi storici da un alias della geografia
   della partita, mantenendo l'ID sempre dal dato canonico.
3. **Memoria datata end-to-end**: oggi la provenienza è corretta al consolidamento; si può estendere
   l'identità `turn/date` alla resa della memoria nella nuova seduta (già presente il turno, da
   esporre anche la data in UI).
4. **Percorso narrativo senza side-effect** per la sola voce della riunione, se si vorrà separare la
   narrazione dalla memoria JEV.
