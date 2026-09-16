# Revisione indipendente — F00 (baseline affidabile e regressioni)

- **Revisore**: ≠ implementatore.
- **Oggetto**: fixture isolata + riproduzioni dei rilievi A01/A03/A05/A07/A10.
- **Metodo**: esecuzione reale + lettura dei test.
- **Esito**: **ACCETTABILE** — baseline F00 chiusa (le riproduzioni sono ora verdi, vedi F01/F03).

## Claim verificati

| Requisito F00 | Evidenza |
|---|---|
| Fixture su SQLite **temporanea**, mai il salvataggio reale | `integrity-regressions.test.ts`: `PRAGMA database_list` + `realpath` (alias macOS `/var`→`/private/var`); caso «usa esclusivamente una SQLite temporanea, mai il salvataggio reale» |
| Riproduzioni A01/A03/A05/A07/A10 | `integrity-regressions.test.ts` — **6 casi, tutti verdi**: A03/C03 (no `pending_state`), A05/C05 (coda conserva `processing`), A01/C01 (nessuna associazione per indice/testo), A07/C07 (chiusura per `projectId`, non titolo), A10/C10 (salto senza eventi non eredita la cronaca) |
| Nessuna riproduzione «expected-fail» residua | `grep -rn "it.fails\|it.skip\|it.todo" tests/` → **vuoto**; A03/A10 convertiti a verde da F03, A01/A05/A07 da F01 |

## Verifica dei residui dichiarati

- Le riproduzioni A03/A10 erano `it.fails` in F00; **F03 le ha corrette e convertite a verdi**
  (nessun expected-fail residuo). Le altre (A01/A05/A07) sono state corrette da F01.
- Le fixture dinamiche per A02/A04/A06/A08/A09/A11–A14 sono di F02–F06 (ora coperte dai
  rispettivi pacchetti e dalle revisioni F02/F04/F05/F06).

## Esito

La guardia di isolamento è ripetibile e le riproduzioni dei cinque rilievi della baseline
sono verdi (corrette a valle). **F00 CHIUSO.**
