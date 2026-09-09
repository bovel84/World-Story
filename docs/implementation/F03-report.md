# F03 — Contratto pubblico dei run e niente esiti per posizione

## Pacchetto / revisore / fotografia iniziale

- **Pacchetto:** F03 (audit A03 e A10, in sospeso da F00/F01), micro-consegna unica.
- **Revisore:** da designare (chi implementa non auto-approva).
- **Fotografia iniziale:** (1) `GET /games/:id/simulations/:runId` serializzava la riga del run con `SELECT *`: **`pending_state`** (le proposte future non applicate: spoiler del futuro e stato interno) e le chiavi di idempotenza finivano nel corpo HTTP. (2) `processWorldAdvance` restituiva `this.results.at(-1) || null`: un salto chiuso senza esito (ramo `no_event`) restituiva la **cronaca del run precedente** come se fosse l'esito corrente (associazione per posizione, I11).

## Requisiti audit / invarianti / test

| Audit | Invariante | Test | Esito |
|---|---|---|---|
| A03/C03 | I11 | `f03-route-contract.test.ts`: run in pausa con `pending_state` e `idempotency_key` presenti nel DB → la risposta `run` non contiene `pending_state`, `idempotency_key`, `idempotency_hash`; il contratto pubblico (id/status/mode/awaitingNext/events) resta integro. | Verde (rosso prima) |
| A10/C10 | I01, I11 | `f03-route-contract.test.ts`: run 1 con evento (cronaca esistente) → run 2 senza eventi (`mode: next_event`) → `no_event_found`, `simulationId` del run 2, nessun `result` ereditato. | Verde (rosso prima: `world_advanced` con la cronaca del run 1) |
| A10/C10 | I01, I11 | F00 `integrity-regressions.test.ts` (source-check): la stringa `return this.results.at(-1) || null;` non esiste più → **convertito a verde** (era `it.fails`). | Verde |
| A03/C03 | I11 | F00 `integrity-regressions.test.ts` (serializzazione): `JSON.stringify(response.body)` non contiene il segreto in `pending_state` → **convertito a verde**. | Verde |

## File letti e modificati

- `backend-nest/src/routes/games.routes.ts` — allowlist dei campi pubblici del run.
- `backend-nest/src/game-session.ts` — `lastCommittedResult` (associazione per ID), reset a inizio batch, `null` nei rami senza esito, `processWorldAdvance` senza fallback per posizione e con distinzione lock/no-event.
- `backend-nest/tests/integrity-regressions.test.ts` — A03/A10 convertiti da `it.fails` a `it` (fix reale, come da contratto F00).
- `backend-nest/tests/f03-route-contract.test.ts` — nuove prove end-to-end sul router.

## Comportamento prima / prova

- **A03 — prima:** `res.json({ run, ... })` con `run = SELECT *`: il lettore HTTP vedeva `pending_state` (eventi futuri proposti non applicati) e `idempotency_key`/`idempotency_hash`. Prova: segreto in `pending_state` → `JSON.stringify(response.body)` lo conteneva (rosso), ora no (verde).
- **A10 — prima:** `no_event` chiudeva il run senza `turnResult`; `processWorldAdvance` restituiva `results.at(-1)` = cronaca del run precedente → la risposta diceva `world_advanced` con `simulationId` del vecchio run. Prova: seconda chiamata senza eventi → `world_advanced` con cronaca ereditata (rosso); ora `no_event_found` (verde).

## Contratto API/schema e compatibilità

- `GET /games/:id/simulations/:runId`: `run` permette solo `id, game_id, mode, status, start_date, target_date, checkpoint_date, checkpoint_id, turn, error, created_at, completed_at` (snake_case invariato: nessun cambio per i client). Rimossi solo i campi interni. `awaitingNext`, `checkpoint`, `events`, `actionOutcomes`, `ongoingProcesses` invariati.
- `POST /games/:id/time-skip` (ramo world): un salto senza eventi ora risponde **`no_event_found`** (contratto già previsto dal route) invece di `world_advanced` con cronaca ereditata. Nessun nuovo campo.

## Algoritmo e invarianti mantenute

- **A03:** allowlist esplicita (non blacklist): qualsiasi colonna interna futura non finisce in HTTP per default.
- **A10:** `lastCommittedResult` è impostato alla creazione del `turnResult` dentro la transazione canonica (associato per ID), nullificato a inizio batch e nei rami senza esito (`no_event`, interruzione). `processWorldAdvance` lo restituisce senza mai leggere `results` per posizione.
- Distinzione lock/no-event: `withLock` restituisce `null` sia per conflitto sia ora per no-event; `processWorldAdvance` usa un flag `executed` → conflitto = `SimulationInProgressError` (409), no-event = `null` (route: `no_event_found`).

## Migrazioni eseguite solo su copie

Nessuna: nessun cambio di schema in F03.

## Comandi test e risultato completo

```
npm --prefix backend-nest test -- f03-route-contract.test.ts     # red → green
npm --prefix backend-nest test                                   # 28 file; 255/255 verdi (0 expected-fail)
npm --prefix backend-nest run build                              # tsc OK
git diff --check                                                 # pulito
```

## Screenshot/trace UI

Nessuno: contratto HTTP backend; la UI non usa i campi rimossi.

## Cosa NON è implementato / dipendenze mancanti

- La rimozione definitiva della colonna `pending_state` da `simulation_runs` (richiederebbe ADR: è il meccanismo di ripristino del playback §9.3); F03 la nasconde dal contratto HTTP, non dallo schema.
- A11 (parse/protocollo invalido = errore tecnico) resta assegnato a F03/F06 secondo la tabella di tracciabilità: l'allowlist A03/A10 chiude i due rilievi con priorità del pacchetto.

## Crediti / DB reale / deploy

Zero chiamate LLM reali, zero deploy, nessun dato reale toccato. Tutte le prove usano provider stub e DB in `os.tmpdir()`.

## Decisione revisore

Attesa revisione indipendente (test, call path, effetti vietati). Lo sviluppatore non si auto-approva.