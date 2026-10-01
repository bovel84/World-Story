# WS-GOVUX-P2 — OPZIONE 1: annullamento provider, arresto preventivo

Base verificata: `main` / `origin/main` **`157a408`**.
Branch: `feat/ws-govux-opt1-freeze-circoscritto`.
Task letto integralmente: `/tmp/pi-tasks/pi-task-govux-opt1-freeze.md`.
Riferimento: `WS-GOVUX-P0-report.md` già presente su `origin/main`.

**Stato: NON IMPLEMENTATO.** Non è il report di una P2 completata.
Il pacchetto si è arrestato sull'obbligo esplicito di documentare PRIMA la
migrazione indispensabile per P5: dettagli in [`WS-GOVUX-P5-report.md`](WS-GOVUX-P5-report.md).
P2 è tecnicamente indipendente e autorizzata nei soli punti minimi, ma non si è
interpretato lo STOP del pacchetto come permesso di continuare altre modifiche.
La PR unica è una consegna **draft/bloccata**, non una proposta pronta al merge.

## 1. Cosa era rotto

La richiesta ministeriale non trasmette il segnale di cancellazione dal confine
HTTP alla generazione LLM. Sono stati verificati i nomi effettivi, senza creare
un percorso alternativo:

| File esistente, solo letto | Righe / simbolo | Lacuna |
|---|---|---|
| `backend-nest/src/routes/games/advisor.routes.ts` | 204–257, POST ministeriale normale e stream | Nessun controller legato alla disconnessione né signal passato a GameSession |
| `backend-nest/src/game-session.ts` | 3334–3357, `getMinisterReply`; 3315–3317, `getAdvisorUnchecked`; 3422–3431, `getMinisterStream` | Contratti ministeriali senza signal; lo stream passa attraverso il controller esistente |
| `backend-nest/src/agents.ts` | 140–163, `getAdvisorWithPrompts` / `getAdvisorStreamWithPrompts` | Nessun argomento di cancellazione per queste chiamate |
| `backend-nest/src/prompt-builder.ts` | 1410–1457, `getAdvisor` / `getAdvisorStream` | Le opzioni al router contengono la temperatura, non signal |
| `backend-nest/src/llm/router.ts` | 73–86, `LLMRouter.stream` | Il router sa già inoltrare `LLMGenerateOptions`; non serve un secondo router |
| `backend-nest/src/llm/types.ts` | 41, `LLMGenerateOptions.signal` | Campo già esistente da riusare |
| `backend-nest/src/llm/openai-compatible.ts` | 157–171, chiamata `postJson`; 195–222, lettura del body | L'adattatore riceve già `options.signal`, ma la cancellazione deve funzionare anche dopo l'arrivo degli header |
| `backend-nest/src/llm/http.ts` | 51–61, listener/fetch; 99–102, finally | `postJson` rimuove il listener esterno quando restituisce `Response`, prima che sia consumato lo stream |
| `frontend/src/services/api.ts` | 1842–1919, `ministerApi.ask` / `askStream` | Nessun signal opzionale; fallback automatico non distingue un annullamento da un errore di trasporto |

**Segnale propagato non significa automaticamente stream interrotto:** il
listener HTTP viene staccato dopo gli header. Una correzione completa deve
anche mantenere la cancellazione efficace durante la lettura del body.
Non basta cancellare il fetch del browser lasciando generazione/provider attivi.

## 2. Cosa è stato toccato (file e righe)

**Nessun codice applicativo modificato.** In particolare, non è stata ancora
usata l'eccezione autorizzata per i metodi ministeriali di GameSession.

Il diff della PR contiene soltanto:

- `docs/implementation/WS-GOVUX-P2-report.md`: questo report;
- `docs/implementation/WS-GOVUX-P5-report.md`: prova del blocco e migrazione minima proposta.

I riferimenti sopra sono righe **auditabili della base**, non modifiche
spacciate per implementazione. Non sono stati aggiunti helper, sistemi di
cancellazione, dipendenze o nuove chiamate al provider.

## 3. Intervento minimo individuato, NON eseguito

Dopo che la regia avrà risolto lo STOP del pacchetto:

1. Legare un `AbortController` della singola richiesta HTTP a `req.aborted` /
   chiusura prematura della risposta; non usare la normale fine di lettura del
   body della richiesta come segnale di annullamento. Staccare i listener a fine richiesta.
2. Estendere soltanto con un signal opzionale il percorso ministeriale attraverso
   GameSession, controller e prompt engine, usando `LLMGenerateOptions.signal`.
   I chiamanti preesistenti senza segnale devono mantenere lo stesso comportamento.
3. Riutilizzare il meccanismo HTTP/provider esistente, assicurando che l'abort
   interrompa anche uno stream già iniziato, non solo l'attesa degli header.
4. Non inviare token/errori dopo la disconnessione e non avviare un fallback o
   retry di generazione in seguito all'annullamento. L'eventuale estensione del
   client deve preservare la stessa identità di richiesta e il segnale, senza nuova UI.
5. Provare con HTTP locale e adattatore/provider reale nel test (server SSE
   controllato): disconnessione client → segnale nella catena → connessione
   upstream chiusa. Servono prove sia prima degli header sia dopo il primo chunk,
   cleanup dei listener e assenza di retry/fallback dopo abort.

Questo è il minimo contrattuale individuato, **non una promessa di test già
passati**. La correzione generale delle personalità, dei budget del prompt,
dei thread e delle operazioni della Tavola rimane fuori da questo pacchetto.
Anche il mismatch `onToken(numero, testo)` rilevato in P0 non viene corretto
come refactor collaterale in una consegna fermata.

## 4. Cosa resta congelato

Tutto il codice resta invariato in questa PR, inclusi:

- `core/simulation/**`, GameSession, TurnOrchestrator, TurnPipelineService,
  SessionStateStore e pipeline temporale;
- schema, repository, semantica checkpoint/run, playback;
- tutti i componenti e store frontend.

Nessuna migrazione applicata. Nessun merge, deploy o riavvio del backend.
I build producono soltanto artefatti locali ignorati da Git.

## 5. Prove realmente eseguite

Nuove esecuzioni sul codice della base, non risultati riciclati da P0.
Log locali: `/tmp/govux-opt1-gate/` (file `exits.txt` e log dei singoli comandi).

| Comando | Exit code | Output chiave / significato |
|---|---:|---|
| `cd backend-nest && npm test` | **0** | **206 file / 2158 test passati** |
| `cd frontend && npm test` | **1** | `Missing script: "test"`; ripetuto, stesso exit **1** |
| `cd frontend && ../node_modules/.bin/vitest run` | **0** | Runner effettivo già usato in CI: **122 file / 1028 test passati**; warning opzioni Vite deprecate |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | **0** | Nessun errore |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | **0** | Nessun errore |
| `npm run build:backend` | **0** | Build tsc riuscita |
| `VITE_API_URL='' npm run build:frontend` | **0** | Build riuscita; warning chunk >500 kB dichiarato |
| `cd e2e && node_modules/.bin/playwright test` | **0** | **155 passati**, 18,6 minuti |
| `cd e2e && node_modules/.bin/playwright test --config=playwright.a11y.config.mjs` | **0** | **4 passati**, 26,3 secondi |
| Nuovo test P2 «annullamento interrompe provider» | **NON ESEGUITO** | Non implementato/aggiunto dopo lo STOP; non soddisfatto dal test suite preesistente |
| Nuovo test P5 «stessa chiave → un ordine» | **NON ESEGUITO** | Blocco documentato nel report P5 |

Ambiente Node `v26.10.0`, npm `11.19.1`; Playwright con
`CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`.
Prima dei test backend sono stati rimossi sei `.test.js` generati in `dist`:
per ciascuno verificato `git check-ignore` e assenza da `git ls-files`. Elenco in
`generated-tests.txt`. **Nessun test sorgente escluso, eliminato o allentato**;
nessuna soglia alzata. Non è stato aggiunto uno script npm dopo lo STOP solo
per nascondere la difformità del comando richiesto.

**Non si dichiara il gate del pacchetto tutto verde:** il comando frontend
letterale manca e soprattutto i due nuovi contratti non sono implementati/provati.
Le suite verdi attestano soltanto la regressione della base invariata.

## 6. Limiti residui e decisione richiesta

- Il provider NON è ancora cancellabile dal confine ministeriale.
- Nessuna nuova prova a provider esterno o browser: non necessaria per la
  diagnosi statica, ma indispensabile alla futura chiusura dell'implementazione.
- Non sono state completate P2 o P5 della roadmap generale.
- P2 può essere ripresa indipendentemente **se la regia autorizza esplicitamente
  a procedere separatamente nonostante lo STOP P5**, oppure insieme alla
  migrazione minima descritta nel report P5.

Consegna documentale e PR draft unica verso `main`; nessun merge/deploy.
