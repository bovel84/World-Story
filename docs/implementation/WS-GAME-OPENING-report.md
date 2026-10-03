# WS-GAME-OPENING — Report

**Branch:** `feat/ws-game-opening` (da `main` corrente)
**Ambito:** immersione iniziale di una nuova partita (dossier di insediamento) + fix del bug di scroll della pagina Governo.

---

## 1. Cosa è stato creato (e dove vive)

### Read model puro
`frontend/src/components/Game/openingBriefing.ts`
`deriveGameOpening({ world, currentDate, nationalName, nationalAccount, crisis, government, relationships, relationshipNames, strategicAgenda, worldFacts, resources, playerPolityId, council, cabinetAddresses, items })`

È **puro, deterministico, read-only**: proietta fonti già esistenti in un `GameOpeningBriefing` con i tre livelli e le cinque pagine. Non è una nuova fonte di stato. Espone anche `extractOpeningParagraphs`, `formatOpeningDate`, `deriveNationReadings`, `deriveNeighbors`, `deriveFirstQuestions` (testabili singolarmente).

### Componente
`frontend/src/components/Game/GameOpeningBriefing.tsx`
- `GameOpeningBriefing` = overlay accessibile (`AccessibleDialog`: portal, focus trap, Esc, sfondo inerte).
- `OpeningPanelContent` = le cinque pagine discrete `IL MONDO / IL PAESE / IL QUADRO / IL CONSIGLIO / ORA TOCCA A TE`, montabile nei test statici. La schermata 1 porta l'intestazione `WORLD STORY` / data / nome mondo (§4).

### Flag UI
`frontend/src/components/Game/openingFlag.ts` — `hasSeenOpening/markOpeningSeen/clearOpeningSeen` su `localStorage['world-story:opening-seen:<gameId>']`. **UX, non simulazione**: non entra nel salvataggio.
`frontend/src/stores/uiStore.ts` — flag `showOpening` (overlay UI).
`frontend/src/App.tsx` — `onGenerated` apre l'apertura solo per una nuova partita e solo se non già vista.
`frontend/src/hooks/useOpeningNarrative.ts` — una sola richiesta read-only, con fallback locale.
`frontend/src/components/Shell/GameMenu.tsx` — voce `Rivedi introduzione`.

### Endpoint narrativa (read-only, deterministico)
`backend-nest/src/core/government/OpeningNarrative.ts` — `buildOpeningNarrative`, `extractOpeningParagraphs`, `openingCouncilLine`.
`backend-nest/src/routes/games/state.routes.ts` — `GET /:id/opening-narrative`.
Restituisce `{ generated: false, deterministic: true, world: { name, date, paragraphs }, council: [...] }`. Nessuna scrittura JEV/memoria, nessuna azione, nessun evento, nessun cambio al motore. Il **fallback deterministico è il percorso stesso**: la rotta non chiama alcun LLM.

La voce del consiglio rispetta **§13**: `openingCouncilLine(address)` unisce la firma di stile di `personaFor(seat)` (persona) alla **prima questione del motore** (`CabinetItem.need`, verified state). La questione entra solo se breve e priva di cifre; altrimenti resta la sola persona. Le virgolette `«…»` le aggiunge il renderer (una sola coppia).

---

## 2. Fonti già esistenti riutilizzate (nomi reali)

| Cosa mostra | Fonte reale |
|---|---|
| Prologo del mondo | `world.basePrompt` (= `preset.base_prompt` + `lore.md`), `world.name`, `currentDate` |
| Paragrafi consiglio | `readCabinetSession(...).addresses` + `openingCouncilLine(...)` = `personaFor(seat).signature` (persona) + prima `CabinetItem.need` del motore (verified state), senza cifre (§13) |
| "Tu governi" + letture | `deriveNationalContext` (frontend) → `nationalName`, `nationalAccount`, `nationalRegions`; `NationResources`; `nationalCrisis`; `nationalGovernment` (letture Popolazione/Economia/Società/Governo/Finanze/Diplomazia, §7) |
| Prime questioni / problemi-opportunità | **lo stesso** `deriveStrategicBriefing(...)` della HUD (`StrategicBriefing.items`) |
| Mondo intorno a te | `relationships`, `relationshipNames`, `strategicAgenda.powers`, `deriveWorldPresence(...).facts` |
| CompactBriefing dopo l'apertura | invariato (`GameScreen` → `CompactBriefing`) |

Nessun secondo sistema di priorità: le "prime questioni" sono le voci del `StrategicBriefing` già derivato, con simbolo `⚠` (problema), `↑` (opportunità), `●` (neutro).

---

## 3. Prima / dopo dell'esperienza

**Prima:** nuova partita → si entrava subito in mappa + HUD + `CompactBriefing`. Il giocatore vedeva subito "cosa richiede attenzione" senza sapere **che mondo** fosse.

**Dopo:** nuova partita → dossier di insediamento a 5 pagine, poi la libertà:
```
1 GENNAIO 2000        → IL MONDO (prologo dal preset)
TU GOVERNI            → IL PAESE (nome, letture, mondo intorno a te)
IL QUADRO CHE EREDITI → problemi/opportunità dal StrategicBriefing
IL CONSIGLIO          → max 3 ministri, dalla persona + fatti del motore
ORA TOCCA A TE        → 3 porte (Governo/Mappa/Consigliere) + "Entra direttamente"
```
Le porte sono **ingressi**, non missioni: "Entra direttamente nella partita" chiude senza aprire nulla. Dopo, `CompactBriefing` resta e ha senso.

Evidenze: `docs/implementation/screenshots/ws-game-opening/{desktop,mobile}-1..5-*.png`.

---

## 4. Il mondo viene dal preset, non da conoscenza generica

- Il testo delle pagine `IL MONDO`/`IL PAESE` viene da `world.basePrompt` (il preset salvato: `base_prompt` + `lore.md`) e da `world.simulationRules`; l'LLM **non è nel percorso** (`generated: false`).
- L'endpoint backend legge lo stesso `world.basePrompt` dal repository e ne estrae 2–4 paragrafi; nessun fatto aggiunto.
- Test: `frontend/.../openingBriefing.test.ts` → *«il mondo viene dal preset, non da conoscenza generica»* (marker presente; nessun paragrafo se il preset è vuoto) e `backend-nest/tests/ws-game-opening.test.ts` → *«il prologo viene dal preset»*.
- Gerarchia rispettata (§23): MOTORE > STATO INIZIALE > PRESET > LLM. Il prologo usa il preset; le letture usano il motore.

---

## 5. La mappa "racconta" senza mutare stato

La mappa racconta in **due** modi, entrambi di sola lettura:

1. **La mappa interattiva già montata** da `GameScreen` resta visibile attraverso il velo dell'overlay (`rgba(16,24,23,.74)` + blur): non si monta una seconda `GameMap`, non si cambia `mapContextSelection`, non si toccano regioni o unità.
2. **La mini-mappa dentro la pagina Paese** (`OpeningMap` in `GameOpeningBriefing.tsx`) usa il read model puro `buildStaticMap(regions)` di `frontend/src/components/Map/staticMapModel.ts`: disegna la geografia politica reale (`Region.geojson`, colori già calcolati dal motore) ed evidenzia le regioni del paese del giocatore. **Nessun `onRegionClick`**: è sola presentazione. Se il mondo non ha geometria disegnabile, lo dichiara invece di inventarla.

Nessuno dei due modifica lo stato: nessuna selezione, nessun fetch, nessuna mutazione.

---

## 6. Bug §27 — scroll della pagina Governo

**Causa reale (misurata):** su mobile il modale full-screen `.government-office` era `overflow: hidden`. La schermata di scelta (registro + riquadri dei ministri) **non ha** `.gov-mobile-scroll` (che esiste solo nella seduta): con un gabinetto completo il contenuto era `scrollHeight 950 > clientHeight 844` e l'ultimo ministro restava irraggiungibile (`last pick bottom 932 > 844`). Desktop era `overflow-y: auto` e scrollava già.

**Fix (minimal, un solo scroll owner):** in `frontend/src/editorial.css`, nel blocco mobile, `.government-office` passa da `overflow: hidden` a `overflow-y: auto; overflow-x: hidden`. La seduta resta a un solo owner perché `.gov-mobile` è `height:100%` e `.gov-mobile-scroll`/`.minister-thread` continuano a scorrere: l'outer non ha nulla da scorrere. Nessun redesign, nessuna modifica all'architettura informativa.

Evidenze: `docs/implementation/screenshots/ws-game-opening/scroll-before-390x844.png` (difetto riprodotto: `overflow:hidden`) e `scroll-after-390x844.png` (fondo raggiunto), idem a `1366x768`.
Test E2E: `e2e/tests/ws-gov-office-scroll.spec.mjs`.

---

## 7. File toccati

**Apertura**
- `frontend/src/components/Game/openingBriefing.ts` (nuovo, read model)
- `frontend/src/components/Game/openingBriefing.test.ts` (nuovo)
- `frontend/src/components/Game/GameOpeningBriefing.tsx` (nuovo) — 5 pagine + `OpeningMap` (mini-mappa read-only via `buildStaticMap`)
- `frontend/src/components/Game/GameOpeningBriefing.test.tsx` (nuovo)
- `frontend/src/components/Game/openingFlag.ts` (nuovo)
- `frontend/src/hooks/useOpeningNarrative.ts` (nuovo)
- `frontend/src/stores/uiStore.ts`, `frontend/src/App.tsx`, `frontend/src/components/Game/GameScreen.tsx` (apertura + passa `regions`/`nationalRegions` alla mini-mappa), `frontend/src/components/Shell/GameMenu.tsx`, `frontend/src/services/api.ts`
- `frontend/src/editorial.css` (blocco `.opening-*`)
- `backend-nest/src/core/government/OpeningNarrative.ts` (nuovo), `backend-nest/src/routes/games/state.routes.ts`, `backend-nest/tests/ws-game-opening.test.ts` (nuovo), `docs/implementation/q02-endpoint-inventory.json`
- `e2e/mock-api.mjs` (route `opening-narrative` + flag `showOpening`), `e2e/tests/ws-game-opening.spec.mjs` (nuovo), `e2e/tests/hud-mobile.spec.mjs` (5ª voce menu), `e2e/wsgameopening-shot.mjs` (nuovo)

**Fix scroll**
- `frontend/src/editorial.css` (una dichiarazione)
- `e2e/tests/ws-gov-office-scroll.spec.mjs` (nuovo)

**Freeze:** nessun file di `backend-nest/src/core/simulation/**`, `game-session.ts`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema/database, checkpoint o pipeline tempo toccato.

---

## 8. Comandi di test eseguiti ed esito reale

```bash
# TypeScript
$ (frontend) npx tsc --noEmit -p tsconfig.json      # 0 errori
$ (backend-nest) npx tsc --noEmit -p tsconfig.json  # 0 errori

# Suite frontend
$ npm run build                                      # build OK (8.65s)
$ npx vitest run                                     # 146 file, 1263 test passati

# Suite backend
$ npx vitest run tests/                              # 217 file, 2321 test passati

# E2E (mock, Chrome di sistema)
$ npx playwright test tests/ws-game-opening.spec.mjs tests/ws-gov-office-scroll.spec.mjs tests/hud-mobile.spec.mjs
# 14 passed
```

---

## 9. Limiti e affermazioni non provate (onestà)

1. **Il modello non legge le immagini.** Gli screenshot sono artefatti reali prodotti da Playwright, ma la loro valutazione estetica non è stata fatta da una persona: le verifiche sono misure DOM (scrollHeight/clientHeight/overflow, hit-test) e i test.
2. **Nessuna chiamata LLM** per l'apertura: il prologo è deterministico dal preset. La prosa "migliore" (renderer narrativo) è dichiarata come step successivo (§24 del task) e **non** è implementata.
3. **Il consiglio usa `personaFor(seat).signature` + la prima questione del motore** (persona + verified state, §13), senza cifre. La questione entra solo quando è breve e priva di cifre; la selezione delle sedie è guidata dal motore (presenza e urgenza). Il world context arriva al ministro nella sua chat; nella riga d'apertura non è riportato letteralmente. Il miglioramento ulteriore è il renderer aggregato.
4. **"Il mondo intorno a te"** è derivato da `relationships`/`strategicAgenda`; se il motore non pubblica relazioni, la sezione non compare (nessun vicino inventato).
5. **Screenshot "before" dello scroll**: riproducono il difetto forzando il vecchio `overflow: hidden` via CSS iniettato, perché il fix è già nel codice. È una riproduzione fedele della causa misurata (950/844), non un checkout del codice precedente.
6. **`hud-mobile.spec.mjs`** è stato aggiornato da 4 a 5 voci di menu (la nuova `Rivedi introduzione`): è una modifica voluta, non una regressione mascherata.
7. La nuova rotta è coperta dal test E2E via mock; non esiste un test di integrazione supertest sul backend reale (scelta "test minimi").
