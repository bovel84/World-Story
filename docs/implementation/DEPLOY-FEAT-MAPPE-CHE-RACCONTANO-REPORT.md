# Deploy — `feat/ws-mappe-che-raccontano` (MAP01–MAP11)

**Data:** 2026-10-10
**Esito complessivo:** ✅ **completato** — gate verde dopo una correzione, merge su `main`, deploy Cloudflare completo, build online allineato.

---

## 1. Riepilogo

| Voce | Valore |
|---|---|
| Branch | `feat/ws-mappe-che-raccontano` |
| HEAD iniziale branch | `5fc2be5` (1 commit avanti su `main`) |
| Base `main` (pre-merge) | `9d774bf` |
| PR | **#252** — https://github.com/bovel84/World-Story/pull/252 |
| Gate richiesto | `test-build` (Quality Gate) → **completed / success** (dopo fix) |
| Fix in corsa | `758bef2` fix(government): la grandezza nel prompt non porta cifre proprie (MAP05) |
| Merge commit su `main` | **`0c7ae5e25ec3fb228c28ff73d0d5390f43179226`** (squash) |
| `origin/main` post-merge | `0c7ae5e` |
| Deploy | `scripts/deploy-cloudflare.sh` (completo, **senza** `--skip-backend`) |
| Worker Version ID | `38ad43d1-be4c-413d-9d16-59484af3bf3c` |
| Tunnel | `https://wanting-audience-heritage-seat.trycloudflare.com` |
| Build online (`build.frontend`) | **`0c7ae5e`** ✔ corrisponde a `origin/main` |

---

## 2. Gate: primo tentativo rosso, causa e correzione

Il primo run del gate `test-build` sul commit `5fc2be5` è **fallito** (2 test rossi):

```
tests/ws-minister-ux-03.test.ts:58  AssertionError: expected ' (la tavola…' not to match /\d/
tests/ws-minister-ux-04.test.ts:44  AssertionError: expected ' (la tavola…' not to match /\d/
Test Files  2 failed | 279 passed (281)
Tests       2 failed | 3303 passed (3305)
```

**Causa.** Il ramo aggiungeva al `MINISTER_DIALOGUE_PROTOCOL` una riga di lezione su `metric`
prefissata dal tag di fase **«MAP05»**. Il contratto storico (`ws-minister-ux-03/04`) vieta
qualsiasi cifra nella sezione `PRESENTAZIONE` del briefing — la presentazione è una *scelta*,
non un dato — e `/\d/` colpiva il tag `MAP05`. La riga nuova e i test nuovi
(`advisor-map-directive.test.ts`) si contraddicevano a vicenda.

**Correzione (`758bef2`).** Il marcatore diventa **«GRANDEZZA precisa»**, senza cifre, in
`MinisterDialogueRules.ts` e `CouncilIssue.ts`; l'asserto del test nuovo viene puntato sullo
stesso marcatore. La lezione su `metric` (`pil`, `popolazione`, `difesa`) e i divieti
(«mai una cifra», «non indovinare gli id») restano intatti.

Verifica locale sui 3 file coinvolti: **3 file, 27 test, 0 fallimenti**; `tsc --noEmit` pulito.

---

## 3. Gate: secondo tentativo verde

Run sul commit `758bef2`:

| Check | Stato | Conclusione |
|---|---|---|
| **`test-build`** (richiesto) | completed | **success** |
| `e2e-mock` (informativo) | in_progress al momento del merge | — |

Merge via `gh pr merge 252 --squash`:

```
mergeCommit.oid = 0c7ae5e25ec3fb228c28ff73d0d5390f43179226
mergedAt        = 2026-10-10T12:56:35Z
```

Storia post-merge verificata: `0c7ae5e` ha un solo genitore (`9d774bf`) → squash, coerente
con la convenzione recente di `main`.

---

## 4. Deploy Cloudflare (completo)

Il diff tocca runtime di backend (`CouncilIssue.ts`, `MinisterDialogueRules.ts`) e frontend
→ deploy **completo**, senza `--skip-backend`:

```
cd "/Users/bovel/Desktop/World Story" && git checkout main && git pull --ff-only
bash scripts/deploy-cloudflare.sh
```

Passi riusciti:

1. Tunnel attivo: `https://wanting-audience-heritage-seat.trycloudflare.com`
2. Build backend (`tsc`) + riavvio launchd `com.openpax.backend`
3. `/api/health` locale pronto
4. Tunnel verificato in inoltro al backend
5. Build frontend same-origin (`vite build`, 247 moduli, 9.79s)
6. Deploy Worker `world-story` → Current Version ID `38ad43d1-be4c-413d-9d16-59484af3bf3c`
7. Push KV `backend_url` = il tunnel corrente

Nessun blocco: backend risalito al primo ciclo, nessun timeout.

---

## 5. Verifica finale

```
curl -s https://world-story.bovel-cannas.workers.dev/api/health
```

Risposta online (`200`):

```json
{
  "status": "ok",
  "build": { "backend": "dev", "frontend": "0c7ae5e" },
  "schema": { "economySnapshot": 1, "database": { "userVersion": 0, "tables": 58 } },
  "api": { "base": "/api", "sameOrigin": true }
}
```

Backend locale: `http://127.0.0.1:8000/api/health` → `200`, `build.frontend = 0c7ae5e`.

**Build online `0c7ae5e` = merge commit su `origin/main`.** Verifica superata.

---

## 6. Blocchi incontrati

| # | Blocco | Impatto | Risoluzione |
|---|---|---|---|
| 1 | Gate rosso: cifre (`MAP05`) nella sezione PRESENTAZIONE del briefing ministri | Merge bloccato | Tag di fase reso senza cifre (`758bef2`), test nuovo riallineato |

Nessun'altra stop condition: gate verde al secondo run, deploy riuscito, build online allineato.

---

## 7. Note per il seguito

- Il workingtree principale è su `main` a `0c7ae5e`.
- Resta **non tracciato** `backend-nest/data/presets/cold_war_1951/` (preset locale, fuori dal
  diff di questo ramo): non è stato incluso nel merge. Va eventualmente gestito a parte.
