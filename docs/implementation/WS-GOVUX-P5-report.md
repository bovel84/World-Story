# WS-GOVUX-P5 — idempotenza durevole della firma, OPZIONE 1

## 1. Stato e autorizzazione

Base: `main@157a408`, [audit P0](WS-GOVUX-P0-report.md). Implementata **l'idempotenza della firma autorizzata**, non tutta P5 della roadmap.

Il precedente STOP della PR #153 (`bfe092e`) documentava la necessità della ricevuta e della migrazione prima di applicarla. Dopo «procedi sei autorizzato» è stata implementata **solo** quella migrazione, con atomicità e ripristino RAM. È stata eseguita esclusivamente nei DB temporanei dei test: **nessuna migrazione sul DB operativo, nessun restart dei servizi pubblicati, merge o deploy**. Verifica aggiuntiva read-only del DB operativo tramite Python `sqlite3`, URI `mode=ro` e `PRAGMA query_only=ON`, exit 0: `action_signature_receipts` **assente** (`operational-schema-readonly.log`).

## 2. Cosa era rotto e perché serviva una migrazione

`OrderExecutionService.enqueue` genera `shortId()` a ogni chiamata e aggiunge l'ordine in RAM prima di `gameRepository.queuePendingAction`. Il repository inserisce ordine e incrementa `queueVersion`, senza identità della richiesta. Dopo una risposta persa, un retry crea un secondo ordine.

Busy UI e deduplica del testo non danno una garanzia durevole. Usare come ricevuta soltanto la riga di `pending_actions` fallisce quando revoca, esecuzione o restore la eliminano. Gli archivi esistenti di simulazioni, memorie e azioni eseguite non coprono un ordine revocato prima dell'esecuzione e non sono stati riutilizzati impropriamente.

## 3. Identità e contratto HTTP

- La preparazione di una bozza nel Governo assegna una UUID casuale. La medesima bozza conserva la chiave per doppio invio e retry.
- `Idempotency-Key` viaggia fino a `POST /games/:id/actions/queue`; chiave non vuota, massimo 128 caratteri. Una chiave fornita ma invalida è rifiutata prima delle mutazioni.
- Il payload firmato è **testo normalizzato + distinta `work`, quando presente**. Si riusa `semanticStateHash`, che ordina le proprietà; non si crea un nuovo sistema di hashing.
- Stessa partita/key/hash: stessa conferma originale con `replayed: true`, senza chiamare enqueue.
- Stessa partita/key, hash diverso: `409 idempotency_conflict`, nessuna scrittura.
- Nuova key con stesso contenuto: nuova firma intenzionalmente distinta.
- Client senza key: contratto legacy invariato; **nessuna promessa di idempotenza durevole** per tali invii.

Dopo il primo invio il candidato non è più modificabile: il testo resta fisso per i retry anche se la risposta è incerta. Per una firma diversa il giocatore annulla la preparazione e prepara una nuova bozza, con nuova UUID. Non si ruota silenziosamente la chiave dopo un errore.

## 4. Unica migrazione e atomicità

`backend-nest/src/database.ts:996–1009` aggiunge soltanto:

```sql
CREATE TABLE IF NOT EXISTS action_signature_receipts (
  game_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  action_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  PRIMARY KEY (game_id, request_key),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
```

Nessuna FK verso la coda, backfill, modifica dei suoi stati o nuova semantica di restore. La ricevuta resta dopo revoca/esecuzione/restore e viene cancellata con la partita. È la **conferma originale di accettazione**, non una certificazione dello stato corrente dell'ordine.

`gameRepository.acceptActionSignature` apre `BEGIN IMMEDIATE` prima del lookup:

1. Cerca la ricevuta; replica oppure segnala conflitto senza enqueue.
2. Solo se assente, chiama sincronicamente l'accodamento **esistente**.
3. `queuePendingAction` annidato diventa savepoint: inserisce l'ordine e incrementa una sola volta la versione.
4. Inserisce hash, actionId e conferma nella ricevuta.
5. Commit di tutte le scritture oppure rollback di tutte.

Niente LLM, network, broadcast o avanzamento temporale nella transazione. La rotta prende uno snapshot del riferimento RAM già esposto da `getPendingActions` e ne ripristina il contenuto se fallisce enqueue, insert della ricevuta **o COMMIT esterno**. Non è stato aggiunto alcun parametro P5 a `GameSession` né modificato `OrderExecutionService`.

La UI rilegge la coda autorevole dopo la conferma, con guardia sulla partita corrente. Una ricevuta storica il cui actionId non è più presente **non** diventa un ordine fantasma, un esito «firmato nel registro» o una memoria `queued-decision`.

## 5. File toccati

| File e righe | Estensione |
|---|---|
| `backend-nest/src/database.ts:996–1009` | Sola tabella ricevute. |
| `backend-nest/src/repositories/game.repository.ts:44–46,650–670` | Conflitto esplicito e singola transazione; riusa hash e queuePendingAction. |
| `backend-nest/src/routes/games/actions.routes.ts:185–234` | Header, payload normalizzato delle firme, ricezione atomica, rollback RAM e risposta 409. |
| `frontend/src/services/api.ts:1345–1367` | Header opzionale e flag replayed, payload di lavoro invariato. |
| `frontend/src/hooks/useOrderQueue.ts:136–168` | Niente deduplica testuale sostitutiva per firme con key; riconciliazione GET e niente accodamento/memoria fittizi. |
| `frontend/src/components/Game/GovernmentOffice.tsx:160,343–391,587–588` | Identità nella bozza esistente, lock del candidato dopo invio, istruzioni per retry/nuova firma. |
| `frontend/src/components/Game/ActDraftPanel.tsx:19–37,65–70` | Editing opzionale e avviso; default compatibili con gli altri chiamanti. |
| `frontend/src/components/Game/SeatTable.tsx:74–79,166–180` | Solo inoltro dei due attributi della bozza. |
| `backend-nest/tests/ws-govux-p5-signatures.test.ts` | 15 nuovi test HTTP/SQLite temporanei. |
| `frontend/src/services/govuxTransport.test.ts` | Contratto header e compatibilità legacy, insieme ai test P2. |
| `e2e/tests/govux-signatures.spec.mjs` | 3 regressioni browser: risposta persa, ricevuta revocata, nuova preparazione. |
| `e2e/mock-api.mjs:1220–1254,1300–1310` | Fixture conserva coda e ricevute, GET autorevole, revoca ed esito mock; nessuna logica di simulazione reale. |

## 6. Prove dedicate e review

Test prima dell'implementazione: **RED validato, 12 falliti**, con riga ricevuta assente e actionId duplicati. Un tentativo precedente aveva una fixture LLM senza `consolidation`: corretta la fixture prima di considerare valido il RED, senza allentare asserzioni. La suite è stata poi ampliata a **15/15 passati**.

I test attraversano HTTP reale, sessione e repository reale, con DB sotto la directory temporanea; non usano il DB operativo:

- Due POST concorrenti, stessa key: un actionId, un ordine DB/RAM, una ricevuta e un solo bump.
- Risposta persa: arresto del server **di fixture**, chiusura SQLite, moduli/registry nuovi, riapertura DB e retry con stessa conferma. Una seconda connessione legge la ricevuta dal file.
- Payload diverso: 409 e versione immutata; distinta inclusa nell'hash, ordine delle proprietà irrilevante.
- Nuova key/stesso testo, isolamento tra partite e compatibilità client legacy.
- Revoca HTTP: replay senza resurrezione né bump.
- Eliminazione/replace della coda con gli stessi metodi usati da esecuzione e restore: ricevuta conservata.
- Modifica dell'ordine già in coda: non cambia l'hash originale della firma.
- Failure SQL nell'ordine, tra ordine e ricevuta e al COMMIT con FK differita: DB/versione/RAM ripristinati; retry possibile.
- Migrazione da tabella ricevute assente, ripetibilità e cancellazione con la partita.

```sh
cd backend-nest
../node_modules/.bin/vitest run tests/ws-govux-p2-cancellation.test.ts tests/ws-govux-p5-signatures.test.ts
# exit 0 — 23 test (15 P5 + 8 P2)

cd ../frontend
../node_modules/.bin/vitest run src/services/govuxTransport.test.ts
# exit 0 — 6 test, dopo RED con 5 falliti/1 passato

cd ../e2e
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node_modules/.bin/playwright test tests/govux-cancellation.spec.mjs tests/govux-signatures.spec.mjs
# exit 0 — 5 test (3 P5 + 2 P2), 1.1m
```

Review indipendente: corretti il registro non montato nelle asserzioni browser e la falsa memoria di accodamento per ricevuta revocata; bloccato il candidato già inviato. I test tornano ora a «Ministri», verificano **registro visibile** e count esatti 1/0; nel caso revocato verificano anche assenza di esito e memoria. Follow-up senza critical/warning sul codice. Corretto inoltre il solo testo atteso del nuovo test da «in coda» al label reale «accodato», senza cambiare le asserzioni sorgente preesistenti.

## 7. Gate completi e limiti

Log: `/tmp/govux-opt1-approved-gate/`, compresi `p5-red-valid.log`, `backend-focused.log`, `browser-fixed.log`, `first-run/` ed `exits.txt`.

| Comando realmente eseguito | Exit | Output |
|---|---:|---|
| `cd backend-nest && npm test` | 0 | 208 file, 2181 test passati |
| `cd frontend && npm test` | **1** | `Missing script: "test"`, due tentativi |
| `cd frontend && ../node_modules/.bin/vitest run` | 0 | 123 file, 1034 test passati |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | 0 | Nessun errore |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | 0 | Nessun errore |
| `npm run build:backend` | 0 | Build completata |
| `VITE_API_URL='' npm run build:frontend` | 0 | Build completata, warning chunk grandi |
| `cd e2e && CHROME_PATH=… node_modules/.bin/playwright test` | 0 | 160 passati, 18.7m |
| `cd e2e && CHROME_PATH=… node_modules/.bin/playwright test --config=playwright.a11y.config.mjs` | 0 | 4 passati, 24.3s |

**Non si dichiara verde il comando frontend `npm test` mancante.** Il runner Vitest effettivo è stato eseguito separatamente. Nessun test sorgente escluso, rimosso, allentato o soglia aumentata. Rimossi soltanto sei file compilati ignorati/non tracciati, con verifica Git registrata. Il primo gate backend aveva 5 falliti/2176 passati (`req.header` assente nelle request dei test legacy): corretta la lettura raw header e rilanciata l'intera suite. Primo E2E completo interrotto per le correzioni della review, non dichiarato passato.

Limiti espliciti:

- Concorrenza HTTP su un singolo handler/connessione; non è uno stress test multi-processo SQLite. `BEGIN IMMEDIATE` serializza il lookup, ma tale stress non viene dichiarato eseguito.
- Restart di HTTP/registry/SQLite di fixture, non riavvio del sistema operativo o del servizio pubblico.
- Test di persistenza usano i metodi di rimozione/replace reali; non eseguono una simulazione completa, salto temporale o restore end-to-end.
- Chiave nella bozza client esistente, in RAM: nessun nuovo store persistente di bozze. Reload completo scarta la bozza; per retry tra processi/client bisogna conservare e riusare la stessa key. La ricevuta server sopravvive al riavvio del DB.
- Nessuna idempotenza retroattiva per ordini legacy senza key. Nessun TTL delle ricevute: cancellarle prematuramente annullerebbe la garanzia; si eliminano con la partita.
- Non completati gli altri requisiti P5 su competenza, versionamento/freschezza, preflight, memoria o semantica temporale.

## 8. Freeze e consegna

Invariati `core/simulation/**`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, `OrderExecutionService`, run/checkpoint/playback e semantiche di salvataggio/tempo. Nessun contratto P5 aggiunto a `GameSession`: il suo diff appartiene soltanto a P2. Repository fuori dal metodo ricevuta invariati; schema fuori dalla sola tabella invariato.

PR unica **#153**, titolo richiesto invariato. Implementazione in commit piccoli: `588e6b7` (P2 backend), `ba9f4ef` (P5 backend), `4f4869a` (P2 browser), `0131d0f` (integrazione firma/UI). **Nessun merge/deploy/migrazione operativa.** Attesa della regia.
