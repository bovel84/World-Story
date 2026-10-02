# WS-GOVUX-P4 — Inline evidence: l'evidenza in linea nel dialogo

Base verificata: `main` / `origin/main` **`3fd751b`** (merge PR #162, WS-GOVUX P3).
Branch: **`feat/ws-govux-p4-inline-evidence`**, commit di codice+test e questo
report. Task letti integralmente: `/tmp/pi-tasks/pi-task-gov-ux-roadmap.md` (§P4,
righe 99-106) e `/tmp/pi-tasks/pi-task-govux-gates-lite.md` (gate ridotto; **P4 è
nell'eccezione UI minima**: 1 E2E mirato a 390×844 + 1 screenshot).

**P4 completata.** P6 e P7 non avviate. Nessun merge, nessun deploy.

## 1. Problema risolto e comportamento finale

Il P0 aveva rilevato (matrice, righe P4):

- il collegamento discorso → tavola era **a senso unico**: il messaggio che aveva
  chiesto un'evidenza non lo diceva, e sotto il testo non c'era alcun riferimento;
- il pallino «novità» era acceso **finché non si apriva la Tavola** e si spegneva
  al semplice cambio tab (`GovernmentOffice.tsx`: `hasCanvasEvidence &&
  mobilePane !== 'tavola'`), non quando l'evidenza era davvero **vista**: bastava
  entrare e uscire dalla Tavola per perdere il segnale.

Comportamento finale, a parità di motore e di dati:

- **card compatta sotto il messaggio** del ministro, con lo **stesso `id`**
  (`data-block-id`) e lo **stesso titolo** del blocco sulla tavola: è un
  **riferimento**, non un secondo grafico (nessun `<svg>`, nessun
  `.advisor-chart`, nessun `.seat-canvas-block` dentro la card);
- il clic sulla card **apre la Tavola e mette a fuoco il blocco reale** (mobile:
  cambia tab; desktop: scorre e illumina) — la pane non si smonta, quindi scroll,
  testo in composizione e selezione restano;
- il **badge novità è un fatto di visione**: si spegne quando la Tavola è vista
  (`seenVersion` = versione corrente della tela) e si riaccende **solo** per una
  **nuova** evidenza (versione diversa da quella vista);
- una chiave **senza blocco reale** non produce una card fantasma; `annotate` e
  `dismiss` non producono card (non portano una nuova evidenza).

Il confine del modello non cambia: la card **legge** il read model già risolto
dalla tavola (`availableEvidence` + `blockForEvidence`) e **non** introduce
direttive, non parla col provider e non tocca il motore.

## 2. File effettivamente modificati e componenti riusati

Classificazione locale (stessa convenzione del modulo Governo): **A**
comportamento/layout, **B** harness, **C** test, **D** report/assets, **E**
congelati. In P4: **E nessuna modifica**.

| File | Classe | Scopo |
|---|---|---|
| `frontend/src/components/Game/inlineEvidence.ts` | **A — nuovo modulo puro** | `inlineEvidenceCards` (solo `show`/`focus` + `compare`; dedup per evidenza; scarta le chiavi senza blocco); `shouldShowEvidenceBadge` (regola del pallino). Nessun DOM, nessuno stato, nessuna chiamata |
| `frontend/src/components/Game/MinisterChat.tsx` | **A — estensione** | Prop opzionali `evidenceIndex`/`onFocusEvidence`; sotto ogni messaggio assistant non in streaming rende le card dal **medesimo** `parsePresentation` già usato per il testo |
| `frontend/src/components/Game/GovernmentOffice.tsx` | **A — estensione** | `evidenceIndex` (`availableEvidence`+`blockForEvidence`); `focusEvidence` (riapplica la direttiva del messaggio **con lo stesso contesto** — citazione e ultimo discorso — poi apre la Tavola e mette a fuoco); effetto di messa a fuoco su `[data-block-id]`/`.proposal-comparison`; effetto `seenVersion`; badge da `shouldShowEvidenceBadge` |
| `frontend/src/components/Game/SeatCanvas.tsx` | **A — estensione** | `data-block-id` su **tutti** i blocchi (metrics/chart/strategy/map/ideas); rimossa la `key` da `ZoneMap` (cambiare le zone in evidenza non rimonta più la mappa: la selezione locale resta) |
| `frontend/src/editorial.css` | **A — stile** | `.minister-evidence-cards`/`.minister-evidence-card*` (card navy, accento ambra, **nessun `!important`**); `.seat-evidence-focus` (contorno temporaneo sul blocco reale) |
| `frontend/src/components/Game/inlineEvidence.test.ts` | **C — nuovo** | 11 test: descrittori delle card (stesso id/titolo, niente card fantasma, filtro operazioni, ancora del confronto, dedup/ordine) e regola del badge (senza evidenza, non vista, Tavola, vista, nuova versione) |
| `frontend/src/components/Game/ministerChatInlineEvidence.test.tsx` | **C — nuovo** | 7 test di render: card sotto il messaggio con id/titolo reali, non-secondo-grafico, nessuna prosa, card assente senza gestore o senza blocco, confronto, due evidenze in un messaggio |
| `e2e/tests/govux-p4-inline.spec.mjs` | **B — nuovo** | 1 E2E a 390×844: card → messa a fuoco, badge che si spegne e si riaccende, bozza conservata |
| `docs/implementation/assets/ws-govux-p4/*.png` | **D — reperto** | Screenshot 390×844 (gate) e 1366×768 (desktop) |
| `docs/implementation/WS-GOVUX-P4-report.md` | **D — documentazione** | Questo report |

**Riusati senza modificarli:** `presentation.ts` (`parsePresentation`,
`availableEvidence`, `blockForEvidence`, `evidenceLabel`, `applyCanvasBatch`,
`resolveCanvas`), `SeatTable`, `ProposalComparison`, `AdvisorChart`, `ZoneMap`,
`RichText`, `chatScroll`. Nessuna libreria o dipendenza aggiunta; nessun sistema
parallelo; nessun backend toccato; nessuna modifica alla semantica del canvas di
P3 (le cinque `op` restano invariate).

## 3. Verifiche eseguite con esito reale

Ambiente: macOS, Node **v26.10.0**, Chrome di sistema headless. Log in
`/tmp/govux-p4-gate/`.

| Comando | Esito reale |
|---|---|
| `cd frontend && ../node_modules/.bin/vitest run src/components/Game/inlineEvidence.test.ts src/components/Game/ministerChatInlineEvidence.test.tsx` | **17/17 passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/vitest run` (suite intera frontend) | **129 file / 1086 test passati**, exit 0 |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd frontend && npm run build` | exit 0; warning chunk >500 kB e opzioni Vite deprecate, non occultati |
| `cd backend-nest && npm run build` | exit 0 (poi `rm -rf dist`) |
| `cd e2e && CHROME_PATH='…' node_modules/.bin/playwright test tests/govux-p4-inline.spec.mjs` | **1/1 passato**, ~7 s, exit 0 |
| `cd e2e && CHROME_PATH='…' node_modules/.bin/playwright test tests/modules.spec.mjs tests/govux-p1-council.spec.mjs tests/govux-p4-inline.spec.mjs` | **15/15 passati**, 1,9 min, exit 0 |

**Perché l'E2E di `modules.spec.mjs` + P1:** non è richiesto dal gate ridotto di P4,
ma la CI (`e2e-mock`) esegue `modules.spec.mjs` sulla PR e P4 tocca proprio il
percorso conversazione → tavola e il badge su mobile. È stato eseguito localmente
per non consegnare una CI rossa: nessun test è stato allentato, escluso o
dichiarato verde senza esito.

**Non eseguiti (dichiarati, non verdi):** suite backend completa
(`npm --prefix backend-nest test`), E2E completo dei percorsi Governo, matrice
multi-viewport — rimandati al **gate completo di fine blocco**, come da
`pi-task-govux-gates-lite.md`. L'audit `a11y` non è stato rieseguito.

## 4. Screenshot mobile e desktop del flusso interessato

P4 è nell'**eccezione UI minima** (`pi-task-govux-gates-lite.md` §0): 1 E2E mirato
Governo a **390×844** e **1 screenshot**. Prodotti:

- `docs/implementation/assets/ws-govux-p4/390x844-inline-evidence.png` — 390×844,
  il dialogo con la card sotto il messaggio (badge attivo) e la bozza conservata;
- `docs/implementation/assets/ws-govux-p4/1366x768-inline-evidence.png` — 1366×768,
  le due superfici insieme dopo la nuova evidenza (reperto desktop aggiuntivo).

Lo screenshot del gate è il primo; il secondo è prodotto dallo stesso E2E (resize
dopo il passo finale) e non sostituisce l'obbligo, lo affianca. Non si dichiara
un'evidenza visiva che non è stata prodotta.

## 5. Checklist di fase

### Checklist P4

- **Completato:** card compatta sotto il messaggio, con lo **stesso id** del blocco reale.
- **Completato:** stessi **dati** della tavola (titolo del blocco risolto), **nessun secondo grafico**.
- **Completato:** clic → desktop mette a fuoco / mobile apre la Tavola e seleziona.
- **Completato:** scroll, testo in composizione e selezione **preservati** (le pane non si smontano; E2E verifica la bozza).
- **Completato:** badge «novità» azzerato quando l'evidenza è **vista**, non quando arriva.
- **Completato:** riuso di `presentation.ts` e della semantica del canvas di P3; nessuna riscrittura del modulo Governo.
- **Completato:** gate ridotto + 1 E2E 390×844 + screenshot.

## 6. Conferma CORE ENGINE FREEZE

**Intatto.** Il diff P4 tocca solo `frontend/src/**` e `e2e/**`. Non tocca
`backend-nest/src/**`, `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, repository, schema/database, semantica
checkpoint/simulation run/playback, né la pipeline di avanzamento del tempo. La
card è un read model di UI: non registra ordini, non applica atti, non muta il
mondo. Il contratto con il provider è invariato.

## 7. Differenze rispetto alla roadmap e limiti residui

- **Nessun nuovo `op`.** La card è prodotta dalle direttive già esistenti; il
  vocabolario sul filo resta quello di P3.
- **Riapplicazione con contesto.** Aprendo una card, la direttiva del messaggio
  viene riapplicata con la **stessa** citazione e l'**ultimo discorso** del
  Presidente: la voce di spesa in evidenza (`matchSpendingVoice`), se c'era, non
  si perde. È un read model di UI, non un effetto di gioco.
- **Messa a fuoco temporanea.** L'evidenziazione del blocco dura ~1,8 s (contorno
  ambra) e poi svanisce: è un aiuto visivo, non uno stato persistente.
- **Badge per versione.** Se una nuova evidenza arriva **mentre** si guarda la
  Tavola, il badge non compare (l'evidenza è già vista): è la lettura letterale di
  «azzerato quando è vista».
- **Deduplica per evidenza.** Due direttive identiche sullo stesso blocco
  producono **una** card; l'ordine del lotto è preservato.
- **Confronto.** La direttiva `compare` produce una card «Confronto» che punta a
  `.proposal-comparison`; non produce un secondo `ProposalComparison`.

## 8. Fase successiva indicata, senza dichiararla completata

**Prossima fase: P6** (l'ordine indicato è P1 → P3 → P4 → P6 → P7; P2 e P5 sono
già in `main`). P4 non avvia P6/P7 e non li dichiara consegnati. Sola PR verso
`main`; merge, deploy e gate completo di fine blocco restano alla regia.
