# Contratto motore deterministico ↔ LLM — reazioni NPC

Delivery contract dell'intervento richiesto in `/tmp/pi-task-reaction-contract.md`
(branch `fix/reaction-contract-final`). Intervento **piccolo, incrementale e
focalizzato**: trigger del turno corrente, `actorId`+`optionId` nelle reazioni
LLM, validazione deterministica fail-closed, rimozione dal prompt delle regole
duplicate di riselezione degli attori.

## Flusso risultante

```
CURRENT PLAYER ACTION
  ↓ DETERMINISTIC TRIGGER          core/simulation/ReactionContext.ts
  ↓ RELEVANT ACTORS
  ↓ ACTOR-SPECIFIC ALLOWED OPTIONS
  ↓ LLM: actorId + optionId + motivazione/narrazione
  ↓ DETERMINISTIC VALIDATOR        core/simulation/ReactionDecisions.ts
  ↓ VALID? ├─ YES → continua
           └─ NO  → un solo repair di formato → LLMContractError
  ↓ MATERIAL EFFECT VALIDATION     WorldIntelService.reconcileNpcMaterialMeasures
  ↓ TIMELINE / CHECKPOINT
```

## 1. Trigger del turno corrente

`GameDataService` passava `this.ctx.actions()` (storico completo) e
`buildReactionContext` usava `actions[0]` + `focusTexts[0]` mescolando azione e
ID. Ora:

- `ReactionContextInput.currentActions: CurrentReactionAction[]` (`actionId`, `text`);
  il campo storico `actions` è **rimosso** dal contratto del trigger;
- priorità: `currentActions` → testo del turno → processo → pressione esterna →
  pressione interna → filone precedente;
- `trigger.summary` e `trigger.sourceRef` appartengono **sempre alla stessa
  azione**; senza ID canonico non si associa l'ID di un'altra azione (nessun ID
  sintetico);
- `TurnPipelineService` passa il lotto corrente con gli `actionId` reali.

## 2. `actorId` + `optionId`

- `SimulationPolityReaction` ha `actorId?`/`optionId?`: **opzionali nei tipi
  persistiti** (i save/timeline legacy restano leggibili senza riscritture),
  **obbligatori nel validator del nuovo output**.
- Il parser normalizza `actorId`/`actor_id` e `optionId`/`option_id`.
- Il motivo per cui non basta `allowedOptionIds`: un attore potrebbe scegliere
  l'opzione di un **altro** attore.

## 3. Validator fail-closed

`core/simulation/ReactionDecisions.ts` (puro, senza DB né LLM):

| controllo | codice |
|---|---|
| `actorId` presente | `missing_actor_id` |
| `actorId` ∈ `RelevantActor` | `unknown_actor` |
| `optionId` presente | `missing_option_id` |
| `optionId` ∈ opzioni di **quell'** attore | `option_not_owned_by_actor` / `unknown_option` |
| `reactions.length ≤ maxReactions` | `too_many_reactions` |
| effetto materiale fuori dalla categoria dell'opzione | `material_scope_violation` |

`reactions: []` è **valido** (nessuna reaction forzata per un fatto interno).

`repairReactionDecisions({ events, context, repair })`:

- valido → **nessuna** chiamata LLM;
- invalido → **una** chiamata `repair` che deve preservare gli eventi (stesso
  numero, stesse `headline`/`date`, stesse `mapChanges`) e correggere solo
  `actorId`/`optionId`;
- ancora invalido o eventi alterati → `LLMContractError`. **Nessun** fallback
  `events: []`, nessun retry multiplo, nessuna rigenerazione della simulazione.

Nel percorso reale (`PromptBuilder.runSimulation`): gli eventi con reactions
fuori contratto **non vengono pubblicati durante lo streaming**; a risposta
completa si valida tutto l'output e si esegue il singolo
`repairReactionFormat` (LLM, `temperature 0.05`, prompt con la sola lista
attori/opzioni ammessi + gli eventi già emessi).

## 4. Compatibilità

- Tipi persistiti: campi nuovi opzionali → save, timeline, eventi già nel DB,
  replay/rewind e checkpoint restano leggibili e **non riscritti**.
- Nessuna validazione quando il contesto strutturato è assente (percorsi legacy
  e dati storici).
- `optionId` assente = reazione legacy: il gate materiale non si applica
  (comportamento precedente conservato).

## 5. §7 — `counterAction` e effetti materiali

`optionMaterialScope(optionId)`: `:mobilize`/`:counter` → `military`+`construction`;
`:embargo` → `trade`; `:negotiate`/`:condition`/`:reject`/`:mediate` → nessuna
categoria materiale. `reconcileNpcMaterialMeasures` (che materializza una
controazione **testuale** in `start_mobilization`/`start_construction`) ora
rispetta questa relazione: un negoziato non mobilita unità. Nessun nuovo engine:
la mappa resta validata da `EffectValidator` come prima.

## 6. §8 — prompt

Nuova regola autoritativa unica `buildReactionContractGuard()`, presente **una
sola volta** per prompt finale (compatto e standard/incrementale). Rimossi i
duplicati di riselezione: «quella politia deve comparire», «Teatro della crisi»,
«note di comodo», catena NPC incondizionata. Restano stile, personalità/memoria,
priority, response, note, causalità, proporzionalità, proposta/decisione/esito e
le regole `mapChanges`.

## 7. Rilevamento degli attori nominati (§2, necessario per il fail-closed)

Con il contesto come unica fonte degli attori ammessi, un attore **nominato ma
non elencato** avrebbe fatto fallire un turno legittimo. Due correzioni minime in
`mentionedPolityIds`:

- alias aggiuntivi per politia (`polityAliases`: nome italiano del registro +
  codice stato) forniti da `GameDataService`;
- match per **radice condivisa** (≥ `min(8, len)`, minimo 5) per le forme flesse
  («mediazione cecoslovacca» → `CZE`), coerente con il matching già usato dal
  resolver dei nomi.

Limite residuo: i demonimi che non condividono la radice del nome («risposta
polacca» → `POL`) non sono riconosciuti; in quel caso il repair può svuotare le
reactions ma non aggiungere l'attore (fail-closed).

## 8. Test

| file | contenuto |
|---|---|
| `tests/reaction-context.test.ts` | A: trigger del turno corrente (mai `A1`), summary+sourceRef coerenti, nessun ID arbitrario, alias/forme flesse |
| `tests/reaction-decisions.test.ts` | B–J: actor corretto/estraneo/inventato, option di un altro attore, tetto, legacy leggibile ma non accettato, repair singolo + `LLMContractError` + divieto di rigenerare, `reactions: []`, relazione materiale |
| `tests/reaction-contract-prompt.test.ts` | protocollo compatto e standard richiedono `actorId`/`optionId`; regola autoritativa unica; duplicati assenti |
| `tests/npc-relevance.test.ts` | integrazione: attore fuori teatro → fail-closed; `:counter` materializza, `:condition` no |
| `tests/chats.test.ts`, `tests/stage2.test.ts` | fixture allineate al contratto (chat, auto-jump, materializzazione) |

## 9. Quality Gate eseguito

```
backend:  126 file / 1062 test  → verde
frontend: 39 file / 220 test    → verde
tsc --noEmit (backend, frontend) → pulito
build backend (tsc) / frontend (vite) → ok
e2e mock 17/17 · a11y 3/3 · git diff --check → pulito
```

## 10. Limiti residui

1. Demonomi senza radice comune («polacca») non riconosciuti nel contesto (vedi §7).
2. La relazione optionId ↔ categoria materiale vale per l'**auto-materializzazione**
   del motore: una `mapChange` emessa esplicitamente dall'LLM resta validata da
   `EffectValidator`, non dal legame con la reaction.
3. Nessuno smoke con provider LLM reale: il comportamento di repair/rifiuto è
   verificato con provider mock e test puri.
