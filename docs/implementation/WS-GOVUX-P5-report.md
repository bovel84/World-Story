# WS-GOVUX-P5 — OPZIONE 1: idempotenza firma, STOP prima della migrazione

Base verificata: `main` / `origin/main` **`157a408`**.
Branch: `feat/ws-govux-opt1-freeze-circoscritto`.
Task: `/tmp/pi-tasks/pi-task-govux-opt1-freeze.md`.

**Stato: BLOCCATO, NON IMPLEMENTATO.** Serve una ricevuta durevole indipendente
dalla coda. La migrazione minima è proposta sotto ma **NON eseguita**.
Il task autorizza l'analisi della sola migrazione indispensabile e impone:
«in tal caso fermarsi e documentare prima». È questo lo STOP applicato.
Nessun altro archivio del motore è stato riutilizzato per aggirare il vincolo.

## 1. Cosa era rotto — nomi reali e prova del blocco

Percorso della firma attuale:

`ActDraftPanel → GovernmentOffice.signDraft → useOrderQueue.queuePlayerAction`
`→ POST actions/queue → GameSession.queueAction → OrderExecutionService.enqueue`
`→ gameRepository.queuePendingAction`.

| File letto, NON modificato | Righe / simbolo | Evidenza |
|---|---|---|
| `frontend/src/components/Game/GovernmentOffice.tsx` | 365–381, `signDraft` | Invia testo/dichiarazione d'opera; nessuna chiave durevole della firma |
| `frontend/src/hooks/useOrderQueue.ts` | 137–156, `queuePlayerAction` | Deduplica solo i testi già nella coda client |
| `frontend/src/services/api.ts` | 1345–1359, `gameApi.queueAction` | Payload testo/opera, senza identità della richiesta |
| `backend-nest/src/routes/games/actions.routes.ts` | 184–217, POST queue | Chiama `session.queueAction(text, work)` e restituisce il nuovo actionId |
| `backend-nest/src/game-session.ts` | 3488–3489, `queueAction` | Delega a `orders.enqueue`; nessun key parameter. Questo contratto resta congelato fuori da P2 |
| `backend-nest/src/game/OrderExecutionService.ts` | 188–212, `enqueue` | `shortId()` nuovo ad ogni chiamata; push RAM prima del repository |
| `backend-nest/src/repositories/game.repository.ts` | 647–661, `queuePendingAction` | INSERT incondizionato + bump queueVersion nella transazione esistente |
| `backend-nest/src/database.ts` | 985–1011, `pending_actions` | PK sull'actionId; nessun request key/hash/ricevuta di firma |

### Perdita della risposta

1. Il primo POST accoda e persiste l'ordine A.
2. La risposta HTTP si perde: il client non vede A.
3. Il retry dello stesso payload passa la deduplica UI.
4. `enqueue` genera B con un nuovo ID; il repository inserisce B.
5. Ora ci sono due ordini per una sola firma logica.

È una conseguenza diretta del percorso sorgente; **non è stato eseguito un
POST di firma sulla partita reale per dimostrarla**, né presentato un test
inesistente come prova di implementazione.

### Perché un ID deterministico nella sola coda non basta

Anche ipotizzando `A = hash(gameId, requestKey)`, la coda non conserva la ricevuta:

| Evento | Evidenza sorgente | Dove sparisce l'identità |
|---|---|---|
| Revoca prima dell'esecuzione | `OrderExecutionService.ts:222-227`, repository `703-709` | DELETE della riga pending; nessuna azione/esito storico viene creato per l'ordine revocato |
| Esecuzione | `game/TurnPipelineService.ts:607-622,834-859` | Pending cancellata. Azione/esito mantengono actionId ma non richiesta/hash originali |
| Ripristino della coda | repository `733-754`, `game/GamePersistenceService.ts:261` | DELETE dell'intera coda e reinserimento degli ordini del salvataggio |
| Ripristino della cronaca | repository `845-878`, `replaceHistory` | Anche le azioni storiche sono cancellate e ricostruite |
| Rewind | repository `881-899`, `deleteAfterTurn` | Le azioni successive al turno sono eliminate |

**Controesempio decisivo:** prima firma accettata, risposta persa, revoca da un
altro client prima del retry. La riga di coda è stata eliminata e non esiste un
esito di turno. Un retry con la stessa key può inserire nuovamente l'ordine,
resuscitando una firma già revocata. La deduplica durava solo finché la riga era
presente, non era una garanzia durevole.

Identificare per testo/opera non è una soluzione: il testo pending è modificabile
(repository `713-720`) e due firme intenzionalmente diverse possono avere lo
stesso testo. Il requisito parla della **stessa richiesta**, non di ogni richiesta
con contenuto uguale.

Le tabelle di job/run hanno già idempotency key, ma sono archivi di simulazione:
riutilizzarli per firme cambierebbe semantica e sistemi congelati. Non si inseriscono
azioni storiche fittizie alla firma, non si usano memorie ministeriali o marker di
migrazione come ricevute, non si mantengono righe cancellate artificialmente nella
coda (il reader le elenca senza filtrare questi nuovi significati).

## 2. Cosa è stato toccato (file e righe)

**Nessun codice né schema modificato.** Sono aggiunti soltanto i due report:

- `docs/implementation/WS-GOVUX-P2-report.md` — stato P2 e percorso di cancellazione;
- `docs/implementation/WS-GOVUX-P5-report.md` — questo arresto preventivo.

I riferimenti di riga nelle tabelle sono ai sorgenti della base, **non** un elenco
di modifiche applicate. L'analisi dello schema è avvenuta leggendo `database.ts`,
non migrando il database attivo. Nessun ordine reale firmato/revocato, nessun
rewind o checkpoint alterato durante questa diagnosi.

## 3. Sola migrazione minima proposta — NON applicata

Occorre un registro tecnico di accettazione della richiesta, separato dalla
coda mutevole e dalla cronaca del mondo. Proposta da approvare, non SQL eseguito:

```sql
CREATE TABLE action_signature_receipts (
  game_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  action_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  PRIMARY KEY (game_id, request_key),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
```

**Perché questi dati:**

- `(game_id, request_key)`: unicità durevole della richiesta, isolata per partita;
- `payload_hash`: stessa key con payload diverso deve produrre conflitto, non
  riscrivere l'atto né firmarne un altro;
- `action_id`: identità dell'unico ordine generato alla prima accettazione;
- `response_json`: conferma originale recuperabile dopo perdita della risposta
  anche quando l'ordine non è più pending; è una ricevuta dell'accettazione,
  **non** la dichiarazione che l'ordine sia ancora in coda o sia stato eseguito;
- nessuna FK verso `pending_actions`: la revoca non deve cancellare la ricevuta;
- cancellazione solo insieme alla partita, non al restore/rewind della coda.

Non occorrono modifiche alle tabelle dei run, delle risorse o dei checkpoint.
Una colonna key nella sola `pending_actions` **non risolve** l'eliminazione della
riga; non si propone una migrazione incompleta pur di evitare il blocco.

### Contratto minimo associato alla migrazione

1. Il client genera una key una volta per la firma logica e la mantiene per
   doppio tap, retry e perdita della risposta; una nuova firma intenzionale
   riceve una nuova key. Riusa la convenzione `Idempotency-Key` già presente
   per altri comandi, senza introdurre un secondo sistema di job.
2. Il confine HTTP valida key/payload, calcola l'hash della versione originale
   mostrata (testo + dichiarazione d'opera normalizzata) e non confronta testo
   successivamente modificato nel registro.
3. **Un'unica transazione atomica**, con serializzazione SQLite adeguata:
   lookup ricevuta → inserimento ordine se assente → incremento queueVersion
   una sola volta → inserimento ricevuta → commit.
4. Stessa key/hash: restituisce la conferma già registrata **senza enqueue,
   senza incremento di versione e senza nuova firma**, anche dopo revoca o
   esecuzione. Stessa key/hash diverso: conflitto, zero scritture.
5. Il client distingue replay da stato corrente dell'ordine e rilegge il registro
   autorevole: non aggiunge un ordine revocato alla lista UI solo perché la
   ricevuta originale dichiarava l'accettazione.
6. Su eccezione/rollback: né ricevuta né ordine persistito né ordine fantasma
   in RAM. L'attuale `enqueue` muta RAM prima della persistenza; una transazione
   annidata è un savepoint, non una conferma indipendente (`database.ts:1364-1375`).
   La coerenza della coda RAM deve quindi essere provata, non assunta.

Il contratto di GameSession per P5 **non è autorizzato a cambiare**: l'eccezione
in questo task riguarda GameSession solo per P2. La futura integrazione deve
preservare quel confine usando il percorso di coda esistente; se non fosse
possibile con l'intervento minimo, occorrerebbe un ulteriore STOP motivato,
non un parametro P5 infilato silenziosamente in GameSession.

Il disegno atomico e la riconciliazione RAM vanno approvati/testati insieme alla
migrazione: il solo `CREATE TABLE` non costituirebbe una correzione end-to-end.
Non è stata implementata alcuna delle operazioni proposte.

## 4. Cosa resta congelato

Tutto il codice rimane quello di `157a408`: `core/simulation/**`, GameSession,
TurnOrchestrator, TurnPipelineService, SessionStateStore, schema e repository,
checkpoint/run/playback/pipeline temporale e stato frontend.

Nessuna migrazione, nessun riuso improprio di tabelle esistenti, nessun refactor
dello storage. Nessun merge, deploy o restart. Le build locali non sono deploy.

## 5. Prove: comandi, exit code e output chiave

Nuove esecuzioni, log `/tmp/govux-opt1-gate/`. Stessi esiti riportati in P2:

| Comando | Exit code | Output chiave |
|---|---:|---|
| `cd backend-nest && npm test` | **0** | **206 file / 2158 test passati** |
| `cd frontend && npm test` | **1**, ripetizione **1** | `Missing script: "test"` |
| `cd frontend && ../node_modules/.bin/vitest run` | **0** | **122 file / 1028 test passati**, runner effettivo della CI; warning opzioni Vite deprecate |
| `cd backend-nest && ../node_modules/.bin/tsc --noEmit` | **0** | Nessun errore |
| `cd frontend && ../node_modules/.bin/tsc --noEmit` | **0** | Nessun errore |
| `npm run build:backend` | **0** | Build riuscita |
| `VITE_API_URL='' npm run build:frontend` | **0** | Build riuscita; warning chunk >500 kB già presente |
| `cd e2e && node_modules/.bin/playwright test` | **0** | **155 passati**, 18,6 minuti |
| `cd e2e && node_modules/.bin/playwright test --config=playwright.a11y.config.mjs` | **0** | **4 passati**, 26,3 secondi |
| Nuovo test P5 «stessa chiave → un solo ordine» | **NON ESEGUITO** | Implementazione bloccata prima della migrazione; non esiste una prova positiva del nuovo contratto |
| Nuovo test P2 «annullamento interrompe provider» | **NON ESEGUITO** | Nessuna implementazione dopo lo STOP del pacchetto |

Backend test preceduto dalla rimozione dei soli sei `.test.js` generati in `dist`,
verificati ignorati e non tracciati da Git. **Nessun test sorgente escluso,
eliminato o allentato**; nessuna soglia modificata.
Per Playwright: `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`.

Questi sono gate della **base invariata**, non test di accettazione P2/P5.
Il pacchetto NON viene dichiarato verde/completo: frontend `npm test` manca,
i test dedicati richiesti non sono implementati e lo STOP resta aperto.

### Test da aggiungere soltanto dopo lo scioglimento dello STOP

- Due POST con stessa key/payload → stessa actionId, una riga ordine/una ricevuta,
  queueVersion incrementata una volta; client differenti, non solo doppio clic UI.
- Retry dopo perdita della risposta e riapertura DB/riavvio → nessun secondo ordine.
- Stessa key/payload diverso → conflitto e nessuna modifica a coda/ricevuta.
- Key nuova/contenuto uguale → firma distinta legittima, senza deduplica per testo.
- Replay dopo revoca/esecuzione/restore → non ricrea l'ordine.
- Fault tra INSERT ordine e INSERT ricevuta / commit → rollback DB e RAM coerente.
- Identica key in due partite → isolamento per gameId.

Sono criteri futuri, non test aggiunti o risultati già ottenuti.

## 6. Limiti residui e consegna alla regia

La firma è ancora soggetta al doppio ordine dopo risposta persa. Busy e dedup
UI non sono promossi a soluzione. Il provider ministeriale non è ancora
cancellabile end-to-end: vedere report P2.

La regia deve approvare esplicitamente **la sola migrazione delle ricevute e
la relativa scrittura atomica/coerenza RAM**, oppure autorizzare P2 separata
mentre P5 resta bloccata. Non si procede oltre con un workaround sotto-traccia.

**Una PR draft verso main, con entrambi i report. Nessun merge/deploy.**
