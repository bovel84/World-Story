# WS-JEV-W1 — Storage branch-aware

## 1. Perimetro ed esito

Specifica: `/tmp/pi-tasks/pi-task-ws-jev-memory.md`, §§0–5, 15, 19–20. Base: `main@ce12bf964e3040f18363b9514ea12ff447c6e4cc`. W1 introduce schema dichiarativo, repository, tipi e flag; W3 è documentata separatamente. Nessun merge, deploy, restart o migrazione del database operativo.

## 2. Moduli e invarianti

- `backend-nest/src/database.ts:884–916`: `CREATE TABLE IF NOT EXISTS jev_memory` dopo `minister_memory`, PK `(id, game_id, branch_id)`, `branch_id NOT NULL DEFAULT ''`, quattro indici della specifica. Nessun ORM/framework di migrazioni.
- `backend-nest/src/core/government/jev/jev.types.ts`: vocabolari, record, ingest input e profilo tipizzato; scope ministeriale derivato dal **vero `MinisterMemoryScope`**, sedi dal **vero `CabinetSeat`**. `null` diventa `''` esclusivamente nella persistenza. Il ramo è obbligatorio anche quando nullo.
- `jevScopeKey`: componenti codificate; coppia diplomatica ordinata e distinta da scope nation/faction/government/world. Nessuna vista percepita implementata anticipatamente.
- `backend-nest/src/repositories/jev-memory.repository.ts`: upsert parametrico, lookup, lista con cutoff data/turno e limite massimo 5000, access metadata e cancellazione esplicita di un ramo. Ogni operazione JEV contiene partita **e** ramo; letture/aggiornamenti ministeriali comprendono anche scope canonico sedia/mandato. Stesso ID nello stesso game/branch non può essere riassegnato silenziosamente a un altro scope.
- Il supporto W3 aggiunge `currentPoint`: legge soltanto data/turno del game con head corrispondente al ramo richiesto, senza idratare/modificare world state. `eligibleOnly` filtra status/lifecycle **prima** di LIMIT; l'ispezione storage ordinaria conserva gli archiviati.
- Nessun `MinisterMemoryRecord` viene copiato nella nuova tabella. `minister_memory`, il suo repository, fork e rewind rimangono i proprietari dei ricordi esistenti.

## 3. Configurazione e sicurezza

`jev.config.ts` legge il flag al momento della chiamata: default attivo, `JEV_MEMORY_ENABLED=false` disattiva; valori diversi da `true`/`false` sono rifiutati. Semantic retrieval, LLM fallback e debug sono disattivati. Espone i default richiesti: 5000 memorie, intervallo consolidamento 10, contesto ministro 4500/diplomazia 3500, quote 400/1200/800/1200/800.

Questi valori non pretendono di implementare ingestion, enforcement globale del numero di memorie, consolidamento o allocazione completa dei prompt: sono fasi successive. Il budget della retrieval W3 è configurabile tramite `maxTokens`.

Validazione di identità, enumerazioni, pesi finiti 0..1, interi, forma della data, array e metadata JSON serializzabili. SQL parametrico, nessun segreto, dipendenza aggiunta o chiamata di modello. La DDL viene eseguita dal normale bootstrap autorizzato del backend, non da questa consegna; il flag off non elimina lo schema dichiarato.

## 4. TDD e verifica

Nuovo `backend-nest/tests/ws-jev-w1-storage.test.ts`: **9 test**. RED del worker: moduli assenti; successivamente validazione metadata, **1 failed / 8 passed**. GREEN ripetuto dall'assistente principale: **9 passed**. Tutti i database sono temporanei.

Prove: schema/PK/indici e bootstrap ripetibile; tutti gli scope; identità/null/encoding; upsert senza duplicazione; isolamento game/branch/mandato; cutoff; accessCount; deleteBranch; input invalidi; flag/default budget. I test W3 aggiungono copertura del cursor attivo e dell'eligibilità pre-LIMIT.

Gate integrati W1+W3 (Node 26.10.0; exit 0 salvo eccezione esplicita):

| Comando | Risultato |
|---|---|
| `cd backend-nest && OPEN_PAX_DB_PATH=/tmp/jev-w1-w3-gate/default-test.db npm test` | 210 file, **2208 passed** |
| `cd frontend && ../node_modules/.bin/vitest run` | 123 file, **1034 passed** |
| `../node_modules/.bin/tsc --noEmit` nelle due directory | entrambi exit 0 |
| `cd backend-nest && npm run build -- --outDir /tmp/jev-w1-w3-gate/backend-dist` | exit 0; output isolato, non sovrascrive il dist del servizio operativo |
| `VITE_API_URL='' npm run build:frontend` | exit 0 |
| `cd e2e && CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node_modules/.bin/playwright test` | **160 passed**, 19.2 minuti, API mock |
| stesso runner `--config=playwright.a11y.config.mjs` | **4 passed**, 47.4 secondi |
| `cd frontend && npm test` | **exit 1: Missing script: "test"**; non equivale al runner Vitest verde |

Il primo avvio parallelo del runner frontend non partì perché il log directory non esisteva ancora; retry completo verde. Nessuna modifica a test sorgente esistenti, discovery, soglie o timeout. Log locali: `/tmp/jev-w1-w3-gate/`; non sono dipendenze dei test né allegati pubblici.

## 5. Non implementato / limiti

W2 ingestion/classificatore, W4 quote dell'intero contesto, W5 diplomazia percepita, W6 fazioni, W7 episodi e W8 metriche sul traffico reale restano aperti. I tipi non costituiscono un secondo profilo persistito del ministro. Non esistono API debug o UI nuove. Nessuna migrazione/backfill dei ricordi legacy, cancellazione automatica, TTL o nuova semantica dei checkpoint.

L'upsert richiede identità coerenti: un futuro writer multi-scope deve assegnare ID distinti per ricordi distinti. La lista ha un cap di 5000 candidati; oltre tale cap non è certificato il richiamo esaustivo. Gli archiviati non vengono cancellati automaticamente.

## 6. Consegna

Branch `feat/ws-jev-w1-w3-memoria-selettiva`; PR verso `main` con W1 e la prima retrieval W3. Nessuna autorizzazione alla pubblicazione è presunta. La produzione rimane separata da questa branch e dai database temporanei della verifica.
