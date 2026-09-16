# Report finale — chiusura roadmap (2026-09-16)

Tutti i pacchetti del piano esecutivo sono chiusi per le parti realizzabili; verbali di
revisione indipendente presenti per **ogni** pacchetto; roadmap aggiornate; Quality Gate verde.

## Pacchetti chiusi

| Pacchetto | Esito | Revisione indipendente |
|---|---|---|
| **F00** Baseline e regressioni | ✅ CHIUSO | `REVIEW-INDIPENDENTE-F00.md` |
| **F01** ID e contratti end-to-end | ✅ CHIUSO | `REVIEW-INDIPENDENTE-F01.md` |
| **F02** Checkpoint/revisioni/rami/outbox | ✅ CHIUSO | `REVIEW-INDIPENDENTE-F02.md` |
| **F03** Contratto pubblico run | ✅ CHIUSO | `REVIEW-INDIPENDENTE-F03.md` |
| **F04** Save/Load/Rewind e chat | ✅ CHIUSO | `REVIEW-INDIPENDENTE-F04.md` (difetto M-1 corretto) |
| **F05** Job asincroni/lease/recovery | ✅ CHIUSO | `REVIEW-INDIPENDENTE-F05.md` |
| **F06** Unico stato client | ✅ CHIUSO | `REVIEW-INDIPENDENTE-F06.md` (difetto M-1 corretto) |
| **M06** Collegamento al simulatore | ✅ CHIUSO | `REVIEW-INDIPENDENTE-M06-CHIUSURA.md` (5 revisioni) |
| **M07** Delega/servizi/politiche (R2) | ✅ CHIUSO (esecuzione manutenzione bloccata) | `REVIEW-INDIPENDENTE-M07.md` + µ2/µ3/µ4a–µ4g; obblighi di manutenzione **proiettati** (read-only) e mostrati nel dossier |
| **U01** Shell + migrazione CSS | ✅ CHIUSO | `REVIEW-INDIPENDENTE-U01.md` |
| **U02** Ordini guidati + catena fattibilità | ✅ CHIUSO (passo 3 bloccato) | `REVIEW-INDIPENDENTE-U02.md` |
| **U03** Dossier/chat/lettore | ✅ CHIUSO | `REVIEW-INDIPENDENTE-U03.md` |
| **Q01** Harness frontend/E2E | ✅ CHIUSO (axe/dispositivi/eval bloccati) | `REVIEW-INDIPENDENTE-Q01.md` |
| **Q02** Compatibilità/sicurezza/rilascio | ✅ CHIUSO (parte automatizzabile) | `Q02-report.md` + `REVIEW-INDIPENDENTE-Q02.md` |

## Consegne via PR (main protetto, gate `test-build` verde)

| PR | Contenuto | Commit merge |
|---|---|---|
| #7 | U02 passo 2 — catena della fattibilità | `ad38628` |
| #8 | U01 — guardia CSS + revisione | `a05e7ac` |
| #9 | Q01 — config Playwright portabile + revisione | `d4671d4` |
| #10 | Verbali U02/U03/M06/M07 + roadmap + report | `9d79338` |
| #11 | Verbali F00/F01/F03 | `c89c26e` |
| #12 | Q01 — workflow E2E/a11y/perf in CI | `9453568` |
| #13 | Raffinamento blocchi U02/M07 + report finale | `4a1fddf` |
| #14 | M07 — proiezione obblighi di manutenzione (read-only) + wiring dossier | `97c2e48` |
| #15 | Q02 — guardia single-owner, inventario endpoint, health/version, script fail-closed | (questo) |

Precedenti: PR #1–#6 (blocco 2, revisioni M07 µ4g e F04/F05/F06).

## Stato del Quality Gate

- Backend: **124 file / 1033 test** verdi; `tsc` pulito; build OK.
- Frontend: **39 file / 220 test** verdi; `tsc` pulito; build OK.
- E2E mock **17/17**; a11y **3/3**; perf **OK** (JS 1.47 MB, CSS 0.54 MB).
- CI: `test-build` (richiesto dal ruleset) **verde**; nuovo job **`e2e-mock`** (E2E + a11y +
  perf) **verde su Linux** — informativo e non richiesto dal ruleset.

## Cosa resta (blocchi reali, con sblocco richiesto)

1. **M07 esecuzione manutenzione** — gli obblighi dichiarati e i deficit di scorta sono ora
   **proiettati e visibili** nel dossier (dati autorevoli del catalogo + ledger, nessuna
   mutazione). Per *eseguire* la manutenzione serve un runtime impianti (stato operativo
   mutabile + scadenzario): decisione di prodotto/catalogo. Vedi `M07-report.md`.
2. **U02 passo 3 (batch/priorità)** — la ricerca aggiornata conferma: i **pool materiali**
   esistono (`reconstructOwnedStock`), ma **fondi** (nessun accessor al tesoro, nessuna
   conversione mld↔minorUnits) e **manodopera per-intent** (nessuna domanda) sono assenti.
   Un batch solo-materiali sarebbe fuorviante → non implementato. Vedi `U02-report.md`.
3. **Q01 axe / dispositivi reali / eval narrativa** — `@axe-core/playwright` (rete),
   hardware reale, risposte LLM salvate + budget.
4. **Q02 rilascio pubblico / smoke LLM reale** — implementati e documentati, ma **non eseguiti**:
   servono autorizzazione esplicita e budget. `node scripts/release.js --plan-only` è sicuro ora.

Nessun difetto bloccante aperto nei pacchetti consegnati.
