# F04 — Save/Load/Rewind e chat sicuri per ramo

## Pacchetto / revisore / fotografia iniziale

- **Pacchetto:** F04, micro-consegne 1–4 (hash semantico e restore verificato; rami al restore con transazione unica e risposta gameId/branch/anchor; fencing chat/advisor su ramo/revisione con politica 409; archivio privato del ramo abbandonato e restore E1 dopo riavvio).
- **Revisore:** da designare (chi implementa non auto-approva).
- **Fotografia iniziale:** save e checkpoint non portavano alcun impronto del contenuto: un JSON manomesso nel DB (oppure incompatibile) veniva applicato alla sessione senza alcuna validazione. Il DoD del piano (C12: «hash semantico di tutti i sottosistemi restaurati uguale al checkpoint scelto») non era verificabile.

## Requisiti audit / invarianti / test

| Audit | Invariante | Test | Esito |
|---|---|---|---|
| A05/A08 | I02 | `semantic-hash.test.ts`: il save registra `content_hash`; il restore legittimo ripristina uno stato con lo stesso hash semantico. | Verde (rosso prima: colonna assente) |
| A12 | I02 | `semantic-hash.test.ts`: snapshot manomesso (owner di una regione alterato) → `snapshot_hash_mismatch` **prima** di mutare la sessione (§9.4.1: validazione prima della mutazione). | Verde |
| C12 | I02 | `semantic-hash.test.ts`: checkpoint con hash; restore via route OK su snapshot integro; manomissione del checkpoint → route rifiuta (422 `snapshot_hash_mismatch`), sessione intatta. Caso E1/E2: restore di un run già completato. | Verde |
| C05/C08 | I02 | `branch.test.ts`: l'inizializzazione apre il ramo `main`; il restore di un checkpoint crea il ramo figlio (parent = ramo abbandonato, origin = checkpoint) e aggiorna `games.head_branch_id`; la risposta API contiene gameId/branchId/anchor (passo 5). | Verde |
| C05/C08 | I02 | `branch.test.ts`: restore fallito a metà (errore iniettato in `replaceHistory`) → transazione unica: nessuna collezione ripristinata, nessun ramo creato, mondo invariato. | Verde |
| A06/A08/C17 | I02 | `chat-fence.test.ts`: chat durante un run (anche solo in pausa) → rifiuto esplicito (`SimulationInProgressError` → 409 `simulation_in_progress`), nessuna scrittura; advisor con stessa politica. | Verde |
| A06/A08 | I02 | `chat-fence.test.ts`: risposta tardiva (LLM bloccato, poi revisione cambiata o ramo cambiato) → `ContextChangedError`, la replica NON è scritta né broadcastata sul ramo nuovo. | Verde |
| A06/C17 | I02 | `branch.test.ts`: al restore le righe outbox pendenti del ramo abbandonato sono archiviate (`delivery_state='published'`), mai ripubblicate (§9.4.1: un solo messaggio di branch replacement). | Verde |
| C17 | I02 | `branch.test.ts`: restore E1 dopo riavvio — sessione ricostruita dal DB (`removeSession` + `getSessionOrThrow`) ripristina il checkpoint di un run chiuso e crea il ramo nuovo. | Verde |

## File letti e modificati

- `backend-nest/src/domain/semantic-hash.ts` — nuovo: canonicalizzazione (chiavi ordinate ricorsivamente) + SHA-256; esclude i metadati del salvataggio.
- `backend-nest/src/database.ts` — migrazioni additive `saves.content_hash`, `simulation_checkpoints.content_hash`.
- `backend-nest/src/game-session.ts` — `save()` e snapshot `__rewind__` commettono l'hash; `loadFromSave(saveData, expectedHash?)` valida prima di mutare; `semanticHash()` pubblico per il DoD post-restore; i re-insert del rewind preservato copiano l'hash.
- `backend-nest/src/repositories/game.repository.ts` — `createSimulationCheckpoint` commette l'hash del payload; `ensureMainBranch`/`getHeadBranch`/`createBranch` (F04 §9.4).
- `backend-nest/src/routes/games.routes.ts` — restore del checkpoint valida con `checkpoint.content_hash`; `snapshot_hash_mismatch` → 422 esplicito; route advisor GET usa `respondRouteError` (409 durante un run).
- `backend-nest/tests/semantic-hash.test.ts`, `backend-nest/tests/branch.test.ts`, `backend-nest/tests/chat-fence.test.ts` — nuove prove (red → green).

## Comportamento prima / prova

- **Prima:** `INSERT INTO saves (...)` senza hash; restore = `JSON.parse(checkpoint.data)` applicato direttamente. Prova ripetibile: manomissione del JSON nel DB → il restore applicava lo stato manomesso.
- **Dopo:** ogni save/checkpoint commette l'hash del proprio payload; un restore con hash incompatibile lancia `snapshot_hash_mismatch` prima di toccare la sessione (data/turno invariati), e il restore legittimo è verificabile post-fatto: `session.semanticHash() === content_hash` del checkpoint scelto.

## Contratto API/schema e compatibilità

- `POST /games/:id/simulations/:runId/restore`: invariato sul successo; su snapshot manomesso/incompatibile risponde **422** `snapshot_hash_mismatch` (prima: 500 generico o applicazione silenziosa).
- Nessun campo rimosso dai contratti esistenti; le nuove colonne sono additive e nullable (i save/checkpoint pre-F04 restano caricabili: `expectedHash` assente → nessuna pre-validazione, comportamento precedente).

## Algoritmo e invarianti mantenute

- `semanticStateHash(data)`: canonicalizzazione ricorsiva (chiavi ordinate) + SHA-256. Ordine degli array preservato (la cronologia è sequenziale): l'hash è deterministico per lo stesso contenuto serializzato.
- Copertura: turn/data, players, regions, relationships, actions, results, consolidatedHistory/UpTo, difficulty, pendingActions (inclusi i «processing» del playback privato), pausedSimulationId, chats, ongoingProcesses — tutti i sottosistemi del DoD.
- Pre-validazione prima della mutazione; post-verifica tramite `semanticHash()` (stessa funzione del salvataggio).

### F04 passo 2+5 — rami al restore

- Ogni partita nasce (o riapre) sul ramo `main` (`ensureMainBranch` nel costruttore di sessione, idempotente); l'id del ramo è il fencing token.
- Il restore di un checkpoint crea un **ramo figlio** nella stessa transazione delle collezioni ripristinate: `parent_branch_id` = ramo abbandonato, `origin_checkpoint_id` = checkpoint ripristinato, `games.head_branch_id` aggiornato.
- `loadFromSave` ora ripristina **tutte le collezioni in una sola transazione** (coda, ordini processing, relazioni, chat, processi, mondo, ramo) con staging RAM: un errore a metà non muta né il DB né la sessione.
- Passo 5: la risposta del restore contiene `gameId`, `branchId` e `anchor` (checkpointId/revision): il client non indovina cosa sia stato caricato.

### F04 passo 3 — chat/advisor sicuri per ramo

- All'inizio di ogni richiesta conversazionale la sessione cattura `fenceContext()` = `{ branchId, revision }` (nuovo `gameRepository.getWorldRevision`, lettura pura).
- **Politica esplicita durante un run: 409** (`SimulationInProgressError` → `simulation_in_progress`), anche quando il playback è solo in pausa (`hasActiveRun() = isProcessing || pausedRun != null`): nessuna scrittura nel contesto congelato, né bozza silenziosa.
- Write-back della replica chat (`generateChatReply`) protetto da `assertFenceValid`: run partito, restore con ramo nuovo o revisione cambiata durante l'attesa LLM → `ContextChangedError` (nuovo) → 409 `context_changed`, **nessuna scrittura né broadcast** sul ramo nuovo (DoD: risposta tardiva non muta il ramo nuovo).
- Il commento proattivo del consigliere (post-commit, broadcast-only) usa `getAdvisorUnchecked`: stessa revisione appena commessa, nessuna guardia necessaria.
- `chats.routes.ts` mappa `SimulationInProgressError`/`ContextChangedError` → 409 con `code` esplicito.

### F04 passo 4 — archivio privato del ramo abbandonato

- Nuovo `gameRepository.archivePendingOutbox(gameId)`: al restore (dentro la stessa transazione), le righe outbox pendenti appartengono al futuro scartato → archiviate (`delivery_state='published'`), mai ripubblicate (§9.4.1: un solo messaggio pubblico di branch replacement, niente republish dello storico). Restano consultabili come audit privato.
- Restore E1 dopo riavvio verificato: la sessione ricostruita dal DB (`removeSession` + `getSessionOrThrow`) ripristina il checkpoint di un run chiuso e apre il ramo nuovo.
- Lo storico del ramo abbandonato non entra nei prompt del ramo corrente per costruzione: lo snapshot ripristinato è quello del checkpoint (niente futuro del ramo scartato in actions/results/consolidatedHistory); gli eventi restano solo nelle tabelle private (simulation_events/outbox).

## Migrazioni eseguite solo su copie

Additive e idempotenti su DB temporanei: `saves.content_hash TEXT`, `simulation_checkpoints.content_hash TEXT`. Mai su `backend-nest/data/world-story.db`. (Le tabelle `game_branches`/`games.head_branch_id` erano state migrate con F02 passo 1.)

## Comandi test e risultato completo

```
npm --prefix backend-nest test -- semantic-hash.test.ts   # red → green
npm --prefix backend-nest test -- branch.test.ts          # rami al restore
npm --prefix backend-nest test -- chat-fence.test.ts      # fencing chat/advisor
npm --prefix backend-nest test                            # 31 file; 267/267 verdi
npm --prefix backend-nest run build                       # tsc OK
git diff --check                                          # pulito
```

## Screenshot/trace UI

Nessuno: pacchetto backend.

## Cosa NON è implementato / dipendenze mancanti

- Selezione/cambio ramo attivo da parte del giocatore (lista rami, switch): richiede contratti client in F06/U02. L'albero dei rami è registrato in `game_branches` ma non esposta una route di lettura.
- Il rewind (§12) resta sul ramo corrente: la creazione del ramo è applicata al restore di checkpoint; estenderla al rewind richiede la decisione di archivio del passo 4 (l'archiviazione outbox è già applicata a ogni load).
- Ripubblicazione dell'unico messaggio di branch replacement via SSE dedicato: il client vede il cambio di ramo dalla risposta del restore e dal flush outbox filtrato per stato; un evento SSE dedicato è rimandato a F06/U02.

## Crediti / DB reale / deploy

Zero chiamate LLM reali, zero deploy, nessun dato reale toccato. Tutte le prove usano provider stub e DB in `os.tmpdir()`.

## Decisione revisore

Attesa revisione indipendente (test, call path, effetti vietati). Lo sviluppatore non si auto-approva.