# WS-NARR-DISPATCH-PAX-QUALITY — Report

**Base:** `main` @ `1183009` (dopo PR #207).
**Branch:** `feat/ws-narr-dispatch-pax-quality` (PR #208).
**Nessun deploy. Nessuna chiamata LLM reale o a pagamento.**
`EffectValidator`, `ReactionDecisions` e il contratto delle reazioni sono **invariati**.
**Nessuna dichiarazione di parità con Pax Historia.**

## Obiettivo

Avvicinare la qualità narrativa dei dispacci a un mondo più vivo **senza** rompere
il motore deterministico: rimuovere le contraddizioni del prompt, aggiungere
texture e un «respiro del mondo» sicuro, e rendere i budget di memoria dipendenti
dalla fascia del modello. Tutto dietro flag **spenti di default**, con una
valutazione che **non mente**.

## File modificati

| Passo | File |
|---|---|
| Prompt | `src/prompts/simulation/prompt.ts`, `src/prompts/simulation/narrativeTexture.ts` |
| World pulse | `src/prompts/simulation/worldPulse.ts`, `src/prompts/simulation/index.ts`, `src/prompt-builder.ts`, `src/agents.ts`, `src/game/TurnPipelineService.ts`, `src/prompts/types.ts` |
| Memoria | `src/llm/modelTier.ts`, `src/prompts/narrative-memory.ts` |
| Flag/meccanica | `src/llm/narrativeFlags.ts`, `src/llm/types.ts`, `src/llm/config.ts`, `src/llm/router.ts`, `src/llm/index.ts`, `llm.config.json` |
| Harness | `tests/helpers/narrativeQuality.ts`, `tests/fixtures/narrative-eval/scenario-millennium-dawn.json`, `tests/narrative-dispatch-quality.test.ts` |
| Test aggiornati | `tests/llm-config.test.ts`, `tests/preset-prompts.test.ts` |

## Flag (tutti OFF di default)

| Flag | Config | Env | Default |
|---|---|---|---|
| `narrative.texture` | `llm.config.json` → `narrative.texture` | `WS_NARRATIVE_TEXTURE` | `false` |
| `narrative.worldPulse` | `llm.config.json` → `narrative.worldPulse` | `WS_NARRATIVE_WORLD_PULSE` | `false` |
| `narrative.tieredMemory` | `llm.config.json` → `narrative.tieredMemory` | `WS_NARRATIVE_TIERED_MEMORY` | `false` |

Con `worldPulse` OFF **zero chiamate provider**. La meccanica è dedicata:
`ALL_MECHANICS` include `worldPulse`, con override `mechanics.worldPulse` in
`llm.config.json` e fallback ai default.

## JSON/NDJSON

- Il prompt standard non chiude più con «Rispondi SOLO con JSON valido»: rimanda
  al `[PROTOCOLLO EVENTI PROGRESSIVI]` in coda e chiede JSON Lines (una riga per
  oggetto).
- Il tetto eventi **non è più** «25-30»: deriva da `opts.eventBudget`
  (default `AUTO_JUMP_MAX_EVENTS = 12`), unica fonte di verità, niente numeri
  duplicati.

## Texture narrativa (flag `texture`)

Figure ed eventi documentati ammessi **solo** se presenti nel preset, nella
baseline storica o in conoscenza storica stabile; divieto di conoscenza futura
oltre la divergence; gerarchia `STATO CORRENTE > STORIA DELLA PARTITA > STORIA
REALE`. Due esempi originali di buon dispaccio e regola di varietà delle
aperture. Lunghezza `EVENT_BODY_WORDS` invariata.

## Tiered memory (flag `tieredMemory`)

Due sole fasce: `constrained` e `full-tier` (nessuna fascia media). I limiti di
`buildNarrativeMemory` e i clip del prompt compatto vivono in una tabella in
`llm/modelTier.ts` e dipendono da `classifyModel`. Con flag OFF valgono i budget
storici (fascia vincolata), identici al pre-PR.

## World pulse

### Pipeline di validazione

```
candidate selection (deterministica, senza LLM)
        ↓
world pulse prompt
        ↓
parse (parser incrementale esistente)
        ↓
finestra temporale (origin < date <= target)
        ↓
EffectValidator (validateStrictMapChanges → mapChanges vietati)
        ↓
validateReactionDecisions sul CONTESTO DEI CANDIDATI
        ↓
deduplica + ordine cronologico + cap 3
        ↓
merge nella cronaca del turno (solo narrativo)
```

- **Candidati:** una nazione entra solo con ≥1 causa canonica — relazione
  hostile/ally, impegno in vigore, fatto recente (finestra 180 giorni), agenda
  NPC nel dossier. **Mai** per lontananza. Nessun candidato → nessuna chiamata.
- **Contesto:** `buildWorldPulseContext` costruisce un `ReactionContext` **solo
  dai candidati** (opzione `:pulse` per attore, `maxReactions` = n. candidati).
  Mai il reaction context del giocatore. Attori/opzioni extra → reject.
- **EffectValidator riusato:** `validateStrictMapChanges` per ogni evento; con
  `mapChanges` non vuoto l'evento è respinto. Nessuna seconda via permissiva per
  `mapChanges`/`effects`/`transfer`/`spawn`/costruzioni/mobilitazioni.
- **Relationships vs commitments:** separati. Il prompt ha blocchi distinti
  `[RELAZIONI CORRENTI]` e `[IMPEGNI ATTIVI]` per candidato; `activeCommitments`
  **non** viene più spacciato per relazioni.
- **0-3 eventi:** `WORLD_PULSE_MIN_EVENTS = 0`, `WORLD_PULSE_MAX_EVENTS = 3`.
  Zero è sempre valido; il prompt dice «genera meno eventi o nessun evento».
- **Date:** `originDate < date <= targetDate`; fuori finestra → reject; ordine
  cronologico; niente doppioni titolo+data rispetto al turno.

### Ingresso nel turno live

Solo con `narrative.worldPulse === true`. Flusso:

```
runSimulation principale (validato)
        ↓ flag OFF → fine
        ↓ candidati == 0 → fine
1 chiamata worldPulse (stesso AbortSignal)
        ↓ validazione completa
result.worldPulseEvents (campo separato, NON result.events)
        ↓
TurnPipelineService: merge SOLO nella cronaca, dopo che mappa/processi/chat/
periodo/decisione auto-jump hanno già consumato appliedEvents
```

- non cambia `actionOutcomes`, `voided`, `targetDate` del giocatore;
- non interferisce con la decisione NPC che ferma l'auto-jump (gli eventi pulse
  non entrano in `appliedEvents` nella fase di decisione);
- budget separato max 3, non sottrae eventi agli ordini;
- abort della richiesta principale → nessun pulse;
- errore provider del pulse → `null`, il turno principale resta valido.

## RUBRIC SANITY CHECK (corpus mock — NON prova di miglioramento del prompt)

I corpus `weak`/`reference` della fixture sono **scritti a mano**. La tabella
misura la **sensibilità della rubrica**, non l'effetto del nuovo prompt.

| Criterio | weak (mock) | reference (mock) |
|---|---|---|
| Fatti strutturati | 40% | 100% |
| Successo | 60% | 100% |
| Causalità (causa canonica) | 0% | 100% |
| Lingua | 100% | 100% |
| Futuro | 80% | 100% |
| Varietà | 52% | 100% |
| **Totale** | **14.52 / 26** | **26 / 26** |

La causalità ora vale 1 solo con struttura causale **e** causa/ancora canonica:
«a causa di X» con X inventato vale 0.

> **Nessun miglioramento narrativo del nuovo prompt è stato misurato su
> generazioni reali.**

## REAL PROVIDER EVALUATION

```
status: NOT RUN
motivo: nessuna chiamata LLM a pagamento autorizzata
```

## Costi teorici

- Flag tutti OFF: **0 chiamate aggiuntive**.
- `texture` ON: nessuna chiamata in più, solo più testo nel prompt.
- `tieredMemory` ON: nessuna chiamata in più, prompt più lungo per la fascia
  piena.
- `worldPulse` ON: **al massimo 1 chiamata provider** per turno, e solo se
  esistono candidati; il worst case del turno resta main + (1 repair reactions) +
  (1 chiusura) + (1 pulse).

## Rischi residui

- La selezione candidati è deterministica ma si basa su dati testuali
  (`npcStrategicProfiles`, `activeCommitments`): una menzione non prova una
  causa; il modello resta vincolato a non inventare, ma la copertura è limitata.
- La rubrica è euristica (frasi-segnale), non comprensione semantica.
- Il pulse non è integrato nel percorso di playback in pausa (salto fisso multi
  evento): con flag ON quegli eventi possono non comparire. È un gap di
  enrichment, non un errore di turno.
- I budget di fascia piena aumentano i token: da misurare a runtime prima di
  accendere `tieredMemory`.
- La qualità storica reale e l'effetto del pulse in partita non sono verificabili
  senza provider.

## Test

- Mirati: harness/contratti **28/28**; prompt/config/memoria **111/111**;
  simulazione/reazioni **92/92**.
- Full backend unit (una volta): **251 file, 2736 test, 0 failed**.
- Build backend: ok (`tsc` + `npm run build`).
- Frontend non toccato.

## Stato E2E

Il workflow `E2E (mock)` è informativo (`continue-on-error`) e gira su push/PR.
Stato riportato nel commento/PR al termine del run; **non viene usata alcuna rete
provider** (API `/api/**` mockate).

## Non mergiare

Senza ok esplicito di Andrea. Quality Gate deve essere verde ed E2E concluso.
