# WS-GOVUX-P3 — Conversational Canvas: la tela guidata dal discorso

Base verificata: `main` / `origin/main` **`daeed49`** (merge PR #161, WS-GOVUX P1).
Branch: **`feat/ws-govux-p3-conversational-canvas`**, commit `6a4d8e1` (+ questo report).
Task letti integralmente: `/tmp/pi-tasks/pi-task-gov-ux-roadmap.md` (§P3) e
`/tmp/pi-tasks/pi-task-govux-gates-lite.md` (gate ridotto; P1/P4 sono l'eccezione
UI minima, **P3 no**).

**P3 completata.** P4, P6, P7 non avviate. Nessun merge, nessun deploy.

## 1. Problema risolto e comportamento finale

Il P0 aveva rilevato (matrice, righe P3):

- il confronto **sostituiva** la principale (`presentation.ts:269-282`), non la
  affiancava;
- il parser conservava **una sola** direttiva per risposta: nessun lotto, quindi
  nessun tetto di «massimo tre nuove evidenze»;
- `annotate`/`dismiss` esistevano ma non avevano un **bersaglio mirato** né una
  **versione di stato**; un ID inesistente poteva rimpiazzare la presentazione
  corrente prima che il resolver restituisse `null`;
- la tavola mostrava **una** principale più supporti, non due principali
  conversazionali.

Comportamento finale, a parità di motore e di dati:

- **sostituisci principale** (`show`/`focus`): l'evidenza sale in testa, l'altra
  principale resta visibile, e la tela non ne mostra più di due;
- **aggiungi confronto** (`compare`): il confronto **si aggiunge**, senza togliere
  le principali (difetto del P0 chiuso);
- **aggiorna** (`annotate`): tocca la nota dell'evidenza **bersaglio**;
- **rimuovi** (`dismiss`): toglie l'evidenza **bersaglio**; senza bersaglio svuota
  la tela;
- **max 3 nuove istruzioni per risposta**, deduplicate (lotto);
- **2 principali visibili**, la seconda separata sulla tavola;
- **direttiva invalida degrada**: un blocco assente non entra nella tela risolta e
  **non azzera** le altre; il testo valido del messaggio resta leggibile;
- **versione di stato**: una direttiva con `version` diversa da quella corrente è
  un no-op (una risposta tardiva non riscrive una tela più recente).

Il confine del modello non cambia: il modello **sceglie riferimenti**, il resolver
costruisce blocchi e geometrie dal catalogo autorizzato. Le operazioni sul filo
restano le cinque già validate (`show`, `focus`, `compare`, `annotate`, `dismiss`):
**nessun nuovo `op`, nessuna modifica al prompt o al provider.** La semantica
richiesta dalla roadmap è mappata sopra quelle, in `CANVAS_OP_SEMANTICS`.

## 2. File effettivamente modificati e componenti riusati

Classificazione locale (stessa convenzione dei report del modulo Governo): **A**
comportamento/layout, **B** harness, **C** test, **D** report/assets, **E**
congelati. In P3: **E nessuna modifica**.

| File | Classe | Scopo |
|---|---|---|
| `frontend/src/components/Game/presentation.ts` | **A — estensione del read model puro** | `CANVAS_OP_SEMANTICS`, `MAX_NEW_EVIDENCES_PER_REPLY`, `MAX_MAIN_EVIDENCES`; `parsePresentation` a lotto; `target`/`version`; `PresentationCanvas`, `CanvasMain`, `CanvasComparison`, `ResolvedCanvas`, `emptyCanvas`, `applyCanvasDirective`, `applyCanvasBatch`, `resolveCanvas`; `resolvePresentation` rifattorizzato su helper condivisi `resolveEvidence`/`resolveComparison` (comportamento invariato) |
| `frontend/src/components/Game/MinisterChat.tsx` | **A — estensione** | Emette il **lotto** di direttive (firma: `directives[]`), dedupe per messaggio |
| `frontend/src/components/Game/GovernmentOffice.tsx` | **A — estensione** | Stato per sedia da `ActivePresentation` a `PresentationCanvas`; `applyCanvasBatch`; pin sul principale; `resolveCanvas`; passa `canvas` a `SeatTable` |
| `frontend/src/components/Game/SeatTable.tsx` | **A — estensione** | Prop opzionale `canvas` (2 principali + confronto) mantenendo `presentation` per retro-compatibilità; atto pertinente dal principale; seconda principale separata |
| `frontend/src/editorial.css` | **A — stile** | `.seat-table-main-second` (separatore della seconda principale) |
| `frontend/src/components/Game/presentationCanvas.test.ts` | **C — nuovo** | 16 test: operazioni, lotto, dedupe, cap a 3, target/version, degradazione, pin, resolver, fetta verticale |
| `frontend/src/components/Game/seatTableCanvas.test.tsx` | **C — nuovo** | 3 test di render: due principali, confronto che non toglie le principali, evidenza senza blocco |
| `docs/implementation/WS-GOVUX-P3-report.md` | **D — documentazione** | Questo report |

**Riusati senza modificarli:** `resolvePresentation`/`shouldApplyPresentation`
(API storica, ancora esportata e testata), `blockForEvidence`, `availableEvidence`,
`focusedProposals`, `matchSpendingVoice`, `SeatCanvas`, `ProposalComparison`,
`TreasuryActPanel`, `ActDraftPanel`, `seatRoads`. Nessuna libreria o dipendenza
aggiunta; nessun sistema parallelo; nessun backend toccato.

## 3. Verifiche eseguite con esito reale

Ambiente: macOS, Node **v26.10.0**, Chrome di sistema headless. Log in
`/tmp/govux-p3-gate/`. Verifiche nuove di P3, non copiate.

| Comando | Esito reale |
|---|---|
| `cd frontend && ../node_modules/.bin/vitest run src/components/Game/presentationCanvas.test.ts` | **16/16 passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run src/components/Game/seatTableCanvas.test.tsx` | **3/3 passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run <presentation + presentationCanvas + seatTablePresentation + seatTableCanvas>` | **4 file / 44 test passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run` (suite intera frontend) | **127 file / 1069 test passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd frontend && npm run build` | exit 0; warning chunk >500 kB e opzioni Vite deprecate, non occultati |
| `cd backend-nest && npm run build` | exit 0 |
| `cd e2e && CHROME_PATH='…' node_modules/.bin/playwright test tests/modules.spec.mjs` | **12/12 passati**, 1,6 min, exit 0 (inclusi P04c/P04d/P06/P07: conversazione → tavola, mappa, confronto, firma) |

**Perché l'E2E di `modules.spec.mjs`:** non è richiesto dal gate ridotto di P3, ma
la CI (`e2e-mock`) lo esegue sulla PR e P3 tocca proprio il percorso
conversazione → tavola. È stato eseguito localmente per non consegnare una CI
rossa: nessun test è stato allentato, escluso o dichiarato verde senza esito.

**Non eseguiti (dichiarati, non verdi):** suite backend completa
(`npm --prefix backend-nest test`), E2E completo dei percorsi Governo, matrice
multi-viewport — rimandati al **gate completo di fine blocco**, come da
`pi-task-govux-gates-lite.md`. L'audit `a11y` non è stato rieseguito.

## 4. Screenshot mobile e desktop del flusso interessato

Il profilo ridotto riserva l'**eccezione UI minima con screenshot a P1 e P4**
(`pi-task-govux-gates-lite.md` §0), non a P3. P3 è una fase di **contratto/modello**
più un adattamento di gerarchia sulla tavola: la prova è nei test di render
`seatTableCanvas.test.tsx` (due principali, confronto additivo) e nell'E2E
`modules.spec.mjs` eseguito localmente. **Nessuno screenshot è stato prodotto in
questa fase**; mobile e desktop del flusso saranno ripresi dagli screenshot del
gate completo di fine blocco. Non si dichiara un'evidenza visiva che non è stata
prodotta.

## 5. Checklist di fase

### Checklist P3

- **Completato:** operazioni `sostituisci principale`, `aggiungi confronto`, `aggiorna`, `rimuovi` con regola verificabile.
- **Completato:** max 3 nuove istruzioni per risposta, deduplicate (parser **e** reducer).
- **Completato:** 2 principali visibili sulla tela.
- **Completato:** validazione schema (campi noti), enum (op/evidence/target), ID/esistenza (blocco assente non entra) e versione di stato.
- **Completato:** direttiva invalida degrada; il messaggio valido resta leggibile.
- **Completato:** fetta verticale messaggio → bilancio → grafico (test dedicato).
- **Completato:** regione e confronto (mappa/`regionIds` e `compare`) preservati sui contratti esistenti.
- **Riusato:** `resolvePresentation`, `SeatCanvas`, `ProposalComparison`, `focusedProposals`, `matchSpendingVoice`.
- **Rimandato con motivo:** screenshot mobile/desktop (gate ridotto P3); limiti dichiarati sotto.

## 6. Conferma CORE ENGINE FREEZE

**Intatto.** Il diff P3 tocca solo `frontend/src/**`. Non tocca
`backend-nest/src/**`, `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, repository, schema/database, semantica
checkpoint/simulation run/playback, né la pipeline di avanzamento del tempo. La
tela è un read model **puro**: non registra ordini, non applica atti, non muta il
mondo. Il contratto con il provider è invariato (stesse cinque `op`).

## 7. Differenze rispetto alla roadmap e limiti residui

- **Operazioni sul filo invariate.** La roadmap nomina le operazioni in italiano;
  il codice mappa `show`/`focus` → sostituisci principale, `compare` → aggiungi
  confronto, `annotate` → aggiorna, `dismiss` → rimuovi (`CANVAS_OP_SEMANTICS`).
  **Non** sono stati introdotti nuovi `op`: cambiare il vocabolario sul filo
  avrebbe richiesto di toccare il prompt del provider, fuori perimetro.
- **Tetto prudente.** `MAX_NEW_EVIDENCES_PER_REPLY = 3` limita il **lotto
  totale** (nuove evidenze più `compare`/`annotate`/`dismiss`), lettura prudente
  di «max 3 nuove evidenze». Con più di tre istruzioni restano le **ultime tre**
  (coerente con «l'ultima vince»).
- **Due principali impilate, non affiancate.** La roadmap dice «adattabili dopo
  verifica»: la seconda principale è separata sotto la prima, non in una griglia
  a forza. La messa a fuoco di zona/voce resta sulla **prima** principale.
- **Lucchetto.** Un'evidenza fissata non si sostituisce (né con `show`/`focus` né
  con `compare`), ma resta **aggiornabile** (`annotate`) e **rimovibile**
  (`dismiss`): il lucchetto protegge dalla sostituzione, non dall'azione esplicita.
  La vecchia `shouldApplyPresentation` resta esportata per il caso a evidenza
  singola (comportamento storico, test invariati).
- **Nessun numero inventato.** `target`, `version`, `note`, `regionIds` sono
  validati e sanitizzati; i dati dei blocchi restano quelli del read model.
- **Testo legibile.** Un blocco invalido viene rimosso dalla prosa e non produce
  prosa visibile (`modules.spec.mjs` verifica l'assenza di ` ``` ` e `"op"` in chat).

## 8. Fase successiva indicata, senza dichiararla completata

**Prossima fase: P4 — Inline evidence** (l'ordine indicato è P1 → P3 → P4 → P6 →
P7; P2 e P5 sono già in `main`). P4 collegherà un messaggio alla sua evidenza con
una card compatta sotto il testo, riusando lo **stesso ID** e gli **stessi dati**
già risolti da `resolveCanvas`/`ResolvedPresentation` (nessun secondo grafico),
azzerando il badge quando l'evidenza è **vista**. P6 e P7 restano da fare: nessuna
fase saltata o dichiarata consegnata. Sola PR verso `main`; merge, deploy e gate
completo di fine blocco restano alla regia.
