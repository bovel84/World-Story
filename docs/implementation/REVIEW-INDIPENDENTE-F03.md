# Revisione indipendente — F03 (contratto pubblico dei run, no esiti per posizione)

- **Revisore**: ≠ implementatore.
- **Oggetto**: audit A03 (allowlist del run) e A10 (nessun esito per posizione).
- **Metodo**: esecuzione reale + ispezione delle query di serializzazione.
- **Esito**: **ACCETTABILE**.

## Claim verificati (esecuzione reale)

| Requisito F03 | Evidenza |
|---|---|
| A03/C03 — `GET /simulations/:runId` **allowlist** (niente `pending_state`/chiavi idempotenza) | `f03-route-contract.test.ts`: run in pausa con `pending_state`+`idempotency_key` nel DB → la risposta non li contiene. Verifica indipendente: `simulations.routes.ts` costruisce `publicRun` campo per campo (niente `SELECT *`); `events`/`actionOutcomes` usano SELECT espliciti (nessun `SELECT *`) → nessuna fuga laterale |
| A10/C10 — un salto senza eventi **non** eredita la cronaca precedente | `f03-route-contract.test.ts`: run 1 con evento → run 2 `next_event` senza eventi → `no_event_found`, `simulationId` del run 2, nessun `result` ereditato |
| Conversione delle riproduzioni F00 a verde | `integrity-regressions.test.ts`: A03 (nessun `pending_state` serializzato) e A10 (stringa `results.at(-1)` assente) ora **verdi**; 0 expected-fail su tutto il backend |

## Verifica indipendente dei call path

- `run` è serializzato per allowlist (id/game/mode/status/date/turn/error/timestamps):
  qualsiasi colonna interna futura **non** finisce in HTTP per default.
- `lastCommittedResult` è associato per ID, nullificato a inizio batch e nei rami senza esito;
  distinzione conflitto-lock (409) vs no-event (`no_event_found`) tramite flag `executed`.

## Residui dichiarati (non bloccanti)

1. La **colonna** `pending_state` resta nello schema (`simulation_runs`): F03 la nasconde dal
   contratto HTTP, non la rimuove (serve al ripristino del playback §9.3; richiede ADR).
2. **A11** (parse/protocollo invalido → errore tecnico) è fuori perimetro F03; coperto dai
   contratti runtime F01 e dal percorso strict M06.

## Esito

Le due fughe dell'audit (spoiler del futuro via HTTP; esito per posizione) sono chiuse e
provare. **F03 CHIUSO.**
