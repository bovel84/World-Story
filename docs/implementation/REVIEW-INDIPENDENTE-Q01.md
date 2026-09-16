# Revisione indipendente — Q01 (harness frontend/E2E, accessibilità, performance)

- **Revisore**: ≠ implementatore.
- **Oggetto**: comandi `test:unit`/`test:e2e:mock`/`test:a11y`/`test:perf`,
  mock API browser-side, config Playwright, copertura E2E/UI, audit a11y, baseline perf.
- **Metodo**: esecuzione reale dei comandi + lettura dei test (non fiducia nel report).
- **Esito**: **ACCETTABILE** per l'harness; pacchetto chiuso con verifiche manuali e
  dipendenze esterne dichiarate come bloccate.

## Claim verificati (esecuzione reale)

| Passo Q01 | Esito | Evidenza |
|---|---|---|
| 1 — comandi separati, exit nonzero | ✅ | `test:unit` (backend 118 file/993 + frontend 37/211), `test:e2e:mock` (17/17), `test:a11y` (3/3), `test:perf` (OK) |
| 2 — provider/HTTP/SSE finti, rete bloccata | ✅ | `installMockApi` (route glob → abort per rete esterna; `/api/**` mappato) |
| 3 — UI01–UI15 via E2E, C/MAT nei unit backend | 🔶 parziale dichiarato | `mock-smoke`, `modules` (UI01/UI02/UI13/UI04), `map-live`; C01–C18/MAT restano negli unit backend verdi |
| 4 — matrice viewport e screenshot stabile | ✅ | `map-live.spec.mjs`: buchi `[1440, 390, 320]` con `setViewportSize`, attese DOM/map readiness, screenshot `/tmp/world-story-*`; asserzioni su `scrollWidth ≤ viewport` |
| 5 — a11y tastiera (automatico) | ✅ parziale | `a11y.spec.mjs` (3 casi): rail/desk da tastiera con `:focus-visible`, picker con focus iniziale + `aria-hidden` + `Escape` + ritorno focus, audit DOM multi-regola |
| 5 — axe + Safari iOS/Chrome Android reali | ⛔ bloccato | `axe-core`/`@axe-core/playwright` non installati (offline); nessun dispositivo reale |
| 6 — eval narrativa offline | ⛔ bloccato | servono risposte LLM salvate e campagna autorizzata |
| DoD — report separa automatico/manuale | ✅ | vedi «Blocchi» qui sotto |

**Portabilità (miglioramento di verificabilità):** `playwright.config.mjs` e
`playwright.a11y.config.mjs` ora impostano `executablePath` **solo** se esiste il
Chrome di sistema (o `CHROME_PATH`), altrimenti usano il Chromium incluso. Su
macOS il comportamento è invariato (a11y 3/3, e2e 17/17 verificati); su Linux/CI
il config è utilizzabile senza override forzati.

## Blocchi reali (con comando esatto)

1. **axe** (passo 5): `npm --prefix e2e install --save-dev @axe-core/playwright && npx playwright install --with-deps chromium` (richiede rete). Poi aggiungere un test axe nel progetto a11y. L'audit DOM attuale **non** sostituisce axe.
2. **Dispositivi reali** Safari iOS / Chrome Android (tastiera virtuale, viewport): manuale, richiede hardware; non automatizzabile in questo ambiente.
3. **Eval narrativa** (passo 6): richiede un set di risposte LLM salvate + budget approvato; criteri già definiti nel piano (nessun fatto contraddetto, niente successi gratuiti, zero future leak).
4. **E2E in CI**: il gate `test-build` esegue backend/vitest/build. Per aggiungere
   `test:e2e:mock` servono (a) le dipendenze `e2e/` (non è un workspace: `npm ci`
   non le installa) e (b) `npx playwright install --with-deps chromium`. Non è stato
   aggiunto al gate protetto per non introdurre flakiness Linux non verificabile qui.

## Osservazioni residue (non bloccanti)

- Baseline perf: JS 1.47 MB / CSS 0.54 MB (soglie 2 MB / 1 MB). Il **chunk splitting**
  è parziale (`MapboxMapView` separato); resta un miglioramento futuro.

## Esito

Harness verificato con esecuzione reale; i residui sono dipendenze esterne/manuali
dichiarate con il comando esatto. **Q01 CHIUSO** per la parte automatizzabile.
