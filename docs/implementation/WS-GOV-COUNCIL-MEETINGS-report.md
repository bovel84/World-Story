# WS-GOV-COUNCIL-MEETINGS — Report di Fase B

**Workstream:** WS-GOV-TURN-SESSIONS + WS-GOV-COUNCIL-MEETINGS (roadmap `pi-task-ws-gov-turn-sessions-council.md`)
**Fase:** B — la riunione di Governo è uno stato condiviso
**Branch:** `feat/ws-gov-council-meetings` (impilato su Fase A: `feat/ws-gov-turn-sessions-council`)
**Base:** Fase A (PR #168), a sua volta impilata su `feat/ws-gov-seat-boards` (PR #167, non ancora unita a `main`)

---

## 1. Problemi trovati (causa reale)

Una decisione che attraversa più competenze non aveva una sede:

1. **Nessuno stato di riunione.** L'ufficio conosceva solo `DecisionWorkspace` **per sedia**
   (`workspaces[seat]`) e la promozione di una singola proposta al Consiglio (WS-GOV-SEAT-BOARDS).
   Non esisteva un piano **condiviso** costruito da più ministri sulla stessa proposta.
2. **Nessun selettore dei partecipanti.** Non c'era modo di decidere, in modo deterministico,
   chi dovesse sedersi: il rischio era o un solo ministro, o «sette chatbot che parlano a caso».
3. **Rischio di numeri inventati.** Senza un confine esplicito, una conversazione fra agenti avrebbe
   potuto produrre costi e disponibilità non letti dal motore (`FeasibilityService`,
   `NationalAccounts`, distinta d'opera).
4. **La dichiarazione d'opera si perdeva.** Un atto nato da una discussione generica ricadeva su
   `actDraftFromProposal` → `text-order`: una fabbrica sarebbe diventata prosa, non un cantiere.
5. **Nessuna distinzione preview/commit.** Durante la discussione non esisteva un confine esplicito
   che vietasse prenotazioni prima della firma.

---

## 2. Correzioni applicate

### B1–B3 — Contratti (`councilMeeting.ts`, modulo puro)
`CouncilMeeting`, `MinisterContribution` (attribuito con `seat`, `kind`, `refs`, `turn`),
`MeetingRequirement` (con `blocker`: blocco del motore vs obiezione politica), `MeetingWorkspace`
(un **unico** piano condiviso, con righe `owner/label/value/status/source`), `MeetingExecutionPlan`.
Una nuova riunione per turno (`openMeeting`), l'id è `game|branch|turn|partecipanti`.

### B4/B5 — Selettore e capofila deterministici
`PARTICIPANT_RULES` (parole chiave → sedie) e `LEAD_RULES`; una costruzione aggiunge sempre il
Tesoro; l'ordine dei partecipanti è quello del gabinetto. Nessun LLM decide chi partecipa.

### B6 — Orchestrazione, non chat libera
`applyEngineRead` è un **reducer deterministico**: dal `MeetingEngineRead` (mappa di
`check-feasibility` + conto nazionale) costruisce piano, requisiti e contributi del **capofila** e
del **Tesoro**. Gli interventi sono idempotenti (id stabile sul contenuto) e attribuiti.

### B7–B10 — I motori reali, non il modello
`meetingReadFromFeasibility` mappa `check-feasibility` (`costs`, `risks`, `prerequisites`,
`workDeclaration`) e il conto nazionale (`money`) in `MeetingEngineRead`. Lavori legge opera,
durata, distinta (`missingMaterials`); Tesoro legge costo, nota di copertura, disponibile e
copertura (`funded` + `materialActorId`). Ogni riga dichiara la sua **provenienza**.

### B11 — Preview ≠ commit
La riunione **legge**: non chiama `actions/queue`, non crea prenotazioni. Solo la firma del
Presidente (`onQueueOrder` → coda) e l'esecuzione del motore usano `WorkCommitService`.

### B12 — UI della riunione
`CouncilMeetingBoard`: una sola tavola condivisa (LAVORI/TESORO con le righe del motore), «Da
risolvere» (blocchi vs obiezioni), «Rischi», «Evidenze» (chiuse), le altre competenze convocabili, e
l'atto. La conversazione resta **una**: i contributi entrano nello **stesso** filo della sedia
aperta, ciascuno con la sua voce (`AdvisorMessage.speaker`).

### B14 — Contraddittorio
I rischi di cassa/materiali/manodopera diventano `MeetingRequirement` con `blocker: true`; il
dissenso politico resta `blocker: false` e **non** blocca l'atto se il motore è favorevole.

### B15/B16 — L'atto conserva la dichiarazione d'opera
`meetingActDraft` costruisce l'atto dal **piano condiviso**. Se il server ha risolto
`workDeclaration` con `materialActorId`, l'atto porta `work` e resta `engine-order`; se la distinta
è scoperta lo dichiara (`unsupported`, «mancano i materiali»); senza dichiarazione resta prosa. La
fabbrica non diventa mai silenziosamente prosa.

### B18/B19 — Test verticale e resa
`councilMeeting.test.ts` + `councilMeetingRender.test.tsx` (puri) e
`e2e/tests/ws-gov-council-meetings.spec.mjs` (fabbrica + cassa insufficiente).

### Classificazione A/B/C/D/E
UI + read model (A/B). **Nessuna** modifica E, **nessuna** migrazione: `AdvisorMessage.speaker` e
`AdvisorHistoryItem.speaker` sono campi di UI in memoria; `costs.note`/`category` sono già
restituiti dal server.

---

## 3. File modificati

Nuovi:
- `frontend/src/components/Game/councilMeeting.ts` — contratti, selettore, capofila, orchestrazione, piano, atto (puro)
- `frontend/src/components/Game/councilMeeting.test.ts` — 13 test
- `frontend/src/components/Game/CouncilMeetingBoard.tsx` — la tavola della riunione
- `frontend/src/components/Game/councilMeetingRender.test.tsx` — 4 test
- `e2e/tests/ws-gov-council-meetings.spec.mjs` — E2E verticale (fabbrica + cassa insufficiente)
- `docs/implementation/assets/ws-gov-council-meetings/390x844-riunione-fabbrica.png`

Modificati:
- `frontend/src/components/Game/GovernmentOffice.tsx` — stato `meeting`, `conveneMeeting`, orchestrazione, `meetingReadFromFeasibility`, `prepareMeetingAct`, prompt di convocazione
- `frontend/src/components/Game/SeatTable.tsx` — `CouncilMeetingBoard`, banner di convocazione
- `frontend/src/components/Game/MinisterChat.tsx` — voce attribuita (`speaker`) nella resa; cronologia di rete senza campi di UI
- `frontend/src/stores/chatStore.ts` — `AdvisorMessage.speaker`
- `frontend/src/services/api.ts` — `AdvisorHistoryItem.speaker`; `costs.note`/`category` (già dal server)
- `frontend/src/editorial.css` — stile della tavola della riunione e della convocazione
- `e2e/mock-api.mjs` — `check-feasibility` con dichiarazione d'opera (coperta/scoperta)

Nessun file backend è stato modificato.

---

## 4. Conferma CORE ENGINE FREEZE

`backend-nest/src/core/simulation/**`, `GameSession`, `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/DB/migrazioni, repository, checkpoint/playback e la pipeline di
avanzamento del tempo **non sono stati toccati**. La riunione **riusa** i motori esistenti in sola
lettura (`check-feasibility`); nessun secondo motore economico, nessuna prenotazione durante la
discussione. Il motore resta l'autorità su costi, risorse, esecuzione e conseguenze.

---

## 5. Test eseguiti (esito reale)

| Gate | Comando | Esito |
|---|---|---|
| Frontend unit | `cd frontend && ../node_modules/.bin/vitest run` | **140 file, 1196 passati, 1 skip** |
| Frontend tsc | `cd frontend && ../node_modules/.bin/tsc --noEmit` | **0 errori** |
| Frontend build | `cd frontend && npm run build` | **0 errori** |
| Backend test | `cd backend-nest && ../node_modules/.bin/vitest run` | **219 file, 2338 passati** |
| Backend build | `cd backend-nest && npm run build` (+ `rm -rf dist`) | **0 errori** |
| E2E Fase B | `playwright test tests/ws-gov-council-meetings.spec.mjs` | **2/2** |
| E2E regressione aree toccate | council + turn-sessions + dialogue-to-act + seat-boards + p1 + p7 + signatures | **11/11** |

Test nuovi (puri):
- `councilMeeting.test.ts` (13): selettore (fabbrica → Lavori+Tesoro, ospedale → Sanità+Lavori+Tesoro,
  mono-competenza → nessuna), capofila, determinismo dell'id, piano con provenienza, contributi
  attribuiti e senza numeri inventati, pronta per l'atto, atto con `workId` (distinta coperta) e
  `unsupported` (distinta scoperta), cassa insufficiente → obiezione + requisito + non pronta,
  dissenso politico ≠ blocco, idempotenza, nuova riunione per turno.
- `councilMeetingRender.test.tsx` (4): oggetto/partecipanti/competenze, pulsante d'atto quando
  pronta, blocco del motore senza pulsante, evidenze chiuse.

E2E Fase B:
- **Fabbrica**: la richiesta multi-competenza propone la riunione → il Presidente la convoca →
  Lavori+Tesoro con piano e provenienza `check-feasibility` → conversazione **una** con voci
  attribuite, senza payload interni → nessun atto nel registro durante la discussione → l'atto porta
  `workDeclaration` e risulta «ordine d'opera supportato» → solo la firma accoda (`accodato`).
- **Cassa insufficiente**: il Tesoro dice «Non c'è la copertura necessaria», la Tavola mostra
  «blocco del motore» e il requisito di cassa; **nessun** pulsante d'atto.

**Non eseguito / non dichiarato verde:** matrice E2E a 4 viewport; suite E2E completa (una sola volta
a fine blocco). Il literal `npm test` del frontend resta assente: il runner reale è `vitest run`.

---

## 6. Risultati

- Una decisione multi-competenza vive in una `CouncilMeeting`: selettore e capofila deterministici,
  un solo piano condiviso, contributi **attribuiti** e **letti dal motore**.
- Nessun valore è inventato: ogni riga dichiara la provenienza (`check-feasibility`,
  `national-accounts`); il modello non è mai database.
- Preview ≠ commit: durante la riunione nessuna riserva; solo la firma accoda.
- L'atto nasce dal piano condiviso e conserva la `workDeclaration` reale: la fabbrica resta un ordine
  d'opera.
- La cassa insufficiente è un blocco del motore, mostrato, senza soluzioni inventate.
- Nessuna regressione: 11/11 E2E delle aree toccate; suite complete verdi.

---

## 7. Limiti residui

- **Convocazione esplicita.** B7 chiede che la frase apra automaticamente la riunione. Un intercept
  automatico su ogni chat di sedia si è rivelato incompatibile con le sedute singole già esistenti
  (dialogue-to-act, seat-boards, P1): «infrastrutture», «fabbrica», «porto» aprivano una riunione al
  posto del colloquio col ministro. Scelta: la richiesta multi-competenza **propone** la riunione
  («Convoca la riunione») e il Presidente la convoca. L'orchestrazione resta deterministica.
- **B13 (interventi spontanei su modifica).** Il meccanismo c'è (nuova lettura + dedup per id), ma la
  rilettura usa l'oggetto della riunione: una variazione di quantità («due invece di una») non è
  ancora ricalcolata dal motore, che non riceve la variazione. Richiede supporto del motore.
- **B17 (casi futuri).** La struttura li supporta (selettore, capofila, tavola, convocazione di
  altre sedie), ma solo la fabbrica è coperta da test; ospedale/università/fortificazioni/import/
  riforma sociale non hanno un E2E dedicato.
- **Etichetta dell'opera.** Il `workId` è quello risolto dal server; l'etichetta leggibile è la frase
  del Presidente (il motore non restituisce il nome del catalogo). Nessuna invenzione: il riferimento
  reale è il `workId`.
- **`availableLabel` dal mock.** Nel caso «cassa insufficiente» la fixture del conto nazionale non
  scala (il disponibile resta alto): il blocco mostrato è quello del motore (`funded: false`), non un
  ricalcolo del client.
- **Stacking.** Fase A e Fase B sono impilate su `feat/ws-gov-seat-boards` (PR #167). I due report
  saranno su `main` solo dopo l'unione della catena.

---

## 8. Proposte per la fase successiva

1. Unire la catena #167 → #168 → (questa PR) per portare su `main` i report di Fase A e Fase B.
2. Convocazione **automatica** quando la richiesta è multi-competenza e la sedia aperta non è il
   capofila, mantenendo la seduta singola quando lo è (risolve il conflitto senza perdere B7).
3. B13 completo: inviare la variazione di quantità al motore (`check-feasibility` con la variazione)
   e ricalcolare piano e requisiti.
4. B17: E2E verticali per ospedale, università, fortificazioni, import e riforma sociale, riusando
   le stesse regole del selettore.
5. Eseguire **una sola volta** la suite E2E completa a fine blocco, quando la catena è su `main`.
