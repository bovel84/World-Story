# WS-GAME-OPENING-IMMERSION — Report

**Branch:** `feat/ws-game-opening-immersion` (da `main = 2877646`)
**Ordine:** I1–I9 (§41).

## 1. OpeningContext / OpeningWorldNarrative (I1)

**Backend, read-only, modulo puro** `backend-nest/src/core/government/OpeningNarrative.ts`:

```ts
interface OpeningContext {
  world: { name; date; premise; rules };
  nation: { name; polityId; verifiedSituation: string[] };
  worldFacts: OpeningWorldFact[];
  priorities: OpeningPriority[];
  council: OpeningCouncilInput[];
}
interface OpeningWorldNarrative {
  headline?: string;
  worldOrder: string;
  regionalSituation?: string;
  stakesForNation: string;
}
```

`buildOpeningContext()` raccoglie **solo dati esistenti**: `world.basePrompt` (preset+lore), `simulation_rules`, data, `verifiedSituation` e `priorities` dal `CabinetSession` (agenda del motore), consiglio dalle sedie occupate. Nessuna copia persistente.

## 2. Doppia generazione eliminata (I1–I2)

Prima: backend `extractOpeningParagraphs()` **e** frontend `extractOpeningParagraphs()` ricostruivano il prologo dal `basePrompt`.
Ora: il backend produce `OpeningNarrativeResponse` (`world.narrative` semantico + `nation.framing` + `council`); il frontend lo **presenta**. `deriveGameOpening` usa `input.narrative` come fonte **primaria**; `fallbackWorldNarrative()` scatta **solo** se l'endpoint non risponde. Il prologo non è più `paragraphs[]`: sono quattro campi semantici.

## 3. Renderer read-only + validazione + fallback (I3)

`backend-nest/src/core/government/OpeningNarrativeRenderer.ts` — **una sola** chiamata LLM aggregata (`getLLMRouter().generate('advisor', …)`, `jsonMode`, timeout 12s, abort). Read-only: nessuna memoria/JEV/action/evento/motazione/direttiva.
- Valida `world` con `validateOpeningWorldNarrative`; valida `nationFraming` e ogni riga del consiglio con `validateTextAgainstContext`.
- **Rifiuta**: cifre non presenti nell'input (es. `999` → fallback), proper noun nuovi non nel materiale verificato (§33), parole di metadato (`preset`/`motore`/…). Voci del consiglio **seat→seat**, max 3 dal motore, `line` del modello solo se valida, altrimenti la riga deterministica.
- Qualsiasi errore → `null` → `buildDeterministicOpeningResponse()` (fallback). Il gioco non si blocca mai.

## 4. Prima / dopo

**Pagina 1 — IL MONDO**
- Prima: 2–4 paragrafi tagliati dal `basePrompt` (estrazione tecnica, spesso generica).
- Dopo: `worldOrder` (che mondo è), `regionalSituation` (regione), `stakesForNation` (perché mi riguarda), con `headline` d'epoca. Es. fixture: *«La Guerra Fredda è finita, ma il nuovo ordine è ancora instabile… Per il tuo paese, le scelte interne saranno inseparabili dalla posizione che saprà costruirsi in questo ordine.»*

**Pagina 2 — IL PAESE**
- Prima: sei letture + mappa.
- Dopo: `nation.framing` (quadro discorsivo dai `verifiedSituation`) sopra le letture, mini-mappa `IL TUO PAESE NEL MONDO` + relazioni reali.

## 5. worldFacts — ranking deterministico (I4)

`rankWorldFacts(facts, max=3)` in `frontend/.../openingBriefing.ts`: ordina per `critical(0) → warning(1) → opportunity(2) → positive(3) → info(4)`, stabile sull'ordine di arrivo, **max 3**. Mostrati in `DAL MONDO` nella pagina IL QUADRO. Esempio: su 20 fatti `info` restano 3; con `critical`+`warning`+`opportunity` l'ordine è `[critical, warning, opportunity]`.

## 6. Priorità dal motore (I5, §13–§14)

`OpeningSituationCard` (`toOpeningSituationCards`) è un **presentation adapter**: trasforma solo la **forma** (`Agenda del consiglio: Forze armate` → titolo `Forze armate` + corpo dal `detail`), **preserva** `severity`, ordine e significato di `StrategicBriefing.items`. L'LLM **non** decide quali questioni esistono: il consiglio parla dallo scenario, le priorità restano del motore.

## 7. Consiglio contestuale (I6, §16–§19)

Il prompt del renderer include, per ogni sedia, persona (`MinisterPersona`), `verifiedNeed` (CabinetItem) e il contesto (mondo/paese/regole). Mapping esatto seat→seat, max 3. Fallback deterministico = `openingCouncilLine` (persona + need).

## 8. Desktop map-first + mobile (I7–I8)

- Desktop (`min-width: 900px`): dossier sul lato (~42%, max 620px), mappa come parte della scena; velo leggero (`rgba(10,16,15,.34)`) e blur ridotto (1.5px).
- Mobile: preservato (full screen, footer sticky, CTA grande, una pagina alla volta).

## 9. Caching / flag / fallback (§28–§31)

`useOpeningNarrative` fa **una** richiesta per `gameId` (effect su `enabled`), il flag `world-story:opening-seen:<gameId>` resta invariato, `Rivedi introduzione` riusa la risposta; nessuna mutazione di memoria/JEV/turn/world. Fallback totale garantito.

## 10. File toccati

Backend: `core/government/OpeningNarrative.ts` (riscritto), `core/government/OpeningNarrativeRenderer.ts` (nuovo), `routes/games/state.routes.ts`, `tests/ws-game-opening.test.ts` (riscritto).
Frontend: `components/Game/openingBriefing.ts`, `components/Game/GameOpeningBriefing.tsx`, `components/Game/GameScreen.tsx`, `components/Game/openingBriefing.test.ts`, `components/Game/GameOpeningBriefing.test.tsx`, `services/api.ts`, `editorial.css`.
E2E: `mock-api.mjs`, `wsgameopeningimmersion-shot.mjs` (nuovo), screenshot `docs/implementation/screenshots/ws-game-opening-immersion/`.
**Freeze intatto.**

## 11. Test (esito reale)

```bash
(frontend) npx tsc --noEmit -p tsconfig.json   # 0 errori
(frontend) npx vitest run                       # 146 file, 1267 test passati
(frontend) npm run build                         # OK
(backend)  npx tsc --noEmit -p tsconfig.json    # 0 errori
(backend)  npx vitest run tests/                 # 217 file, 2323 test passati
(e2e)      npx playwright test tests/ws-game-opening.spec.mjs   # 3 passed
```

Test immersion (backend `ws-game-opening.test.ts`): `OpeningContext` raccoglie i fatti; prologo semantico (no `paragraphs`); validazione rifiuta `999` non presente; rifiuta il proper noun nuovo `C` (§33); prompt porta i fatti; parsing JSON. Frontend: I2 (narrativa backend primaria, niente rigenerazione), I4 (ranking deterministico max 3), I5 (severity/ordine preservati).

## 12. Limiti dichiarati (onestà)

1. Il modello **non legge le immagini**: gli screenshot sono artefatti Playwright; la verifica del criterio visivo (§37) è affidata alla struttura DOM/CSS e non a un giudizio visivo umano.
2. La validazione copre **cifre e proper noun interni** (word-boundary); non è un fact checker universale (come da §33). Nomi a inizio frase non sono verificabili senza NLP.
3. Il renderer LLM non è esercitato nei test automatizzati (nessun provider in CI): i test coprono `OpeningContext`, prompt, parsing e validazione; il percorso end-to-end con provider reale è verificato solo dallo smoke live dell'endpoint (fallback deterministico sempre disponibile).
4. La mappa **non cambia focus** tra le pagine (§24 "se semplice"): resta la mappa dietro l'overlay + la mini-mappa read-only con il territorio evidenziato. Non è stato creato un secondo sistema mappa.
5. Gli screenshot usano override di route per una fixture credibile (Millennium Dawn 2000, 2 relazioni, 3 ministri); non è un preset reale su disco.
