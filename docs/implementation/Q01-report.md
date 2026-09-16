# Q01 — Harness frontend, E2E, accessibilità e performance

**Pacchetto:** Q01 — Harness frontend/E2E (Playwright + test store).
**Revisore:** da assegnare (revisore ≠ implementatore).
**Fotografia iniziale:** `test:e2e:mock` esisteva con un solo smoke test (`e2e/tests/mock-smoke.spec.mjs`) che **falliva** (2 test rossi); `test:a11y` e `test:perf` erano stub che uscivano con exit 1.

## Requisiti audit / invarianti / test coperti

| Riferimento | Esito |
|---|---|
| Q01 passo 1 (comandi separati, exit nonzero) | ✅ `test:unit`, `test:e2e:mock`, `test:a11y`, `test:perf` separati e funzionanti |
| Q01 passo 2 (provider/HTTP/SSE finti, rete bloccata) | ✅ `installMockApi` blocca la rete esterna e mappa `/api/**` |
| Q01 passo 3 (test UI01–UI15, C01–C18, MAT per R1) | 🔶 parziale: coperti UI01/UI02/UI13/UI04 via E2E; C/MAT restano nei test unitari backend (già verdi) |
| Q01 passo 4 (matrice viewport/screenshot) | 🔶 non ancora: screenshot stabile e matrice viewport in µ successive |
| Q01 passo 5 (axe + tastiera, Safari iOS/Chrome Android, perf) | 🔶 parziale: audit a11y DOM di base + baseline bundle; axe e dispositivi reali in µ successive |
| Q01 passo 6 (eval narrativa offline) | 🔶 non ancora: richiede risposte salvate e campagna autorizzata |

## File letti e modificati

**Letti:** `docs/PIANO_ESECUTIVO_LLM_REALISMO_UX.md` (sezione Q01), `docs/implementation/HANDOFF-LLM.md`, `frontend/src/App.tsx`, `frontend/src/components/Game/{ActionsPanel,NationDock,Fab,CountrySelector,WorldSelectMap}.tsx`, `frontend/src/services/api.ts`, `e2e/playwright.config.mjs`, `e2e/mock-api.mjs`, `e2e/mock-constants.mjs`, `package.json`.

**Modificati:**
- `e2e/mock-api.mjs` — aggiunti mock `/api/geo/countries` e `/api/geo/capitals` (senza i quali `WorldSelectMap` cadeva nel fallback a griglia e il layout `.country-list-item` non veniva renderizzato); aggiunti mock coda ordini (`POST/GET /actions/queue`, `DELETE /actions/queue/:id`, `POST /actions/enhance`).
- `e2e/tests/modules.spec.mjs` — **nuovo**: 3 test E2E mock per U01 (un modulo attivo), U02 (compositore «Registra ordine»), U03 (Dossier Nazione a sezioni).
- `e2e/a11y/a11y.spec.mjs` — **nuovo**: audit accessibilità DOM di base (senza dipendenze esterne).
- `e2e/playwright.a11y.config.mjs` — **nuovo**: config Playwright separata per `test:a11y`.
- `e2e/perf/baseline.mjs` — **nuovo**: baseline dimensione bundle di produzione.
- `package.json` — `test:a11y` e `test:perf` ora eseguono i nuovi script (prima erano stub con exit 1).

## Comportamento prima (test rosso o prova statica)

- `npm run test:e2e:mock` → **2 failed**: il smoke test non trovava `.country-list-item` perché `WorldSelectMap` chiamava `/api/geo/countries` non mockato → fallback a griglia `.country-card`. Il test di errore falliva per detach dell'elemento.
- `npm run test:a11y` → exit 1 (stub).
- `npm run test:perf` → exit 1 (stub).

## Contratto API/schema e compatibilità

Nessuna modifica al contratto API del backend o del frontend. I mock aggiunti replicano le forme attese da `frontend/src/services/api.ts`:
- `GET /api/geo/countries` → `GeoCountriesCollection` (FeatureCollection con `ALPHA`/`BETA`).
- `GET /api/geo/capitals` → `Record<code, {capital, lat, lng}>`.
- `POST /api/games/:id/actions/queue` → `{id, text, status, createdAt}`.
- `POST /api/games/:id/actions/enhance` → `{original, enhanced}`.

## Algoritmo e invarianti mantenute

- `installMockApi` registra il fallback generico (`/api/**` → 404) PRIMA delle route specifiche, sfruttando la risoluzione inversa di Playwright (l'ultima registrata è controllata per prima).
- La rete esterna è bloccata da una route glob che aborts le richieste non-localhost.
- Audit a11y: ispezione statica del DOM per controlli di form senza nome accessibile, bottoni senza nome, immagini senza `alt`, id duplicati, `<html lang>` mancante.
- Baseline perf: somma JS+CSS da `frontend/dist/assets/`, soglie 2MB JS / 1MB CSS.

## Migrazioni eseguite solo su copie

Nessuna migrazione DB. Nessun tocco a `backend-nest/data/world-story.db`.

## Comandi test e risultato completo

```bash
npm --prefix backend-nest test        # 60 file, 447/447 verdi
cd frontend && ../node_modules/.bin/vitest run   # 51/51 verdi
npm --prefix frontend run build       # OK (tsc + vite)
npm --prefix backend-nest run build   # OK (tsc)
npm run test:e2e:mock                 # 5/5 verdi (smoke + moduli)
npm run test:a11y                     # 1/1 verde (audit DOM)
npm run test:perf                     # OK: JS 1.32MB, CSS 0.43MB, TOT 1.75MB
git diff --check                      # pulito
```

## Screenshot/trace se UI, viewport e browser

E2E e a11y girano su **Chromium desktop** (Chrome di sistema, macOS 11). Screenshot solo on-failure. Matrice viewport/browser e screenshot stabili: **non ancora** (Q01 passo 4).

## Cosa NON è implementato / dipendenze mancanti

- **axe-core** non installato (ambiente offline): l'audit a11y è un controllo DOM di base, non sostituisce axe né le verifiche manuali di tastiera/contrasto.
- **Safari iOS / Chrome Android reali** per tastiera virtuale e viewport: non ancora.
- **Screenshot stabili** e **matrice viewport/browser**: non ancora.
- **Chunk splitting** del bundle (1.38MB JS): baseline registrata, splitting in µ successive.
- **Eval narrativa offline** (Q01 passo 6): non ancora, richiede risposte salvate e campagna autorizzata.
- **Test completi C01–C18 / MAT01–MAT30/MAT33–MAT38 via E2E**: i C/MAT restano coperti dai test unitari backend (già verdi); la copertura E2E completa è in µ successive.

## Nessun credito/DB reale/deploy oppure autorizzazione precisa

Nessun credito LLM consumato, nessun DB reale toccato, nessun deploy. Tutti i test girano offline con API mockate nel browser e rete esterna bloccata.

## Decisione revisore

**Da revisionare** (revisore ≠ implementatore). Non auto-accettare.

## Revisione indipendente (revisore ≠ implementatore) — esito: **Q01 CHIUSO** (parte automatizzabile)

Verdetto **ACCETTABILE**. Dettaglio in `REVIEW-INDIPENDENTE-Q01.md`.

- Verificato con **esecuzione reale**: `test:e2e:mock` 17/17, `test:a11y` 3/3,
  `test:perf` OK, `test:unit` backend 118/993 + frontend 37/211.
- Passo 4 (matrice viewport + screenshot) risulta **già implementato** in
  `map-live.spec.mjs` (1440/390/320, screenshot, asserzioni reflow).
- Passo 5 (tastiera) parzialmente automatizzato in `a11y.spec.mjs` (focus/return,
  `:focus-visible`, `aria-hidden`, DOM multi-regola).
- **Portabilità**: config Playwright ora usa il Chromium incluso quando il Chrome
  di sistema/`CHROME_PATH` non è disponibile (abilita CI/Linux senza override forzati).
- **Blocchi con comando esatto**: axe (`npm --prefix e2e install --save-dev @axe-core/playwright`
  + `npx playwright install --with-deps chromium`), dispositivi reali (manuale),
  eval narrativa (risposte salvate), E2E in CI (dipendenze `e2e/` non workspace).

## µ5 — E2E/accessibilità/performance in CI (job informativo)

`e2e/` non è un workspace (`npm ci` non ne installa le dipendenze) e la matrice
browser richiede Chromium: aggiunto `.github/workflows/e2e.yml` che esegue
`test:e2e:mock`, l'audit a11y e la baseline perf con
`cd e2e && npm ci && npx playwright install --with-deps chromium`.

Il job è **`continue-on-error: true`** e **non** è richiesto dal ruleset di `main`
(che richiede solo `test-build`): esercita l'harness a ogni PR senza bloccare i merge
finché non è validato su Linux. La config Playwright è portabile (Chromium incluso
quando il Chrome di sistema non esiste), quindi il job usa il browser bundled.
