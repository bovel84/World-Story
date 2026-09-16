# Revisione indipendente — F05 (job asincroni, lease, recovery)

- **Revisore**: ≠ implementatore (gate F00–F06).
- **Oggetto**: `backend-nest/src/jobs/SimulationJobService.ts`, i metodi job di
  `src/repositories/game.repository.ts`, le route legacy delegate.
- **Metodo**: lettura dei call path + prove **riproducibili** (`backend-nest/tests/jobs.test.ts`),
  non fiducia nei claim del report.
- **Esito**: **ACCETTABILE**.

## Claim verificati

| Claim F05 | Evidenza |
|---|---|
| 202 con provider bloccato; il job si completa poi | `jobs.test.ts` «POST accetta con 202 mentre il provider è bloccato» |
| Idempotenza: stessa chiave + stesso payload → stesso job | `submit` confronta `payload_hash`; test «stessa chiave e stesso payload» |
| Stessa chiave con payload diverso → **409** `idempotency_conflict` (C09) | `IdempotencyConflictError`; test µ1 e µ3 (`time-skip`) |
| Lease scaduto dopo crash → job `failed`, run `paused_recovery`, **nessuna rigenerazione** (C13) | `recoverExpiredLeases()` marca `lease_expired` + `markRunPausedRecovery`; test asserisce 0 chiamate provider |
| Arresto controllato: l'abort raggiunge gli adattatori (convertitore) e il job è marcato `failed`, mai dimenticato | `shutdown()` → `abortActiveSimulation()`; test con gate sul convertitore |
| Fencing del lease: solo il proprietario rinnova | `renewJobLease(id, owner, …)` → `false` per owner diverso; test dedicato |
| Chiusura del recupero → run `interrupted` | route `close-recovery`; test |
| Ripresa **esplicita** (mai automatica): riaccoda il job e crea un nuovo run | `resumeRun` richiede `run=paused_recovery` + `job=failed`; test |
| Ripartenza controllata: `startup()` recupera i lease scaduti e **reclama i job in coda sopravvissuti** senza rigenerare | `startup()` = `recoverExpiredLeases()` + `kick()`; **nuovo test** «startup() reclama i job in coda sopravvissuti al crash» (una sola esecuzione, `jumpCalls+1`) |
| Endpoint legacy (`time-skip`, `process-all`) delegano al worker conservando la forma | describe «F05 µ3» (3 test) |

## Verifica della raggiungibilità dei casi limite

- **Recovery solo all'avvio.** `recoverExpiredLeases()` è invocato **unicamente** da
  `startup()` (dopo `shutdown()`/riavvio). L'heartbeat in `execute()` (`setInterval`)
  rinnova *solo* il lease, non esegue recovery. Conseguenza: i casi in cui una
  recovery in-process potrebbe sovrascrivere lo stato di un job ancora vivo **non
  sono raggiungibili** in deployment a singolo processo (R1).
- **Idempotenza cross-restart.** Dopo un riavvio la mappa di idempotenza in memoria
  riparte vuota; riusare la stessa chiave su `resumeRun` non può quindi restituire
  un risultato stantio.

## Osservazioni residue (non bloccanti)

1. `claimNext()` ritorna `null` se il `claim` perde la corsa, **interrompendo il
   `drain`**; il `finally` di `execute` ri-arma `kick()` se resta un job in coda,
   quindi il sistema si auto-riprende. In single-process la corsa non è possibile.
2. `updateJobStatus` non protegge dal sovrascrivere un `failed` già scritto dalla
   recovery. Irraggiungibile per il punto «recovery solo all'avvio»; da rivalutare
   se in futuro la recovery diventasse periodica o multi-processo.
3. Idempotenza per `(game_id, idempotency_key)`: le chiavi sono per partita, come
   atteso dai test condivisi.

## Esito

Nessun difetto bloccante. Aggiunta di copertura mancante per la ripartenza
(`startup()`), così il claim «i sopravvissuti sono reclamati, non rigenerati»
ha una prova permanente. Backend: **118 file / 993 test** verdi.
