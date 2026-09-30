# WS-MINISTER-UX-06 — Dalla proposta alla decisione del Presidente

> La strada discussa non è un atto: lo diventa quando il Presidente la **prepara**,
> la **corregge** e la **firma**. Questa fase collega la proposta discussa alla
> bozza concreta tramite il flusso esistente di fattibilità e ordini, dichiara che
> cosa il motore sa davvero fare di ogni strada, e ricostruisce lo stato reale
> dell'atto da coda e cronologia. Il ministro non firma: firma il Presidente.

- **Branch**: `feat/ws-minister-ux-06-dalla-proposta-alla-decisione`
- **Base dichiarata**: `0b7ae5a` (HEAD di `feat/ws-minister-ux-05-memoria-persistente`;
  `main` @ `25a9d89` + l'innesto di memoria di UX-05, **non ancora mergiato**). La
  fase è impilata su UX-05 e sarà riportata su `main` dopo il merge di UX-05.
- **Task**: `docs/roadmaps/task-ws-minister-ux-06.md`.
- **Roadmap**: `docs/roadmaps/raw-roadmap-pi-20260930.md`, fase UX-06.
- **Contratti collegati**: `WS-MINISTER-UX-00-report.md` §3 (conversazione /
  evidenza / ordine / memoria sono oggetti distinti), `WS-MINISTER-UX-03-report.md`
  (direttive), `WS-MINISTER-UX-04-report.md` (confronto e conseguenze),
  `WS-MINISTER-UX-05-report.md` (memoria).
- **Freeze rispettato**: nessuna modifica a `core/simulation/**`, `GameSession`,
  `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema, repository.
  Nessun numero di gioco nuovo: la fase è **solo** frontend, sopra le rotte di coda
  già esistenti (`POST /:id/actions/queue`, `PATCH/DELETE .../:actionId`).
- **JEV**: non toccato.

---

## 1. Il confine, in una frase

La conversazione **propone**, la tavola **mostra e prepara**, la firma **impegna**,
la memoria **ricorda**. Preparare un atto o confrontare due strade **non** accoda e
**non** spende: solo la firma esplicita del Presidente entra nel registro, e da lì
la esegue il motore all'avanzamento del tempo.

## 2. Il flusso: proposta → bozza → firma → esito

```
strada sul tavolo
   │  «Prepara l'atto»   (non accoda, non spende)
   ▼
bozza d'atto  ── «Modifica proposta» ──▶  testo corretto dal Presidente
   │  «Firma e inserisci nel registro»   (rotta di coda esistente)
   ▼
registro (pendingActions)  ── avanzamento del tempo ──▶  esito (HistoryItem)
```

Lo stato dell'atto è `proposto → preparato → accodato → eseguito | fallito`.
Nessuno di questi passaggi è un flag locale: `preparato` è la bozza di UI,
`accodato` è una voce reale di `pendingActions`, `eseguito`/`fallito` è l'esito del
motore in cronologia.

## 3. La capacità dichiarata del motore

Per ogni strada la tavola dice **cosa il motore sa fare** — e non finge:

| Capacità | Quando | Cosa dice la tavola |
|---|---|---|
| **ordine d'opera supportato** | opera con distinta coperta (`declaration.materialActorId`) | «il motore apre il cantiere e addebita la cassa all'esecuzione» |
| **bozza testuale da valutare** | ordine in testo (es. ammortamento titoli) | «il motore interpreterà la prosa al salto: nessun comando dedicato» |
| **funzione assente** | opera con distinta scoperta | «mancano …: registrare non aprirebbe il cantiere» |

La capacità viene dalla **dichiarazione**, non dalla voce del ministro. Una strada
`unsupported` **non** porta con sé la dichiarazione d'opera: resta prosa, e non
sembra eseguita solo perché esiste un ordine in testo.

## 4. Lo stato reale, non un flag locale

`deriveActState(draft, pendingActions, history)` (modulo puro `actDraft.ts`):

1. se il testo della bozza è in `pendingActions` → **accodato** (vince anche su una
   esecuzione precedente: un atto riaccodato è di nuovo in attesa);
2. altrimenti, l'ultimo `HistoryItem` con lo stesso testo: `outcomeStatus ===
   'rejected'` → **fallito**, altrimenti → **eseguito**;
3. altrimenti → **preparato**.

La corrispondenza normalizza spazi e a capo (`orderKey`). Il pannello della bozza e
la riga di stato nel dialogo mostrano entrambi lo stato derivato: la UI distingue
sempre *atto in attesa* ed *effetto applicato*.

## 5. La tavola e il pannello

- **`TreasuryActPanel`** — l'atto del Tesoro non firma più: ogni strada ha
  **«Prepara l'atto»**. La richiesta dei Lavori cambia stato (`in attesa` /
  `accolta`) in base allo stato **reale** della strada d'investimento, non a un
  flag.
- **`SeatTable`** — aggiunge «Confronta le strade» (mostra, non accoda) e rende il
  **`ActDraftPanel`** quando c'è una bozza.
- **`ActDraftPanel`** — la bozza: capacità dichiarata, nota onesta, testo
  correggibile («Modifica proposta»), stato reale, **«Firma e inserisci nel
  registro»**, «Annulla preparazione». Mentre la firma è in volo il pulsante è
  disabilitato; un atto già in coda mostra «Già nel registro» e non si firma due volte.
- **`GovernmentOffice`** — tiene la bozza per la sedia aperta (si azzera cambiando
  sedia o chiudendo l'ufficio), deriva `roadStates`/`draftStatus` da
  `pendingActions` + `history`, e aggiorna il dialogo con una riga di stato reale.

## 6. Niente duplicati, e il nulla di fatto

- **Doppio clic**: un solo atto in volo (`actBusy` nel chiamante + `signing` nel
  pannello); il pulsante è disabilitato.
- **Tentativi ripetuti**: la coda del motore deduplica per testo
  (`queuePlayerAction` non riaccoda un ordine identico già presente).
- **Fallimenti**: la bozza resta, lo stato diventa `fallito`; si può correggere e
  firmare di nuovo.
- **Nulla di fatto**: chiude la seduta senza ordine e **non cancella** gli ordini
  già accodati — che restano nel registro.

## 7. File

### Nuovi
| File | Ruolo |
|---|---|
| `frontend/src/components/Game/actDraft.ts` | contratto puro: capacità, bozza, stato derivato, modifica |
| `frontend/src/components/Game/ActDraftPanel.tsx` | il pannello della bozza d'atto |
| `frontend/src/components/Game/actDraft.test.ts` | 13 test puri (capacità, preparazione, stato reale) |
| `frontend/src/components/Game/actDraftPanel.test.tsx` | 4 test di render (capacità, edizione, anti-duplicato, fallito) |
| `e2e/ux06-shot.mjs` | harness screenshot (bozza e firmato) |
| `docs/implementation/assets/ws-minister-ux-06/` | screenshot a 1440×900, 1024×768, 390×844 |
| `docs/roadmaps/task-ws-minister-ux-06.md` | il task della fase |

### Modificati
| File | Cosa |
|---|---|
| `frontend/src/components/Game/TreasuryActPanel.tsx` | «Prepara l'atto»; stato richiesta derivato dagli stati reali |
| `frontend/src/components/Game/SeatTable.tsx` | «Confronta le strade» + `ActDraftPanel`; il ritorno al messaggio richiede una citazione |
| `frontend/src/components/Game/GovernmentOffice.tsx` | bozza, `roadStates`/`draftStatus`, firma, confronto dal tavolo, riga di stato |
| `frontend/src/components/Game/GameScreen.tsx` | `onQueueOrder` porta la dichiarazione d'opera; rimosso il vecchio `onQueueCabinetPath` |
| `frontend/src/editorial.css` | stili di bozza, capacità, stato, confronto dal tavolo |
| `frontend/src/components/Game/seatCanvasRender.test.tsx` | «Prepara l'atto» invece di «Firma l'atto» |
| `e2e/tests/modules.spec.mjs` | P04b/P04e al flusso prepare→sign; nuovo **P06** (esito reale) |
| `e2e/ux05-shot.mjs` | prepare→sign per lo screenshot della memoria |

## 8. Test ed esiti

| Controllo | Esito |
|---|---|
| `npx tsc --noEmit` (frontend) | pulito |
| `vitest run` (frontend) | **119 file / 997 test** verdi (baseline UX-05 117/980 → +2 file / +17 test) |
| `npx tsc --noEmit` (backend) | pulito |
| `vitest run` (backend) | **205 file / 2154 test** verdi (nessuna modifica backend) |
| `npm run build` (frontend) | build ok |
| E2E `modules.spec.mjs` (mock) | **11/11**, incluso **P06** |
| E2E `a11y` (mock) | **3/3** |
| Screenshot 1440×900 / 1024×768 / 390×844 | `e2e/ux06-shot.mjs`, prodotti (`-bozza`, `-firmato`) |

I test dell'accettazione:

1. **Flusso completo** — P06: confronto → prepara → modifica → firma → registro →
   avanzamento del tempo → stato **eseguito** derivato dalla cronologia.
2. **Non impegna** — P06: «Confronta le strade» e «Prepara l'atto» lasciano il
   registro a 0; solo la firma lo porta a 1.
3. **Firma esplicita** — nessun percorso accoda da sé: il ministro non firma
   (`actDraft.test.ts`, P04b/P06).
4. **Capacità dichiarata** — `actDraft.test.ts` (opera coperta → engine-order;
   distinta scoperta → unsupported con l'elenco dei materiali; testo → text-order).
5. **Niente duplicati** — `actDraftPanel.test.tsx` (atto in coda: «Già nel
   registro», pulsante disabilitato) e `actDraft.test.ts` (stato `queued`).
6. **Stato derivato** — `actDraft.test.ts`: `pendingActions` → accodato,
   `outcomeStatus` → eseguito/fallito, un atto riaccodato torna accodato.
7. **Invarianti** — suite frontend/backend verdi, `tsc` pulito, build ok, E2E e a11y verdi.

## 9. Verifica visiva

`docs/implementation/assets/ws-minister-ux-06/ux06-*-bozza.png` e
`ux06-*-firmato.png`: la strada preparata in bozza (capacità «ordine d'opera
supportato», testo correggibile, stato `preparato`) e la stessa dopo la firma
(stato `accodato`), a desktop, tablet e mobile.

## 10. Limiti residui

- **La bozza non sopravvive alla chiusura dell'ufficio**: è stato di UI per sedia,
  non memoria. Lo stato `eseguito` si rivede ripreparando la strada (P06) o dalla
  cronologia; non è promesso come persistenza (non è materia di UX-06).
- **`queueCabinetPath`** resta nel hook ordini come API pubblica ma non è più usato
  dalla seduta: la firma passa da `queuePlayerAction(text, work)`, che onora la
  «Modifica proposta». Nessun comportamento rimosso dal motore.
- **Respingimento strutturato dal modello** resta di UX-05 (§6.6): qui lo stato
  `fallito` è derivato dall'esito del motore, non prodotto dal modello.
- **`onQueueOrder` e la dichiarazione**: la dichiarazione d'opera viaggia con il
  testo (non più ricomposta): una bozza d'opera modificata resta un ordine d'opera.
- Igiene preesistente: `dist/**/*.test.js` (copie compilate non versionate) vanno
  rimosse prima di `vitest`, altrimenti falliscono per `require('vitest')` in CommonJS.

## 11. Freeze e classificazione A/B/C/D/E

Il freeze è **intatto**: nessuna riga sotto `core/simulation/**`, `GameSession`,
`TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema o
repository. Nessuna migrazione, nessun motore nuovo, nessun numero inventato.

- **A** — il flusso proposta→decisione: `actDraft.ts`, `ActDraftPanel.tsx`,
  `TreasuryActPanel.tsx`, `SeatTable.tsx`, `GovernmentOffice.tsx`, `GameScreen.tsx`,
  `editorial.css`.
- **B** — harness e E2E: `e2e/ux06-shot.mjs`, `e2e/tests/modules.spec.mjs` (P04b,
  P04e, P06), `e2e/ux05-shot.mjs`.
- **C** — test: `actDraft.test.ts`, `actDraftPanel.test.tsx`,
  `seatCanvasRender.test.tsx`.
- **D** — questo report, il task e gli screenshot.
- **E** — *nessuna*. Nessuna migrazione, nessun dato toccato.

---

**Prossimo passo del piano**: **WS-MINISTER-UX-07** (verifica completa e
rifinitura): Tesoro, Sanità/Istruzione e Guerra, un caso con dati mancanti,
accessibilità, latenza e chiamate LLM. La fase dovrà anche riportare UX-06 su
`main` dopo il merge di UX-05.
