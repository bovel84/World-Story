# WS-GOVUX-P2 — annullamento provider, OPZIONE 1

## 1. Stato e autorizzazione

Base: `main@157a408`, audit [P0](WS-GOVUX-P0-report.md). Implementato **solo il pacchetto P2 autorizzato**, non tutta la fase P2 della roadmap.

Il precedente STOP era documentato nella PR #153 (`bfe092e`). Dopo «procedi sei autorizzato», sono stati implementati P2 e la migrazione minima P5 già proposta. La PR resta unica; **nessun merge, deploy o restart dei servizi pubblicati**. I riavvii nei test riguardano esclusivamente fixture locali con DB temporaneo.

## 2. Cosa era rotto

Le rotte ministeriali non legavano la disconnessione HTTP alla chiamata LLM. Mancava il parametro opzionale lungo `GameSession → GameController → PromptEngine`, nonostante `LLMGenerateOptions.signal` e il router/provider lo supportassero già.

Inoltre `llm/http.ts` rimuoveva il listener esterno al ritorno degli header: il successivo consumo del body JSON/SSE non era più annullabile dal chiamante. Propagare soltanto il parametro non avrebbe risolto questo secondo difetto.

## 3. Estensione minima e file

| File e righe | Modifica |
|---|---|
| `backend-nest/src/routes/games/advisor.routes.ts:204–282` | Controller per richiesta, `req.aborted` e chiusura prematura della risposta; niente write/error dopo abort; listener rimossi in `finally`. La chiusura normale non annulla. |
| `backend-nest/src/game-session.ts:3315–3317,3334–3357,3423–3433` | Solo parametro opzionale e forwarding P2 nei contratti ministeriali e nell'helper condiviso. |
| `backend-nest/src/agents.ts:140–164` | Forwarding del signal, senza cambiare prompt o controller. |
| `backend-nest/src/prompt-builder.ts:1410–1458` | Signal nelle opzioni esistenti di generate/stream. |
| `backend-nest/src/llm/http.ts:52–103` | `AbortSignal.any` compone controller esistente e signal del chiamante; il legame al body sopravvive agli header. Timeout e retry non vengono ridisegnati. |
| `frontend/src/services/api.ts:1844–1940` | Signal opzionale per ask/askStream; abort non diventa fallback, successo parziale o token tardivo; rilascio del reader. |
| `frontend/src/components/Game/MinisterChat.tsx:104–115,173–216,289–296` | Un controller posseduto dalla richiesta, pulsante di invio esistente riusato come «Interrompi» durante la richiesta, cleanup su uscita/cambio contesto; una vecchia richiesta non libera né sovrascrive quella successiva. |
| `backend-nest/tests/ws-govux-p2-cancellation.test.ts` | 8 nuovi test con HTTP reale e adapter OpenAI-compatible reale verso upstream locale controllato. |
| `frontend/src/services/govuxTransport.test.ts` | Test del trasporto condiviso P2/P5. |
| `e2e/tests/govux-cancellation.spec.mjs` | 2 regressioni browser con rete mockata. |

Riutilizzati router, adapter, opzioni LLM e `AbortController` standard. Nessun nuovo framework di cancellazione, provider, prompt o sistema di sessione.

## 4. Prove dedicate

**RED → GREEN:** il primo run backend P2 aveva 5 fallimenti e 1 passaggio: socket ancora aperti e richieste pre-annullate avviate. Dopo l'estensione, la suite è stata ampliata e conta **8/8 passati**. Log: `/tmp/ws-govux-p2-{red,green,focused,tsc,full}.log`.

La prova passa davvero da route Express, sessione, controller, prompt, router, fetch e adapter. Il server upstream osserva la chiusura del socket senza completamento normale:

- prima degli header;
- dopo header e primo token SSE consumato dall'adapter;
- dopo header SSE senza token;
- body JSON aperto, anche nel fallback legacy della rotta streaming;
- pre-abort senza chiamata provider;
- due richieste contemporanee: annullarne una non interrompe l'altra;
- completamento normale e richiesta successiva: nessun abort e listener puliti.

Si controllano anche assenza di retry/fallback e write tardivi. Non è una prova basata soltanto su un booleano UI.

Comandi eseguiti:

```sh
cd backend-nest
../node_modules/.bin/vitest run tests/ws-govux-p2-cancellation.test.ts tests/ws-govux-p5-signatures.test.ts
# exit 0 — 2 file, 23 test (8 P2 + 15 P5)

cd ../frontend
../node_modules/.bin/vitest run src/services/govuxTransport.test.ts
# exit 0 — 6 test

cd ../e2e
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node_modules/.bin/playwright test tests/govux-cancellation.spec.mjs tests/govux-signatures.spec.mjs
# exit 0 — 5 test (2 P2 + 3 P5), 1.1m
```

I test browser verificano abort del fetch, composer riabilitato, nessun POST di fallback o risposta fittizia all'annullamento, isolamento dalla risposta sostitutiva, uscita dalla sedia e chiusura del Governo.

## 5. Gate completi

Log: `/tmp/govux-opt1-approved-gate/`; exit code in `exits.txt`.

| Comando realmente eseguito | Exit | Output chiave |
|---|---:|---|
| `cd backend-nest && npm test` | 0 | 208 file, 2181 test passati |
| `cd frontend && npm test` | **1** | `Missing script: "test"`, confermato in due tentativi |
| `cd frontend && ../node_modules/.bin/vitest run` | 0 | 123 file, 1034 test passati |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | 0 | Nessun errore |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | 0 | Nessun errore |
| `npm run build:backend` | 0 | Build completata |
| `VITE_API_URL='' npm run build:frontend` | 0 | Build completata; warning chunk grandi |
| `cd e2e && CHROME_PATH=… node_modules/.bin/playwright test` | 0 | 160 passati, 18.7m |
| `cd e2e && CHROME_PATH=… node_modules/.bin/playwright test --config=playwright.a11y.config.mjs` | 0 | 4 passati, 24.3s |

**Il gate letterale `npm test` frontend non è verde.** Il runner esistente è stato eseguito separatamente; nessuno script è stato aggiunto fuori perimetro. I warning Vite deprecati appartengono al log dei test frontend; i chunk grandi al log della build.

Il primo gate applicativo completo aveva 5 test falliti/2176 passati: i test di rotta legacy invocano handler con request semplici, senza `req.header`. Corretta la lettura al confine HTTP tramite `req.headers`; nessun test sorgente modificato. Rerun completo: 2181 passati. Il primo E2E completo è stato interrotto per applicare i rilievi della review, non dichiarato superato.

Una precedente esecuzione P2 isolata trovava sei suite generate `dist/**/*.test.js` incompatibili con Vitest CommonJS. Rimossi **solo** artefatti verificati ignorati e non tracciati (`generated-tests*.txt`), senza esclusioni di discovery, soglie o test sorgente.

## 6. Freeze rispettato e review

Invariati `core/simulation/**`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, checkpoint/run/playback e semantiche temporali. `GameSession` cambia soltanto per P2. Schema e repository sono toccati esclusivamente per il pacchetto P5 descritto nel [report dedicato](WS-GOVUX-P5-report.md).

Review indipendente read-only: nessun blocker sul backend; corretti due rilievi frontend P5 e il blocco del candidato dopo il primo invio. Follow-up: nessun critical/warning residuo sul codice. Nessuna modifica architetturale accessoria.

## 7. Limiti residui

- Upstream controllato locale, **non** chiamata al provider remoto pagato o verifica live su produzione. Adapter e socket sono reali; contenuti sono fixture dichiarate.
- Resta il contratto preesistente del callback provider con primo argomento numerico: la rotta può mostrare il testo finale invece dei token incrementali. Non viene corretto nel pacchetto ristretto.
- Il timeout precedente resta limitato agli header; non si introduce una nuova politica di timeout del body.
- L'annullamento non ritira token già ricevuti né rollbacka la memoria già persistita prima della richiesta. Non è una revisione completa di presentazioni, errori non di abort, thread o scroll.
- Nessuna certificazione WCAG/contrasto, dispositivo fisico, notch o tastiera virtuale. Il completamento delle altre richieste P2 e di P1/P3/P4/P6/P7 non è dichiarato.

## 8. Consegna

PR unica **#153**, titolo invariato: `WS-GOVUX — P2 annullamento provider + P5 idempotenza firma (freeze circoscritto)`. Nessun merge, deploy, restart di produzione o migrazione sul DB operativo. Attesa della regia.
