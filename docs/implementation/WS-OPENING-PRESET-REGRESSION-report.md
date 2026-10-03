# WS-OPENING-PRESET-REGRESSION

## 1. Causa radice

Il difetto **non** era nella persistenza del preset: `worlds.routes.ts` scrive
correttamente `base_prompt`/`simulation_rules` e `gameRepository.findById()` li
rilegge. Il contratto di risposta `GET /games/:id`
(`backend-nest/src/routes/games/state.routes.ts`) costruiva `world` con soli
`id`, `name` e `regions`. Di conseguenza, nel frontend:

- `gameApi.get()` → `setCurrentWorld(game.world)` produceva un `World` senza
  `basePrompt`;
- `GameScreen.deriveGameOpening` passava `basePrompt: undefined`;
- `deriveGameOpening` calcolava `premise = ''` e `fallbackWorldNarrative('')` →
  `worldOrder` vuoto;
- finché `opening-narrative` non rispondeva (LLM o timeout), il dossier mostrava
  «Il mondo non ha ancora una descrizione».

La correzione è nel **contratto dati**, non un mascheramento UI: la GET espone i
campi canonici in camelCase, e il fallback locale li usa subito.

## 2. File modificati

- `backend-nest/src/routes/games/state.routes.ts` — `world` di `GET /games/:id`
  ora include `basePrompt`, `simulationRules`, `description`, `startDate` dal
  record canonico (`game.world.base_prompt`, `simulation_rules`, ...). Nessun
  `any` nuovo: `game.world` è `WorldRecord & { regions }`.
- `frontend/src/types/index.ts` — `World.basePrompt` e `World.simulationRules`
  tipizzati (`string | null` opzionali); `description`/`startDate`/
  `historicalAccuracy`/`blocs` allineati alla forma reale della risposta.
- `frontend/src/components/Game/GameScreen.tsx` — il fallback locale riceve
  `basePrompt` e `simulationRules` con `?? null`; aggiunta la dipendenza
  `currentWorld?.simulationRules`.
- `frontend/src/components/Game/openingBriefing.ts` — il read model espone
  `world.simulationRules` dallo stesso input canonico (nessuna seconda fonte).
- `frontend/package.json` — aggiunto lo script `test: "vitest run"` così il
  comando richiesto `npm --prefix frontend test -- --run` funziona (prima non
  esisteva alcuno script `test`).
- Test nuovi/modificati e report; screenshot.

Nessuna modifica a `core/simulation/**`, `GameSession`, `TurnOrchestrator`,
`TurnPipelineService`, `SessionStateStore`, schema/database, checkpoint,
pipeline tempo, JEV, Governo, `DecisionWorkspace` o `worlds.routes.ts`.

## 3. Test aggiunti

- **Test A/D** — `backend-nest/tests/ws-opening-preset-regression.test.ts`:
  crea un mondo con `BASE_PROMPT_MARKER` e `SIMULATION_RULES_MARKER`, crea una
  partita e chiama la **rotta reale** `GET /games/:id`; verifica i campi non
  vuoti (A) e la persistenza dopo un riavvio in memoria, percorso refresh/resume
  (D).
- **Test B** — `frontend/src/components/Game/openingBriefing.test.ts`, nuovo
  describe: con `openingNarrative = null` e il mondo nella forma di
  `gameApi.get()`, `deriveGameOpening` produce `premise` non vuota col marker e
  conserva `simulationRules`.
- **Test C** — `e2e/tests/ws-opening-preset-regression.spec.mjs`: preset →
  paese → generazione → dossier; `opening-narrative` trattenuta via
  intercezione; durante il ritardo la premessa è già visibile e non compare lo
  stato vuoto; al rilascio la narrativa arricchita la sostituisce.
  Screenshot: `docs/implementation/screenshots/ws-opening-preset-regression/during-delay.png`
  e `after-release.png`.

## 4. Risultati reali (§9.2)

```text
$ npm --prefix backend-nest test
 Test Files  226 passed (226)
      Tests  2386 passed (2386)

$ npm --prefix frontend test -- --run
 Test Files  149 passed (149)
      Tests  1289 passed (1289)

$ npm run build
 (tsc backend + tsc/vite frontend) exit 0
```

Test mirati:

```text
$ npm --prefix backend-nest test -- tests/ws-opening-preset-regression.test.ts
 2 passed (A + D)

$ npm --prefix frontend test -- --run src/components/Game/openingBriefing.test.ts
 (include i 2 nuovi casi Test B) — suite verde

$ cd e2e && node_modules/.bin/playwright test tests/ws-opening-preset-regression.spec.mjs
 ✓ 1 passed (Test C)

$ cd e2e && node_modules/.bin/playwright test tests/smoke.spec.mjs tests/viewport.spec.mjs tests/ws-*.spec.mjs
 24 passed
```

Le suite mock complete sono state eseguite localmente: 163 test passati prima del
limite di tempo del comando, più i 24 rimanenti (`smoke`, `viewport`, `ws-*`)
tutti verdi. Il job E2E in CI è `continue-on-error`; il gate richiesto resta
`test-build`.

## 5. Conferma: `basePrompt` dal primo render

Con il contratto corretto, alla creazione della partita `GET /games/:id`
restituisce `world.basePrompt`; `GameScreen` lo passa a `deriveGameOpening`, che
calcola subito la premessa locale. Il Test C lo prova osservando il dossier
mentre `opening-narrative` è trattenuta: `BASE_PROMPT_MARKER` è già a schermo e
lo stato «Il mondo non ha ancora una descrizione» non compare mai. All'arrivo
della narrativa arricchita, essa sostituisce il fallback senza perdita del
mondo (nome e data restano).

## 6. Stato deploy

Merge su `main` solo dopo `test-build` verde; deploy standard
(`bash scripts/deploy-cloudflare.sh`) con verifica backend `127.0.0.1:8000` e
worker pubblico. Gli esiti sono riportati nel resoconto di consegna.
