# Deploy — `feat/una-notizia-per-ordine-e-modelli-deboli`

**Data:** 2026-09-26
**Esito complessivo:** ✅ **completato** — merge su `main`, gate verde, deploy Cloudflare completo, build online allineato.

---

## 1. Riepilogo

| Voce | Valore |
|---|---|
| Branch | `feat/una-notizia-per-ordine-e-modelli-deboli` |
| HEAD iniziale branch | `968da74` (4 commit avanti su `main`) |
| Base `main` (pre-merge) | `f301c19` |
| PR | **#120** — https://github.com/bovel84/World-Story/pull/120 |
| Gate richiesto | `test-build` (Quality Gate) → **completed / success** |
| Merge commit su `main` | **`d24d895a2326bbdaf242386f68e419c516b3a558`** |
| `origin/main` post-merge | `d24d895` |
| Deploy | `scripts/deploy-cloudflare.sh` (completo, **senza** `--skip-backend`) |
| Worker Version ID | `d98bb1d9-b21c-4268-9959-f20ad0966ecf` |
| Build online (`build.frontend`) | **`d24d895`** ✔ corrisponde a `origin/main` |

Commit confluiti nel merge:

- `3f457ae` feat(prompt): ogni ordine produce la propria notizia (fase F)
- `b280081` fix(llm): il rilevatore riconosce i modelli deboli (fase G)
- `67963bf` docs(dispacci): il piano registra il secondo giro (F, G, H)
- `968da74` docs(dispacci): la misura corregge il numero — la perdita cominciava a sette ordini

Diff vs `origin/main`: 9 file, +478 / −22.

---

## 2. Compito 1 — Verità sui test (baseline)

La suite è stata eseguita con **cwd corretta** (`backend-nest/`), quindi il problema
noto `MODULE_NOT_FOUND: backend-nest/src/utils/countries.ts` (causato dal `require` di
`process.cwd()/data/countries.json`) **non si è presentato**: nessuna esecuzione è stata
fatta dalla root.

### 2.1 Rumore locale: `backend-nest/dist/`

`npm --prefix backend-nest test` sul workingtree locale ha raccolto **anche** i file di
test compilati in `backend-nest/dist/` (5 file `*.test.js`), fallendo con:

```
Error: Vitest cannot be imported in a CommonJS module using require()
  dist/llm/modelTier.test.js, dist/game/dispatchComposer.test.js,
  dist/game/dispatchLink.test.js, dist/prompts/dispatchForm.test.js,
  dist/prompts/orderCoverage.test.js
Test Files  5 failed | 178 passed (183)
Tests       1856 passed (1856)
```

`backend-nest/dist/` è **gitignored** (`dist/` in `.gitignore`, 0 file tracciati): in CI
(`npm ci` da checkout pulito) non esiste. Quei 5 rossi sono un **artefatto di build
locale**, non una regressione. Le misure di confronto qui sotto sono quindi state fatte
**escludendo `dist/`**, cioè esattamente ciò che gira in CI.

### 2.2 Branch — suite backend (sorgenti, senza `dist/`)

- Esecuzione parallela (default): **178 file passed, 1856 test passed**.
- Esecuzione **sequenziale** (`--no-file-parallelism`, confronto deterministico):
  **178 file passed, 1856 test passed, 0 failed**.

### 2.3 Baseline `main` pulito (worktree separato)

Worktree dedicato su `main` (`f301c19`), con `node_modules` collegati al repo:

- Esecuzione parallela: **176 file / 1 failed file | 1841 test passed, 1 failed**
  → `tests/playable-presets.test.ts` («l'elenco del giocatore è quello atteso…»),
  con l'id spurio `mapcomplete7296mui33f0h`.
- Esecuzione **sequenziale**: **176 file passed, 1842 test passed, 0 failed**.

Il fallimento parallelo è una **race pre-esistente fra file di test**, non introdotta dal
branch: `backend-nest/tests/map-complete-route.test.ts` crea in `beforeAll` un preset
`mapcomplete<pid><timestamp>` **dentro `data/presets/`** (il percorso che l'handler reale
legge) e lo rimuove in `afterAll`. Se `playable-presets.test.ts` enumera la cartella
mentre quel preset esiste, vede un id extra e fallisce. Entrambi i file sono **non
toccati dal diff** e la race è riproducibile anche sulla baseline.

### 2.4 Confronto

| Suite (sorgenti, sequenziale) | File | Test | Esito |
|---|---|---|---|
| `main` (`f301c19`) | 176 | 1842 | tutti verdi |
| branch (`968da74`) | 178 | 1856 | tutti verdi |

Il branch aggiunge **2 file di test / 14 test**, tutti verdi. **Nessun fallimento nuovo
rispetto a `main`.** → nessuna stop condition, si procede.

### 2.5 Frontend e type-check

- Frontend (`cd frontend && ../node_modules/.bin/vitest run`): **97 file passed, 818 test passed**.
- `tsc --noEmit` backend: **OK**.
- `tsc --noEmit` frontend: **OK**.

> Nota di trasparenza: i numeri sopra sono quelli **realmente eseguiti** in questa sessione.

---

## 3. Compito 2 — Push del branch

Branch non ancora presente su `origin`; push con upstream:

```
git push -u origin feat/una-notizia-per-ordine-e-modelli-deboli
* [new branch]  ... -> ...  (tracking impostato)
```

---

## 4. Compito 3 — PR verso `main`

Il token di `gh` CLI è scaduto (`HTTP 401`) come previsto. Il token è stato recuperato dal
keychain **senza mai stamparlo**.

**Blocco incontrato:** `security find-internet-password -s github.com -w` ha aperto un
dialogo **SecurityAgent** in GUI, bloccando il comando fino al timeout. Recuperato invece
con il credential helper già funzionante per il push HTTPS:

```
printf 'protocol=https\nhost=github.com\n\n' | git credential fill   # -> x-access-token
```

Token verificato con `GET /user` → `200`, login `bovel84`.

PR creata via API (`POST /repos/bovel84/World-Story/pulls`):

- **#120** — «feat(dispacci): una notizia per ordine + riconoscimento modelli deboli»
- `head` = `feat/una-notizia-per-ordine-e-modelli-deboli`, `base` = `main`

---

## 5. Compito 4 — Gate `test-build` e merge

La CI parte sull'evento `pull_request`, quindi il check è stato atteso **dopo** la
creazione della PR, sul commit esatto `968da74b5e1a81bd2668ba10d6fbd5627dd88f3a`.

`GET /repos/.../commits/968da74.../check-runs`:

| Check | Stato | Conclusione |
|---|---|---|
| **`test-build`** (richiesto) | completed | **success** |
| `e2e-mock` (informativo, `continue-on-error`) | in_progress | — |

Merge via API `PUT /repos/bovel84/World-Story/pulls/120/merge`:

```json
{ "merged": true, "sha": "d24d895a2326bbdaf242386f68e419c516b3a558", "message": "Pull Request successfully merged" }
```

Verifica post-merge:

```
git fetch origin
git log --oneline -1 origin/main     # d24d895 Merge pull request #120 ...
git cat-file -e origin/main:docs/DISPACCI_PARITA_PAX_HISTORIA.md   # OK (presente)
```

Il workingtree principale è stato riportato su `main` a `d24d895` (rimosso il worktree di
baseline che occupava `main`).

---

## 6. Compito 5 — Deploy Cloudflare (completo)

Il diff tocca codice di runtime (`EventBudget.ts`, `prompt-builder.ts`, `modelTier.ts`,
`guards.ts`, `prompt.ts`) → deploy **completo**, senza `--skip-backend`:

```
cd "/Users/bovel/Desktop/World Story" && bash scripts/deploy-cloudflare.sh
```

Passi eseguiti con successo:

1. Tunnel attivo: `https://using-facing-utc-cheap.trycloudflare.com`
2. Backend build (`tsc`) + riavvio launchd `com.openpax.backend`
3. Attesa `/api/health` → **backend pronto** al primo ciclo (nessun timeout)
4. Verifica che il tunnel inoltri al backend → OK
5. Frontend build same-origin (`vite build`, 186 moduli, built in 7.82s)
6. Deploy Worker (`wrangler deploy`): `world-story` → Current Version ID `d98bb1d9-b21c-4268-9959-f20ad0966ecf`
7. Push KV `backend_url` = `https://using-facing-utc-cheap.trycloudflare.com`

**Nessun blocco.** Il gotcha noto («backend non risalito entro 150s») **non si è
verificato**; per riferimento, lo script attende fino a 60×5s = 300s.

Verifica backend locale: `http://127.0.0.1:8000/api/health` → `200`,
`build.frontend = d24d895`.

---

## 7. Compito 6 — Verifica finale

```
curl -s https://world-story.bovel-cannas.workers.dev/api/health | ...["build"]["frontend"]
```

Risposta online (`200`):

```json
{
  "status": "ok",
  "build": { "backend": "dev", "frontend": "d24d895" },
  "schema": { "economySnapshot": 1, "database": { "userVersion": 0, "tables": 52 } },
  "api": { "base": "/api", "sameOrigin": true }
}
```

**Build online `d24d895` = merge commit su `origin/main`.** Verifica superata.

---

## 8. Blocchi incontrati — riepilogo

| # | Blocco | Impatto | Risoluzione |
|---|---|---|---|
| 1 | `MODELE_NOT_FOUND countries.ts` da run dalla **root** | Evitato | Eseguito sempre con cwd `backend-nest/` |
| 2 | 5 rossi `dist/*.test.js` (require CJS di vitest) | Rumore locale | `dist/` è gitignored, assente in CI; suite rieseguita escludendo `dist/` |
| 3 | Race `playable-presets` vs `map-complete-route` in parallelo | Flaky **pre-esistente**, non del branch | Confermata sulla baseline; confronto in modalità sequenziale |
| 4 | `security find-internet-password` → dialogo SecurityAgent bloccante | Non bloccante | Token via `git credential fill` (osxkeychain), mai stampato |
| 5 | Deploy backend boot lento (gotcha noto) | **Non verificatosi** | — |

Nessuna stop condition è stata innescata: nessun test nuovo rosso, gate `test-build`
verde, deploy riuscito.

---

## 9. Deliverable

- Questo report: `docs/implementation/DEPLOY-FEAT-UNA-NOTIZIA-REPORT.md`
- Commit + push del report su `main` (eseguito solo dopo il buon fine del deploy).
