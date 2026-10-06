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

---

# Iterazione 2 — `AdvisorSituation` come oggetto di prima classe

La PR #223 aveva tolto il limite di 3, ma le «situazioni» restavano testo: solo
le `CouncilIssue` erano cliccabili. Questa iterazione separa davvero i due
concetti e rende la situazione una card reale nel Consulente.

## Flusso

```
Dossier + stato reale + storia del turno
        ↓  buildRealitySignals()  (canonico)
AdvisorSituation[]                → card cliccabili nel Consulente
        ↓  «Approfondisci»
      discussione col Consulente
        ↓  (eventuale, e solo se c'è un atto concreto)
CouncilIssue                      → «Porta al Consiglio»
```

## 1. File modificati (iterazione 2)

**Backend**
- **`backend-nest/src/core/government/AdvisorSituations.ts`** (nuovo): tipo,
  schema, validazione, derivazione deterministica, parser, merge, serializzazione.
- `backend-nest/src/core/government/RealitySignals.ts`: `subject`/`title` sul
  segnale; granularità per entità di **vicini ostili**, **fronti attivi** e
  **opere in ritardo**.
- `backend-nest/src/core/government/CouncilIssue.ts`: `SITUATION_PROPOSAL_PROTOCOL`
  descrive il blocco ```advisor_situation e i titoli concreti.
- `backend-nest/src/core/government/RealityAdvisor.ts`: `RealityAdvisorResult`
  espone `situations`; apertura/turn-briefing citano il blocco.
- `backend-nest/src/prompt-builder.ts`: `validatedAdvisorText` usa
  `parseAdvisorResponse`/`serializeAdvisorResponse` (round-trip che non perde le
  situazioni).
- `backend-nest/src/game-session.ts`: `getAdvisorOpening`/`getRealityAdvisor`
  usano `parseAdvisorResponse`.
- `backend-nest/tests/advisor-situations.test.ts` (nuovo).

**Frontend**
- `frontend/src/services/api.ts`: tipo `AdvisorSituation`; `situations?` su
  `RealityAdvisorResponse`.
- `frontend/src/stores/chatStore.ts`: `situations?` su `AdvisorMessage`.
- `frontend/src/components/Game/advisorMemory.ts`: `sanitizeSituations`, persistenza
  su messaggi e apertura; cache apertura `v5`.
- `frontend/src/components/Game/advisorOpening.ts`: propaga `situations`.
- **`frontend/src/components/Game/AdvisorSituationsPanel.tsx`** (nuovo): card con
  titolo, sintesi e «Approfondisci».
- `frontend/src/components/Game/AdvisorChat.tsx`: rende `opening.situations` e
  `message.situations`; il focus-situazione e l'invio al Consulente.
- `frontend/src/components/Game/councilRoom.css`: stile delle card.
- `frontend/src/components/Game/advisorSituations.test.tsx` (nuovo) e
  `advisorMemory.test.ts` (test situazioni).

## 2. Dove vengono create le AdvisorSituation

Sempre **server-side**, in `AdvisorSituations.ts`:

- **`buildAdvisorSituations(snapshot)`** — base deterministica: una situazione
  per ogni `RealitySignal` realmente misurato (escluse le decisioni già prese),
  con `id` stabile, titolo concreto, `summary = signal.reason`, `importance` dal
  segnale. È la garanzia che il modello non possa nascondere un problema reale.
- **`parseAdvisorSituations(snapshot, text)`** — estrae i blocchi
  ```advisor_situation prodotti dal modello.
- **`parseAdvisorResponse(snapshot, text, origin)`** — punto unico: unisce le due
  fonti con `mergeAdvisorSituations` e ritorna `{ reply, situations, issues }`.
  Il modello **non** può far sparire un segnale (la base resta) né inventarlo.

La granularità (F) è nel segnale, non nel testo: `RealitySignals` emette un
segnale per **entità** — `hostile-relations:<polityId>` (o `hostile-relations`
con un solo rapporto, retrocompatibile), `conflict:<frontId>`,
`late-projects:<projectId>` — mantenendo aggregati solo i problemi sistemici
(liquidità nazionale, tensione sociale generale).

## 3. Come vengono validate

- **Schema zod** `advisorSituationInputSchema`: `title` (1..240), `summary`
  (1..600), `signalKeys` (1..12 chiavi). L'`id` è opzionale e viene generato dal
  server; `importance` **non** si accetta dal modello.
- **`resolveSignalLinks`**: ogni `signalKey` è risolta contro
  `buildRealitySignals(snapshot)`. Una chiave ignota **invalida** la scheda
  (`Unknown reality signal key: …`), mai accettata in parte.
- **`importance`** = massimo dei segnali risolti (autorità del server).
- **Parser fail-soft**: `parseAdvisorSituations` scarta il blocco non valido e
  riporta il motivo (`onDiscard`/log), come `parseCouncilIssues`.
- **Frontend**: `sanitizeSituations` valida la forma (id/titolo/sintesi
  presenti, `signalKeys` stringhe deduplicate); il server rileggerà e
  rivaliderà le chiavi. Un payload senza `situations` è trattato come `[]`
  (retrocompatibilità, requisito I).

## 4. Come il click «Approfondisci» arriva al Consulente

In `AdvisorChat.tsx`, `AdvisorSituationsPanel` espone solo il callback
`onDeepen` (nessun `onOpenIssue`):

1. `deepen(situation)` imposta `situationFocus` (banner «Situazione in esame»);
2. costruisce il messaggio `buildSituationFocusMessage(situation)`
   («Approfondiamo la situazione «Titolo»: sintesi.»);
3. lo invia con lo **stesso trasporto del Consulente** (`advisorApi.reality`),
   che restituisce `reply`, `situations` e `issues` separati;
4. il Consiglio si apre **solo** dal pulsante «Porta al Consiglio» di una
   `CouncilIssue` (`CouncilIssueInline` → `onOpenIssue`).

## 5. Punti dove situazione e CouncilIssue sono ancora confuse

- **Nessun punto funzionale**: `situations` e `issues` sono array separati in
  `AdvisorSituation`/`CouncilIssue`, nel trasporto HTTP, nello store e nella UI;
  il pulsante che apre il Consiglio vive solo su `CouncilIssue`.
- **`AdvisorChat`**, per un solo caso, mostra ancora «Approfondisci {titolo}»
  anche su una `CouncilIssue` (comportamento storico che imposta il focus del
  Consulente). È un residuo di UX, non una confusione di modello dati: si può
  rimuovere in una pulizia successiva.
- **`backend-nest/src/prompts/advisor.ts` (`buildAdvisorPrompt`)** resta dead
  code con «proponi 2-3 opzioni»: fuori percorso, da eliminare.
- **`frontend/src/components/Game/GovernmentSituations.tsx`** resta un
  componente legacy non montato, concettualmente affine ma non il percorso del
  Consulente.

## Verifiche (iterazione 2, mirate — nessuna suite completa)

- `backend-nest`: `tsc --noEmit` pulito.
- `frontend`: `tsc --noEmit` pulito.
- Backend mirati: `advisor-situations` (6), più `reality-advisor`,
  `council-proposal-anchors`, `council-issue-variety`, `council-signalkeys`,
  `advisor-strategist-voice`, `preset-reality-smoke`,
  `government-salience-snapshot`, `ws-jev-w3-minister`,
  `polity-historical-baselines`, `reality-advisor-routes`, `advisor`,
  `advisor-historical-baseline`, `government-prompt`, `preset-prompts`,
  `prompts`, `reality-advisor-review`, `verified-world-session`,
  `ws-gov-minister-world-context`, `ws-jev-w4-context`,
  `narrative-context-compiler` — tutti verdi.
- Frontend mirati: `advisorSituations` (nuovo), `advisorMemory`,
  `advisorOpening`, `advisorStatus`, `governmentRealityHome`, `richTextModel`,
  `councilRoomFailureRender`, `crisisSurface` — tutti verdi.

---

# Iterazione 3 — Fix CI e focus canonico

## A. Blocchi `advisor_situation` fuori dal testo pubblico

**Causa del fallimento CI:** `validatedAdvisorText` chiamava `parseAdvisorResponse`
con il merge deterministico sempre attivo: anche quando il modello rispondeva con
sola prosa, il testo validato veniva serializzato con i blocchi
```advisor_situation``` di `buildAdvisorSituations(snapshot)`. Il percorso
proattivo (`getAdvisorUnchecked` → SSE `advisor_proactive` → `{ content }`)
pubblicava quindi quei blocchi dentro `content`.

**Fix:**
- `parseAdvisorResponse` ha ora `includeDeterministicSituations` (default `false`).
- `validatedAdvisorText` (prompt-builder) resta a `false`: la lista deterministica
  non entra più nel testo di trasporto.
- `getAdvisorUnchecked` senza `ministerSeat` (proattivo/semplice) e
  `getAdvisorStream` pubblicano **solo** `parsed.reply`.
- Il percorso ministro usa `parseAdvisorResponse` (non `parseCouncilIssues`):
  `advisor_situation` non trapela nella risposta del ministro.
- Nessun test è stato modificato per accettare i blocchi; `chats.test.ts` ha in
  più l'asserzione negativa sul `content`.

## B. Una AdvisorSituation = un RealitySignal

`advisorSituationInputSchema.signalKeys` è passato da `min(1).max(12)` a
`.length(1)`: due `signalKeys` invalidano la scheda. Sudan e Congo restano due
situazioni distinte; un problema sistemico deve essere un singolo
`RealitySignal` sistemico prodotto da `buildRealitySignals()`.

## C. `includeDeterministicSituations`

Deciso in `parseAdvisorResponse` (`AdvisorSituations.ts`), con un'unica opzione:

| Caller | Valore | Effetto |
|--------|--------|---------|
| `getAdvisorOpening` (apertura / turn briefing) | `true` | lista completa delle situazioni correnti |
| `/advisor/context` (fallback iniziale) | `buildRealitySignals` | lista completa |
| `getRealityAdvisor` (chat normale) | `false` (default) | solo eventuali nuove situazioni del modello, o nessuna |
| approfondimento (`focusSituation`) | `false` | non ristampa la lista nazionale |
| `validatedAdvisorText`, proattivo, ministro | `false` | nessuna lista automatica |

## D/E. Focus strutturato

- Frontend: `advisorApi.reality(..., signal?, focusSituation?)` invia
  `{ id, signalKey }` (mai il testo come fonte di fatti). `AdvisorChat` passa il
  focus quando `situationFocus` è attivo e lo azzera alla chiusura.
- Backend: `realityAdvisorSchema` accetta `focusSituation: { id?, signalKey }`;
  `resolveFocusSituation` risolve la chiave contro `buildRealitySignals`, ignora
  titolo/sintesi del client e ricostruisce la situazione dal segnale.
- Chiave ignota → `InvalidAdvisorSituationError` → **400** prima di generare;
  il prompt riceve `[FOCUS SITUATION — …]` con l'avviso di non ripresentare le
  altre situazioni.

## Test eseguiti (mirati)

- Backend: `tsc` pulito; `chats` (con asserzione negativa), `advisor-situations`
  (8), `reality-advisor-routes` (21, inclusi focus valido/ignoto), più i 19 file
  advisor/prompt/context e 6 file council/minister — tutti verdi.
- Frontend: `tsc` pulito; `realityAdvisorTransport` (focus payload),
  `advisorSituations`, `advisorMemory`, `advisorOpening`, `advisorStatus` — verdi.

Non modificati: core engine, database, `MAX_COUNCIL_ISSUES`, granularità di
rapporti ostili/fronti/progetti, flusso del Consiglio.

---

# Iterazione 4 — Modalità, focus e scrivania del Presidente

## 1. BRIEFING MODE vs CONVERSATION MODE

Il protocollo è stato separato in `CouncilIssue.ts`:

- `SITUATION_BASE_PROTOCOL` — sempre: SITUAZIONE ≠ PROPOSTA DI ATTO, nessuna
  quota, una situazione può restare senza proposta.
- `ADVISOR_BRIEFING_SITUATION_PROTOCOL` — **solo** apertura/nuovo turno/fallback:
  il modello emette i blocchi ```advisor_situation``` con titoli concreti e una
  sola `signalKey`.
- `ADVISOR_CONVERSATION_PROTOCOL` — chat normale e approfondimento: NON
  rigenerare l'elenco, nessun blocco salvo una NUOVA situazione distinta; con
  `focusSituation` rispondi solo su quella.

`RealityAdvisorContext.mode` (`'briefing' | 'conversation'`, default
conversation) decide quale protocollo entra nel prompt. `getAdvisorOpening` usa
`'briefing'`; `getRealityAdvisor`, `getAdvisorUnchecked` e `getAdvisorStream`
usano `'conversation'`. Le richieste di apertura/turno non duplicano più
l'istruzione: rimandano al BRIEFING MODE.

## 2. Niente lista ripubblicata nelle risposte correttive

In `getRealityAdvisor`, il ramo `verifiedRequestCorrection` ora restituisce
`{ ...initial, reply: correction, situations: [] }`. La lista completa compare
solo nel briefing/apertura.

## 3. Focus

`resolveFocusSituation` (già presente) resta l'unico punto di validazione:
una sola `signalKey`, chiave ignota → 400 `invalid_advisor_situation`, titolo e
sintesi del client ignorati. Il prompt con FOCUS SITUATION dice «Stai
approfondendo questa situazione: rispondi SOLO su di essa. Non presentare
nuovamente il quadro nazionale e non elencare le altre situazioni.»

## 4. Frontend — scrivania del Presidente

- `AdvisorSituationsPanel`: header «Situazioni sul tavolo / Questioni che
  richiedono attenzione», badge testuale `Urgente` (3) / `Da seguire` (2) /
  `Opportunità` (1), titolo `<h5>`, sintesi clampata, pulsante
  «Approfondisci →»; stato `.active` sulla card in esame; `data-many` attiva lo
  scroll quando le situazioni superano 6. Nessun JSON/`signalKeys`/importanza
  numerica.
- `AdvisorChat`: un solo banner compatto (`Situazione in esame` + titolo + ✕);
  le proposte di atto vivono in `.advisor-proposals` con «Porta al Consiglio»;
  rimosso il vecchio «Approfondisci {titolo}» dalla CouncilIssue.
- CSS: griglia a 2 colonne da 768px, 1 colonna sotto; `focus-visible` su tutti i
  pulsanti; badge leggibili senza colore.

## 5. Test

- Backend (`tsc` pulito): `advisor-situations` (+ BRIEFING/CONVERSATION prompt,
  focus), `council-issue-variety`, `polity-historical-baselines`,
  `reality-advisor-routes` (correzione → `situations: []`; chat normale → `[]`),
  `chats`, `ws-jev-w3-minister` e 19 file advisor/prompt/context + council/
  minister — tutti verdi (373 test nel batch).
- Frontend (`tsc` pulito): `advisorSituations` (badge, active, `data-many`,
  nessun dato tecnico), `advisorStatus`, `realityAdvisorTransport`,
  `advisorMemory`, `advisorOpening`, `CouncilIssueInline` — verdi.
- E2E mock: `government-situations`, `government-advisor-hub`,
  `government-situation-loop`, `govux-p4-inline`, `ws-gov-dialogue-to-act` —
  verdi (mock aggiornato con `situations` + `focusSituation`).

Non toccati: core engine, database, turn pipeline, `MAX_COUNCIL_ISSUES`,
granularità segnali, CouncilRoom, Dossier Nazionale. `MAX_ADVISOR_SITUATIONS`
resta solo tetto tecnico.
