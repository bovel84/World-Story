# WS-GOV-DIALOGUE-TO-ACT — Tavola decisionale viva e atti derivati dalla conversazione

Branch: **`feat/ws-gov-dialogue-to-act`** (da `main` aggiornato). Base verificata:
`origin/main` **`df211fd`** (merge PR #165, WS-GOVUX P7). Task letto integralmente:
`/tmp/pi-task-ws-gov-dialogue-to-act.md`. Deliverable: questo report + PR. **Nessun
merge, nessun deploy.**

Esito: **completato**. I due difetti osservati sono chiusi e il gate di qualità è
verde (dettaglio in §5). Il criterio di successo del task — *«la conversazione
modifica la Tavola, la Tavola rappresenta la proposta corrente, e l'atto nasce dalla
proposta corrente»* — è verificato end-to-end (§6).

---

## 1. Problemi trovati (causa reale)

### Difetto 1 — La conversazione col ministro era un brief, non una conversazione

Il difetto non era «il modello scrive male»: era **il contratto del prompt**. In
`MinisterChat.ts` il briefing impone al modello la struttura a tre livelli
**FATTI / LETTURA / PROPOSTA** senza dirgli che quella struttura è **interna**. Il
modello, ubbidiente, la riversava nella risposta: tre sezioni etichettate al posto
di una conversazione. Aggravante reale: il ministro è servito dal **prompt generale
del consigliere** (`getAdvisorWithPrompts`), che lo apostrofa come «Primo
Consigliere» e gli impone titoli, grassetto ed elenchi. Due contratti in conflitto,
e nessuno dei due diceva al modello che la voce della sedia deve prevalere.

**Causa**: mancava (a) il divieto esplicito di mostrare la struttura interna, (b)
la licenza di **sviluppare** idee e compromessi oltre a commentare le alternative
già presenti, (c) una **precedenza** dichiarata della voce ministeriale sullo stile
generico.

### Difetto 2 — Chat, Tavola e Atto divergevano

Il difetto non era «manca l'aggiornamento»: era **l'assenza di uno stato
strutturato** fra il dialogo e la tavola. `applyPresentation` gestiva solo la
**tela** (le direttive `tavola`), non la **proposta**: nessuno memorizzava
obiettivo, misure, percentuali, vincoli, rischi o revisioni. Di conseguenza
`prepareRoad`→`actDraftFor(road)` costruiva l'atto dal **testo iniziale della
strada**: si poteva concordare 80/20 in chat e firmare l'atto con i valori vecchi.
Chat, tavola, proposta e atto erano **quattro verità scollegate**.

**Causa**: mancava un modello puro della decisione, un canale strutturato per
aggiornarlo dal dialogo, e un ponte `proposta → atto`.

---

## 2. Correzioni applicate

### Difetto 1 — La voce del ministro, e la struttura che resta interna

- **`backend-nest/src/core/government/MinisterPersona.ts`** — `personaSection()`
  dichiara, per ogni sedia, che quella voce **prevale** sullo stile generico: «non
  un consigliere generico», «ignora le istruzioni pensate per il consigliere
  generale (titoli, grassetto, elenchi)». La sezione resta **senza cifre** (ruolo,
  non stato).
- **`backend-nest/src/core/government/MinisterChat.ts`** — il briefing aggiunge:
  - **FORMA DELLA RISPOSTA — NON MOSTRARE LA STRUTTURA**: FATTI / LETTURA /
    PROPOSTA restano **interni**; la risposta è conversazione naturale;
  - licenza di **sviluppare idee, combinare alternative, proporre compromessi**,
    purché non si inventino dati del mondo;
  - «Tu non sei il Primo Consigliere… queste istruzioni **PREVALGONO**»;
  - un blocco **PROPOSTA IN LAVORAZIONE** che documenta il canale ```` ```decision ````
    (vedi difetto 2), con la provenienza obbligatoria di ogni numero.

### Difetto 2 — Il Decision Workspace, e l'atto che nasce dalla proposta

- **`frontend/src/components/Game/decisionWorkspace.ts` (NUOVO, puro)** — il
  modello della decisione: `DecisionMeasure` (label, kind, valore/percentuale/importo,
  `status`: proposed/accepted/rejected/unresolved, `source`: engine/president/minister),
  `NegotiatedProposal` (obiettivo, misure, vincoli, assunzioni, rischi, effetti
  attesi, domande aperte, revisione, messaggi sorgente), `DecisionWorkspace`
  (stato, proposta attiva, revisione, `history`). Funzioni:
  - `applyDecisionAction` / `applyDecisionBatch` — mutazioni **pure**; una risposta
    con più azioni = **una** revisione; un **no-op** non apre revisione (confronto
    per fingerprint);
  - `isReadyForAct` — pronta solo con ≥1 misura **accettata**, nessuna `unresolved`,
    nessuna domanda aperta;
  - `workspaceStatus` / `actStaleness` — stato effettivo (incluso `act-prepared`) e
    stacco fra revisione dell'atto e revisione della proposta;
  - `parseDecisionActions` / `validateDecisionAction` / `stripDecisionFences` — il
    parser del canale, **validazione alla lettera** (vedi §5.3);
  - `withEvidenceRefs` — l'evidenza mostrata entra come **riferimento**, senza
    revisione e senza copiare il dato.
- **`frontend/src/components/Game/DecisionBoard.tsx` (NUOVO)** — la gerarchia della
  tavola: QUESTIONE / OBIETTIVO → **PROPOSTA CORRENTE** (grande e centrale, con
  stato e provenienza di ogni misura) → DA DECIDERE → CONSEGUENZE/RISCHI →
  EVIDENZE → REVISIONI → **ATTO** (comando «Trasforma questa proposta in atto»
  quando pronta; «Rigenera atto» quando la proposta è avanzata).
- **`frontend/src/components/Game/actDraft.ts`** — `actDraftFromProposal(proposal,
  context)`: l'atto nasce dalla **proposta corrente** (misure accettate + vincoli),
  con la capacità d'opera presa dalla strada d'origine quando c'è. `actDraftFor(road)`
  **resta** come fallback compatibile per le proposte non negoziate.
- **`frontend/src/components/Game/MinisterChat.tsx`** — nuovo canale `onDecision`:
  le azioni `decision` di una risposta conclusa viaggiano alla tavola; il testo
  visibile è già ripulito dal blocco.
- **`frontend/src/components/Game/GovernmentOffice.tsx`** — stato `workspaces` per
  sedia; `chatDecision` applica il lotto; `prepareFromProposal` (e «Rigenera atto»)
  costruiscono l'atto dalla proposta con la **revisione** corrente; `actStale`
  disabilita la firma finché l'atto non è rigenerato; l'evidenza mostrata è
  referenziata nel workspace.
- **`frontend/src/components/Game/SeatTable.tsx`** — la `DecisionBoard` è la prima
  cosa della tavola; quando una decisione è in corso l'atto è in fondo, non domina.
- **`frontend/src/components/Game/presentation.ts`** — `parsePresentation` estrae
  anche le azioni `decision` (campo `decisions`) e le toglie dal testo visibile.
- **`frontend/src/editorial.css`** — blocco `.decision-*` (nessun `!important`).

---

## 3. File modificati

Classificazione locale del modulo Governo: **A** comportamento/layout, **B** harness
E2E, **C** test, **D** report/assets, **E** congelati.

| File | Classe | Perché |
|---|---|---|
| `backend-nest/src/core/government/MinisterPersona.ts` | **A** | Voce della sedia che prevale sullo stile generico (difetto 1) |
| `backend-nest/src/core/government/MinisterChat.ts` | **A** | Divieto di mostrare la struttura; licenza di sviluppare; canale `decision` (difetto 1) |
| `frontend/src/components/Game/decisionWorkspace.ts` | **A — nuovo modulo puro** | Il modello della decisione e il parser `decision` (difetto 2) |
| `frontend/src/components/Game/DecisionBoard.tsx` | **A — nuovo** | La proposta corrente e la gerarchia della tavola |
| `frontend/src/components/Game/actDraft.ts` | **A** | `actDraftFromProposal`: l'atto nasce dalla proposta |
| `frontend/src/components/Game/MinisterChat.tsx` | **A** | Canale `onDecision` dalla conversazione alla tavola |
| `frontend/src/components/Game/GovernmentOffice.tsx` | **A** | Workspace per sedia, ponte proposta→atto, staleness, evidenze |
| `frontend/src/components/Game/SeatTable.tsx` | **A** | La decisione in testa, l'atto in fondo |
| `frontend/src/components/Game/presentation.ts` | **A** | Estrae/e nasconde le azioni `decision` |
| `frontend/src/editorial.css` | **A** | Stile `.decision-*` |
| `frontend/src/components/Game/decisionWorkspace.test.ts` | **C — nuovo** | 18 test puri |
| `frontend/src/components/Game/decisionBoardRender.test.tsx` | **C — nuovo** | 6 test di render |
| `frontend/src/components/Game/presentation.test.ts` | **C** | +2 test: `decision` convive con la tela |
| `backend-nest/tests/ws-gov-dialogue-to-act.test.ts` | **C — nuovo** | 4 test del nuovo contratto di prompt |
| `e2e/tests/ws-gov-dialogue-to-act.spec.mjs` | **B — nuovo** | 1 E2E del flusso Tesoro |
| `e2e/mock-api.mjs` | **B** | Il mock emette i blocchi `decision` del flusso |
| `docs/implementation/assets/ws-gov-dialogue-to-act/390x844-decision-workspace.png` | **D** | Reperto visuale |
| `docs/implementation/WS-GOV-DIALOGUE-TO-ACT-report.md` | **D** | Questo report |

**Riusati senza riscriverli:** `presentation.ts` (esteso, non riscritto),
`actDraft.ts`, `cabinetOrder.ts`, `proposalComparison`/`ProposalComparison.tsx`,
`treasuryAct.ts`, `consequenceBoard.ts`/`DecisionBoard` (la plancia P7 resta
compatibile), `MinisterPersona.ts`, la persistenza `minister-memory`. **Nessun
backend riscritto; nessuna rotta nuova; nessun motore economico nuovo.**

---

## 4. Conferma CORE ENGINE FREEZE

**Intatto.** Il diff tocca:
- `backend-nest/src/core/government/MinisterPersona.ts` e `MinisterChat.ts` —
  **solo testo di prompt** (il briefing del ministro). Nessuna funzione di gioco,
  nessun turno, nessun ordine, nessuna risorsa;
- `frontend/src/**` — UI e read model puro (lo stato della decisione vive nel
  client, non nel motore);
- `e2e/**`, `docs/implementation/**`.

**Non toccati**: `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, repository, schema/database (nessuna
migrazione), semantica checkpoint/simulation run/playback, RNG, costi e code eventi.
La firma continua a passare dalla rotta di accodamento esistente; il **contenuto**
dell'ordine firmato è il testo dell'atto preparato dalla proposta, come già faceva
`actDraftFor`. **Nessuna chiamata LLM nuova** e nessun nuovo costo di provider.

---

## 5. Test eseguiti (esito reale)

Ambiente: macOS, Node v26.10.0 (locale), Chrome di sistema headless. Log in
`/tmp/ws-gov-dialogue-gate/`.

| Comando | Esito reale |
|---|---|
| `cd frontend && ../node_modules/.bin/vitest run` (suite intera) | **134 file / 1144 passati, 1 saltato** (1145), exit 0 |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | exit 0 |
| `cd frontend && npm run build` | exit 0 (warning chunk >500 kB, non occultato) |
| `cd backend-nest && ../node_modules/.bin/vitest run` (suite intera) | **219 file / 2338 passati**, exit 0 |
| `cd backend-nest && npm run build` (poi `rm -rf dist`) | exit 0 |
| `cd e2e && … playwright test tests/ws-gov-dialogue-to-act.spec.mjs` | **1/1 passato**, ~8-10 s |
| `cd e2e && … playwright test modules.spec.mjs govux-p1 govux-p4 govux-p7 govux-cancellation govux-signatures ws-gov-dialogue-to-act` | **22/22 passati**, 2,6 min |

### 5.1 Nota sulla suite backend e `dist/`

La prima esecuzione della suite backend è fallita con 6 file in errore
(`Vitest cannot be imported in a CommonJS module using require()`): un `npm run
build` precedente lasciava `backend-nest/dist/**/*.test.js`, che il runner
raccoglie. Rimuovendo `dist/` la suite è **verde al 100%** (219 file / 2338 test).
Non è un difetto del task: è l'ordine di esecuzione locale, ed è qui dichiarato.

### 5.2 Cosa coprono i test nuovi (difetto 1)

`backend-nest/tests/ws-gov-dialogue-to-act.test.ts` (4 test) verifica che il
briefing: vieti di mostrare FATTI/LETTURA/PROPOSTA; conceda di sviluppare idee e
compromessi; dichiari la precedenza della voce della sedia; documenti il canale
`decision` con provenienza obbligatoria e divieto di numeri inventati. La sezione
della persona resta **senza cifre** (invariante già esistente, rispettata).

### 5.3 Cosa coprono i test nuovi (difetto 2)

`decisionWorkspace.test.ts` (18) — workspace vuoto, obiettivo, proposta del
ministro (`proposed`), accettazione del Presidente, modifica di percentuale,
esclusione, `unresolved`, revisioni crescenti, **no-op senza revisione**, dato del
motore accettato, evidenze come riferimenti, **parser ostile** (percentuale >100,
provenienza inventata, markup, JavaScript) e atto dalla proposta (valori correnti,
niente valori vecchi, staleness, `actDraftFor` compatibile).

`decisionBoardRender.test.tsx` (6) — obiettivo, proposta corrente con provenienza,
«da decidere», cronologia; comando «Trasforma questa proposta in atto» quando
pronta; «Atto non più attuale» + «Rigenera atto» quando la proposta avanza;
«atto preparato» quando allineato.

**Non eseguiti (dichiarati, non verdi)**: nessun test con **provider LLM reale** per
il nuovo canale `decision` (l'E2E usa il mock); matrice multi-viewport; audit `a11y`.
La CI esegue `test-build` e `e2e-mock` sull'HEAD esatto e resta l'autorità per Node 22.

### 5.4 Prima/dopo

| | Prima | Dopo |
|---|---|---|
| Chat ministro | tre sezioni FATTI/LETTURA/PROPOSTA | conversazione naturale, voce della sedia |
| Stato della decisione | assente (solo direttive tela) | `DecisionWorkspace` strutturato e revisionato |
| Tavola | strade/atto iniziali | **proposta corrente** al centro |
| Atto | dal testo della strada iniziale | dalla **proposta corrente**, con i suoi valori |
| Proposta che avanza | nessun segnale | atto `stale`, firma disabilitata, «Rigenera atto» |
| Numeri inventati dal modello | non regolati | **scartati** dal parser; resta la domanda aperta |

---

## 6. Risultati

L'E2E del gate fondamentale (`ws-gov-dialogue-to-act.spec.mjs`, flusso Tesoro) prova
che:

1. **Obiettivo** — «Voglio investire nelle infrastrutture»; la Tavola mostra
   l'obiettivo; ancora «Continua la discussione».
2. **Proposta del ministro** — «Come useresti l'avanzo?»; la Tavola mostra 70/30
   come **proposta del ministro**, con «Da decidere»; non è ancora una decisione.
3. **Decisione del Presidente** — «80% infrastrutture, 20% debito»; la Tavola mostra
   **80/20 con «scelta del Presidente»**, stato «pronta per l'atto»; la proposta
   corrente non contiene più il 70%.
4. **Evidenza** — «Mi mostri dove va la spesa?» aggiunge la **referenza** «Dove va la
   spesa» alla decisione (nessuna copia del dato).
5. **Atto dalla proposta** — «Trasforma questa proposta in atto»: la bozza contiene
   **80%** e **20%** e **non** i valori iniziali della strada del Tesoro.
6. **Staleness** — «Portiamo le infrastrutture al 90%» porta la proposta alla
   revisione successiva: la Tavola dichiara **«Atto non più attuale»**; «Rigenera
   atto» riallinea la bozza a **90%**, senza l'80% e senza i vecchi valori.
7. **Nessuna perdita** — i blocchi ```` ```decision ```` non compaiono **mai** come
   prosa nel dialogo.

Reperto: `docs/implementation/assets/ws-gov-dialogue-to-act/390x844-decision-workspace.png`
(390×844, la proposta corrente sulla Tavola).

**Criterio di successo: soddisfatto.** Chat, Tavola e Atto convergono.

---

## 7. Limiti residui

- **Il workspace è stato di UI, non persistito.** Il `DecisionWorkspace` vive nel
  client e non è salvato lato server (a differenza della memoria `minister-memory`).
  Il task non chiedeva persistenza e non andava toccato il motore: lo dichiaro. Un
  ricarico pagina perde la proposta in lavorazione.
- **Il canale `decision` con un modello reale non è verificato.** Il prompt lo
  documenta e il parser è difensivo (scarta i blocchi invalidi), ma un modello reale
  può produrre JSON malformato o dimenticare il blocco. In quel caso la proposta
  resta all'ultima revisione valida e la domanda resta aperta: **nessun numero
  inventato entra**, ma la tavola non avanza finché il modello non emette un blocco
  valido. Serve una verifica con provider reale (proposta per §8).
- **Firma disabilitata quando l'atto è stantio.** Scelta deliberata: impedisce di
  firmare l'atto sbagliato. È una restrizione, non un difetto; se la regia volesse
  permettere la firma consapevole del vecchio atto, è una riga di UI.
- **Un solo atto per proposta.** Non c'è ancora modo di derivare **più** atti dalla
  stessa proposta (p.es. una misura per volta); l'atto è unico e sostituibile.
- **L'atto preparato da proposta senza strada** è un ordine in prosa
  (`capability: text-order`): la plancia P7 lo stima col motore, ma non eredita una
  distinta d'opera che non esiste.
- **Il workspace non conosce l'esito.** Una volta firmato, l'atto entra nel registro
  come prima; il workspace non registra l'esito di esecuzione (resta compito di
  `decisionImpact`/registro).

---

## 8. Proposte per la fase successiva

1. **Persistenza del workspace** (se la regia la vuole): una tabella
   `decision_workspace` per partita+ramo+sedia, con migrazione compatibile e
   filtro obbligatorio `game_id` **e** `branch_id`, sullo stampo di `jev_memory`.
   Da fare solo con il via della regia: tocca il database.
2. **Verifica reale del canale `decision`**: una prova con provider reale
   (`ux08-real-provider.mjs` come modello) che misuri quanti blocchi validi produce
   il modello e quanto spesso resta una domanda aperta. Solo dopo si può valutare un
   retry o una riparazione JSON.
3. **Più atti da una proposta**: derivare un atto per misura accettata, con la stessa
   disciplina di revisione (`actStaleness` per ciascuno).
4. **Esito nel workspace**: collegare il registro/`decisionImpact` alla proposta,
   così la Tavola può dire «deciso e applicato», non solo «deciso».
5. **E2E multipiattaforma** del flusso a 390×844 e 1366×768 come parte del gate
   completo di fine blocco (qui è stata eseguita la variante desktop + reperto
   mobile).
