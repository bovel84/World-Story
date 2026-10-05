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
candidate selection (deterministica, senza LLM, SOLO trigger dinamici)
        ↓
world pulse prompt (con divergenceDate + eventi del turno)
        ↓
parse (parser incrementale esistente)
        ↓
finestra temporale (origin < date <= target)
        ↓
EffectValidator (validateStrictMapChanges → mapChanges vietati)
        ↓
narrative-only guard (nessuna mutazione materiale nel testo/counterAction)
        ↓
anti-contraddizione con il turno principale (relazioni/esiti respinti)
        ↓
validateReactionDecisions sul CONTESTO DEI CANDIDATI
        ↓
deduplica + ordine cronologico + cap 3
        ↓
merge nella timeline persistita (solo narrativo, cronologico)
```

- **Candidati:** una nazione entra solo con **≥1 TRIGGER dinamico verificabile**
  — fatto recente (finestra 180 giorni), impegno in vigore, **vera agenda NPC**
  (marker esplicito nel dossier), oppure è coinvolta in un evento del turno
  appena prodotto. Le **relazioni** (`hostile`/`ally`) sono **contesto**: da sole
  **non** creano il candidato. **Mai** per lontananza. Nessun candidato →
  nessuna chiamata.
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
TurnPipelineService: gli eventi pulse NON entrano in appliedEvents
(materiali); vengono uniti alla SOLA timeline persistita e ordinati
cronologicamente insieme agli eventi principali
```

- non cambia `actionOutcomes`, `voided`, `targetDate` del giocatore;
- non interferisce con la decisione NPC che ferma l'auto-jump;
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

- La selezione candidati è deterministica e **fail-closed**: una menzione nel
  dossier non è un'agenda, una relazione da sola non è un trigger. Resta però
  legata a dati testuali (`npcStrategicProfiles`, `activeCommitments`): processi
  e crisi NPC non sono esposti in forma strutturata per il pulse, quindi la
  copertura di «processo in corso» e «decisione NPC non risolta» è **parziale**.
- La rubrica è euristica (frasi-segnale), non comprensione semantica.
- Il material-claim guard è una **lista prudente di stem**: respinge il
  palesemente materiale, non capisce ogni frase italiana. Fail-closed: un pulse
  dubbio viene scartato, non canonizzato.
- L'anti-contraddizione copre i casi strutturati (cambio di relazione
  neutral/ally + ripresa del conflitto; esito respinto ripetuto) e la dedup
  titolo+data. Contraddizioni puramente semantiche non rilevabili restano
  possibili: il prompt ha una regola esplicita, ma non un validatore semantico.
- Il pulse non è integrato nel percorso di playback in pausa (salto fisso multi
  evento): con flag ON quegli eventi possono non comparire. È un gap di
  enrichment, non un errore di turno.
- I budget di fascia piena aumentano i token: da misurare a runtime prima di
  accendere `tieredMemory`.
- La qualità storica reale e l'effetto del pulse in partita non sono verificabili
  senza provider.

## Test

- Mirati world pulse + narrative-dispatch-quality: **36/36**.
- Simulation/reactions correlati: **106/106**.
- Prompt/config/memoria: **131/131** (suite correlate).
- Full backend unit (una volta): **251 file, 2744 test, 0 failed**.
- Build backend: ok (`tsc` + `npm run build`).
- Frontend non toccato.

## Stato E2E

Run `E2E (mock)` su `1fea248` (workflow informativo, `continue-on-error`, nessuna rete provider):

| Step | Esito |
|---|---|
| E2E mock (smoke, moduli, mappa, viewport) | **success** |
| Accessibility audit | **failure** — 2 test **pre-esistenti dal #200**: `a11y/a11y.spec.mjs:129` (`.minister-chat`) e `:164` (`.government-office-pane-chat`) |
| Build frontend (perf baseline) / Performance baseline | skipped (dipendono dall'audit) |
| **Conclusion effettiva del workflow** | **success** (`continue-on-error`) |

`Quality Gate / test-build` su `1fea248`: **success**.

## FINAL HARDENING

Residui chiusi sull'HEAD `225f97a` senza nuova architettura, senza deploy,
senza chiamate provider.

### 1. Relationships ≠ trigger (fail-closed)

`selectWorldPulseCandidates()` non considera più `hostile`/`ally` una causa
sufficiente. Un candidato esiste **solo** con ≥1 trigger dinamico:

```
TRIGGERS      → autorizzano la candidatura
  recentTriggers[]     fatto negli ultimi 180 giorni
  activeCommitments[]  impegno in vigore che cita la nazione
  agendaTriggers[]     VERA agenda NPC (marker esplicito nel dossier)
RELATIONSHIPS → contesto, ordinamento, spiegazione… ma da sole NON autorizzano
```

`dossierActiveAgendas()` legge il dossier del motore con marker stabili: blocco
`- Nome [ID]` + riga `Agenda strategica: ...`. Il fallback del motore
«nessun obiettivo attivo registrato» è **escluso**: se non si dimostra una vera
agenda attiva, quella causa **non** viene aggiunta. Nessun parsing NLP.

### 2. Post-turn context e viste relazionali effettive

`worldPulseSelectionInput(game, result)` costruisce il contesto **post-turno**,
non solo lo stato pre-turno:

- **`effectiveRelationships`** = clone di `game.relationships` con i
  `relationshipChanges` del turno applicati (match nome→id, aggiornamento
  bidirezionale). Vale **solo** per il pulse: non viene persistito.
- gli **eventi del turno** sono anteposti ai `recentEvents`, quindi un fatto
  appena successo diventa un trigger per le nazioni coinvolte.

Il prompt riceve `[EVENTI APPENA ACCADUTI NEL PERIODO]` e
`[CAMBI DI RELAZIONE NEL PERIODO — autoritativi]`, con priorità
`MAIN RESULT DEL TURNO > STATO CANONICO PRE-TURNO > STORIA GIOCO PRECEDENTE`.

### 3. Contradiction guard deterministico

Prima della dedup, per ogni evento:

- se un `relationshipChanges` del turno porta la coppia a `neutral`/`ally` e
  l'evento pulse racconta una ripresa del conflitto fra le stesse due nazioni →
  **respingi**;
- se un esito `rejected` del turno ricompare nel testo come compiuto →
  **respingi**;
- dedup titolo+data invariata.

### 4. Narrative-only contract + material-claim guard

`validateNarrativeOnlyWorldPulseEvent()` scarta descrizioni e `counterAction`
con claim materiali (`mobilita`, `schiera`, `occupa`, `conquista`, `costruisce`,
`annette`, `dichiara guerra`, `embargo`, `flotta`, `divisioni`, …).

- ammesso: «Il governo annuncia che valuterà una mobilitazione» (marker di
  intenzione entro 60 caratteri prima dello stem);
- vietato: «Il governo mobilita due divisioni».

Principio fail-closed: meglio respingere un pulse dubbio che canonizzare un
fatto che il motore non conosce.

### 5. Merge cronologico globale e non-ibridazione di `appliedEvents`

`appliedEvents` torna a significare **solo** «eventi applicati al motore»: il
pulse **non** viene più pushlato lì. Gli eventi pulse entrano nella sola
`turnResult.timelineEvents`, che viene ordinata con
`mergeTimelineChronologically()`: **`date ASC`**, tie-break **stabile =
indice d'inserimento** (quindi evento principale **prima** del pulse a parità di
data). Esempio: main `10`, `25`; pulse `7`, `18` → timeline `7, 10, 18, 25`.

Il merge tocca **solo** timeline/persistenza/cronaca/memoria/UI feed: non
`actionOutcomes`, non `eventHeadlines` degli ordini, non auto-jump, non
`targetDate`, non l'applicazione mappa.

### 6. `divergenceDate` esplicita

`WorldPulseInput.divergenceDate` arriva da `game.world.startDate` e compare nel
prompt in `[CONFINE TEMPORALE]`:

```
Divergenza: YYYY-MM-DD
- REAL HISTORY < divergenceDate
- GAME HISTORY >= divergenceDate
- dopo la divergenza la storia reale futura NON è canonica
```

Gerarchia invariata: `CURRENT / POST-TURN STATE > GAME HISTORY > PRE-DIVERGENCE
HISTORY`.

### Invarianti confermati

Flag `texture`/`worldPulse`/`tieredMemory` OFF di default; mechanic `worldPulse`
dedicata; max 0-3 eventi; `EffectValidator` e `ReactionDecisions` invariati;
`actionOutcomes`/`voided`/`targetDate`/auto-jump invariati; nessun deploy;
nessuna chiamata LLM reale o a pagamento.

## Non mergiare

Senza ok esplicito di Andrea. Quality Gate deve essere verde ed E2E concluso.
