# Revisione indipendente — F02 (checkpoint atomici, revisioni, rami, outbox)

- **Revisore**: ≠ implementatore (gate F00–F06).
- **Oggetto**: revisione mondiale monotona, commit canonico atomico, pubblicatore
  outbox separato e ripetibile, CAS sull'ancora del mondo + scarto dello staging RAM.
- **Metodo**: lettura dei call path + prove riproducibili (non fiducia nel report).
- **Esito**: **ACCETTABILE**.

## Claim verificati

| Audit | Claim F02 | Evidenza |
|---|---|---|
| A02/C02 | Revisione mondiale **monotona e univoca** per partita (niente collisioni/decrementi) | `nextWorldRevision` = `UPDATE games SET world_revision = world_revision + 1` + `SELECT` in transazione breve; `revision-contract.test.ts` → `[1,2,3,4]` dopo run multi-evento + salto ordinario |
| A02/C02 | Un `checkpoint = una mutazione canonica = una revisione` (i tre siti chiamano il contatore **una volta**) | `game-session.ts` siti `_commitPausedStepUnlocked`, `_completePausedRunUnlocked`, finalizzazione percorso ordinario; ordinale di broadcast `jump_event.index` **separato** dalla revisione |
| A02/C02 | Commit **atomico**: errore a metà → nessun checkpoint/evento/cronaca orfano | `withCanonicalTransaction` avvolge i tre blocchi; `atomic-commit.test.ts` (errore in `addSimulationEvents`, protocol error in chiusura run) → rollback completo, mondo al turno precedente |
| C15 | Eventi e outbox **commettono insieme**, pubblicano **solo dopo** il commit | enqueue dentro la transazione, `publishPendingOutbox` dopo; `outbox.test.ts` |
| C15 | Senza client: righe `pending`; alla riconnessione flush in ordine, `published`; **secondo flush non duplica** | `outbox.test.ts` + `outbox-service.test.ts`; `broadcast` ritorna `false` senza client → `publishPendingOutbox` non marca `published` |
| C02 | **CAS** sull'ancora del mondo: scrittura condizionale solo su ancora valida | `compareAndSwapTurnAndDate`; `atomic-commit.test.ts` unitario + writer esterno durante la pausa → `world_anchor_conflict` |
| A09/C09 | Stesso esito sui dati **persistiti** (`simulation_checkpoints`), non solo RAM | `atomic-commit.test.ts` |
| F02 passo 4 | Su conflitto CAS: **zero scritture** e **staging RAM scartato** | `PlaybackService` cattura/ripristina lo staging; `atomic-commit.test.ts` asserisce RAM tornata al checkpoint confermato |
| G22 | Dopo Load le revisioni **non si riusano** | `semantic-hash.test.ts` (hash su save e checkpoint; snapshot manomesso rifiutato prima di mutare la sessione) + `branch.test.ts` (ramo figlio su restore, ramo abbandonato non ripubblica l'outbox) |

## Verifica della raggiungibilità dei casi limite

- **CAS su `(turn, date)`.** Il fencing copre la mutazione canonica del mondo, che
  avanza sempre turno e/o data; un checkpoint non cambia mai *solo* `world_revision`.
  Quindi l'ancora è sufficiente e il conflitto è raggiungibile e testato.
- **Pubblicazione ripetibile.** `publishPendingOutbox` è idempotente per costruzione
  (marca `published` solo a invio riuscito con client presenti); un ramo abbandonato
  non ripubblica outbox pendente (`branch.test.ts`).

## Osservazioni residue (non bloccanti)

1. L'ancora del CAS non include `world_revision`: due checkpoint con stesso
   `(turn, date)` — oggi non generati — non sarebbero distinguibili. Da rivalutare
   solo se in futuro un checkpoint potesse non avanzare turno/data.
2. `state.revisionBase` resta persistito per compatibilità di shape con run sospesi
   pre-F02, ma **non è più fonte** delle revisioni (documentato).
3. La RAM di parti non transazionali è coperta dallo scarto dello staging; restano
   fuori dal commit (per scelta) consolidamento LLM, consigliere e broadcast SSE.

## Esito

Nessun difetto bloccante: revisioni monotone, commit atomico, outbox ripetibile e
fencing CAS sono verdi e con copertura dedicata.
