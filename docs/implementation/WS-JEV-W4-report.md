# WS-JEV-W4 — Context builder a sezioni

## 1. Perimetro ed esito

Quarta milestone della memoria narrativa JEV: sostituire il **dump della cronologia** con un contesto a sezioni, innestato nel builder esistente. Non è completamento della roadmap JEV (W5–W8 restano aperti) né una seconda architettura di contesto. Base `main@2dfe0b12e5a45b1ff88627913875e6cf9535b8fb`; nessun merge/deploy, solo PR verso `main`.

Sezioni prodotte, nell'ordine:

1. `[MINISTER IDENTITY]`
2. `[CURRENT VERIFIED STATE — fatti del motore, mai da JEV]`
3. `[STRATEGIC MEMORY]`
4. `[RELEVANT PAST EVENTS — narrativa citata, non fatti del motore]`
5. `[UNRESOLVED ISSUES — aperti o in sospeso]`
6. `[RECENT CONVERSATION]`

## 2. Innesto e proprietà

- `backend-nest/src/core/government/MinisterMemory.ts`: estratta la funzione **pura** `rankMinisterMemory(memory, jev, query, point)`, che restituisce i candidati ordinati con la riga già resa. `recallMinisterMemory` ora la consuma: comportamento, ordine, righe, budget e tie-break della W3 restano invariati (verificato dalla suite W3, verde). Nessun nuovo modulo proprietario: la grammatica e la selezione restano dove erano.
- `backend-nest/src/core/government/jev/jev-memory.service.ts`: la stessa facade espone `buildMinisterContext(input)`. Legge il repository `MinisterMemory` esistente e lo scope ministeriale JEV, già filtrati per `game_id` **e** `branch_id`, e compone le sei sezioni. Nessun travaso di memorie ministeriali in `jev_memory`; nessun accesso a scope world/nation/faction.
- `backend-nest/src/prompt-builder.ts`: **non** nasce un context builder parallelo. Lo stesso `PromptBuilder` produce il contesto con `buildMinisterContextSection(history)` e `PromptEngine.getAdvisor` / `getAdvisorStream` lo antepongono al messaggio. Con contesto non vuoto la `history` viene azzerata (`history = []`), così il dump non viene ripetuto dal renderer advisor. Percorso non-ministeriale, preset e `promptOverride` restano invariati.
- `backend-nest/src/game-session.ts`: il ramo selettivo costruisce il briefing della sedia separatamente, passa come messaggio **solo la domanda** e come `verifiedState` il briefing. La richiesta è metadata request-local di `GameData`, non world state persistito. Un unico helper `ministerSelectiveFrom` serve richiesta normale e streaming (il vecchio ramo duplicato è stato rimosso). I contratti `AbortSignal`/cancellazione restano invariati.
- Flag off (`JEV_MEMORY_ENABLED=false`): nessuna lettura del repository, contesto vuoto, prompt legacy byte-identico; la tabella può anche mancare.

## 3. Provenienza, budget e autorità

- `CURRENT VERIFIED STATE` deriva **solo** da `verifiedState` (briefing del motore con regole inviolabili e fatti verificati). Nessuna evidenza JEV vi compare: test dedicato.
- Il briefing del motore è inserito **integro**, non troncato al budget di riferimento `worldState` (1200): tagliarlo perderebbe proprio le regole e i fatti portati al Consiglio, che è peggio. La scelta è dichiarata nel codice; `telemetry.section_bytes`/`total_bytes`/`budget_bytes`/`over_budget` ne registrano la dimensione reale senza nasconderla. Non esiste alcun taglio morbido che possa scartare silenziosamente il briefing o la memoria strategica.
- I budget restano vincolanti per le sezioni di **memoria**: `identity` 400, `worldState` 1200 (riferimento), `strategicMemory` 800, `retrievedMemory` 1200, `recentConversation` 800 — totale dichiarato 4400. `UNRESOLVED ISSUES` è calcolato **direttamente** dai record passati (legacy `open-question`/`queued-decision`, JEV `active` di tipo `promise`/`conflict`), non dal ranking di pertinenza: una questione aperta resta aperta anche se non risponde alla domanda del turno. Il suo budget è lo spazio residuo di `strategicMemory` + `retrievedMemory`, così `strategic + retrieved + unresolved ≤ 2000` senza una nuova chiave di budget.
- `[RECENT CONVERSATION]` conserva **la parte più recente** entro il budget: si riserva lo spazio dell'header prima di selezionare, così il messaggio più nuovo non viene mai sacrificato dal conteggio dell'intestazione (bug trovato in TDD e corretto).
- Data **e** turno escludono il futuro, sia legacy sia JEV. Ogni accesso resta delimitato da game/branch e, per il ministro, seat/mandato.
- Le evidenze JEV effettivamente finite nel testo ricevono `touch` (accessCount/lastAccessedAt), come in W3; è telemetria di lifecycle, non stato deterministico. Nessun numero JEV diventa economia, coda ordini, consenso, territori o altra mutazione.

## 4. Prove e TDD

`backend-nest/tests/ws-jev-w4-context.test.ts`: **10 test** su SQLite temporaneo e provider stub, nessuna rete e nessun credito.

1. Sei sezioni con la giusta provenienza (identità/strumento, stato dal motore, memoria legacy, passato JEV, questioni aperte legacy+JEV, conversazione recente); `model_calls=0`.
2. Lo stato verificato non arriva mai da JEV (claim JEV assente da `worldState`).
3. Budget configurabili tagliano davvero le sezioni di memoria; il briefing resta.
4. Esclusione del futuro per legacy e JEV.
5. Flag off: nessun testo, `total_bytes=0`, zero chiamate a `listMemory` legacy/JEV.
6. Tetto complessivo (`budget_bytes=4400`, `total_bytes ≤ 400+800+1200+800 + byte del briefing`) e **ordine** delle sezioni nel testo.
7. `touch` registrato solo sulle evidenze JEV selezionate.
8. Percorso reale `GameSession` normal+stream: sezioni presenti, domanda presente, cronologia non duplicata (il dump più vecchio è assente, quello più recente compare una volta sola).
9. `PromptEngine` diretto: `verifiedState → CURRENT VERIFIED STATE`, history non ripetuta.
10. Percorso advisor senza richiesta ministro: nessuna sezione JEV (innesto correttamente condizionato).

Ciclo RED/GREEN: scritti prima i test, il settimo (`RECENT CONVERSATION` assente dal prompt reale) ha rivelato che il budget dell'header veniva conteggiato due volte e scartava il messaggio più nuovo; corretta la riserva, verdi. Durante la revisione indipendente sono emersi e sono stati chiusi: budget `worldState` silenziosamente ignorato (ora esplicitato e diagnosticato, senza taglio del briefing), perdita del `touch` W3 sul percorso reale (ripristinato), doppia composizione della persona (evitata quando il briefing è presente), duplicazione del ramo selettivo (unificata con `ministerSelectiveFrom`), più i test di tetto ordine e percorso advisor.

Gate della fase (regia: backend completo + frontend + tipi + E2E mirato Governo):

- JEV mirati + regressioni ministre: **61 passed** (W1 9, W2 24, W3 18, W4 10).
- Backend completo: **212 file / 2242 test passed**, `OPEN_PAX_DB_PATH` temporaneo.
- Frontend: **123 file / 1034 test passed** (runner reale Vitest; `npm test` resta `Missing script: "test"`, non nascosto).
- `tsc --noEmit` backend e frontend: entrambi **exit 0**. Build backend (outDir temporaneo) e frontend (`VITE_API_URL=''`): **exit 0**.
- E2E **mirato** Governo (`e2e/tests/modules.spec.mjs`, mock): **12 passed** (1.8m). E2E completo una sola volta a fine blocco, come da direttiva.
- Log: `/tmp/jev-w4-gate/`, `/tmp/jev-w4-focused*.log`.

## 5. Limiti espliciti

- La W4 non completa W5–W8: niente retrieval di scope `government`/`world`/`nation`/`diplomacy`/`faction` nel contesto del ministro, niente consolidamento/`maxActiveMemories` (W7), niente budget dedicato a diplomazia/fazioni, niente debug API, nessuna metrica W8 sul traffico reale.
- `worldState` è un budget di **riferimento**: con briefing ricchi il blocco può superarlo e `over_budget` lo dichiara. Non è un taglio nascosto, ma non è nemmeno un tetto duro sul prompt completo.
- Nessuna prova con provider reale né stress multi-processo per questo innesto: i test usano provider stub. La tokenizzazione effettiva del provider non è misurata (i byte UTF-8 sono un upper bound conservativo).
- Il percorso advisor standard e l'E2E mock non esercitano il contesto del ministro reale; l'E2E mirato è una regressione dei flussi Ufficio del Governo, non una verifica del testo LLM.

## 6. Consegna

Branch `feat/ws-jev-w4-context`, PR verso `main`. Commit coerenti in italiano; report unico W4. Nessun merge/deploy, nessun restart o sostituzione del `dist` operativo, nessun deploy Cloudflare, nessuna migrazione o modifica del DB di produzione.
