# World Story — Roadmap e stato

**Aggiornato:** 2026-09-16 (chiusura pacchetti residui: M06/M07/U01/U02/U03/Q01 e revisioni indipendenti).

> Fonte operativa: [PIANO_ESECUTIVO_LLM_REALISMO_UX.md](PIANO_ESECUTIVO_LLM_REALISMO_UX.md).
> Verbali e report in [`docs/implementation/`](implementation/). Ogni pacchetto è consegnato
> su `main` protetto via PR con Quality Gate (`test-build`) verde.

## Pacchetti del piano esecutivo

### Fondamentali F00–F06

| Pacchetto | Stato | Revisione indipendente |
|---|---|---|
| F00 Baseline affidabile e regressioni | ✅ fatto | ⬜ da produrre (non bloccante) |
| F01 ID e contratti end-to-end | ✅ fatto | ⬜ da produrre (non bloccante) |
| F02 Checkpoint atomici, revisioni, rami, outbox | ✅ fatto | ✅ `REVIEW-INDIPENDENTE-F02.md` |
| F03 Contratto pubblico run, no esiti per posizione | ✅ fatto | ⬜ da produrre (non bloccante) |
| F04 Save/Load/Rewind e chat sicuri per ramo | ✅ fatto | ✅ `REVIEW-INDIPENDENTE-F04.md` (difetto M-1 corretto) |
| F05 Job asincroni, lease e recovery post-crash | ✅ fatto | ✅ `REVIEW-INDIPENDENTE-F05.md` |
| F06 Unico stato client, reset ramo, riconciliazione | ✅ fatto | ✅ `REVIEW-INDIPENDENTE-F06.md` (difetto M-1 corretto) |

### Realismo materiale M01–M07

| Pacchetto | Stato | Note |
|---|---|---|
| M01 Cataloghi, preset, qualità dati | ✅ fatto | |
| M02 Quantità, ledger append-only, prenotazioni | ✅ fatto | |
| M03 Interpretazione controllata + preflight lotto | ✅ fatto | |
| M04 Produzione, energia, logistica | ✅ fatto | |
| M05 Progetti a fasi, tecnologia, personale | ✅ fatto | |
| M06 Collegamento al simulatore | ✅ fatto | **CHIUSO** — 5 revisioni; `REVIEW-INDIPENDENTE-M06-CHIUSURA.md` |
| M07 Delega, servizi, politiche nazionali (R2) | ✅ fatto (con 1 sotto-passaggio bloccato) | **CHIUSO** — `REVIEW-INDIPENDENTE-M07.md`; «priorità manutenzione/servizi» bloccato (manca il runtime impianti) |

### Grafica/accessibilità e harness

| Pacchetto | Stato | Note |
|---|---|---|
| U01 Shell operativa + migrazione CSS | ✅ fatto (parte di codice) | **CHIUSO** — `REVIEW-INDIPENDENTE-U01.md`; guardia `cssDiscipline.test.ts`; screenshot/tastiera reali → Q01 |
| U02 Ordini guidati e catena fattibilità | ✅ fatto (parti realizzabili) | **CHIUSO** — `REVIEW-INDIPENDENTE-U02.md`; catena dati/deficit/fonti + alternative; passo 3 (batch) bloccato |
| U03 Dossier Nazione, chat/accordi, lettore | ✅ fatto (parti realizzabili) | **CHIUSO** — `REVIEW-INDIPENDENTE-U03.md`; residui dati/dispositivi dichiarati |
| Q01 Harness frontend/E2E, a11y, perf | ✅ fatto (parte automatizzabile) | **CHIUSO** — `REVIEW-INDIPENDENTE-Q01.md`; config Playwright portabile; axe/dispositivi/eval narrativa bloccati |
| Q02 Compatibilità, sicurezza, rilascio | ⬜ non avviato | Dipende da GATE-3 |

## Verifiche di qualità (stato reale, 2026-09-16)

- Backend: **118 file / 993 test** verdi; `tsc` pulito.
- Frontend: **37 file / 211 test** verdi; `tsc` pulito; `npm run build` verde.
- E2E mock: **17/17**; a11y: **3/3**; perf: **OK** (JS 1.47 MB, CSS 0.54 MB; soglie 2 MB / 1 MB).
- `git diff --check` pulito; Quality Gate `test-build` verde su `main`.

## Blocchi reali (con comando/decisione richiesta)

1. **M07 «priorità manutenzione/servizi»** — manca il runtime impianti (stato operativo,
   scadenzario, personale): serve una decisione di prodotto/catalogo. Vedi `REVIEW-INDIPENDENTE-M07.md`.
2. **U02 passo 3 (conflitti batch/priorità)** — servono accessor ai pool materiali mutabili,
   conversione canonica mld↔minorUnits e fonte della domanda di manodopera. Vedi `U02-report.md`.
3. **Q01 axe** — `npm --prefix e2e install --save-dev @axe-core/playwright && npx playwright install --with-deps chromium` (rete).
4. **Q01 dispositivi reali / eval narrativa** — hardware e risposte LLM salvate + budget.
5. **Q01 E2E in CI** — `e2e/` non è un workspace: servono le sue dipendenze + `npx playwright install --with-deps chromium`.

## Prossimi passi

1. **Q02** — compatibilità, sicurezza, rilascio coordinato (GATE-3).
2. **Chunk splitting** del bundle (baseline registrata).
3. Revisioni indipendenti residue F00/F01/F03 (non bloccanti, già coperte da test).
