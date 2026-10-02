# WS-GOVUX-P7 — Consequence board: le conseguenze prima della firma

Base verificata: `main` / `origin/main` **`98f8081`** (merge PR #164, WS-GOVUX P6).
Branch: **`feat/ws-govux-p7-consequence-board`**, commit di codice+test e questo
report. Task letti integralmente: `/tmp/pi-tasks/pi-task-gov-ux-roadmap.md` (§P7,
righe 119-124) e `/tmp/pi-tasks/pi-task-govux-gates-lite.md` (gate ridotto).

**P7 completata.** Nessun merge, nessun deploy. Nessuna fase successiva avviata.

> **Nota di gate, dichiarata.** Il profilo `pi-task-govux-gates-lite.md` §0 mette
> P7 nel **gate ridotto** (nessun obbligo di E2E né di screenshot): l'eccezione UI
> minima è riservata a **P1 e P4**. La regia ha però chiesto per questa fase **1
> E2E mirato del percorso Governo a 390×844 + 1 screenshot**: è una verifica
> **aggiuntiva**, non un alleggerimento, ed è stata eseguita davvero. Nessun test
> del gate ridotto è stato tolto o dichiarato verde senza esito.

## 1. Problema risolto e comportamento finale

Il P0 aveva rilevato che la firma di un atto era una **scommessa**: il Presidente
vedeva il testo della bozza, il costo **dichiarato** dall'atto, ma non ciò che il
motore avrebbe **davvero applicato** all'esecuzione, né i rischi né ciò che il
motore **non** calcola. L'unico riscontro sulle conseguenze era **a posteriori**
(`decisionImpact.ts` / `DecisionImpactBlock.tsx`), dopo l'atto.

Comportamento finale, a parità di motore e di dati — **prima della firma**, dentro
la bozza d'atto, la plancia mostra **quattro gruppi distinti ed etichettati**:

- **Effetti diretti calcolati** — il costo che il motore applica all'esecuzione:
  per gli **ordini in prosa** la verifica di fattibilità del motore
  (`check-feasibility` → `estimateIntentCosts`), con durata, consumi e
  mantenimenti; per le **opere** la distinta già risolta dal server. Ogni voce
  portata dal motore è marcata *«applicato dal motore»*;
- **Previsioni del motore** — beneficio atteso della strada, copertura, esito
  della verifica, interpretazione del testo;
- **Rischi** — distinta scoperta, vincoli dichiarati, blocchi e prerequisiti
  della verifica, funzione assente;
- **Incertezze** — cifre stimate o mancanti, spesa ricorrente e tempi non
  dichiarati, effetti sociali non simulati, avvisi del motore.

Regole di fase rispettate:

- la plancia è un **read model puro**: nessuna scrittura, nessun ordine accodato,
  nessun effetto su salvataggi, risorse, turno, code eventi o RNG;
- **i costi della preview sono gli stessi applicati** nelle stesse condizioni: la
  stima arriva dalla **stessa** funzione di costo che `OrderExecutionService` usa
  all'esecuzione (`estimateIntentCosts` / `estimateOrderCost`), e la plancia non la
  ricalcola;
- **modificare la bozza invalida la stima**: la firma del preventivo dipende dal
  testo della bozza e dallo **snapshot canonico del mondo**; una stima prodotta per
  una versione diversa è dichiarata `stale` e **non viene più usata**, con un
  pulsante di **ricalcolo esplicito** («Ricalcola stima»);
- **ciò che il motore non simula è dichiarato non stimabile**, in un riquadro
  dedicato: mai una percentuale inventata dalla plancia. L'unica percentuale che
  può comparire è **citata come nota del motore** («Avviso del motore»).

Il confine è chiaro: la plancia **legge** bozza, strada, opera e verifica del
motore; non introduce comandi, non parla con il provider, non tocca il motore.

## 2. File effettivamente modificati e componenti riusati

Classificazione locale (stessa convenzione del modulo Governo): **A**
comportamento/layout, **B** harness, **C** test, **D** report/assets, **E**
congelati. In P7: **E nessuna modifica**.

| File | Classe | Scopo |
|---|---|---|
| `frontend/src/components/Game/consequenceBoard.ts` | **A — nuovo modulo puro** | Tipi (`ConsequenceEntry`, `ConsequenceGroup`, `ConsequenceBoard`, `EnginePreview`, `PreviewStatus`); `CONSEQUENCE_GROUP_LABEL`, `PREVIEW_NOTE`; `consequenceBoardSignature` (snapshot + capacità + opera + `orderKey(testo)`); `buildConsequenceBoard` (i quattro gruppi, `stale`, `notEstimable`, `status`). Nessun DOM, nessuno stato, nessuna chiamata |
| `frontend/src/components/Game/ConsequenceBoardPanel.tsx` | **A — nuovo componente** | Presentazionale: intestazione con stato, avviso `stale` + ricalcolo, riquadro «Non stimabile», i quattro gruppi con etichette di provenienza. Classi `consequence-` |
| `frontend/src/components/Game/ActDraftPanel.tsx` | **A — estensione** | Prop opzionali `board`/`boardLoading`/`boardError`/`onRefreshBoard`; rende la plancia **tra** lo stato della bozza e i pulsanti, cioè **prima della firma**. Senza `board` il pannello resta quello di prima |
| `frontend/src/components/Game/SeatTable.tsx` | **A — estensione** | Prop `actBoard`/`actBoardLoading`/`actBoardError`/`onRefreshActBoard` inoltrate a `ActDraftPanel` |
| `frontend/src/components/Game/GovernmentOffice.tsx` | **A — estensione** | `boardSnapshotKey` (`actionSnapshotKey` con partita/turno/data/ramo); `boardRoad`/`boardItem` dalla bozza e dalle proposte; `refreshActBoard` (verifica del motore per gli ordini in prosa, con **firma** della stima); effetto alla **preparazione** della bozza; `consequenceBoard` in `useMemo`; la plancia non tocca alcuno stato di gioco |
| `frontend/src/editorial.css` | **A — stile** | Blocco `.consequence-*` (griglia dei quattro gruppi, badge di provenienza, tag «applicato dal motore», avviso `stale`, riquadro non stimabile), nella palette navy/ambra del pannello atto, **nessun `!important`** |
| `frontend/src/components/Game/consequenceBoard.test.ts` | **C — nuovo** | 10 test: firma stabile/cangiante (testo e snapshot), i quattro gruppi, la copia riga-per-riga dei costi del motore, l'ordine in prosa non applicato, la stima `stale`, la distinta scoperta come rischio, le cifre stimate come incertezze, nessuna percentuale propria, la funzione assente non stimabile |
| `frontend/src/components/Game/consequenceBoardRender.test.tsx` | **C — nuovo** | 5 test di render: i quattro gruppi e l'«applicato dal motore», lo stato «stima dichiarata», il `stale` con «Ricalcola stima», la plancia **prima** della firma, la bozza invariata senza plancia |
| `e2e/tests/govux-p7-consequence.spec.mjs` | **B — nuovo** | 1 E2E a 390×844: prepara una strada in prosa → la plancia mostra i costi del motore e i quattro gruppi; modificare la bozza dichiara `stale` e il ricalcolo li riporta; **nessuna** richiesta di accodamento (`/actions/queue`) parte |
| `docs/implementation/assets/ws-govux-p7/390x844-consequence-board.png` | **D — reperto** | Screenshot 390×844 della plancia prima della firma |
| `docs/implementation/WS-GOVUX-P7-report.md` | **D — documentazione** | Questo report |

**Riusati senza riscriverli:** `treasuryAct.ts` (strade e cifre dichiarate),
`actDraft.ts` (`ProposalActDraft`, `ActCapability`, `orderKey`),
`consequences.ts` (`ConsequenceBasis`, `compareRoads`, `SOCIAL_EFFECTS_NOTE`),
`actionSnapshot.ts` (`actionSnapshotKey`), `FeasibilityCheck.tsx`,
`ProposalComparison.tsx`, `TreasuryActPanel.tsx`. La chiamata di verifica usa la
rotta esistente `gameApi.checkFeasibility` (`check-feasibility`), **di sola
lettura**. Nessuna libreria o dipendenza aggiunta; nessun sistema parallelo;
nessun nuovo motore economico; **nessun backend toccato**.

## 3. Verifiche eseguite con esito reale

Ambiente: macOS, Node **v26.10.0**, Chrome di sistema headless. Log in
`/tmp/govux-p7-gate/`.

| Comando | Esito reale |
|---|---|
| `cd frontend && ../node_modules/.bin/vitest run src/components/Game/consequenceBoard.test.ts src/components/Game/consequenceBoardRender.test.tsx` | **15/15 passati** (10+5), exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run` (suite intera frontend) | **132 file / 1118 passati, 1 saltato** (1119), exit 0 |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd frontend && npm run build` | exit 0; warning chunk >500 kB e opzioni Vite deprecate, non occultati |
| `cd backend-nest && npm run build` | exit 0 (poi `rm -rf dist`). Il backend non è toccato: la build difende solo l'invariante |
| `cd e2e && CHROME_PATH='…' node_modules/.bin/playwright test tests/govux-p7-consequence.spec.mjs` | **1/1 passato**, 6,5 s (9,4 s totali), exit 0 |
| `cd e2e && CHROME_PATH='…' node_modules/.bin/playwright test tests/modules.spec.mjs tests/govux-p1-council.spec.mjs tests/govux-p7-consequence.spec.mjs` | **15/15 passati**, 1,8 min, exit 0 |

**Perché l'E2E di regressione (`modules.spec.mjs` + P1):** P7 tocca
`ActDraftPanel`/`SeatTable`, cioè il percorso che `P04b`/`P04c`/`P06` esercitano
firmando atti del Tesoro. È stato rieseguito localmente per non consegnare una CI
rossa: **nessun test è stato allentato, escluso o dichiarato verde senza esito.**

**Nota sulla suite frontend:** lo script letterale `npm test` del frontend **non
esiste** (`Missing script: "test"`). Il runner reale è
`../node_modules/.bin/vitest run`, ed è quello usato. La suite è stata eseguita
con `dist/` **assente** (`rm -rf dist`), perché un build precedente lascia
`dist/**/*.test.js` che il runner raccoglie.

**Non eseguiti (dichiarati, non verdi):** E2E **completo** dei percorsi Governo e
matrice multi-viewport — rimandati al **gate completo di fine blocco** come da
`pi-task-govux-gates-lite.md`. La suite backend completa non è stata eseguita (il
backend non è toccato). L'audit `a11y` non è stato rieseguito. La CI della PR
esegue `test-build` e `e2e-mock` sull'HEAD esatto e resta l'autorità per Node 22.

## 4. Screenshot del flusso interessato

P7 **non è** nell'eccezione UI minima (`pi-task-govux-gates-lite.md` §0: P1, P4),
ma la regia ha chiesto per questa fase **1 E2E mirato a 390×844 + 1 screenshot**:
sono stati prodotti **davvero**.

- `docs/implementation/assets/ws-govux-p7/390x844-consequence-board.png` — 390×844,
  la bozza del Tesoro con la plancia delle conseguenze **sopra** i pulsanti, i
  quattro gruppi, il costo del motore («Tesoreria 12,40 mld») marcato *applicato
  dal motore* e il riquadro «Non stimabile».

Non si dichiara un'evidenza visiva che non è stata prodotta.

## 5. Checklist di fase

### Checklist P7

- **Completato:** quattro gruppi **distinti ed etichettati** — effetti diretti calcolati / previsioni del motore / rischi / incertezze.
- **Completato:** la plancia **non** modifica salvataggi, risorse, turno, code eventi o RNG (modulo puro; E2E verifica che **nessuna** richiesta di coda parta).
- **Completato:** **modificare la bozza invalida/aggiorna la stima** — firma del preventivo da testo + snapshot; stima `stale` scartata; ricalcolo esplicito.
- **Completato:** **costi preview == costi applicati** nelle stesse condizioni — la stima è la verifica del motore, non un ricalcolo locale.
- **Completato:** **effetti non supportati dichiarati non stimabili**, mai percentuali inventate — riquadro «Non stimabile» + avviso `stale`.
- **Completato:** riuso di moduli e componenti esistenti; nessuna riscrittura del modulo Governo; nessun nuovo motore economico.
- **Completato:** gate ridotto (test mirati + `tsc --noEmit` + build), **più** l'E2E mirato e lo screenshot richiesti dalla regia.

## 6. Conferma CORE ENGINE FREEZE

**Intatto.** Il diff P7 tocca solo `frontend/src/**`, `e2e/**` e
`docs/implementation/**`. Non tocca `backend-nest/src/**`, `core/simulation/**`,
`GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`,
repository, schema/database, semantica checkpoint/simulation run/playback, né la
pipeline di avanzamento del tempo. La plancia è un read model di UI: **non**
registra ordini, **non** applica atti, **non** muta il mondo. Il contratto con il
provider è invariato e **non** è stata aggiunta alcuna chiamata LLM: la sola
chiamata introdotta è la verifica di fattibilità già esistente (di sola lettura).

## 7. Differenze rispetto alla roadmap e limiti residui

- **Nessun nuovo `op` e nessuna rotta nuova.** La plancia riusa
  `check-feasibility` (sola lettura) e il read model delle strade d'atto.
- **La firma del preventivo è dell'UI, non del motore.** Serve a riconoscere una
  stima prodotta per un'altra versione della bozza; non è un identificatore
  persistito e non compare in alcun salvataggio.
- **Ricalcolo esplicito, non silenzioso.** Modificare il testo **non** rilancia da
  solo la verifica: la stima vecchia diventa `stale` e il Presidente decide se
  ricalcolare. Evita una richiesta per battuta di tastiera.
- **Ordini in prosa vs opere.** Per gli **ordini in prosa** la plancia usa la
  verifica del motore; per le **opere** legge la **distinta** già risolta dal
  server (costo immediato e copertura dichiarati dalla distinta), senza ricalcolare
  un costo che il client non è autorizzato a stimare.
- **La nota del motore è citata, non riformulata.** Se la verifica riporta una
  percentuale (p.es. «25% del gettito annuo»), la plancia la mostra come **nota del
  motore**: non è un numero calcolato dalla UI.
- **Effetti sociali sempre non stimabili.** `SOCIAL_EFFECTS_NOTE` è dichiarato tra
  le incertezze e nel riquadro «Non stimabile»: il motore non li simula, quindi non
  sono previsti.

## 8. Fase successiva indicata, senza dichiararla completata

Con P7 si chiude l'ordine di esecuzione della roadmap
(**P1 → P3 → P4 → P6 → P7**); **P2** e **P5** erano già in `main`. Resta il
**gate completo di fine blocco** (E2E completo Governo, matrice viewport,
screenshot reali, suite backend intera) e la **sessione di regia** per merge e
deploy. P7 **non** dichiara consegnate queste attività: sola PR verso `main`.
