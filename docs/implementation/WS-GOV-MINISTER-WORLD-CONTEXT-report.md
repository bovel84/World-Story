# WS-GOV-MINISTER-WORLD-CONTEXT — Report

**Branch:** `feat/ws-gov-minister-world-context` (da `main = 173df86`)
**Data:** 2025
**Principio guida:** *I ministri non devono soltanto conoscere lo stato del motore: devono sapere in quale mondo, paese e momento storico quello stato esiste. Il preset fornisce il significato; il motore fornisce i fatti correnti; la storia della partita dice come il mondo è cambiato.*

---

## 1. Cosa è stato creato

**Un solo `MinisterWorldContext`**, derivato esclusivamente dallo stato reale della partita. Vive in un modulo **già esistente**, esteso — non in un secondo riepilogo storico:

`backend-nest/src/prompts/national-context.ts`

```ts
export interface MinisterWorldContext {
  worldName: string;
  country: string;              // §5 — il paese, distinto dal mondo
  currentDate: string;

  scenarioPremise: string;
  simulationRules: string;

  nationalContext: string;
  recentHistory: string;

  activeCommitments: string;
  ongoingProcesses: string;

  relevantStrategicContext?: string;
}
```

Espone, nello stesso file:

- `buildMinisterWorldContext({ vars, worldName, seat })` — costruisce il contesto;
- `renderWorldIdentity(world)` — il blocco `[IDENTITÀ DEL MONDO]`;
- `renderNationalContext(world, seat)` — il blocco `[CONTESTO DEL PAESE]` + `[GERARCHIA DELLE VERITÀ]` + `[ENFASI DELLA TUA COMPETENZA]`;
- `renderMinisterWorldContext(world, seat)` — i due blocchi uniti, nell'ordine §3;
- `SEAT_WORLD_EMPHASIS` — enfasi per competenza (§6–§7);
- `MINISTER_WORLD_TRUTH_HIERARCHY` — la gerarchia delle verità (§12) e la regola «il preset è un punto di partenza» (§13);
- `MINISTER_WORLD_BUDGET` — i budget UTF-8 espliciti (§8).

**Nessun sottotipo per ministero.** Non esistono `TesoroPresetContext`, `LavoriPresetContext`, `SanitaPresetContext`: l'unica differenza tra le sedie è `seat emphasis`, un **testo di lettura**, non una copia del preset.

---

## 2. Fonti già esistenti riutilizzate

Il contesto è derivato **solo** dalle variabili che `PromptBuilder` produce già (`buildVariables()`), senza alcuna ricostruzione frontend. Nomi reali delle variabili usate:

| Campo `MinisterWorldContext` | Variabili `PromptVariables` riutilizzate |
|---|---|
| `worldName` | `WORLD_NAME` (nuova variabile, da `game.world.name`) |
| `country` | `PLAYER_POLITY` |
| `currentDate` | `ORIGIN_ROUND_DATE` |
| `scenarioPremise` | `WORLD_BEFORE_ROUND_ONE_TEXT` |
| `simulationRules` | `HISTORICAL_PRESET_SIMULATION_RULES` |
| `nationalContext` | `NATION_CRISIS`, `PEACETIME_PRESSURES`, `GOVERNMENT_STATE` |
| `recentHistory` | `ALL_EVENTS_WITH_CONSOLIDATION`, `PLAYER_EVERY_ACTION_NOT_PREVIOUS` |
| `activeCommitments` | `ACTIVE_COMMITMENTS` |
| `ongoingProcesses` | `ONGOING_PROCESSES` |
| `relevantStrategicContext` | `STRATEGIC_STATE` |

`WORLD_NAME` è stata aggiunta come campo **opzionale** a `PromptVariables` (`backend-nest/src/prompts/types.ts`) e valorizzata in `PromptBuilder.buildVariables()` da `this.game.world.name`. Essendo opzionale, i test che costruiscono `PromptVariables` parziali con `as PromptVariables` non si rompono.

---

## 3. Come `buildNationalDecisionContext` è stato riusato/esteso

`buildNationalDecisionContext(vars)` **non è stato duplicato né sostituito**: è rimasto intatto per il suo percorso (suggerimenti ed elaborazione ordini).

Il nuovo codice **estende lo stesso file** e riusa:

- la stessa fonte di verità (`PromptVariables` di `PromptBuilder`);
- lo stesso helper privato `clip()` per i budget;
- la stessa logica «la storia già giocata prevale sulla storia reale», che in `buildNationalDecisionContext` è la riga *«La storia alternativa già giocata prevale sulle aspettative della storia reale»* e nella nuova `MINISTER_WORLD_TRUTH_HIERARCHY` diventa la gerarchia esplicita a 4 livelli (§12).

Non esiste un secondo riepilogo storico incompatibile: c'è **una** funzione per il contesto delle decisioni e **una** per il contesto di mondo, sullo stesso file e sulle stesse variabili.

---

## 4. Ordine degli strati (§3)

Nei due percorsi, il ministro riceve semanticamente:

```text
[IDENTITÀ DEL MONDO]      → renderWorldIdentity()
[CONTESTO DEL PAESE]      → renderNationalContext()  (+ [GERARCHIA DELLE VERITÀ] + [ENFASI DELLA TUA COMPETENZA])
[IL TUO MINISTERO]        → sezione identity di buildMinisterContext()
[MEMORIA]                 → strategicMemory / relevantPast / unresolved / recentConversation
[DATI VERIFICATI]         → worldState  (ULTIMO: l'ultima parola sul quanto)
```

Il percorso JEV (`buildMinisterContextSection`) produce, in quest'ordine, le sezioni `worldContext → nationalContext → identity → strategicMemory → relevantPast → unresolved → recentConversation → worldState`.

Il percorso non-JEV (`buildAdvisorPrompt`) inserisce `renderMinisterWorldContext(...)` **immediatamente prima** di `buildAdvisorDialogSuffix(...)`, che è dove vivono la cronologia e il messaggio del ministro (briefing = memoria + dati verificati). Quindi il mondo è **prima** di memoria e dati verificati, come richiesto dalla §19.

### Esempio reale (estratto non inventato)

Mondo `Millennium Dawn`, data partita `2000-04-01`, Tesoro, JEV spento. Sezione estratta dal prompt effettivo:

```text
[Data corrente]

È importante: il 1° aprile 2000

[IDENTITÀ DEL MONDO]
Mondo: Millennium Dawn
Data: 2000-04-01
Premessa dello scenario:
Il 1 gennaio 2000. La Russia esce dal caos degli anni Novanta. La Cina cresce rapidamente. L'UE prepara l'allargamento.
Regole fondamentali:
Le crisi economiche si propagano ai partner commerciali in tre mesi.

[CONTESTO DEL PAESE]
Paese: Italia
Situazione nazionale:
Crisi nazionale:
Situazione sotto controllo. ...
...
Processi in corso:
...
Situazione strategica e materiale:
...

[GERARCHIA DELLE VERITÀ — vale sempre]
1. STATO CORRENTE DEL MOTORE: prevale su cifre e situazione corrente.
2. STORIA DELLA PARTITA: prevale sul passato storico se il mondo è cambiato.
3. MONDO DI PARTENZA E SUE LOGICHE: descrive il punto di partenza, non una realtà congelata.
4. CONOSCENZA STORICA GENERALE: solo per interpretazione prudente, mai per sovrascrivere i livelli 1–3.
Il mondo di partenza descrive l'inizio della partita. ...
Non introdurre mai cifre che non provengano dai dati verificati elencati in fondo: il mondo dà il significato, non i numeri.
Non usare con il Presidente parole come «preset», «scenario», «prompt», «motore», «contesto» o «istruzioni»: parla come chi vive in quel mondo.

[ENFASI DELLA TUA COMPETENZA]
Guarda soprattutto la situazione economica, il debito, il commercio, gli shock energetici, gli impegni finanziari e i processi di spesa del periodo.

[Messaggio del giocatore]
Sei il Ministro del Tesoro del governo.
...
REGOLE CHE NON PUOI VIOLARE:
1. Usi SOLO le cifre elencate qui sotto. ...
...
--- 
Possiamo investire pesantemente nell'industria?
```

**Prima** (a parità di scenario) il prompt conteneva la premessa solo nella sezione generica `[Contesto di gioco]` / `[Regole di simulazione]` del builder del Consigliere, e non aveva né il contesto nazionale strutturato, né la gerarchia delle verità, né l'enfasi della competenza: il ministro vedeva `PERSONA + NUMERI + MEMORIA`.

---

## 5. Il preset non introduce cifre (§4)

`buildMinisterWorldContext` è una funzione **pura** che copia testo da `PromptVariables`. Non calcola, non stima, non inventa numeri: l'unica trasformazione è `clip()` (taglio di lunghezza). Le cifre del mondo appartengono a `STRATEGIC_STATE`, che è dato del **motore** e finisce in `relevantStrategicContext`, oppure al `verifiedState` (briefing della sedia), che resta separato.

Il guardrail è **anche testuale** nel prompt, come richiesto dalla nota di enforcement della §4:

```text
Non introdurre mai cifre che non provengano dai dati verificati elencati in fondo: il mondo dà il significato, non i numeri.
```

Test che lo dimostrano:

- `tests/ws-gov-minister-world-context.test.ts` → *«guardrail: il preset non è una fonte di cifre e i dati verificati restano separati»*: il numero del preset (`PRESET_NUMBER_777`) finisce in `worldContext`, ma **non** in `worldState`; il numero del motore (`CIFRA_MOTORE 42`) finisce solo in `worldState`.
- `tests/ws-jev-w4-context.test.ts` → *«lo stato verificato non arriva mai da JEV»*: `worldState` contiene `STATO_DEL_MOTORE` e **non** il claim JEV.
- `tests/ws-gov-minister-world-context.test.ts` → *«JEV acceso…»*: il prompt contiene la regola e `STATO_VERIFICATO_<seat>`.

---

## 6. Paese distinto dal mondo e filtrato per competenza (§5–§7)

- **`worldName` vs `country`**: `[IDENTITÀ DEL MONDO]` porta il nome del mondo/preset, `[CONTESTO DEL PAESE]` porta `Paese: <PLAYER_POLITY>`. Sono due campi diversi dell'interfaccia.
- **Filtrato per competenza senza keyword filtering**: non c'è nessun `preset.split(...).filter(x => x.includes('economia'))`. Il contesto comune (premessa + paese + cronaca + impegni + processi) è sempre presente e **budgeted**; la competenza agisce come `seat emphasis`, un breve testo di *lettura*, in `SEAT_WORLD_EMPHASIS`:

  | Sedia | Enfasi |
  |---|---|
  | `tesoro` | situazione economica, debito, commercio, shock energetici, impegni finanziari, processi di spesa |
  | `lavori` | industrializzazione, ricostruzione, infrastrutture, territorio, risorse, logistica, progetti in corso |
  | `esteri` | alleanze, conflitti, trattati, rapporti fra paesi, equilibrio internazionale |
  | `guerra` | conflitti, dottrina, frontiere, forze, minacce, logistica |
  | `istruzione` / `sanita` / `interno` | scuola/ricerca, salute/welfare, ordine/consenso/fazioni |

- Il contesto nazionale non contiene l'intera mappa mondiale: contiene crisi, pressioni, anime del governo e lo stato strategico **del paese del giocatore**.

Test: *«JEV spento: al ministro e alla voce della riunione arriva il mondo, con l'enfasi della sedia»* verifica la keyword di competenza per `lavori` (`industrializzazione`) ed `esteri` (`alleanze`) e per `tesoro` (`situazione economica`).

---

## 7. Budget token esplicito (§8)

Definiti in `MINISTER_WORLD_BUDGET` (byte UTF-8 per sezione, tagliati da `clip()`):

| Sezione | Byte | ~token |
|---|---|---|
| `scenarioPremise` | 1 200 | ~300 |
| `simulationRules` | 600 | ~150 |
| `nationalContext` | 2 400 | ~600 |
| `recentHistory` | 1 200 | ~300 |
| `activeCommitments` | 400 | ~100 |
| `ongoingProcesses` | 600 | ~150 |
| `relevantStrategicContext` | 1 000 | ~250 |

Totale ~7,4 KB ≈ **1 850 token**, entro i budget indicativi della §8 (scenario 800–1200 + national 800–1500 + seat 500–1000). Il contesto di mondo è **esente dal taglio JEV** (`worldContext`/`nationalContext` sono sezioni immutabili), resta compatto ma **sempre presente**.

Il taglio `clip()` misura i **byte UTF-8** (`Buffer.byteLength`), non i caratteri JS: i budget dichiarati sono in byte e il taglio li rispetta davvero (pre-merge fix #4).

---

## 8. JEV: identità del mondo non compattata, `verifiedState` separato (§9–§10)

- **IMMUTABLE/SLOW** (`worldContext`, `nationalContext`): aggiunti come sezioni a sé di `MinisterContextSections` (`backend-nest/src/core/government/jev/jev-memory.service.ts`), **reiniettati a ogni richiesta** da `PromptBuilder.buildMinisterContextSection()`. Non passano dal budget delle sezioni di memoria e non vengono mai compattati dalla retrieval JEV.
- **DYNAMIC** (`strategicMemory`, `relevantPast`, `unresolved`, `recentConversation`): restano JEV, con i budget esistenti.
- **`verifiedState` separato**: `MinisterContextInput` ora accetta `worldContext` e `nationalContext` come campi distinti da `verifiedState`. Il `[CURRENT VERIFIED STATE]` (briefing del motore) resta l'**ultimo** blocco e non assorbe né mondo né paese.

L'interfaccia richiesta dalla §10 è stata implementata **estendendo** l'interfaccia già esistente (`MinisterContextInput`) invece di crearne una parallela:

```ts
interface MinisterContextInput {
  scope: MinisterMemoryScope;
  query: string;
  verifiedState?: string;
  worldContext?: string;    // nuovo
  nationalContext?: string; // nuovo
  recentConversation?: readonly { role: string; content: string }[];
  asOf?: MinisterMemoryPoint;
  budget?: JevContextBudget;
}
```

Il comportamento del percorso JEV preesistente non cambia quando `worldContext`/`nationalContext` non sono passati (tutti i test JEV esistenti restano verdi).

### Telemetria coerente (pre-merge fix #3)

`worldContext` e `nationalContext` sono **immutabili** e fuori dalla compaction JEV: non devono falsare `over_budget`. La telemetria ora li contabilizza a parte:

```ts
telemetry: {
  section_bytes;            // per sezione (include world/national)
  total_bytes;              // tutto il testo
  immutable_context_bytes;  // world + national
  dynamic_context_bytes;    // total - immutable
  dynamic_budget_bytes;     // somma dei budget dinamici dichiarati
  budget_bytes;             // alias retro-compatibile di dynamic_budget_bytes
  over_budget;              // dynamic_context_bytes > dynamic_budget_bytes
  ...
}
```

Test: *«guardrail…»* verifica `immutable_context_bytes > 0`, `dynamic_budget_bytes === 4400` e `over_budget === false` con le sezioni dinamiche entro budget.

---

## 9. La riunione read-only riceve il contesto (§11)

`POST /:id/government/minister/:seat/render` (`backend-nest/src/routes/games/advisor.routes.ts`) chiama `session.getMinisterReply(seat, composeMeetingNarrativeMessage(brief))`. `getMinisterReply` usa lo **stesso** `buildAdvisorPrompt`/`buildMinisterContextSection`, quindi la voce della riunione riceve `MinisterWorldContext` senza modifiche alla rotta e **senza toccare `game-session.ts`** (congelato). La rotta continua a **non** persistere nulla (`persistMinisterMemory`/`persistJevConversation` non vengono chiamate) e a restituire solo prosa (`stripNarrativeDirectives`).

Test: la stessa suite verifica che, nel percorso del renderer, il prompt contenga `[IDENTITÀ DEL MONDO]`, il marker di scenario e l'obiettivo della riunione, sia con JEV spento sia nel percorso JEV.

---

## 10. Il ministro come membro del mondo, non come storico (§17)

Il testo vincola esplicitamente:

```text
Non usare con il Presidente parole come «preset», «scenario», «prompt», «motore», «contesto» o «istruzioni»: parla come chi vive in quel mondo.
```

E la gerarchia (§12–§13) gli dice di **non reintrodurre eventi superati**:

```text
2. STORIA DELLA PARTITA: prevale sul passato storico se il mondo è cambiato.
...
non reintrodurre alleanze, confini, guerre, programmi o crisi superati.
```

Test: *«storia alternativa: il preset iniziale e la rottura della partita convivono, con la precedenza dichiarata»* verifica che il prompt contenga sia l'alleanza iniziale del preset sia la rottura avvenuta nel turno 3, e la regola di precedenza.

---

## 11. File toccati

| File | Modifica |
|---|---|
| `backend-nest/src/prompts/national-context.ts` | Esteso: `MinisterWorldContext`, builder, renderer, enfasi, gerarchia, budget |
| `backend-nest/src/prompts/types.ts` | `WORLD_NAME?: string` in `PromptVariables` |
| `backend-nest/src/prompts/advisor.ts` | `buildAdvisorPrompt` riceve `options.worldContext` **già costruito** e lo inserisce prima del dialogo; non costruisce più nulla da sé |
| `backend-nest/src/prompt-builder.ts` | `WORLD_NAME` in `buildVariables()`; `buildMinisterContextSection` passa `worldContext`/`nationalContext`; `ministerWorldBlockFor()`/`isMinisterRequest()` per il percorso ministro/riunione (anche con `promptOverride`); `getAdvisor`/`getAdvisorStream` passano le opzioni |
| `backend-nest/src/core/government/jev/jev-memory.service.ts` | `MinisterContextInput`/`MinisterContextSections` estesi; ordine §3; `verifiedState` ultimo |
| `backend-nest/tests/ws-gov-minister-world-context.test.ts` | **Nuovo** — 7 test (mondo diverso, JEV off, JEV on, guardrail+telemetria, storia alternativa, override advisor, Consigliere normale) |
| `backend-nest/tests/ws-jev-w4-context.test.ts` | Aggiornata l'assert sull'ordine delle sezioni (i dati verificati sono ora ultimi) |

**File congelati:** nessuno toccato. Verifica: `git diff --name-only` non contiene `core/simulation/**`, `game-session.ts`, `TurnOrchestrator`, `TurnPipelineService`, `SessionStateStore`, schema/database, checkpoint, pipeline tempo.

---

## 12. Comandi di test eseguiti ed esito reale

```bash
# TypeScript backend
$ npx tsc --noEmit -p tsconfig.json
# (nessun output → 0 errori)

# Suite backend completa
$ npx vitest run tests/
# Test Files  216 passed (216)
#      Tests  2315 passed (2315)

# Test mirati
$ npx vitest run tests/ws-gov-minister-world-context.test.ts tests/ws-jev-w4-context.test.ts
# Test Files  2 passed (2)
#      Tests  17 passed (17)
```

---

## 12-bis. Pre-merge fixes (branch `feat/ws-gov-minister-world-context-fixes`)

Cinque correzioni chieste in revisione:

1. **`prompts.advisor` override + JEV off** → il `MinisterWorldContext` ora arriva comunque. `PromptBuilder` costruisce il blocco con `ministerWorldBlockFor()` e lo antepone **in entrambi i rami** (override e default). Il template custom non può più bypassare il contesto di mondo. Test: *«JEV spento + prompts.advisor override…»*.
2. **Consigliere normale** → `buildAdvisorPrompt` non costruisce più nulla da sé: il blocco arriva **solo** se il chiamante lo passa, e `isMinisterRequest()` lo attiva solo per sedia (`Sei il … del governo.`) o riunione (`RIUNIONE DI GOVERNO`). Test: *«Consigliere normale…»*.
3. **Telemetria JEV** → `immutable_context_bytes`, `dynamic_context_bytes`, `dynamic_budget_bytes` (alias `budget_bytes`); `over_budget` confronta le sole sezioni dinamiche. Niente più falsi `over_budget`. Test: *«guardrail…»*.
4. **Budget byte-accurate** → `clip()` usa `Buffer.byteLength(..., 'utf8')` (con iterazione per code point), coerente con i budget dichiarati in byte.
5. **Test aggiunti** → override JEV off, Consigliere normale, telemetria `over_budget=false`.

---

## 13. Limiti e affermazioni non provate (onestà)

1. **Il modello LLM non è testato**. I test provano che il contesto *arriva* al prompt e che il guardrail testuale c'è; non provano che il modello poi rispetti il guardrail. La verifica comportamentale richiede un giudizio umano sul testo prodotto, che non è stato fatto qui.
2. **`clip()` tronca la premessa a 1 200 byte**. Se un preset ha una premessa molto più lunga, la parte tagliata non arriva al ministro nel blocco `[IDENTITÀ DEL MONDO]` (resta però nella sezione generica `[Contesto di gioco]` del builder del Consigliere, che non è stata rimossa). Questo è il compromesso del budget §8.
3. **Sovrapposizione parziale con la sezione generica preesistente** `[Contesto di gioco]`/`[Regole di simulazione]`: nel **percorso ministro** la premessa e le regole compaiono sia lì sia nel nuovo blocco strutturato. È stato scelto di **non** rimuovere la sezione generica per non alterare il resto del builder. Il **Consigliere normale non riceve il blocco nuovo**: nessuna sovrapposizione fuori dal Governo. L'overlap nel percorso ministro è di poche centinaia di byte; il contenuto nazionale/eventi/impegni/processi è **solo** nel nuovo blocco.
4. **`WORLD_NAME` per ora è derivato da `game.world.name`**, che nei test/fixture può coincidere con un nome sintetico. Non è stato aggiunto un campo "preset id" separato perché non esisteva e non era richiesto.
5. **Il test su "due paesi diversi"** usa due set di `PromptVariables` (stesso motore, preset/data diversi) e verifica che i prompt di paese differiscano; non avvia due sessioni complete con due preset su disco, per non appesantire la suite ("senza mille test").
6. **La CI `test-build` non è stata ancora eseguita** su questo branch: va fatta al push. Il presente report attesta solo i comandi locali sopra.
7. ~~Il percorso `promptOverride` non riceve il nuovo blocco strutturato.~~ **RISOLTO** (pre-merge fix #1): il blocco viene anteposto anche nel ramo override, per il percorso ministro/riunione.
