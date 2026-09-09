# F02 — Checkpoint atomici, revisioni, rami e outbox

## Pacchetto / revisore / fotografia iniziale

- **Pacchetto:** F02, micro-consegne 1–4 (revisione mondiale monotona + migrazioni additive; commit canonico atomico; pubblicatore outbox separato e ripetibile; CAS sull’ancora del mondo + scarto staging RAM).
- **Revisore:** da designare (chi implementa non auto-approva).
- **Fotografia iniziale:** le revisioni dei checkpoint erano derivate dal turno (`currentTurn` per il percorso ordinario, `turn + eventIndex` per il playback scaglionato). Due run possono quindi produrre la stessa revisione o una decrescente: un run multi-evento al turno 1 generava revisioni 2, 3, 4 e il salto ordinario successivo al turno 2 generava di nuovo 2. Il percorso di restore/intervento confronta le revisioni per uguaglianza (G22): una collisione rende ambiguo il checkpoint mostrato e viola C02/C09.

## Requisiti audit / invarianti / test

| Audit | Invariante | Test | Esito |
|---|---|---|---|
| A02/C02 | I01, I02 | `revision-contract.test.ts`: run multi-evento (3 checkpoint) + salto ordinario successivo (1 checkpoint): revisioni strettamente crescenti, mai uguali, mai minori. | Verde (dopo fix; rosso prima: `[2, 3, 4, 2]`) |
| A02/C02 | I01, I02 | `atomic-commit.test.ts`: errore simulato a metà commit (in `addSimulationEvents`) → zero checkpoint/eventi/cronache orfane; il mondo resta al turno precedente e un nuovo run riesce. | Verde (dopo fix; rosso prima: 1 checkpoint orfano) |
| A02/C02 | I01, I02 | `atomic-commit.test.ts`: protocol error nella chiusura del run (`completesProjectId` non accettato) → rollback completo: nessun checkpoint finale, nessun esito, ordine ancora in carico. | Verde |
| C15 | I02, I11 | `outbox.test.ts`: eventi e outbox commettono insieme (una riga per evento, stessi ID stabili, sequenze crescenti); senza client le righe restano `pending`; il flush alla (ri)connessione diffonde in ordine e marca `published`; un secondo flush non duplica nulla. | Verde |
| C15 | I02, I11 | `outbox.test.ts`: run con client connesso → pubblicazione immediata al commit, tutte le righe `published`. | Verde |
| A02/C02 | I02 | `atomic-commit.test.ts`: errore a metà commit nella chiusura del run → anche la RAM torna al checkpoint confermato (ordine non «completed», data del checkpoint, run ancora in pausa). | Verde (rosso prima: RAM avanti) |
| C02 | I02 | `atomic-commit.test.ts`: CAS unitario — scrittura condizionale OK su ancora valida; su ancora stantia non scrive. | Verde |
| C02/C15 | I02 | `atomic-commit.test.ts`: writer esterno muta il mondo durante la pausa → il commit del playback fallisce con `world_anchor_conflict`, zero scritture, staging RAM scartato. | Verde |
| A09/C09 | I02 | Stessa prova sui dati persistiti in `simulation_checkpoints` (non solo RAM). | Verde |
| — | G22 | `stage2.test.ts` «Save durante la pausa…»: dopo Load le revisioni non si riusano. | Verde (adattato con motivo) |

## File letti e modificati

- `backend-nest/src/database.ts` — migrazioni additive F02 passo 1; helper `withCanonicalTransaction`.
- `backend-nest/src/repositories/game.repository.ts` — `nextWorldRevision`.
- `backend-nest/src/game-session.ts` — i tre siti di creazione checkpoint usano il contatore; i tre blocchi di commit (percorso ordinario, chiusura run scaglionato, checkpoint per-evento) avvolti in `withCanonicalTransaction`; `syncRegionsToDB` resa sincrona (corpo già tale); enqueue outbox dentro le transazioni e `publishPendingOutbox` dopo il commit.
- `backend-nest/src/routes/games.routes.ts` — flush outbox alla (ri)connessione SSE.
- `backend-nest/tests/revision-contract.test.ts`, `backend-nest/tests/atomic-commit.test.ts`, `backend-nest/tests/outbox.test.ts` — nuove prove (red → green).
- `backend-nest/tests/stage2.test.ts` — tre asserzioni adattate con motivo esplicito (vedi sotto).

## Comportamento prima / prova

- **Prima:** `revision = currentTurn` (percorso ordinario), `revision = state.revisionBase + eventIndex` con `revisionBase = currentTurn + 1` (playback). Prova ripetibile (`revision-contract.test.ts`): dopo un run con 3 checkpoint, il checkpoint ordinario successivo aveva revisione 2 < 4 — regressione di revisione a fronte di una mutazione canonica successiva.
- **Dopo:** `games.world_revision` è un contatore monotono per partita incrementato esattamente una volta per checkpoint, dentro una transazione breve (`UPDATE … + SELECT` in `db.transaction`). Prova: `[1, 2, 3, 4]`.

## Contratto API/schema e compatibilità

- Nessun cambio di shape DTO: `revision` resta un numero intero; i confronti G22 (uguaglianza) restano validi. Le revisioni sono ora univoche per partita e strettamente crescenti — il restore per revisione diventa non ambiguo.
- `state.revisionBase` resta nello stato persistito (`pending_state`) per compatibilità di shape con run sospesi creati prima di F02; non è più fonte delle revisioni.
- Client/SSR: nessuna modifica richiesta.

## Algoritmo e invarianti mantenute

- `nextWorldRevision(gameId)`: transazione breve `UPDATE games SET world_revision = world_revision + 1` + `SELECT`; nessuna I/O LLM/network dentro la transazione.
- I tre siti (`_commitPausedStepUnlocked`, `_completePausedRunUnlocked`, finalizzazione percorso ordinario) chiamano il contatore una sola volta ciascuno: un checkpoint = una mutazione canonica = una revisione.
- Ordinale di broadcast (`jump_event.index`) separato dalla revisione: è la posizione dell'evento nel playback, non più una componente aritmetica della revisione.

### F02 passo 2 — commit canonico atomico

- `withCanonicalTransaction(fn)`: transazione better-sqlite3; le transazioni annidate (`nextWorldRevision`, bump della coda, `replaceHistory`) diventano savepoint.
- **Percorso ordinario** (`_processActionBatchUnlocked`): una sola transazione da `relationshipRepository.upsertForGame` fino a `finishSimulationRun` (relazioni, chat, azioni, regioni, esiti, processi, coda, turno/data, checkpoint, eventi, chiusura run). Consolidamento LLM, consigliere e broadcast SSE restano fuori.
- **Chiusura run scaglionato** (`_completePausedRunUnlocked`): stessa atomica; un protocol error (projectId non accettato) riporta il DB al checkpoint precedente invece di lasciare cronache/azioni orfane.
- **Checkpoint per-evento** (`_commitPausedStepUnlocked`): transazione su risultato del turno, mondo, checkpoint, eventi e `pauseSimulationRun`; la chiusura del run (se l'evento era l'ultimo) avviene dopo il commit, fuori dalla transazione.
- `syncRegionsToDB` è ora sincrona (il corpo lo era già): nessun `await` dentro le transazioni.
- RAM non ancora transazionale: su errore a metà commit il DB è coerente, ma alcune variabili di RAM (esiti degli ordini segnati `completed`) restano avanti — scarto dello staging previsto per il passo 4 (CAS/fencing).

### F02 passo 3 — pubblicatore outbox separato e ripetibile

- Gli eventi canonici entrano in `simulation_outbox` **nella stessa transazione** del checkpoint (eventi e outbox commettono o rollbackano insieme); ID stabili = ID degli eventi; `sequence` per-game crescente.
- `publishPendingOutbox()`: legge le righe `pending` in ordine, diffonde `world_event` via SSE e marca `published` **solo dopo** la diffusione (almeno-una-volta: un crash tra diffusione e marcia ripete con gli stessi ID; il client deduplica).
- Senza client SSE le righe restano `pending`; la (ri)connessione SSE esegue il flush (`games.routes.ts`): un client assente al commit riceve gli eventi alla riconnessione.
- Chiamate automatiche al publisher dopo ognuna delle tre transazioni di commit.

### F02 passo 4 — CAS sull’ancora del mondo e scarto staging RAM

- `compareAndSwapTurnAndDate(gameId, expectedTurn, expectedDate, turn, date)`: UPDATE condizionale all’ancora; `"current_date"` quotato (keyword SQLite). I tre commit (ordinario, chiusura run, per-evento) usano il CAS al posto della scrittura incondizionata: un mondo mutato altrove (restore, altro processo) produce `world_anchor_conflict` e rollback, mai sovrascritture.
- Ancora: percorso ordinario = `turnBeforeRun/dateBeforeRun`; percorsi paused = stato pre-commit catturato all’inizio della funzione.
- **Staging RAM**: nei due percorsi paused la RAM (regioni deep-copy, relazioni, azioni, risultati, coda, turno/data, `pausedRun`, `appliedCount`, `changedRegions`) viene catturata prima del lavoro; il commit riuscito la promuove, ogni errore la scarta → RAM e DB tornano insieme al checkpoint confermato.
- Fencing dei callback: l’intervento già verifica revision/eventId (G22); «Continua» è coperto da runId + lock + ora anche dal CAS all’ancora.
- Le scritture non-commit (inizializzazione, save/load, ripristino del catch, tick legacy) restano incondizionate per progetto.

## Migrazioni eseguite solo su copie

Additive e idempotenti (testate su DB temporanei; mai su `backend-nest/data/world-story.db`):
- `games.world_revision INTEGER NOT NULL DEFAULT 0`
- `games.head_branch_id TEXT` (F04: rami/restore cronologico)
- tabella `game_branches` (id, game_id, name, parent_branch_id, origin_checkpoint_id, created_at)
- tabella `simulation_outbox` + indice `(game_id, sequence)` (pubblicazione SSE separata, §9.3)
- `simulation_runs.idempotency_hash TEXT` (C09: stessa chiave + payload diverso = conflitto)

## Comandi test e risultato completo

```
npm --prefix backend-nest test -- revision-contract.test.ts   # red → green
npm --prefix backend-nest test -- atomic-commit.test.ts       # red → green
npm --prefix backend-nest test -- outbox.test.ts              # outbox e ripetibilità
npm --prefix backend-nest test                                # 27 file; 251 verdi, 2 expected-fail F00 (253)
npm --prefix backend-nest run build                           # tsc OK
git diff --check                                              # pulito
```

## Rilievo d'audit emerso durante il lavoro (da registrare)

**`current_date` è una keyword SQLite (`CURRENT_DATE`)**: ogni `SELECT current_date FROM games` non legge la colonna ma valuta la keyword, restituendo la data di oggi. Il DB è corretto (la colonna contiene il valore giusto; `SELECT *` lo legge bene) e i repository non usano select-list per nome — il difetto non è attivo in produzione, ma è una trappola per ogni nuova query/audit SQL. Da affrontare con una eventuale rinomina della colonna (richiede ADR/migrazione) o convenzione di quoting (`"current_date"`).`

## Screenshot/trace UI

Nessuno: pacchetto backend, nessuna UI toccata.

## Cosa NON è implementato / dipendenze mancanti

- Publisher outbox (passo 3) implementato: righe scritte nella transazione canonica, pubblicazione post-commit, flush alla riconnessione SSE. Restano fuori: la migrazione completa dei client agli eventi outbox (F06/U02), hash payload + conflitto C09 (migrati ma non ancora cablati nel percorso time-skip), rami alternativi e restore cronologico (F04).

## Crediti / DB reale / deploy

Zero chiamate LLM reali, zero deploy, nessun dato reale toccato. Tutte le prove usano provider stub e DB in `os.tmpdir()`.

## Decisione revisore

Attesa revisione indipendente (test, call path, effetti vietati). Lo sviluppatore non si auto-approva.

### Adattamento test preesistenti (motivo esplicito, come da contratto di consegna)

Tre asserzioni di `stage2.test.ts` verificavano l'aritmetica vecchia `revision = turno + indice` (`[2, 3]`, `revision: 2` all'avvio del mondo). Sono state adattate al nuovo contatore (`[1, 2]`, `revision: 1`) con commento inline: il cambiamento di semantica delle revisioni è l'oggetto stesso di questa micro-consegna, dimostrato rosso-prima/verde-dopo da `revision-contract.test.ts`. L'invariante G22 e tutti gli altri assert dei test sono rimasti intatti.