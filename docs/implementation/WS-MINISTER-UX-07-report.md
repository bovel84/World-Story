# WS-MINISTER-UX-07 — Verifica completa e rifinitura

- **Repo**: `/Users/bovel/Desktop/World Story`
- **Branch**: `feat/ws-minister-ux-07-verifica-completa`
- **Base reale dichiarata**: `0803a58` (`docs(ux07): task file`), sopra `main` @
  `02ad9ad` (merge PR #149, UX-06).
- **Task**: `docs/roadmaps/task-ws-minister-ux-07.md`
- **Roadmap**: `docs/roadmaps/raw-roadmap-pi-20260930.md` §WS-MINISTER-UX-07
- **Contratti collegati**: `WS-MINISTER-UX-00-report.md` §3, `WS-MINISTER-UX-03/04/05/06-report.md`.
- **Natura della fase**: verifica + rifinitura. Nessuna meccanica nuova, nessun
  numero nuovo, nessun motore nuovo.
- **JEV**: non toccato.

---

## 1. Problemi trovati (causa reale, con file e riga)

### 1.1 CRASH — il percorso del ministro non risponde più (bloccante)

**Sintomo**: `POST /:id/government/minister/:seat` (e lo stream) va in
`TypeError: Cannot read properties of undefined (reading 'map')`.

**Causa reale**: `GameSession.ministerMemoryFor` (`backend-nest/src/game-session.ts:3364`)
dichiarava `any[]` e restituiva direttamente il risultato di
`ministerMemoryRepository.listMemory(...)`, che è un **array di righe**
(`MinisterMemoryRecord[]`). Quel valore veniva passato a
`briefingFor(address, agenda, memory?)`, che si aspetta una `MinisterMemory`
(oggetto con `.records`). Con `memory` = array vuoto — che è **truthy** — il
briefing entrava nel ramo memoria e chiamava `memorySection(memory)`, che a sua
volta chiama `relevantMinisterMemory(memory)` e fa `memory.records.map(...)`
(`backend-nest/src/core/government/MinisterMemory.ts:237`): `memory.records` è
`undefined` ⇒ crash.

Il difetto era invisibile alle suite E2E mock (il mock intercetta la rotta nel
browser e il backend reale non gira) ed era mascherato in `vitest` dal
`require('./core/government/MinisterChat')` non risolvibile in ESM
(`game-session.ts:3384`, ora rimosso): il test del prompt non arrivava mai alla
riga rotta.

**Impatto**: qualsiasi conversazione con un ministro nella partita reale non
risponde. Blocca anche la verifica di A1/A2/A3 sul backend vero.

### 1.2 A1 — Markdown grezzo e falsi corsivi

**Contesto**: la chat rendeva già il markdown come documento (`RichText` /
`richTextModel.ts` dalla fase P02-ter): grassetto, corsivo, elenchi e titoli
erano resi senza asterischi. **Non** era quindi «markdown grezzo» il difetto
residuo. Il difetto reale rimasto era nella funzione pura del parser.

**Causa reale**: in `frontend/src/components/Game/richTextModel.ts:48` il
marcatore di corsivo `\*([^*\n]+)\*` non distingueva una moltiplicazione. Con
asterischi legittimi fra numeri — `2*3*4` — il parser leggeva `*3*` come corsivo
e rendeva `<em>3</em>`. Verificato prima della correzione con l'harness
(`.../before/ux07-*-markdown.png`: `multiplicationItalic: true`).

### 1.3 A2 — «Dove va la spesa» mostrava l'insieme, non la voce discussa

**Causa reale**: la mappa `spesa → bilancio` (`presentation.ts`,
`BLOCK_ID_BY_KEY`) portava in cima **tutto** il grafico delle uscite. Il
resolver non aveva alcun aggancio alla **voce** di spesa discussa: la tavola
mostrava le uscite in ordine di importo, senza evidenziare sanità, istruzione,
difesa o opere. Verificato prima della correzione:
`focused=null`, banner `Mostrato su richiesta — Dove va la spesa`.

### 1.4 A3 — Layout mobile: etichette del bilancio tagliate

**Causa reale**: a `390×844`, la tavola del Tesoro usava la griglia desktop del
grafico (`.advisor-chart-bars li { grid-template-columns: minmax(72px, 38%) 1fr auto }`,
`foundations.css:2158`) con `.advisor-chart-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }`.
Le voci lunghe («Amministrazione pubblica», «Istruzione e ricerca», «Sostegno
sociale e lavoro») venivano troncate con «…». Verificato prima della correzione:
`clipped(tavola)=3` a `390×844`, `0` a 1024/1440.

### 1.5 C — Autoscroll che strappava la lettura; streaming token-per-token

**Causa reale (autoscroll)**: `MinisterChat.tsx` aveva
`useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streaming])`
senza alcuna condizione: ogni token riportava la chat in fondo, anche a chi era
risalito a rileggere.

**Causa reale (screen reader)**: `.minister-thread` era `aria-live="polite"` e
conteneva il messaggio in streaming: lo screen reader poteva vocalizzare ogni
token.

**Focus della tavola**: la selezione locale della mappa (`ZoneMap`) si perdeva
al cambio di `focusRegionIds` (la `key` del componente rimonta), e non c'era modo
di **fissare** un'evidenza mentre si leggeva.

---

## 2. Correzioni applicate

### 2.0 Crash (precondizione)

- `backend-nest/src/game-session.ts` — `ministerMemoryFor` ora restituisce una
  `MinisterMemory` **con il suo scope** (`{ scope, records }`), non l'array di
  righe. Il `require` dinamico di `MinisterChat` è diventato un import statico
  (era anche il motivo per cui il percorso non era testabile in `vitest`).
- `backend-nest/tests/ws-minister-ux-05-graft.test.ts` — aggiornate le due
  asserzioni a `.records` e aggiunto un test di regressione che scrive un
  ricordo e verifica che **arrivi nel prompt reale** della sedia (il percorso che
  prima andava in `TypeError`): `il prompt della sedia si compone con la memoria, senza TypeError`.

### 2.1 A1 — Markdown corretto, moltiplicazioni intatte

- `frontend/src/components/Game/richTextModel.ts:48` — il corsivo `*…*` ora non
  si apre a contatto di una cifra (`(?<!\d)\*([^*\n]+)\*(?!\d)`). `2*3*4` resta
  testo; `*enfasi*` resta corsivo.
- Test in `richTextModel.test.ts`: «una moltiplicazione non diventa corsivo»
  (con guardia sul corsivo vero, per non allentare il contratto).
- Verifica DOM end-to-end in `e2e/ux07-shot.mjs`: `bold/em/list` resi,
  `rawAsterisks=false`, `multiplicationPreserved=true`, `multiplicationItalic=false`.

### 2.2 A2 — La voce di spesa discussa, scelta in locale

- Nuovo modulo puro `frontend/src/components/Game/spendingFocus.ts`:
  `matchSpendingVoice(text, labels)` sceglie la voce del bilancio pertinente per
  sinonimi noti (sanità, istruzione, difesa, infrastrutture, sostegno,
  amministrazione) + parole dell'etichetta. Deterministico, nessuna chiamata
  LLM; `null` se nulla combacia (mai una voce a caso).
- `presentation.ts` — `ActivePresentation.discussion` (l'ultimo messaggio del
  Presidente) e `ResolvedPresentation.focusLabel`: per `evidence: 'spesa'` la
  voce si sceglie dal **discorso** (ripiego: la citazione della risposta). La
  label del banner diventa `Dove va la spesa — Sanità e assistenza`.
- `MinisterChat.tsx` — l'evento `onPresentation` porta anche il testo utente.
- `AdvisorChart.tsx` / `SeatCanvas.tsx` / `SeatTable.tsx` — la voce in evidenza
  **sale in cima** ed è marcata `.focused`; il resto resta leggibile sotto. Il
  dato non cambia: cambia cosa è evidenziato.
- Test: `spendingFocus.test.ts` (6), `presentation.test.ts` (A2 focus + nessun
  aggancio), `seatTablePresentation.test.tsx` (render con voce in cima).
- E2E `P07`: banner `Dove va la spesa — Sanità e assistenza` e
  `.advisor-chart-bars li.focused` con la voce del read model.

### 2.3 A3 — Tavola mobile leggibile

- `frontend/src/editorial.css`, blocco `@media (max-width: 767px)`: nel grafico
  di bilancio l'etichetta va su una riga propria e può andare a capo
  (`white-space: normal; overflow: visible; text-overflow: clip`), la barra sotto
  a tutta larghezza. Le voci lunghe non sono più troncate.
- Il banner della presentazione (ora con «Fissa evidenza», «Tavola predefinita»,
  «Vai al messaggio») va a capo su mobile invece di uscire dal foglio.
- Verifica: `clipped(tavola)` da `3` a `0` a `390×844`; `0` su 1024/1440.

### 2.4 C — Accessibilità e streaming

- Nuovo modulo puro `chatScroll.ts` + `chatScroll.test.ts`: `isNearBottom`
  (±48 px). `MinisterChat` segue il fondo **solo** se il giocatore era in fondo;
  chi risale resta dove sta. L'invio forza l'aggancio.
- Screen reader: `.minister-thread` **non** è più una live region; una regione
  separata `p.minister-live.sr-only[role=status][aria-live=polite]` annuncia
  **la sola risposta conclusa** (senza il blocco `tavola`). Niente token-per-token.
- Evidenza fissabile: `ActivePresentation.pinned`, `shouldApplyPresentation`
  (puro) e pulsante `aria-pressed` nella tavola. Un'evidenza fissata non viene
  sostituita da nuove risposte; solo un comando esplicito (o un `dismiss`) la
  chiude.
- `.sr-only` globale in `editorial.css`; `prefers-reduced-motion` già coperto
  dal foglio esistente (`scroll-behavior: auto`).
- Test: `presentation.test.ts` (lucchetto), `seatTablePresentation.test.tsx`
  (render del pulsante), a11y E2E «seduta del ministro» (tastiera, Enter,
  live region separata, `aria-pressed`, audit DOM).

### 2.5 Difetti emersi in B (copertura)

- `backend-nest/tests/ws-minister-ux-07.test.ts` — eventi fuori ordine e
  duplicati non rompono né duplicano la memoria; il rewind pota il futuro e
  conserva il tardivo; il blocco di prompt dichiara il confine con i fatti.
- Il test di regressione del crash (§2.0) copre anche l'isolamento di scope
  (mandato server-side) nel percorso reale.

---

## 3. File modificati

### Nuovi
| File | Ruolo |
|---|---|
| `frontend/src/components/Game/spendingFocus.ts` | scelta deterministica della voce di spesa (A2) |
| `frontend/src/components/Game/spendingFocus.test.ts` | test puri di A2 |
| `frontend/src/components/Game/chatScroll.ts` | decisione pura dell'autoscroll (C) |
| `frontend/src/components/Game/chatScroll.test.ts` | test puri di C |
| `backend-nest/tests/ws-minister-ux-07.test.ts` | copertura B (eventi fuori ordine/duplicati) |
| `e2e/ux07-shot.mjs` | screenshot + misura di taglio (A1/A2/A3) |
| `e2e/ux07-latency.mjs` | misura latenza e chiamate LLM (D) |
| `docs/implementation/assets/ws-minister-ux-07/before/` | screenshot **prima** (1440/1024/390) |
| `docs/implementation/assets/ws-minister-ux-07/after/` | screenshot **dopo** (1440/1024/390) |

### Modificati
| File | Cosa |
|---|---|
| `backend-nest/src/game-session.ts` | `ministerMemoryFor` restituisce `MinisterMemory`; import statico di `MinisterChat` (crash) |
| `backend-nest/tests/ws-minister-ux-05-graft.test.ts` | asserzioni `.records` + test di regressione del prompt |
| `frontend/src/components/Game/richTextModel.ts` | corsivo `*…*` che non tocca i numeri (A1) |
| `frontend/src/components/Game/richTextModel.test.ts` | test A1 |
| `frontend/src/components/Game/presentation.ts` | `discussion`, `focusLabel`, `pinned`, `shouldApplyPresentation` (A2/C) |
| `frontend/src/components/Game/presentation.test.ts` | test A2/C |
| `frontend/src/components/Game/MinisterChat.tsx` | discussion all'evento, autoscroll condizionato, live region separata (A2/C) |
| `frontend/src/components/Game/GovernmentOffice.tsx` | pin dell'evidenza, discussion (A2/C) |
| `frontend/src/components/Game/SeatTable.tsx` | pulsante «Fissa evidenza», `focusLabel` (A2/C) |
| `frontend/src/components/Game/SeatCanvas.tsx` | `focusLabel` verso il grafico (A2) |
| `frontend/src/components/Game/AdvisorChart.tsx` | voce in evidenza in cima e marcata (A2) |
| `frontend/src/components/Game/seatTablePresentation.test.tsx` | test A2/C di render |
| `frontend/src/editorial.css` | `.sr-only`, banner fissato, etichette mobile, voce in evidenza (A2/A3/C) |
| `e2e/tests/modules.spec.mjs` | nuovo **P07** (voce di spesa + evidenza fissata) |
| `e2e/a11y/a11y.spec.mjs` | nuova verifica tastiera/streaming/audit della seduta |

---

## 4. CORE ENGINE FREEZE — conferma

Il freeze è **intatto**. Nessuna riga toccata in:

- `backend-nest/src/core/simulation/**`
- `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`
- schema/database, repositories (nessuna migrazione)
- semantica checkpoint / simulation run / playback
- pipeline di avanzamento del tempo

L'unica modifica a `GameSession` (`ministerMemoryFor`) è la **correzione di un
difetto nella composizione del prompt** dentro il percorso del ministro: non
tocca stato, simulazione, coda o tempo. Nessun motore nuovo, nessun numero nuovo.
JEV: non toccato.

---

## 5. Test eseguiti (esito reale, numeri)

| Controllo | Comando | Esito |
|---|---|---|
| Frontend unit | `vitest run` (frontend) | **121 file / 1013 test verdi** (baseline UX-06: 119/997 → +2 file / +16 test) |
| Backend unit | `vitest run` (backend) | **206 file / 2158 test verdi** (baseline UX-06: 205/2154 → +1 file / +4 test) |
| Type-check frontend | `npx tsc --noEmit` | pulito |
| Type-check backend | `npx tsc --noEmit` | pulito |
| Build backend | `npm run build:backend` | ok |
| Build frontend | `npm run build:frontend` | ok |
| E2E mock | `playwright test tests/modules.spec.mjs` | **12/12** (incluso **P07**) |
| E2E a11y | `playwright test --config=playwright.a11y.config.mjs` | **4/4** (inclusa la seduta del ministro) |

Nota di igiene già documentata: prima di `vitest` vanno rimossi i
`dist/**/*.test.js` generati da `tsc` (copie compilate non versionate). Nessun
test è stato allentato o disattivato; nessuna soglia alzata.

**Test rosso rieseguito, non rilassato**: nessun rosso di timeout durante questa
sessione (le suite sono passate al primo tentativo dopo le correzioni; un
fallimento *di assertion reale* in P07 — `toHaveAttribute('data-pinned', null)`,
non valido nell'API Playwright — è stato corretto **nel test**, perché era un
errore del test, non del codice).

---

## 6. Risultati — misure reali di latenza e chiamate LLM

**Metodo**: `e2e/ux07-latency.mjs`, percorso mock Playwright (`installMockApi`),
viewport 1440×900. Conta i `POST .../government/minister/:seat` reali e misura
«Invio → risposta conclusa» su 8 messaggi. Il provider è mockato: la **latenza è
dell'applicazione** (rete locale, render, risoluzione della presentazione), non
del modello; il **conteggio delle chiamate** è invece quello reale del percorso.

| Metrica | Valore misurato |
|---|---|
| Messaggi inviati | 8 |
| Chiamate al ministro | **8** (1 per messaggio — atteso 8) |
| Chiamate aggiuntive per grafici/mappe/presentazione | **0** |
| Latenza media | **293 ms** |
| p50 | **336 ms** |
| p95 | **336 ms** |
| min / max | **252 / 336 ms** |

Invariante verificata: **una risposta per testo e presentazione** — il blocco
`tavola` viaggia nella stessa risposta del testo (nessun secondo round-trip), e
il render di grafici e mappe non genera alcuna chiamata (`extraCallsForChartsOrMaps = 0`).

---

## 7. Prima / dopo — screenshot comparabili

Asset: `docs/implementation/assets/ws-minister-ux-07/before/` e `/after/`
(`1440×900`, `1024×768`, `390×844`).

| Difetto | Prima (misura) | Dopo (misura) |
|---|---|---|
| A1 — `2*3*4` in corsivo | `multiplicationPreserved=false`, `multiplicationItalic=true` | `multiplicationPreserved=true`, `multiplicationItalic=false` |
| A2 — voce di spesa in evidenza | `focused=null`, banner «Dove va la spesa» | `focused="Sanità e assistenza"`, banner «Dove va la spesa — Sanità e assistenza» |
| A3 — taglio tavola a 390×844 | `clipped(tavola)=3` | `clipped(tavola)=0` |

File per viewport: `ux07-<width>-markdown.png` (A1),
`ux07-<width>-spesa.png` (A2/A3), `ux07-390-dialogo.png` (A3 mobile).

---

## 8. Limiti residui

1. **La scelta della voce di spesa (A2) usa i sinonimi italiani del modulo**
   (`spendingFocus.ts`): una denominazione del bilancio molto diversa o una
   lingua diversa non combacia → si mostra l'insieme, senza inventare una voce.
   È il comportamento di sicurezza voluto, ma il dizionario è estendibile.
2. **«Fissa evidenza» è stato di UI per sedia**: non sopravvive alla chiusura
   dell'ufficio (coerente con la memoria di presentazione di UX-03/05; la
   persistenza vera riguarda i *ricordi*, non l'evidenza a schermo).
3. **La latenza di D è dell'applicazione, non del modello**: con un provider
   reale va misurata la latenza di `getAdvisorStream` (fuori dagli E2E offline).
4. **`deleteGameMemory`** resta senza call site (nessun percorso `deleteGame`
   nel progetto), come già dichiarato in UX-05.
5. **Respingimento strutturato dal modello** (proposta respinta *con motivo*)
   resta aperto da UX-05 §6.6: contratto e resa pronti, produzione dal modello
   no.

---

## 9. Proposte per fasi successive

1. **Misura di latenza con provider reale** (streaming SSF/SSE): separare
   latency di rete/provider da quella di render, e fissare un budget per
   risposta.
2. **Respingimento strutturato**: estendere il protocollo `tavola` a un evento
   `memoria` (direttiva validata come UX-03) e persisterlo nell'innesto UX-05.
3. **Selezione territoriale di A2**: oggi `regionIds` è mappa-solo; un focus su
   sotto-insiemi per la spesa (es. «sanità in una provincia») può riusare lo
   stesso resolver deterministico.
4. **Dizionario voce→frase** per A2 alimentato dai `label` del motore invece che
   da sinonimi cablati, così nuove voci di bilancio sono evidenziabili senza
   modifiche.
5. **Igiene**: rimuovere alla radice la generazione dei `dist/**/*.test.js`
   (escludere `tests/**` dal `tsconfig` di build) per non doverli cancellare
   prima di `vitest`.

---

## 10. Criterio di successo — verifica puntuale

- ✅ A1, A2, A3 corretti e provati (test + screenshot prima/dopo).
- ✅ Copertura B dimostrata, incluso il caso dati mancanti (già difeso nei test
  dei read model e in `p02b-minister-chat.test.ts`; eventi fuori ordine nel
  nuovo `ws-minister-ux-07.test.ts`).
- ✅ Accessibilità e streaming (C) verificati e rifiniti (autoscroll, live
  region, evidenza fissabile, tastiera, reduced motion).
- ✅ Misure reali di latenza e chiamate LLM (D) riportate con metodo.
- ✅ Core engine congelato, nessun motore nuovo, nessun test allentato.
- ✅ Suite verdi: backend, frontend, `tsc`, build, E2E mock, a11y.
