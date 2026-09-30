# WS-MINISTER-UX-03 — La conversazione guida la tavola

> Finché la tavola è selezionata dal frontend (UX-01), il ministro può parlare ma
> non può **mostrare**: la destra non risponde al colloquio. Questa fase dà al
> ministro una capacità di presentazione **strutturata** — scegliere cosa
> mostrare, su quale evidenza — senza consegnargli mai dati, HTML o geometrie.

- **Ramo**: `feat/ws-minister-ux-03-conversazione-guida-tavola`, impilato su
  `feat/ws-minister-ux-02-identita-ministro` (tip `8debb2b`). Base dichiarata:
  `origin/main` @ `5ec7cdc` (UX-02 non ancora mergiata: la PR la apre la regia).
- **Roadmap**: `docs/roadmaps/raw-roadmap-pi-20260930.md`, fase UX-03.
- **Contratti collegati**: `WS-MINISTER-UX-00-report.md` §3 (conversazione /
  evidenze / ordini sono oggetti distinti), `WS-MINISTER-UX-01-report.md` (la
  tavola e il suo ordine predefinito), `WS-MINISTER-UX-02-report.md` (voce e
  priorità del ministro).
- **Freeze rispettato**: nessun file di `core/simulation/**`, nessuna modifica a
  `GameSession`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`,
  schema o repository. Nessun innesto rimandato per freeze.

---

## 1. Il confine, in una frase

Il modello **sceglie riferimenti** (un'operazione e una chiave di evidenza); il
**resolver** costruisce il blocco dalle fonti autorizzate già in memoria
(`SeatCanvasBlock`, `TreasuryRoad`). Una direttiva invalida non fa nulla: la
risposta testuale resta e la tavola non finge di aver mostrato qualcosa.

## 2. Il contratto

### `PresentationDirective`

```ts
export type PresentationOperation = 'show' | 'focus' | 'compare' | 'annotate' | 'dismiss';
export type EvidenceKey = 'spesa' | 'trend' | 'cifre' | 'piano' | 'mappa' | 'idee';

export interface PresentationDirective {
  readonly op: PresentationOperation;
  readonly evidence?: EvidenceKey; // richiesta per show/focus/annotate
  readonly note?: string;          // per annotate; testo breve, mai markup
}
```

Il vocabolario è **chiuso**: `op` e `evidence` sono elenchi dichiarati; qualunque
altro valore è respinto. Le chiavi extra in JSON (es. `regionIds`) sono
**ignorate**; se il payload contiene markup o codice (`<`, `>`, `javascript:`,
`on…=`), l'intera direttiva è respinta.

### Il formato sul filo

Un blocco delimitato con una sola riga JSON, come **ultima** riga della risposta
(ripiego previsto dalla roadmap quando il provider non offre eventi strutturati):

````
```tavola
{"op":"focus","evidence":"spesa"}
```
````

Il parser accetta anche un ripiego `op=focus evidence=mappa` quando il JSON non
c'è. Il blocco è **sempre rimosso** dal testo: non compare mai come prosa, e
durante lo streaming un blocco incompleto viene tagliato via (nessuna struttura
parziale resa alla tavola).

### La riga aggiunta al briefing

In `backend-nest/src/core/government/MinisterChat.ts`, dopo le regole di dialogo:

```
PRESENTAZIONE (la tavola, solo se serve):
- Puoi disporre sulla tavola l'evidenza che aiuta il Presidente: una sola scelta per risposta, come ULTIMA riga del testo.
- Formato: un blocco delimitato con una sola riga JSON, per esempio:
```tavola
{"op":"focus","evidence":"spesa"}
```
- `op` è uno di: show, focus, compare, annotate, dismiss. `evidence` è una di: spesa, trend, cifre, piano, mappa, idee.
- Nel blocco scrivi SOLO questa scelta: niente HTML, niente JavaScript, niente numeri, niente geometrie, niente altre chiavi.
- Usa solo le evidenze che esistono per la tua sedia; se non serve mostrare nulla, NON aggiungere il blocco.
```

Le regole dei dati restano intatte accanto alla presentazione: «un'opinione non è
un dato», `DATO MANCANTE` resta mancante, «Non impegni nulla».

## 3. Flusso end-to-end

```
modello ── testo + blocco `tavola` ──▶ MinisterChat
                                        │  parsePresentation(): estrae, valida, rimuove il blocco
                                        │  (solo a risposta conclusa; durante lo streaming non emette)
                                        ▼
                             onPresentation(messageId, quote, directive)
                                        ▼
                          GovernmentOffice: presentations[sedia] = ActivePresentation
                                        ▼
                  resolvePresentation(active, canvasBlocks, act.roads)
                                        ▼
                          SeatTable: evidenza in cima / confronto / tavola predefinita
```

- **La chiave → il blocco** (`presentation.ts`): `spesa→bilancio`,
  `trend→trend`, `cifre→cifre-sedia` (ripiego `quadro`), `piano→piano`,
  `mappa→zone`, `idee→idee`. Se il blocco non esiste per quella sedia, il
  resolver restituisce `null` e la tavola resta quella predefinita.
- **`compare`** costruisce il confronto dalle `TreasuryRoad` dell'atto (costo
  immediato, guadagno atteso, raccomandata): le stesse cifre del motore, nessun
  effetto sociale inventato. Non firma: l'ordine nasce dall'atto.
- **`dismiss`** e il pulsante «Tavola predefinita» chiudono la presentazione.
- **Isolamento**: la presentazione è legata alla **sedia** e al **messaggio**
  (`messageId = "<sedia>#<indice>"`); la tavola di un'altra sedia non eredita
  nulla. Lo stato è di UI: parlare e mostrare **non** toccano coda o mondo.
- **Streaming**: nessuna struttura parziale; l'evento scatta solo a risposta
  conclusa ed è emesso una volta sola per messaggio.
- **Errori**: direttiva invalida o evidenza assente ⇒ nessuna modifica; la
  risposta testuale è conservata integralmente.

## 4. File

### Nuovi
| File | Ruolo |
|---|---|
| `frontend/src/components/Game/presentation.ts` | contratto, parser/validatore, catalogo e resolver (puro) |
| `frontend/src/components/Game/ProposalComparison.tsx` | il confronto tra le strade del motore |
| `frontend/src/components/Game/presentation.test.ts` | 10 test puri sul contratto e il resolver |
| `frontend/src/components/Game/seatTablePresentation.test.tsx` | 3 test di render sulla tavola guidata |
| `backend-nest/tests/ws-minister-ux-03.test.ts` | 5 test sul contratto nel briefing |
| `e2e/ux03-shot.mjs` | harness screenshot (focus, confronto) |

### Modificati
| File | Cosa |
|---|---|
| `backend-nest/src/core/government/MinisterChat.ts` | sezione `PRESENTAZIONE` nel briefing (contratto del modello) |
| `frontend/src/components/Game/MinisterChat.tsx` | estrae/rimuove il blocco; emette `onPresentation` a risposta conclusa |
| `frontend/src/components/Game/GovernmentOffice.tsx` | stato presentazione per sedia, resolver, badge mobile, ritorno al messaggio |
| `frontend/src/components/Game/SeatTable.tsx` | evidenza presentata in cima, confronto, banner con citazione e comandi |
| `frontend/src/editorial.css` | stili di banner, confronto e pallino mobile (delimitati alla tavola) |
| `e2e/mock-api.mjs` | la risposta ministeriale mock può chiedere un'evidenza (`spesa`/`mappa`/`confronta`) |
| `e2e/tests/modules.spec.mjs` | nuovo **P04c**: la conversazione guida la tavola, isolamento e ritorno |

### Asset
`docs/implementation/assets/ws-minister-ux-03/` — screenshot a 1440×900,
1024×768 e 390×844 (`after-*-focus.png`, `after-*-confronto.png`).

## 5. Test ed esiti

| Controllo | Esito |
|---|---|
| `npx tsc --noEmit` (frontend) | pulito |
| `vitest run` (frontend) | **113 file / 946 test** verdi (baseline 111/933 → +2 file / +13 test) |
| `npx tsc --noEmit` (backend) | pulito |
| `vitest run` (backend) | **202 file / 2128 test** verdi (baseline 201/2123 → +1 file / +5 test) |
| `npm run build:frontend` | build ok |
| E2E `modules.spec.mjs` (mock) | **8/8**, incluso **P04c** (focus → confronto → isolamento → ritorno) |
| E2E a11y `HUD di gioco` | **1/1** |
| Screenshot 1440×900 / 1024×768 / 390×844 | `e2e/ux03-shot.mjs`, tutti prodotti |

P04c verifica, in particolare: nessun banner senza richiesta; «Mi mostri dove va
la spesa?» porta `.seat-table-main` a contenere il grafico e il banner a dire
«Dove va la spesa»; il blocco ```` ```tavola ```` **non** è mai visibile nella
chat; «Confronta le due strade» mostra `.proposal-comparison` con Ammortamento e
Investimento; un'altra sedia non eredita il banner; «Tavola predefinita» lo
chiude.

## 6. Verifica visiva

- **Focus spesa**: la tavola apre con il **grafico del bilancio** e il banner che
  cita il messaggio; il piano scende tra i supporti.
- **Confronto**: due schede affiancate (Ammortamento / Investimento) con costo
  immediato, guadagno atteso e badge «raccomandata».
- **Mobile**: una superficie alla volta; mentre si legge il dialogo compare il
  **pallino** sulla linguetta «Tavola» per la nuova evidenza; «Vai al messaggio»
  riporta al dialogo.

## 7. Limiti residui

- **La scelta è del modello**: i test difendono il **contratto** (formato,
  vocabolario, validazione, resolver) e il percorso mock. Non c'è un E2E con LLM
  reale: se il provider non emette il blocco, la tavola resta quella predefinita
  — che è il comportamento di sicurezza previsto.
- **`compare` riguarda le strade del Tesoro** (`act.roads`). Per le altre sedie,
  senza strade dichiarate, il confronto dice «Nessuna alternativa dichiarata» e
  non inventa opzioni.
- **`annotate`** mostra la nota nel banner, ma non c'è ancora una selezione
  territoriale: eventuali `regionIds` sono ignorati di proposito (nessuna
  geometria dal modello). Un focus su sotto-insiemi di zone appartiene a UX-04.
- **«Vai al messaggio»** su mobile riporta al **dialogo**, non ancora allo scroll
  esatto del messaggio: l'ancoraggio preciso è una rifinitura di UX-07.
- **Stato di UI, non memoria**: la presentazione vive nello stato del componente
  e si perde al reload. La memoria persistente è UX-05; qui non è promessa.
- Nota di igiene preesistente: `dist/**/*.test.js` (copie compilate non
  versionate) vanno rimosse prima di `vitest`, altrimenti falliscono per
  `require('vitest')` in CommonJS.

## 8. Freeze e innesto

Non è stato necessario toccare la simulazione: il contratto vive in
`core/government/**` (testo del briefing) e nella presentazione frontend, che
legge solo read model già in memoria. **Nessun innesto rimandato per freeze.**

---

**Prossimo passo del piano**: **WS-MINISTER-UX-04** (grafici, mappe focalizzate e
confronto delle conseguenze), che estende il confronto e la vista geografica su
cui questa fase ha predisposto il punto di aggancio.
