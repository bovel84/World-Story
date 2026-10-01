# WS-GOVUX-P0 — Audit, baseline e matrice del modulo Governo

Base verificata: `main` / `origin/main` **`05575db`**, merge PR #151.
Branch: **`feat/ws-govux-p0-audit-baseline`**.
Task letto integralmente: `/tmp/pi-tasks/pi-task-gov-ux-roadmap.md`.

**P0 completata come audit. P1…P7 NON completate. Arresto richiesto dal CORE ENGINE FREEZE:**
l'audit identifica contratti necessari in P2/P5 che attraversano componenti congelati.
Questo report non autorizza tali modifiche e non presenta flag UI come garanzie server.
**Nessun merge, deploy, riavvio backend, migrazione o modifica al codice applicativo.**

## 1. Problema risolto e comportamento finale

Mancava una baseline aggiornata alle cinque dimensioni CSS richieste e una matrice
che separasse le capacità effettivamente consegnate dalle capacità solo nominali.
P0 consegna audit del percorso reale, baseline riproducibile e lacune verificabili.
Il comportamento applicativo resta quello di `05575db`.

### Flusso reale ricostruito

1. **Ingresso nel Governo.** `frontend/src/components/Game/GameScreen.tsx:187-191`
   carica il gabinetto mediante `frontend/src/hooks/useOrderQueue.ts:121-135` e
   `frontend/src/services/api.ts:1150-1151` (`GET government/cabinet`).
   `backend-nest/src/routes/games/state.routes.ts:233-249` chiama
   `game/GovernmentReadings.ts:309-357` e `core/government/Cabinet.ts:158-198`.
   È un read model deterministico: **nessuna richiesta LLM per ministro all'apertura**.
2. **Scelta.** `GovernmentOffice.tsx:445-451` imposta la sedia;
   `CabinetSession.tsx:122-153` mostra solo ruolo e competenza. Il governo è già
   organizzato in scelta → seduta: non occorre ricostruirlo.
3. **Ripresa e contesto.** `GovernmentOffice.tsx:231-239` legge la cronaca per sedia
   dallo store. `MinisterChat.tsx:162-187` invia domanda, ultimi 20 messaggi e memoria.
   `api.ts:1862-1919` invoca il POST `/government/minister/:seat/stream`.
4. **Server e LLM.** `advisor.routes.ts:204-257` normalizza la cronaca e persiste
   la memoria ricevuta prima della risposta; `game-session.ts:3334-3432` compone
   briefing, persona, fatti e memoria. `agents.ts:140-163` passa al prompt generale
   del consulente (`prompt-builder.ts:1410-1457`, `prompts/advisor.ts:14-120`),
   poi `llm/router.ts` e l'adattatore del provider.
5. **Risposta.** L'adattatore `llm/openai-compatible.ts:187-190` chiama
   `onToken(numeroCaratteri, testoCumulativo)`. La rotta del ministro
   `advisor.routes.ts:240-250` considera invece il primo argomento una stringa:
   ignora i callback incrementali e scrive la risposta finale. La baseline reale
   osserva **un solo blocco da 1253 byte dopo circa 16,7 s**, non streaming incrementale.
   Il conteggio di chunk di rete da solo non prova il bug: è corroborato dal
   disallineamento dei contratti sorgente.
6. **Tavola.** `MinisterChat.tsx:127-145` estrae il fence `tavola` solo a risposta
   conclusa. `presentation.ts:227-312` conserva l'ultima direttiva valida e la
   risolve contro i blocchi reali; `GovernmentOffice.tsx:269-324` conserva una
   presentazione per sedia; `SeatTable.tsx` rende grafici/mappe/confronti esistenti.
   Il modello sceglie l'evidenza, **non produce i dati numerici del grafico**.
7. **Bozza.** `GovernmentOffice.tsx:343-359` prepara/modifica/scarta in UI;
   `actDraft.ts:123-150` deriva il testo e conserva la dichiarazione d'opera.
   La baseline percorre questa parte senza firma: la coda resta identica.
8. **Decisione.** `ActDraftPanel.tsx:33-45` chiede una firma esplicita;
   `GovernmentOffice.tsx:365-381` → `useOrderQueue.ts:137-156` → `api.ts:1345-1359`
   → `actions.routes.ts:184-217` → `GameSession.queueAction` →
   `game/OrderExecutionService.ts:188-210` → `repositories/game.repository.ts:647-661`.
   **Firma = ordine persistito in coda; gli effetti sul mondo arrivano solo
   avanzando il tempo.** Non è applicazione economica istantanea. Nessuna firma
   aggiunta sulla partita reale durante P0; questo tratto è verificato per sorgente,
   test unitari e E2E mock, non spacciato per nuova firma reale.
9. **Memoria.** `GovernmentOffice.tsx:138-151,369-398` registra ricordi locali su
   partita + ramo + mandato. La memoria server è nello scope corrispondente
   (`repositories/minister-memory.repository.ts:85-137`), ma la scrittura dal
   client avviene **alla successiva domanda al ministro** (`advisor.routes.ts:42-61`),
   senza conferma di persistenza restituita alla firma. Cronaca in RAM e memoria
   persistente sono due capacità diverse.

Ricerca strutturale: il knowledge graph non ha progetti indicizzati
(`list_projects` restituisce elenco vuoto); audit eseguito leggendo e cercando
nei sorgenti, non mediante affermazioni di copertura del grafo.

### Blocchi del freeze dimostrati

**P2 — annullamento reale del provider.** Il percorso
`getMinisterStream → getAdvisorStreamWithPrompts → getAdvisorStream` non riceve
né propaga un `AbortSignal` (`game-session.ts:3422-3431`, `agents.ts:153-163`,
`prompt-builder.ts:1434-1454`). Gli adattatori hanno una propria infrastruttura
per segnali, ma il contratto ministeriale non la raggiunge. Cancellare soltanto
`fetch` nel browser non cancella la generazione lato server. Propagare il segnale
richiede attraversare **GameSession congelato**. Non si duplica il percorso LLM
nella rotta per aggirare questo confine. La sola riparazione del callback di
streaming nella rotta sarebbe una modifica circoscritta non congelata, ma non
completerebbe l'annullamento end-to-end.

**P5 — firma idempotente persistente.** `enqueue` assegna un nuovo `shortId()` a
**ogni chiamata**, aggiunge alla coda RAM e inserisce una nuova riga. Il payload
queue non porta un'identità della versione firmata; il repository inserisce
senza unicità per comando/versione. Sequenza possibile:

> POST firmato → INSERT riuscito → risposta persa → retry dello stesso payload
> → nuovo ID → secondo INSERT.

La deduplica frontend per testo e il pulsante `busy` non coprono questo caso,
né la concorrenza di due client. Servirebbe un contratto atomico durevole nel
percorso di coda/persistenza: **repository congelato, eventuale migrazione da
valutare, non autorizzata**. L'idempotenza già presente nel commit di un'opera
(`services/WorkCommitService.ts:87-149`, test `mg02-turn-commit.test.ts:255-270`)
riguarda **lo stesso orderId**, non due firme che generano orderId differenti.
Le chiavi idempotenti dei simulation run non possono diventare un archivio di
firme: cambierebbe la semantica congelata dei run.

Questi sono blocchi dell'implementazione della roadmap, non fallimenti dei gate
esistenti: i gate non coprono ancora questi contratti. Si applica l'istruzione
«fermati e documenta il blocco», senza avviare fasi successive né fingere che le
lacune siano risolte.

## 2. File effettivamente modificati e componenti riusati

Solo tre gruppi aggiunti:

| File | Classificazione della modifica | Scopo |
|---|---|---|
| `e2e/govux-baseline.mjs` | **B — harness di verifica** | Browser reale, cinque viewport, 20 screenshot, richieste/CDP, geometria, contrasto CSS, conservazione composizione, bozza/scarto, tastiera e coda invariata |
| `docs/implementation/assets/ws-govux-p0/real/*` | **D — evidenze** | 20 PNG e `baseline-log.json` dell'ultima esecuzione completa |
| `docs/implementation/WS-GOVUX-P0-report.md` | **D — documentazione** | Questo audit, matrice e blocchi |

Il task non definisce A/B/C/D/E e i report storici usano tassonomie differenti.
Per **il diff P0** si adotta esplicitamente la convenzione dei report del modulo
Governo (`WS-GOVOFFICE-04-report.md:111-118`): A comportamento/layout, B harness,
C test, D report/assets, **E componenti congelati**. È una classificazione locale
esplicita, non una nuova autorizzazione sul freeze. In P0: A/C/E **nessuna modifica**.

Riusati, senza modificarli: `GovernmentOffice`, `CabinetSession`, `MinisterChat`,
`SeatBrief`, `SeatTable`, `SeatCanvas`, `SeatProposalPanel`, `TreasuryActPanel`,
`ActDraftPanel`, `ProposalComparison`, `OrderRegister`; resolver `presentation`,
`seatRoads`, `actDraft`, `ministerMemory`, `consequences`; endpoint reali esistenti.
Nessuna libreria o dipendenza aggiunta, nessun sistema parallelo.

## 3. Verifiche eseguite con esito reale

Ambiente: macOS, Node **v26.10.0**, npm **11.19.1**, Chrome di sistema headless;
backend locale già attivo su `:8000`, frontend Vite `:5173` per i test mock.
Le verifiche sono nuove esecuzioni P0, non i risultati copiati da UX-08.

| Comando dalla root, salvo indicazione | Esito reale |
|---|---|
| `npm --prefix backend-nest test` | Primo tentativo: **206 file passati / 6 falliti**, 2158 test passati; Vitest raccoglieva `.test.js` CommonJS generati in `dist` |
| `find backend-nest/dist -name '*.test.js' -delete`, poi stesso comando | **206 file / 2158 test passati**, exit 0; rimossi solo artefatti generati ignorati da Git, nessun test sorgente escluso o modificato |
| `cd frontend && ../node_modules/.bin/vitest run` | **122 file / 1028 test passati**, exit 0 |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | exit 0, nessun errore |
| `npm run build:backend` | exit 0 |
| `VITE_API_URL='' npm run build:frontend` | exit 0; bundle same-origin uguale alla baseline (`index-CbFB7et3.js`); warning chunk >500 kB e opzioni Vite deprecate, non occultati |
| `cd e2e && node_modules/.bin/playwright test` | **155 passati**, 20,0 minuti, exit 0 |
| `cd e2e && node_modules/.bin/playwright test --config=playwright.a11y.config.mjs` | **4 passati**, exit 0; audit DOM di base, non certificazione WCAG completa |
| `node --check e2e/govux-baseline.mjs` | exit 0 |
| `node e2e/govux-baseline.mjs` | Ultima esecuzione completa: **20 screenshot**, exit 0; API/provider reali, zero `pageerror`, un colloquio reale, coda invariata |

Per Playwright è stato usato
`CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`.
I log dei gate sono conservati localmente in `/tmp/govux-p0-gate/`; le evidenze
browser riproducibili sono versionate in `assets/ws-govux-p0/real/baseline-log.json`.

**Correzioni dell'harness, non dell'app:** un primo tentativo assumeva erroneamente
i tab visibili a 768 px; verificato il breakpoint reale, il runner usa la visibilità
del tab (senza abbassare un requisito dell'app). Un altro tentativo misurava la
scena prima del completamento della transizione React: aggiunto `waitFor` sul
chooser e sullo smontaggio della bozza. Il parser dei colori dell'harness è stato
corretto prima della rilevazione finale. La review indipendente ha richiesto una
whitelist di scritture **prima della trasmissione** (blocca anche `/simulation-jobs`)
e un'attesa di completamento che non confonda il placeholder assistant con una
risposta finita: entrambe applicate e runner reale ri-eseguito con successo. I tentativi falliti non sono presentati
come baseline riuscite; l'ultima esecuzione genera tutte le 20 evidenze.

### Comandi disponibili e limiti

Confermati da `package.json` e workflow CI, ed eseguiti dove applicabili:

- build root `npm run build`; per ambito `npm run build:backend` / `build:frontend`;
- `npm run test:unit` aggrega backend e frontend; singole invocazioni nella tabella;
- `tsc --noEmit` da ciascun workspace;
- `npm run test:e2e:mock`, `npm run test:a11y`;
- `npm run test:e2e:real` esiste ma **non eseguito** come suite generale P0:
  eseguito invece il flusso ministeriale reale dedicato;
- `npm run test:perf` esiste, **non eseguito**;
- **nessuno script lint generale** nei package root/frontend/backend. La disciplina
  CSS è verificata dal test frontend `cssDiscipline.test.ts`, non da un lint inesistente;
- CI: `.github/workflows/ci.yml` (`test-build`) e `e2e.yml` (`e2e-mock`).
  Il risultato locale non è presentato come risultato CI della nuova PR.

## 4. Screenshot mobile e desktop del flusso interessato

Baseline **reale** `http://localhost:8000`, non screenshot di componenti isolati,
non `installMockApi`. Salvataggio esistente `56193ead2b2e`, partita
`c849a98a3abb`; `/api/health` dichiara frontend **`05575db`**. Il runner riprende
il salvataggio, entra nel Governo, parla con il Tesoro, riceve una risposta dal
provider, mostra il grafico dai conti e attraversa la bozza.
Il restore iniziale è esplicito; non si afferma che caricare un salvataggio sia
un'operazione senza scritture. Durante l'esplorazione successiva **nessun POST
queue, firma, process o avanzamento**. Il browser consente solo il primo restore
configurato e le richieste al Tesoro; blocca ogni altra scrittura **prima** che
raggiunga il backend. Nessun tentativo bloccato nell'ultima esecuzione.
Coda iniziale/finale: vuota, `queueVersion=20` in entrambi i campioni.

Cartella: [`assets/ws-govux-p0/real/`](assets/ws-govux-p0/real/).
Ogni PNG è stato verificato per dimensioni pixel = viewport CSS, DPR=1.

| Viewport CSS | Consiglio | Dialogo ripreso | Tavola, grafico reale | Bozza modificata, NON firmata |
|---|---|---|---|---|
| **390×844** | [PNG](assets/ws-govux-p0/real/390x844-consiglio.png) | [PNG](assets/ws-govux-p0/real/390x844-dialogo.png) | [PNG](assets/ws-govux-p0/real/390x844-tavola.png) | [PNG](assets/ws-govux-p0/real/390x844-bozza.png) |
| **768×1024** | [PNG](assets/ws-govux-p0/real/768x1024-consiglio.png) | [PNG](assets/ws-govux-p0/real/768x1024-dialogo.png) | [PNG](assets/ws-govux-p0/real/768x1024-tavola.png) | [PNG](assets/ws-govux-p0/real/768x1024-bozza.png) |
| **1366×768** | [PNG](assets/ws-govux-p0/real/1366x768-consiglio.png) | [PNG](assets/ws-govux-p0/real/1366x768-dialogo.png) | [PNG](assets/ws-govux-p0/real/1366x768-tavola.png) | [PNG](assets/ws-govux-p0/real/1366x768-bozza.png) |
| **1920×1080** | [PNG](assets/ws-govux-p0/real/1920x1080-consiglio.png) | [PNG](assets/ws-govux-p0/real/1920x1080-dialogo.png) | [PNG](assets/ws-govux-p0/real/1920x1080-tavola.png) | [PNG](assets/ws-govux-p0/real/1920x1080-bozza.png) |
| **360×800** | [PNG](assets/ws-govux-p0/real/360x800-consiglio.png) | [PNG](assets/ws-govux-p0/real/360x800-dialogo.png) | [PNG](assets/ws-govux-p0/real/360x800-tavola.png) | [PNG](assets/ws-govux-p0/real/360x800-bozza.png) |

### Rilievi della baseline, non correzioni già completate

- **Nessun overflow orizzontale del documento** nei 20 campioni; c'è scroll interno.
- Il grafico è nella main ma **non interamente visibile senza scroll** su schermi
  stretti: frazione verticale della main dentro la pane Tavola ~**58% a 390**,
  **44% a 768**, **40% a 360**; 100% a 1366/1920. Testata/banner occupano spazio.
  `hasLayout` e `intersectsViewport` nel log non significano evidenza tutta visibile.
- A **768 px** il breakpoint non attiva i tab; restano due colonne, Tavola larga
  circa 379 px. Non assimilata arbitrariamente alla modalità mobile.
- **Contrasto CSS campionato:** 109 misure risolvibili, senza sfondi immagine;
  sotto 4,5:1 le etichette autore `.entry-meta` (~**2,50:1**) e
  `.act-draft-label` (~**3,79:1**). L'audit DOM verde non copre questi difetti.
  Non è un audit completo di ogni testo, hover, disabled o contrasto su immagini.
- **Tastiera reale:** divisore 42→44→42 tramite frecce; Esc chiude e restituisce
  focus a Governo; Enter riapre; Tab produce focus visibile (outline solid 3 px).
  I tab non hanno `aria-controls` né roving tabindex: entrambi `tabIndex=0`.
- **Composer:** testo non inviato conservato Dialogo→Tavola→Dialogo a 390/360.
- **Badge:** dopo aver visto la Tavola, tornare al Dialogo riaccende il badge senza
  nuova risposta. Riproduzione positiva del difetto P4.
- **Reduced motion:** media query `reduce` attiva in tutti i campioni. Il flusso
  funziona; non si dichiara eliminata ogni animazione: `MinisterChat.tsx:112`
  chiama ancora `scrollIntoView({ behavior: 'smooth' })` senza verificare la query.
- **Safe area:** CSS esistente usa `env(safe-area-inset-*)`; rilevati i padding
  desktop/Chrome. Dispositivi fisici con notch, tastiera virtuale iOS/Android e
  zoom elevato **non verificati**, quindi rimandati, non dichiarati verdi.

Riproduzione dalla root: `node e2e/govux-baseline.mjs`. Variabili disponibili:
`BASE_URL`, `SAVE_ID`, `OUT_DIR`, `CHROME_PATH`. Necessari backend reale, provider
configurato e salvataggio con Tesoro/proposte disponibili. Non è una fixture CI:
consuma credito LLM, fallisce con exit nonzero se il flusso non è completo.

## 5. Checklist di fase e matrice presente / parziale / assente

### Checklist P0

- **Completato:** audit ingresso → sedia → contesto → risposta → Tavola → bozza →
  firma/coda → memoria, con differenza tra prova reale e lettura/test.
- **Completato:** cinque viewport, 20 screenshot e misure browser reali.
- **Completato:** matrice per tutte le capacità P1…P7 e differenze esplicite.
- **Completato:** comandi/gate eseguiti, errore iniziale e warning dichiarati.
- **Riusato:** modulo esistente, nessuna riscrittura o dato di gioco nuovo.
- **Rimandato con motivo:** implementazione delle fasi successive per blocchi E;
  firma reale aggiuntiva e avanzamento evitati per non mutare la partita auditata;
  dispositivi fisici e certificazione completa accessibilità fuori dalla prova eseguita.

### Legenda della matrice

**Presente** = capacità verificata nel codice/flusso indicato, non fase intera chiusa.
**Parziale** = fondamento già disponibile ma almeno un contratto richiesto manca.
**Assente** = nessuna implementazione del requisito nel percorso auditato.
`F/` = `frontend/src/`; `B/` = `backend-nest/src/`. File Game sotto `F/components/Game/`.

| Fase / capacità | Stato | Evidenza reale e lacuna da completare |
|---|---|---|
| P1 — nome e ruolo | **parziale** | `CabinetSession.tsx:128-145`: label della sedia + competenza; nessuna identità personale separata, non inventare biografie |
| P1 — frase breve, tema, questioni nell'agenda | **assente nella scelta** | Il chooser non rende `opening/items`; i dati esistono in `CabinetAddressView` e nella seduta |
| P1 — quattro stati con regole verificabili | **assente** | Nessun selettore `attenzione/discussione/decisione/disponibile`; urgenza dell'item è un concetto distinto |
| P1 — attenzione senza urgenza inventata | **parziale** | `B/core/government/GovernmentAgenda.ts:245,298,353,397,483`: regole del motore riusabili, non ancora rese come stato del colloquio |
| P1 — ordinamento stabile | **presente** | `B/core/government/Cabinet.ts:149-164`, ordine fisso; il chooser lo conserva |
| P1 — sintesi dal selettore della lista | **parziale** | `Cabinet.ts:182-195` conta la stessa agenda backend; il chooser non espone riepilogo/stati di riunione |
| P1 — riaprire riprende il colloquio | **presente in RAM** | `GovernmentOffice.tsx:231-239`, `F/stores/chatStore.ts:256-267`; provato alle cinque dimensioni, non persiste la cronaca al reload |
| P1 — sedia disponibile senza questioni | **assente** | `Cabinet.ts:164` omette sedie senza voci; `B/game-session.ts:3350-3353` rifiuta ministri non presenti |
| P2 — identità/tratti/stato/tema/memorie/scambi | **parziale** | `B/core/government/MinisterChat.ts:132-247`, `MinisterPersona.ts:32-159`, storico client limitato a 20; retrieval non tematico |
| P2 — budget compatto misurato del contesto | **assente** | `MinisterChat.tsx:37,170` conta messaggi, non caratteri/token; il prompt finale generale aggiunge contesto globale |
| P2 — fatti vs preferenze presidenziali | **parziale** | Briefing distingue fatti e opinioni, memoria dichiara fatti autorevoli; nessun produttore live di preferenze distinte |
| P2 — risposta tardiva nella propria riunione | **parziale** | Callback catturano la sedia; mancano guardie partita/ramo/richiesta/messageId, append al messaggio più recente |
| P2 — una richiesta attiva per riunione | **assente come invariante** | `F/stores/chatStore.ts:269`: un unico `ministerStreamingSeat` sovrascrivibile da un'altra sedia |
| P2 — annullamento end-to-end | **assente / blocco E** | `B/game-session.ts:3422-3431`: nessun signal; abort del fetch non arresta provider |
| P2 — retry e duplicati | **parziale** | `F/services/api.ts:1886-1919`: fallback automatico anche su 4xx, senza identità richiesta; nessun retry esplicito/lock atomico |
| P2 — loading | **presente** | `MinisterChat.tsx:216-232,264-269`, niente testo durante attesa |
| P2 — streaming incrementale reale | **parziale** | Endpoint presente; mismatch callback sopra; baseline osserva risposta finale unica |
| P2 — errori separati dalla risposta | **assente** | `MinisterChat.tsx:179-182` appende errore tecnico alla voce assistant, contaminando gli scambi successivi |
| P3 — evidenze seguono il discorso | **presente** | `presentation.ts`, `MinisterChat.tsx:127-145`; fetta bilancio provata col provider reale |
| P3 — sostituisci principale | **presente** | `GovernmentOffice.tsx:274-286` sostituisce l'active record della sedia |
| P3 — aggiungi confronto senza perdere principale | **parziale** | `presentation.ts:269-282`: confronto esiste ma sostituisce la principale |
| P3 — aggiorna mirato | **parziale** | `annotate` e re-resolve esistono; nessun update su ID/revisione di evidenza conservata |
| P3 — rimuovi mirato | **parziale** | `dismiss`/clear rimuovono la presentazione singola, non un elemento di una collezione |
| P3 — max tre nuove evidenze per risposta | **parziale** | Parser conserva una sola direttiva; limite pratico 1, ma nessun contratto batch/overflow/dedup a 3 |
| P3 — due principali visibili | **assente** | `SeatTable.tsx:110-124`: una principale più supporti, non due principali conversazionali |
| P3 — validazione schema | **parziale** | `presentation.ts:160-219`: campi ignoti ignorati, fallback key/value, non schema intero rigoroso |
| P3 — validazione enum | **presente** | Allowlist op/evidence; `presentation.ts:192-200` |
| P3 — validazione ID/esistenza | **parziale** | Catalogo blocchi esistente, regex ID regioni, filtraggio in `regionFocus.ts`; manca target ID generale/validazione pre-apply |
| P3 — versione stato | **assente** | `PresentationDirective`/`ActivePresentation` non contengono revision/branch anchor |
| P3 — direttiva invalida degrada, testo leggibile | **parziale** | JSON/enum invalido preserva prose; ID non disponibile può rimpiazzare active e perdere la precedente evidenza prima del resolve null |
| P3 — messaggio→bilancio→grafico | **presente** | `seatCanvasModel.ts:246-256`, `SeatCanvas.tsx:179-184`; baseline reale e E2E P04c |
| P3 — regione e confronto | **presenti, contratti parziali** | `regionFocus.ts`, `ProposalComparison.tsx`, `seatRoads`; verificati negli E2E mock P04c/P04d, non nuove prove reali di entrambe in P0 |
| P4 — card inline sotto messaggio | **assente** | `MinisterChat.tsx:210-235` rende testo/cursore, nessuna referenza evidence |
| P4 — stessa identità e dati, niente duplicato | **parziale (fondamento)** | `seatCanvasModel.ts:77-82` ha ID; resolver restituisce il blocco reale, ma non c'è link inline |
| P4 — attivazione desktop mette a fuoco | **assente** | Nessun callback card→ancora DOM dell'evidenza |
| P4 — mobile apre Tavola e seleziona | **parziale (tab esistente)** | `GovernmentOffice.tsx:474-497` cambia pane; nessun collegamento da messaggio |
| P4 — scroll conservato | **parziale** | `chatScroll.ts` e pane montate; nessun contratto round-trip card/messaggio con posizione esatta |
| P4 — composizione conservata fra tab | **presente** | Provata 390/360; pane nascoste via CSS, non smontate |
| P4 — selezione conservata | **parziale** | Selezione mappa locale, ma cambio `focusRegionIds` remonta `ZoneMap` (`SeatCanvas.tsx:198`) |
| P4 — badge consumato solo quando VISTA | **assente** | `GovernmentOffice.tsx:493-495`: deriva da active+pane nascosta; ricompare dopo visione nella baseline |
| P5 — esplora/modifica/scarta senza effetti | **presente per UI** | Funzioni pure `actDraft.ts`, nessun queue call; coda reale invariata nella baseline; non equivale a prova della preview P7 |
| P5 — bozza/validazioni riusate | **presente** | `actDraft.ts`, `ActDraftPanel.tsx`, capacità dichiarate; non introdurre altro modello di atto |
| P5 — firma della versione mostrata | **parziale** | Panel invia draft mostrato, ma nessun anchor versione; editing testo mantiene `work` immutato (`actDraft.ts:145-147`) |
| P5 — firma una volta/doppio tap/retry | **parziale / blocco E** | Busy e dedup testo frontend; assente idempotenza server persistente, come dimostrato sopra |
| P5 — bozza superata richiede revisione | **assente** | Draft senza revision/branch/data fence; firma non verifica freschezza |
| P5 — errore conserva bozza | **presente** | `GovernmentOffice.tsx:365-381`, `useOrderQueue.ts:150-154`: false non cancella draft |
| P5 — errore reale spiegato sulla bozza | **parziale** | `suggestionsError` resta nel hook; l'Office riceve errore cabinet, non dettaglio queue (`GameScreen.tsx:342-353`) |
| P5 — memoria solo dopo persistenza confermata | **parziale** | Ordine registra memoria locale dopo risposta queue; memoria server solo alla domanda successiva, senza ack |
| P6 — riuso persistenza/vecchi salvataggi | **presente, limitato** | Tabella esistente + letture vuote compatibili (test UX05); cache localStorage scoped di UX08 non migra automaticamente vecchia chiave gameId |
| P6 — decisione / preferenza / aperta / ipotesi | **parziale** | Enum esistente distingue queued/discussed/open, `objective` non è preferenza; preferenza/ipotesi non sono categorie live distinte |
| P6 — scope partita | **presente** | Cache e repository isolati per gameId, inoltre branch+mandate; non eliminare questa isolamento più forte |
| P6 — turno, non timestamp tecnico | **parziale** | `refs.turn`/`record_turn` esistono; produttori Office passano data/messageId, non turno/orderId |
| P6 — revoche conservano storia | **assente nel flusso** | Withdrawal elimina ordine; non produce evento di revoca nella memoria; upsert sullo stesso ID sovrascrive il record |
| P6 — poche memorie pertinenti | **parziale** | `relevantMemory`/server selezionano 8 per tipo/recenza; nessuna pertinenza al tema, client può trasmettere fino a 40 per sedia |
| P7 — categorie calcolato/forecast/rischi/incertezze | **parziale** | `consequences.ts:24-49,87-116` distingue provenienze; confronto proposte, non board del draft corrente |
| P7 — preview del draft modificato | **assente** | `SeatTable.tsx:165-174,267-284` separa bozza da `ProposalComparison` su roads; modifica non invalida una stima |
| P7 — preview pura senza mutazioni/RNG | **parziale** | `compareRoads` puro e testato; preview del draft assente, nessun contratto completo sulla sua purezza |
| P7 — costo preview == applicato | **non presente come contratto** | Estimatori catalogo/settlement esistono ma manca board/parità per draft; costo applicato dipende da condizioni ed esito |
| P7 — effetti non supportati non stimabili | **parziale** | Nota sociale qualitativa presente; frasi cantiere/addebito e mancato rifinanziamento troppo assolute (`consequences.ts:127-139`) rispetto a copertura/modalità/esecuzione reale |
| Trasversale — desktop/mobile/tastiera | **parziale** | Cinque dimensioni ora baseline; controlli tastiera di base provati, tab non completi e main parzialmente visibile sugli stretti |
| Trasversale — contrasto/safe area/reduced motion | **parziale** | Difetti contrasto misurati, safe area CSS presente ma dispositivo fisico non provato, scroll smooth non condizionato |

## 6. Conferma CORE ENGINE FREEZE

**Intatto.** Il diff P0 aggiunge soltanto harness e documentazione/evidenze.
Non tocca `backend-nest/src/**`, `frontend/src/**`, repository, schema, store
congelati, playback, checkpoint, RNG, pipeline temporale o contratto dei run.
I build sono artefatti locali, non deployment né modifiche del processo attivo.
I sei `.test.js` rimossi erano artefatti generati in `dist`, non test tracciati.

Le letture di GameSession/repository per l'audit non sono modifiche autorizzate.
L'incontro con i blocchi E ha interrotto l'implementazione; non sono stati creati
nuovi sistemi per aggirarli.

## 7. Differenze rispetto alla roadmap e limiti residui

- I nomi descrittivi della roadmap non sono nuovi file da creare: il Consiglio è
  `CabinetSession`, la riunione `GovernmentOffice`+`MinisterChat`, la tavola
  `SeatTable`+`SeatCanvas`; draft, memoria e confronto hanno già moduli propri.
- Il Consiglio non elenca tutti i ministri disponibili: elenca le sedie con dati.
  Il server non accetta una sedia assente. Non si inventano ministri per colmare
  il layout né si assume che sia solo una questione CSS.
- La personalità è già un archetipo di ruolo (`MinisterPersona`), non una biografia.
- Esiste il fence `tavola`, ma non le quattro operazioni/versioni/collezioni P3.
- Esiste la firma in registro; non è applicazione istantanea. La semantica esistente
  «accoda → avanza tempo → risolve» va conservata, senza firme automatiche.
- Memoria più stretta di «partita»: ramo + mandato già isolati, da preservare.
- `DecisionImpactBlock` è un **esito retrospettivo**, non una previsione P7.
- Baseline completa del flusso reale fino a bozza/scarto, ma nessuna nuova firma
  reale né avanzamento: questi comportamenti restano verificati dal codice/test.
- La prova reale usa il Tesoro e un salvataggio esistente; gli altri ministri,
  dati vuoti, cambi partita e race richiedono prove mirate nelle rispettive fasi.
- Non si pretende che i gate attuali certifichino idempotenza durevole, cancellazione
  end-to-end, revoche o parità preview/applicazione: sono lacune dell'audit.
- **Consegna su origin/main:** il task dice che l'autopilot cerca il report lì,
  ma vieta merge. P0 è consegnata nel branch/PR; soltanto la regia potrà farla
  comparire su `origin/main`. Non è stato fatto push diretto su main.
- Senza merge fra fasi, eventuali branch dipendenti richiederebbero uno stack
  esplicito di PR; non si dichiara che otto PR indipendenti verso main possano
  includere automaticamente il lavoro non ancora integrato. Nessuno stack
  successivo creato prima di chiarire i blocchi.

## 8. Fase successiva indicata, senza dichiararla completata

**Prossima fase: P1 — Council alive**, non avviata, da realizzare estendendo il
chooser con un selettore puro da indirizzi/items, thread, bozze e memorie; stessi
record per lista e conteggi, ordine stabile, niente LLM all'apertura. P2 seguirebbe
P1, poi P3…P7: nessuna fase saltata o dichiarata consegnata.

**Stato della sequenza:** P0 audit completato; **P1…P7 non avviate**. L'esecuzione
si arresta qui perché i blocchi E sono già dimostrati: la regia deve stabilire
un pacchetto separato/autorizzato per annullamento e idempotenza persistente,
oppure delimitare formalmente i requisiti senza spacciarli per implementati.
Non sono stati creati report P1…P7 vuoti o falsamente conclusivi, né PR di fasi
non implementate. Nessun merge o deploy.
