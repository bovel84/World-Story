# WS-CONSULENTE-SITUAZIONI — Report

**Data:** 2026-02
**Base:** `main` @ `f55992d` (PR #222 già mergiata)
**Branch:** `feat/ws-consulente-situazioni`
**PR:** una sola, verso `main` — **non mergiata**

---

## 1. Obiettivo

Trasformare il Consulente Presidenziale da generatore di un numero fisso di
proposte a **lettore dello stato reale della partita**:

- nessun limite cablato di 3 proposte/situazioni: il numero dipende dallo stato;
- separazione netta tra **SITUAZIONE** (ciò che merita attenzione) e
  **PROPOSTA DI ATTO** (una decisione concreta da prendere);
- grounding obbligatorio sul Dossier/fatti verificati;
- titoli concreti e ancorati a luoghi/domini reali;
- situazioni che cambiano nel tempo;
- UI non troncata a 3.

Vincolo rispettato: **modifica minima**, nessun rewrite, nessuna modifica al
core engine, nessun nuovo game state.

---

## 2. Ricognizione — dove nasceva il limite di 3

| # | Punto | File / riga | Ruolo |
|---|-------|-------------|-------|
| 1 | Default `max = 3` sulle situazioni/domande del paese | `backend-nest/src/core/government/RealitySignals.ts:97` (`nationalQuestions`) e `:101` (`nationalSituationLines`) | Tagliava a 3 i segnali reali prima di diventare "situazioni" |
| 2 | Testo prompt "una o più di tre" | `CouncilIssue.ts` (`COUNCIL_ISSUE_PROTOCOL`), `RealityAdvisor.ts` (`ADVISOR_OPENING_REQUEST`, `ADVISOR_TURN_BRIEFING_REQUEST`, sezione FORMA LIBERA) | Dettava al modello la quota 3 |
| 3 | "Per ogni questione produci la relativa scheda `council_issue`" | `RealityAdvisor.ts` (`ADVISOR_OPENING_REQUEST`) | Trasformava automaticamente **ogni** situazione in una proposta di atto |
| 4 | Taglio frontend a 3 sulle domande del paese | `frontend/src/components/Game/openingBriefing.ts` (`questions: … .slice(0, 3)`) | UI del briefing di apertura troncata |
| 5 | Taglio frontend a 3 sulle situazioni | `frontend/src/components/Game/GovernmentSituations.tsx` (`decisions.slice(0, 3)`) | Lista situazioni troncata (componente legacy, non montato) |

**Usi di `nationalQuestions`/`nationalSituationLines`:** solo
`state.routes.ts:304-305` (apertura partita) e il test `preset-reality-smoke`.
Nessun altro consumatore dipendeva dal default 3.

**Fuori perimetro (non toccati):**
- `CompactBriefing` (`maxItems = 3`): striscia HUD compatta del briefing
  strategico, non la lista situazioni del Consulente.
- `GovernmentSituations.tsx` è **legacy / non montato** (non importato altrove
  se non da sé stesso e dai test): modificato solo per coerenza "UI non troncata".
- `governmentOperatingPicture.ts` / `OperatingPictureBoard.tsx` (`slice(0,3)`):
  quadro per dominio del Dossier, non situazioni del Consulente.
- `backend-nest/src/prompts/advisor.ts` (`buildAdvisorPrompt`, "proponi 2-3
  opzioni"): **dead code**, non usato — lasciato invariato.
- `MAX_COUNCIL_ISSUES = 8`: cap tecnico anti-abuso, non una quota; mantenuto.

---

## 3. Modifiche effettuate

### 3.1 Il numero di situazioni è ora quello reale
`backend-nest/src/core/government/RealitySignals.ts`
- `nationalQuestions(snapshot, max?)` e `nationalSituationLines(snapshot, max?)`:
  il parametro `max` **non ha più default 3**. Senza argomento restituiscono
  **tutte** le situazioni realmente misurate (zero se non c'è nulla); `max`
  resta solo un tetto tecnico opzionale per eventuali chiamanti.

### 3.2 SITUAZIONE vs PROPOSTA DI ATTO (advisor-only)
`backend-nest/src/core/government/CouncilIssue.ts`
- Nuova costante esportata **`SITUATION_PROPOSAL_PROTOCOL`**:
  - distingue SITUAZIONE (descrizione, anche senza chiedere nulla) da PROPOSTA
    DI ATTO (decisione concreta → scheda `council_issue`);
  - vieta di trasformare ogni situazione in una proposta e vieta la quota;
  - impone titoli concreti e ancorati ai fatti (luogo/dominio/oggetto reale),
    vietando titoli generici.
- `COUNCIL_ISSUE_PROTOCOL`: rimossa la frase "una o più di tre" → "una o più",
  **senza aggiungere testo** (il protocollo è condiviso col ministro, che ha un
  budget di contesto stretto, JEV-W3 < 5000: la sostituzione è più corta
  dell'originale per non sforare).

`backend-nest/src/core/government/RealityAdvisor.ts`
- Import di `SITUATION_PROPOSAL_PROTOCOL` e sua inclusione **solo per
  `audience === 'advisor'`** (il ministro non lo riceve).
- `ADVISOR_OPENING_REQUEST`: non più "una o più di tre" né "per ogni questione
  produci la scheda": il Consulente **descrive le situazioni** e propone una
  scheda **solo** dove c'è un atto concreto.
- `ADVISOR_TURN_BRIEFING_REQUEST`: stessa logica (situazioni dinamiche +
  proposte solo per atti concreti).
- Sezione FORMA LIBERA: rimossa la quota; aggiunto "una situazione può restare
  senza proposta".

### 3.3 Grounding e situazioni nel tempo
- Il grounding era già garantito dai fatti canonici (`signalKeys`/`anchorKeys`
  validati server-side); è stato **rafforzato a livello di istruzione** con
  `SITUATION_PROPOSAL_PROTOCOL` (titoli ancorati, separazione situazione/atto).
- Le situazioni sono già ricostruite ad ogni turno dai segnali dello snapshot
  (`buildRealitySignals`), quindi **cambiano nel tempo per costruzione**: nessuna
  modifica al motore necessaria.

### 3.4 UI non troncata a 3
- `frontend/src/components/Game/openingBriefing.ts`: rimossa `questions.slice(0,3)`
  → tutte le situazioni reali del paese.
- `frontend/src/components/Game/GovernmentSituations.tsx`: rimossa
  `decisions.slice(0, 3)` (componente legacy, non montato).

### 3.5 Commenti allineati
`state.routes.ts`, `OpeningNarrative.ts`: commenti "1-3 questioni" aggiornati.

### 3.6 Test mirati aggiornati (nessuna suite estesa aggiunta)
- `backend-nest/tests/council-issue-variety.test.ts`: verifica assenza della
  quota "una o più di tre"; nuovo test su `SITUATION_PROPOSAL_PROTOCOL`.
- `backend-nest/tests/advisor-strategist-voice.test.ts`: asserzioni sul nuovo
  testo (no "una o più di tre"; presenza separazione situazione/proposta).
- `backend-nest/tests/polity-historical-baselines.test.ts`: asserzione su
  `ADVISOR_OPENING_REQUEST` aggiornata.
- `backend-nest/tests/preset-reality-smoke.test.ts`: non più `≤ 3`; le domande
  del briefing devono coincidere con `nationalQuestions(snapshot)` (prova di
  non-troncamento).

---

## 4. File modificati

**Backend**
- `backend-nest/src/core/government/RealitySignals.ts`
- `backend-nest/src/core/government/CouncilIssue.ts`
- `backend-nest/src/core/government/RealityAdvisor.ts`
- `backend-nest/src/core/government/OpeningNarrative.ts` (commento)
- `backend-nest/src/routes/games/state.routes.ts` (commento)
- `backend-nest/tests/council-issue-variety.test.ts`
- `backend-nest/tests/advisor-strategist-voice.test.ts`
- `backend-nest/tests/polity-historical-baselines.test.ts`
- `backend-nest/tests/preset-reality-smoke.test.ts`

**Frontend**
- `frontend/src/components/Game/openingBriefing.ts`
- `frontend/src/components/Game/GovernmentSituations.tsx`

**Report**
- `docs/implementation/WS-CONSULENTE-SITUAZIONI-report.md`

Nessuna modifica a core engine, database/schema, repository, turn pipeline,
Governo/CouncilRoom, JEV/worldPulse.

---

## 5. Come viene deciso oggi il numero di situazioni/proposte

1. `buildRealitySignals(snapshot)` misura i segnali reali dello stato canonico.
2. `nationalQuestions`/`nationalSituationLines` restituiscono **tutti** i segnali
   (nessun taglio a 3; `max` solo opzionale).
3. Il Consulente riceve i segnali + gli anchor già esistenti; con
   `SITUATION_PROPOSAL_PROTOCOL` **descrive** le situazioni e **propone** una
   scheda `council_issue` solo per le situazioni che richiedono un atto.
4. Il numero di schede è quindi **derivato dallo stato**; il solo tetto è il cap
   tecnico anti-abuso `MAX_COUNCIL_ISSUES = 8` (non presentato come quota).
5. In UI il briefing di apertura mostra tutte le domande reali.

---

## 6. Logica vecchia rimasta da ripulire (fuori scope, segnalata)

- **`backend-nest/src/prompts/advisor.ts` — `buildAdvisorPrompt`**: dead code,
  contiene ancora "proponi 2-3 opzioni"; può essere rimosso in un task di pulizia.
- **`frontend/src/components/Game/GovernmentSituations.tsx`**: componente
  **legacy non montato** (situazioni del vecchio loop). Ora coerente col resto,
  ma candidato all'eliminazione.
- **`frontend/src/components/Game/CompactBriefing.tsx`** (`maxItems = 3`):
  striscia HUD compatta, per design sintetica; da rivalutare solo se si vuole
  che mostri più voci.
- **`deriveCouncil(...).slice(0,3)` e `rankWorldFacts(...,3)`** in
  `openingBriefing.ts`: riguardano voci del Consiglio e fatti del mondo
  nell'apertura, non le situazioni del Consulente; lasciati volutamente.

---

## 7. Verifiche

- `backend-nest`: `tsc --noEmit` pulito; suite completa **2981 test passati**
  (i 6 fallimenti residui sono artefatti `dist/*.test.js` CommonJS preesistenti,
  esclusi dalla CI).
- `frontend`: `tsc --noEmit` pulito; suite completa **1425 test passati**
  (166 file).
- Budget prompt ministro (JEV-W3) ancora sotto 5000 grazie alla sostituzione
  neutra in `COUNCIL_ISSUE_PROTOCOL` (protocollo advisor-only per il resto).
