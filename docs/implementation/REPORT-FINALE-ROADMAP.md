# Report finale — chiusura roadmap residua (2026-09-16)

Pacchetti residui della roadmap chiusi, verbali di revisione indipendente prodotti,
roadmap aggiornate, Quality Gate verde.

## Pacchetti chiusi

| Pacchetto | Esito | Come |
|---|---|---|
| **M06** Collegamento al simulatore | ✅ CHIUSO | 5 revisioni indipendenti (l'ultima ACCETTABILE); consolidamento in `REVIEW-INDIPENDENTE-M06-CHIUSURA.md`. Nessun codice nuovo: già completo. |
| **M07** Delega/servizi/politiche (R2) | ✅ CHIUSO (1 sotto-passaggio bloccato) | µ1–µ4g verificati; `REVIEW-INDIPENDENTE-M07.md`. «Priorità manutenzione/servizi» bloccato: manca il runtime impianti (non si inventano dati). |
| **U01** Shell + migrazione CSS | ✅ CHIUSO (parte di codice) | Guardia ripetibile `src/styles/cssDiscipline.test.ts` (nessun `!important` nei moduli migrati, vendor non travasato); `REVIEW-INDIPENDENTE-U01.md`. |
| **U02** Ordini guidati + catena fattibilità | ✅ CHIUSO (parti realizzabili) | Nuova **catena dati/deficit/fonti** (`feasibilityChain.ts` + `FeasibilityChainPanel.tsx`) oltre ad alternative/dati mancanti; `REVIEW-INDIPENDENTE-U02.md`. Passo 3 (batch) bloccato. |
| **U03** Dossier/chat/lettore | ✅ CHIUSO (parti realizzabili) | Verifica di dossier (7+11 test), lettore checkpoint, «Perché è accaduto»/«Mostra sulla mappa»; `REVIEW-INDIPENDENTE-U03.md`. |
| **Q01** Harness frontend/E2E | ✅ CHIUSO (parte automatizzabile) | Matrice viewport/screenshot già presente; config Playwright resa **portabile** (CI/Linux); `REVIEW-INDIPENDENTE-Q01.md`. |

## Consegne via PR (main protetto, gate `test-build` verde)

| PR | Contenuto | Commit merge |
|---|---|---|
| #7 | U02 passo 2 — catena della fattibilità | `ad38628` |
| #8 | U01 — guardia CSS + revisione | `a05e7ac` |
| #9 | Q01 — config Playwright portabile + revisione | `d4671d4` |
| #10 | Verbali U02/U03/M06/M07 + roadmap + report | (questo) |

Precedenti nella stessa sessione: PR #1–#6 (blocco 2, revisioni M07 µ4g e F04/F05/F06).

## Cosa resta (e perché)

1. **M07 «priorità manutenzione/servizi»** — bloccato: il catalogo dichiara solo i *termini*
   di manutenzione; manca il runtime impianti (stato operativo, scadenzario, personale).
   Serve una decisione di prodotto/catalogo; cablarlo ora significherebbe inventare dati.
2. **U02 passo 3 (conflitti batch/priorità)** — bloccato: `allocateBatch` è codice morto
   (solo test) e mancano pool materiali mutabili, conversione mld↔minorUnits e domanda di
   manodopera per intent.
3. **Q01 axe / dispositivi reali / eval narrativa** — richiedono rete (`@axe-core/playwright`),
   hardware (Safari iOS/Chrome Android) e risposte LLM salvate + budget.
4. **Q01 E2E in CI** — `e2e/` non è un workspace; per il gate servono le sue dipendenze e
   `npx playwright install --with-deps chromium`. Non aggiunto al gate protetto per non
   introdurre flakiness Linux non verificabile in questo ambiente.
5. **Q02** Compatibilità/sicurezza/rilascio — non avviato (dipende da GATE-3).
6. **Revisioni F00/F01/F03** — non prodotte (non bloccanti: coperte da test); restano come
   miglioramento di processo.

## Quality Gate finale

- Backend: **118 file / 993 test** verdi; `tsc` pulito; build OK.
- Frontend: **37 file / 211 test** verdi; `tsc` pulito; build OK.
- E2E mock **17/17**; a11y **3/3**; perf **OK** (JS 1.47 MB, CSS 0.54 MB).
- `git diff --check` pulito; `main` protetto con check `test-build` verde.
