# Q02 — Compatibilità, sicurezza e rilascio coordinato

**Stato:** ✅ **CHIUSO** (parte automatizzabile) — consegnato via PR con Quality Gate verde.
**Dipendenze:** GATE-3 soddisfatto (M06/U02/U03 chiusi, suite Q01 verde, nessun bypass materiale).
**Data:** 2026-09-16.
**Riferimenti:** `docs/PIANO_ESECUTIVO_LLM_REALISMO_UX.md` §Q02 e §7.

> Questo report distingue **prove automatiche** (eseguite in CI/locale) da **verifiche manuali non svolte**
> (rilascio pubblico, dispositivi reali, smoke con provider a pagamento), ciascuna con il comando o la
> decisione esatta richiesta. Nessun dato reale è stato modificato; nessun rilascio pubblico è stato eseguito.

---

## 1. Vecchi save copiati (passo 1)

**Implementato/provato**

| Proprietà richiesta | Prova | Esito |
|---|---|---|
| La migrazione gira su una **copia**; l'originale resta intatto | `tests/q02-legacy-migration.test.ts` — hash dell'originale invariato, `table_info(games)` senza `economy_mode` sull'originale | ✅ |
| Il legacy resta **leggibile** | stessa suite: `current_turn=7`, `[current_date]='1961-05-04'` conservati; `polity_id` ricostruito da `world_regions.flag` | ✅ |
| **Conversione mai implicita** | `gameRepository.getEconomyMode('g1') === 'legacy'`, `economy_model_version` resta `NULL`; `scenario-catalog.test.ts` «dichiarato legacy con warning, mai migrato silenziosamente» | ✅ |
| **Catalog hash coerente** | `scenario-catalog.test.ts` «ogni file di catalogo ha un hash di contenuto»; `catalogHash`/`catalogFingerprint` deterministici | ✅ |
| Migrazioni **ripetibili** | `initDatabase()` eseguito 3 volte sulla copia: nessun errore, dati invariati | ✅ |
| **Abort/rollback su copia** | `economy-snapshot.test.ts` (M07 µ4b): restore invalido è atomico e non svuota il ramo target; rollback = ripristino dell'originale intatto (nuovo test) | ✅ |

**Gotcha documentato e coperto:** `SELECT current_date` non bracketato restituisce la parola chiave SQLite
(la data odierna) e non la colonna. I test Q02 usano `[current_date]`; il difetto è già annotato in
`saves.routes.ts`. Un test lo avrebbe mascherato: ora è esplicito.

Nessun dato reale è stato toccato: le prove usano DB temporanei in `os.tmpdir()` e copie locali.

## 2. Inventario endpoint mutanti, ownership e budget LLM (passo 2)

**Decisione: protezione *single-owner*** prima di qualunque esposizione ampliata. World Story non ha
multiutenza; l'esposizione attuale avviene via quick tunnel/Worker. La protezione è **opt-in** e
retrocompatibile:

- `WORLD_STORY_OWNER_TOKEN` non configurato → modalità `open-single-user`: comportamento **invariato**
  (sviluppo, test, uso locale).
- Token configurato → modalità `owner-token`: ogni `/api/*` richiede
  `X-Owner-Token: <token>`, `Authorization: Bearer <token>` oppure `?owner_token=` (necessario per gli
  SSE, che non supportano header). `/health` e `/api/health` restano aperti per i probe di readiness.
- Il rifiuto è **uniforme** (403 `owner_token_required`) e avviene **prima dell'handler**: un game ID
  indovinato non distingue «non autorizzato» da «inesistente» → nessuna enumerazione.
- Implementazione: `src/security/owner-guard.ts`, installato in `index.ts` **prima** di `registerRoutes`
  (source-contract test). Il token non compare mai nelle risposte (nemmeno in health).

**Inventario (snapshot verificabile):** `q02-endpoint-inventory.json` — **99 endpoint**, di cui
**54 mutanti** (POST/PUT/PATCH/DELETE) e **45 di lettura**. Il test `tests/endpoint-inventory.test.ts`
rigenera l'inventario dal sorgente e lo confronta: **un endpoint nuovo senza inventario fa fallire il
gate**. Nessun mutante vive fuori da `/api` (l'unico router montato anche su `/health` è la sola GET).

| Area | Mutanti | Chi può chiamarli |
|---|---|---|
| `llm.routes.ts` | POST `/config`, `/models`, `/test` | owner (settings provider, chiavi API) |
| `games/*` (azioni, economia, playback, simulazione, save) | 41 | owner |
| `worlds`/`maps`/`presets`/`templates`/`saves`/`chats` | 10 | owner |

**Test richiesti dal piano**

| Caso | Prova | Esito |
|---|---|---|
| Accesso di un **utente diverso** | `tests/owner-guard.test.ts` — nessun token → 403, handler non raggiunto | ✅ |
| **Game ID indovinato** (enumerazione) | risposta identica per id esistente e inesistente, handler non raggiunto | ✅ |
| **Settings provider** | GET e POST `/api/llm/config` → 403 senza token | ✅ |
| Token errato / corretto (header, Bearer, query) | 8 casi | ✅ |
| Client invia il token | `frontend/src/services/ownerToken.test.ts` + `api.ts` (`...ownerHeaders()`) e `sse.ts` (`withOwnerToken`) | ✅ |

**Budget LLM:** gli endpoint che possono generare consumo (`/api/llm/test`, advisor, simulazioni) sono
tutti sotto l'inventario e sotto la guardia. Nessun test E2E o di unità usa un provider reale.

## 3. Health/version (passo 3)

`GET /health` e `GET /api/health` (stesso payload) espongono, **senza segreti**:

```json
{
  "status": "ok",
  "timestamp": "…",
  "build": { "backend": "<WORLD_STORY_BUILD_ID | dev>", "frontend": "<dist/build-id.txt | null>" },
  "schema": { "economySnapshot": 1, "database": { "userVersion": 0, "tables": 48 } },
  "modelVersions": [ { "id": "cold_war_1951_v2", "version": 2, "mode": "strict", "declaration": "historical_estimated" } ],
  "auth": "open-single-user | owner-token",
  "api": { "base": "/api", "sameOrigin": true }
}
```

- Build ID backend: `WORLD_STORY_BUILD_ID` (stampato in CI = `github.sha`; fallback `dev`).
- Build ID frontend: `frontend/dist/build-id.txt`, emesso dal plugin Vite `world-story-build-id`
  (`WORLD_STORY_BUILD_ID` o short SHA di git).
- Nessun token, chiave LLM o percorso sensibile: verificato da `tests/health-version.test.ts`
  (asserzioni su sottostringhe vietate `apikey/secret/password/authorization` e sui valori segreti).
- **API same-origin `/api`**; **nessun URL quick-tunnel nel bundle**: `ownerToken.test.ts` scandisce
  `frontend/dist` e rifiuta `trycloudflare.com`/`ngrok.io`/`localtunnel.me`.

## 4. Script fail-closed (passo 4)

| Script | Cosa fa | Garanzia |
|---|---|---|
| `scripts/db-backup.js <db> [out]` | backup **coerente** con l'API di backup online di SQLite (`better-sqlite3.backup()`), poi `PRAGMA integrity_check` | se l'integrità non è `ok` il backup viene rimosso ed esce ≠0 (exit 2 db mancante, 3 integrità) |
| `scripts/db-restore.js <backup> [db]` | verifica il backup, mette da parte il DB corrente (`.pre-restore-<ts>`), copia, rimuove WAL/SHM | nessun dato reale distrutto senza copia |
| `scripts/release.js` | orchestrazione dei 10 passi: tests → build → **backup** → inventario run attivi → maintenance/drain → migrazione → aggiornamento backend → readiness → compat frontend → smoke | **fail-closed**: ogni passo si ferma al primo errore; `--plan-only` non muta nulla |

**"Mai killare un job alla cieca":** il preflight interroga `simulation_jobs` per `running`/`queued`. Se
ci sono run attivi il rilascio **si ferma** (exit 4) e chiede il drain, oppure `--allow-active-runs`
esplicito. Il drain è SIGTERM (graceful shutdown, che fa flush delle sessioni) — **nessun SIGKILL**, e
dopo il drain l'inventario viene ricontrollato. La fase di aggiornamento richiede `--restart-command`
esplicito (fail-closed se manca).

**Rilascio solo autorizzato (passo 5):** `--execute` **richiede `--authorized`**; senza, exit 5
`authorization_required` e nessun passo eseguito (provato: la cartella backup resta vuota).

**Rollback documentato** (stampato nel piano):
```
node scripts/db-restore.js <backup> <db>
riavviare la revisione precedente del backend (stesso comando di deploy)
```

Prove: `tests/q02-release.test.ts` — **9 casi** (backup coerente, db mancante, restore + safety copy,
backup mancante, piano con 10 passi e rollback, run attivi bloccanti/sbloccabili, db mancante,
`--execute` non autorizzato, flag sconosciuto).

## 5. Matrice audit/spec (passo 6)

| Voce | Requisito | Prova automatica | Data |
|---|---|---|---|
| Q02.1 | legacy leggibile, mai convertito | `q02-legacy-migration.test.ts`, `scenario-catalog.test.ts` | 2026-09-16 |
| Q02.1 | migrazioni ripetibili + abort/rollback su copia | `q02-legacy-migration.test.ts`, `economy-snapshot.test.ts` | 2026-09-16 |
| Q02.2 | protezione single-owner (utente diverso, id indovinato, settings) | `owner-guard.test.ts` | 2026-09-16 |
| Q02.2 | inventario endpoint mutanti verificabile | `endpoint-inventory.test.ts` + `q02-endpoint-inventory.json` | 2026-09-16 |
| Q02.3 | health/version senza segreti, same-origin, no tunnel | `health-version.test.ts`, `ownerToken.test.ts` | 2026-09-16 |
| Q02.4 | script fail-closed, backup coerente, rollback, no kill cieco | `q02-release.test.ts` | 2026-09-16 |
| Q02.5 | rilascio solo autorizzato | `q02-release.test.ts` (exit 5) | 2026-09-16 |
| Q02.6 | confronto Pax residuo = campagna separata autorizzata | non avviato per scelta (non è una condizione delle funzioni World Story) | — |

## 6. Cosa resta bloccato (e perché)

1. **Rilascio pubblico reale** — non eseguito: **richiede autorizzazione esplicita**. Comando pronto:
   ```
   node scripts/release.js --execute --authorized \
     --db <path-al-db-di-produzione> \
     --restart-command "<comando-di-restart>" \
     --health-url <url-readiness>
   ```
   Il piano (`--plan-only`) è eseguibile ora, in sola lettura.
2. **Smoke E2E pubblico con partita isolata e provider LLM reale** — **richiede budget approvato**.
   Alternativa pronta e non fuorviante: harness mock (`npm run test:e2e:mock`, 17/17) che **non** è una
   prova LLM di produzione e non viene spacciata come tale.
3. **Deploy in produzione / staging mock separato** — non eseguito (nessuna autorizzazione). Lo script
   è pronto e fail-closed.
4. **Dispositivi reali (Safari iOS / Chrome Android) e axe-core** — restano bloccati come in Q01
   (hardware e pacchetto non in cache offline).

## 7. Verifica

- Backend **124 file / 1033 test** verdi; `tsc` pulito.
- Frontend **39 file / 220 test** verdi; `tsc` pulito.
- `npm run build` OK (build ID frontend emesso: `frontend/dist/build-id.txt`).
- E2E mock **17/17**, a11y **3/3**, perf **OK** (JS 1.47 MB, CSS 0.54 MB).
- `git diff --check` pulito; Quality Gate `test-build` + `e2e-mock` verdi su `main`.
