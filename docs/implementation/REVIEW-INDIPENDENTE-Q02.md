# Revisione indipendente — Q02 (compatibilità, sicurezza, rilascio)

**Revisore:** sessione di revisione distinta dall'implementazione, che ha rieseguito le prove sul codice
consegnato e ha cercato difetti non dichiarati.
**Oggetto:** `docs/implementation/Q02-report.md` + PR Q02 su `main`.
**Data:** 2026-09-16. **Esito: ACCETTABILE** con rilievi di copertura (nessuno bloccante).

## Metodo

Riesecuzione diretta, non lettura del report:

```
npm --prefix backend-nest test        # 124 file / 1033 test
cd frontend && ../node_modules/.bin/vitest run
npx tsc --noEmit (backend e frontend)
npm run build
npm run test:e2e:mock / test:a11y / test:perf
OPEN_PAX_DB_PATH=/tmp/… node -e "require('./backend-nest/dist/health/build-info').buildInfo()"
```

Più ispezione avversariale di: `owner-guard.ts`, `route-inventory.ts`, `build-info.ts`, `index.ts`,
`health.routes.ts`, `scripts/{db-backup,db-restore,release}.js`, `frontend/src/services/ownerToken.ts`,
`api.ts`, `sse.ts`, `vite.config.ts`, e dei nuovi test.

## Cosa ho verificato e confermo

1. **La guardia è realmente attiva, non solo testata.** Prova integrativa su HTTP reale (Express +
   `fetch`): senza token → 403 e handler **mai** raggiunto; con token → 200. Prova presente in
   `tests/owner-guard.test.ts` (11 casi).
2. **Enumerazione bloccata:** id indovinato e id esistente restituiscono lo stesso 403 con **body
   identico**; l'handler non viene invocato (`handled` resta vuoto).
3. **Settings provider protetti:** GET e POST `/api/llm/config` → 403 senza token (unità + integrazione).
4. **Health senza segreti:** il payload non contiene il token né la chiave LLM; verifica su sottostringhe
   vietate. `build.frontend` letto davvero da `frontend/dist/build-id.txt` (verificato eseguendo il
   modulo compilato: `"frontend":"97c2e48"`).
5. **Nessun tunnel nel bundle:** scansione di `frontend/dist` per `trycloudflare.com`/`ngrok.io`/
   `localtunnel.me` → nessuna occorrenza.
6. **Fail-closed reale:** `--execute` senza `--authorized` esce 5 **e non produce file** (verificato:
   directory backup vuota). Run attivi → exit 4; `--allow-active-runs` → piano ammesso. DB mancante →
   exit 4. Flag ignoto → exit 1.
7. **Backup coerente:** `db-backup.js` usa l'API di backup online, verifica `integrity_check`, rimuove un
   backup corrotto. `db-restore.js` crea la copia di sicurezza prima di sovrascrivere.
8. **Legacy:** la migrazione su copia lascia l'originale **byte-identico** e senza `economy_mode`;
   `getEconomyMode` resta `legacy`, `economy_model_version` resta `NULL`; `initDatabase()` ripetuto 3×
   non perde dati. Il gotcha `current_date` (keyword SQLite) è coperto esplicitamente con `[current_date]`.
9. **Inventario non può marcire:** `endpoint-inventory.test.ts` rigenera lo snapshot dal sorgente
   (99 endpoint, 54 mutanti) e fallisce su drift.

## Rilievi (nessuno bloccante)

| # | Rilievo | Gravità | Stato |
|---|---|---|---|
| R-1 | La guardia è **applicativa**, non per-route: i test che invocano direttamente gli handler (`layer.route.stack[…].handle`) la bypassano. La protezione vale solo nel processo reale. | Bassa | **Mitigato**: prova integrativa HTTP reale aggiunta; source-contract che la guardia precede `registerRoutes`. |
| R-2 | In modalità `owner-token` la **shell SPA** (`/`, asset) resta pubblica: senza token si vede la pagina ma non i dati. | Bassa | **Accettato per design**: nessun dato nella shell, nessun segreto nel bundle (verificato). |
| R-3 | Il token per SSE viaggia in **query string**: può finire nei log di un proxy/edge. Il backend logga solo `req.path` (nessuna query). | Media | **Rilievo di processo**: usare HTTPS e non loggare la query a monte; documentato qui. |
| R-4 | **Rotazione del token**: i client con il vecchio token in `localStorage` ricevono 403 finché non riaprono `?owner_token=<nuovo>`. | Bassa | **Documentato**: comportamento atteso, non silenzioso (403 esplicito). |
| R-5 | Il percorso `--execute` di `release.js` **non è provato end-to-end** (richiede autorizzazione e un rilascio reale). | Media | **Dichiarato**: verifica manuale non svolta; coperti preflight, backup/restore, autorizzazione, no-kill. |
| R-6 | `release.js` usa **`curl`** per la readiness. | Bassa | **Fail-closed**: se manca, il passo fallisce e il rilascio si ferma; requisito documentato. |
| R-7 | Nessuna prova di backup **con scritture concorrenti** del backend. | Bassa | **Copertura**: l'API di backup online è lo strumento corretto; test concorrente non aggiunto (fuori portata). |

## Verdetto

Il pacchetto Q02 è **completo per la parte automatizzabile** e non introduce regressioni. I passi che
richiedono autorizzazione (rilascio pubblico, smoke con provider reale) sono **correttamente non
eseguiti** e hanno comando e condizione dichiarati. I rilievi R-3, R-5, R-7 restano come debito di
processo/copertura, non come difetti del codice consegnato.

**Esito: ACCETTABILE.**
