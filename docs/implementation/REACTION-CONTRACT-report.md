# Contratto motore deterministico ↔ LLM — reazioni NPC

Delivery contract dell'intervento richiesto in `/tmp/pi-task-reaction-contract.md`.
Intervento **piccolo, incrementale e focalizzato**: trigger del turno corrente,
`actorId`+`optionId` nelle reazioni LLM, validazione deterministica fail-closed,
rimozione dal prompt delle regole duplicate di riselezione degli attori.

Storia: PR #18 (`74a37c8`, branch `fix/reaction-contract-final`) + hardening
`improve/reaction-repair-fallback` che chiude i rilievi della revisione
indipendente (`docs/implementation/REVIEW-INDIPENDENTE-REACTION-CONTRACT.md`).

## Flusso risultante

```
CURRENT PLAYER ACTION
  ↓ DETERMINISTIC TRIGGER          core/simulation/ReactionContext.ts
  ↓ RELEVANT ACTORS
  ↓ ACTOR-SPECIFIC ALLOWED OPTIONS
  ↓ LLM: actorId + optionId + motivazione/narrazione
  ↓ DETERMINISTIC VALIDATOR        core/simulation/ReactionDecisions.ts
  ↓ VALID? ├─ YES → continua
           └─ NO  → un solo repair di FORMATO → LLMContractError
  ↓ MATERIAL EFFECT VALIDATION     WorldIntelService.reconcileNpcMaterialMeasures
  ↓ TIMELINE / CHECKPOINT
```

## 1. Trigger del turno corrente

- `ReactionContextInput.currentActions: CurrentReactionAction[]` (`actionId`,
  `text` del **lotto corrente**); il campo storico `actions` è rimosso dal
  contratto del trigger.
- Priorità: `currentActions` → testo del turno → processo → pressione esterna →
  pressione interna → filone precedente.
- `trigger.summary` e `trigger.sourceRef` appartengono **sempre alla stessa
  azione**; senza ID canonico non si associa l'ID di un'altra azione.
- Il contesto è costruito dal **testo originale** dell'ordine (quello che il
  giocatore ha scritto/accodato), non dalla sua riformulazione: il trigger deve
  citare l'ordine reale. La conversione avviene dopo, dentro il percorso di
  simulazione (vedi §9, rilievo N3).

## 2. `actorId` + `optionId`

- `SimulationPolityReaction` ha `actorId?`/`optionId?`: **opzionali nei tipi
  persistiti** (save/timeline legacy leggibili, non riscritti), **obbligatori
  nel validator del nuovo output**.
- Il parser normalizza `actorId`/`actor_id` e `optionId`/`option_id`.
- Non basta `allowedOptionIds`: un attore potrebbe scegliere l'opzione di un
  **altro** attore.

## 3. Validator fail-closed

`core/simulation/ReactionDecisions.ts` (puro, senza DB né LLM):

| controllo | codice |
|---|---|
| `actorId` presente | `missing_actor_id` |
| `actorId` ∈ `RelevantActor` | `unknown_actor` |
| `optionId` presente | `missing_option_id` |
| `optionId` ∈ opzioni di **quell'** attore | `option_not_owned_by_actor` / `unknown_option` |
| `reactions` delle **politie** ≤ `maxReactions` | `too_many_reactions` |

Il budget conta come il motore: `ReactionContext` calcola `maxReactions` sulle
sole politie, quindi gli attori interni (fazioni, settori) non consumano il
tetto delle reazioni diplomatiche. `reactions: []` è **valido**.

**Attribuzione**: la canonicalizzazione usa `actorId` validato come fonte
autorevole (`polityName` viene riscritto con il nome pubblico di quell'attore) e
salta il filtro di pertinenza testuale, perché la selezione degli attori è del
motore. Senza `actorId` resta il percorso storico su `polityName`, e in quel
caso **`actorId` non viene aggiunto**: nessuna riscrittura di dati legacy.

## 4. Un solo repair di formato, con invarianti verificabili

`repairReactionDecisions({ events, context, repair })`:

- valido → **nessuna** chiamata LLM;
- invalido → **una** chiamata `repair`, poi ri-validazione.

Invarianti imposti al repair (rilievo **B1** della revisione):

1. stesso numero di eventi;
2. **cronaca identica**: `headline`, `date`, `description` e `mapChanges`
   (confronto canonico, quindi l'ordine delle chiavi non conta) — un repair non
   può iniettare effetti materiali né riscrivere il dispaccio;
3. **nessuna perdita di una reazione di un attore ammesso** dal motore, salvo il
   caso in cui il motivo del repair sia `too_many_reactions` (lì ridurre è
   esattamente la correzione richiesta);
4. l'eventuale **omissione** riguarda solo reazioni di attori fuori contesto, per
   cui non esiste alcun `actorId`/`optionId` compatibile. È una degradazione
   ammessa, resa **osservabile** da un `console.warn` con il conteggio delle
   reaction omesse;
5. qualunque violazione o output ancora invalido → `LLMContractError`. Nessun
   fallback `events: []`, nessun retry, nessuna rigenerazione.

Il repair accetta sia `{"events":[...]}` sia il proseguimento in **NDJSON** del
protocollo originale: entrambe le forme correggono la stessa cronaca e non
servono chiamate ausiliarie aggiuntive.

## 5. Pubblicazione in streaming (rilievo B2)

Nell'ordine di gioco l'evento riparato non può essere pubblicato dopo quelli che
lo seguono (in auto-jump la mappa verrebbe applicata fuori ordine cronologico) e
non può essere perso dal tetto eventi. Regola: l'evento con reactions fuori
contratto **non viene pubblicato** e la pubblicazione **live** si ferma; a
stream concluso, dopo l'unico repair, tutti gli eventi escono **in ordine**
(la deduplica per contenuto evita doppioni). Se il repair non corregge, il run
fallisce chiuso e la sessione ripristina lo stato dello stream (rollback già
esistente in `TurnPipelineService`).

## 6. Compatibilità

- Campi nuovi opzionali nei tipi persistiti → save, timeline, eventi nel DB,
  replay/rewind e checkpoint restano leggibili.
- Nessuna validazione quando il contesto strutturato è assente (percorsi legacy
  e dati storici).
- Reazioni legacy senza `optionId`: il gate materiale non si applica
  (comportamento precedente conservato) e `actorId` non viene aggiunto.
- Copertura: test G (parse di un payload legacy) **e** test end-to-end
  `canonicalizeEventReactions` su un evento senza `actorId`/`optionId`
  (rilievo O4).

## 7. §7 — `counterAction` e effetti materiali

`optionMaterialScope(optionId)`: `:mobilize`/`:counter` → `military`+`construction`;
`:embargo` → `trade`; `:negotiate`/`:condition`/`:reject`/`:mediate` → nessuna
categoria. `reconcileNpcMaterialMeasures` rispetta questa relazione: un negoziato
non auto-materializza unità o cantieri. Le reazioni legacy senza `optionId`
restano invariate. Nessun nuovo engine: la mappa resta validata da
`EffectValidator`.

Il controllo è attivo sull'**auto-materializzazione**; una `mapChange` emessa
esplicitamente dall'LLM resta validata da `EffectValidator`, non dal legame con
la reazione (limite dichiarato, §10.2).

## 8. §8/§9 — prompt

Regola autoritativa unica `buildReactionContractGuard()`, presente **una sola
volta** in ogni prompt realmente assemblato: percorso compatto
(`buildConstrainedSimulationPrompt`), standard e override del preset (via
`buildIncrementalOutputInstruction`, che è anche la sezione dove vive l'esempio
JSON delle `reactions`). Rimossi i duplicati di riselezione («quella politia deve
comparire», «Teatro della crisi», «note di comodo», catena NPC incondizionata).
Restano stile, personalità/memoria, priority, response, note, causalità,
proporzionalità, proposta/decisione/esito e regole `mapChanges`.

## 9. Riconoscimento degli attori nominati

Con il contesto come unica fonte degli attori ammessi, un attore **nominato ma
non elencato** farebbe fallire (o svuotare) un turno legittimo. Due correzioni:

- `polityNameAliases(polityId, registeredName)` in `utils/country-facts.ts`:
  codice stato + nome del registro + nome italiano curato, **unica fonte** usata
  sia dal resolver dei nomi sia dal `GameDataService` (nessuna divergenza);
- match per **radice condivisa** (≥ `min(8, len)`, minimo 5) per le forme flesse
  («mediazione cecoslovacca» → `CZE`).

Limite residuo: i demonimi che non condividono la radice («risposta polacca» →
`POL`) non sono riconosciuti; non è stata inventata una tabella di demonimi
(assente dal catalogo). Conseguenza mitigata: il repair può omettere la reazione
fuori contesto con log esplicito, e il turno non si perde.

## 10. Test

| file | contenuto |
|---|---|
| `tests/reaction-context.test.ts` | A: trigger del turno corrente (mai `A1`), summary+sourceRef coerenti, nessun ID arbitrario, alias/forme flesse |
| `tests/reaction-decisions.test.ts` | B–J + F2 (budget con attori interni) + H6/H7/H8/H9 (invarianti del repair: cronaca, effetti, perdita di attori ammessi, omissione ammessa, trim con `too_many_reactions`) |
| `tests/reaction-contract-prompt.test.ts` | contratto in entrambi i protocolli e nel percorso override; regola autoritativa unica; istruzioni del repair (source contract); una sola chiamata di repair |
| `tests/reaction-stream-order.test.ts` | B2: ordine di pubblicazione dopo il repair (indici 0,1,2) e fail-closed senza eventi fuori ordine |
| `tests/npc-relevance.test.ts` | integrazione: attore fuori teatro fail-closed; repair che omette; attribuzione da `actorId`; evento legacy non riscritto; `:counter` materializza / `:condition` no |
| `tests/country-facts.test.ts` | unicità e contenuto degli alias di politia |
| `tests/chats.test.ts`, `tests/stage2.test.ts` | fixture allineate al contratto (chat, auto-jump, materializzazione); il flag di test `converterPreservesOriginal` è stato **rimosso**: non serve, il contesto usa il testo originale dell'ordine |

## 11. Quality Gate eseguito

```
backend:  127 file / 1075 test  → verde
frontend: 39 file / 220 test    → verde
tsc --noEmit (backend, frontend) → pulito
build backend (tsc) / frontend (vite) → ok
e2e mock 17/17 · a11y 3/3 · git diff --check → pulito
```

## 12. Esito della revisione indipendente

`docs/implementation/REVIEW-INDIPENDENTE-REACTION-CONTRACT.md` (revisore ≠
implementatore, verdetto «ACCETTABILE CON RILIEVI»).

| rilievo | esito |
|---|---|
| **B1** repair non preservava `mapChanges`/`description`/reactions | **CHIUSO**: impronta di cronaca (headline, data, descrizione, mapChanges) + divieto di perdere reazioni di attori ammessi (eccezione `too_many_reactions`) + log delle omissioni; test H6–H9 |
| **B2** evento riparato ri-emesso fuori ordine / scartabile | **CHIUSO**: la pubblicazione live si ferma al primo evento fuori contratto e riprende in ordine dopo il repair; test `reaction-stream-order` |
| N1 attribuzione da `polityName` | **CHIUSO**: `actorId` validato è la fonte autorevole; nessuna riscrittura se `actorId` è assente; test end-to-end |
| N2 budget `maxReactions` | **CHIUSO**: il validator conta come il motore (solo politie); test F2 |
| N3 contesto sulle azioni pre-conversione | **DISPOSIZIONE**: scelta deliberata (il trigger deve citare l'ordine reale del giocatore; la conversione è una riformulazione). Il flag di test che mascherava il caso è stato rimosso |
| N4 `validateReactionMaterialScope` codice morto | **CHIUSO**: funzione e codice `material_scope_violation` rimossi (il gate resta in `reconcileNpcMaterialMeasures` + `reactionAllowsMaterialCategory`) |
| N5 demonimi | **LIMITE DICHIARATO** con degradazione osservabile (§9) |
| O1 «un solo repair» ambiguo | **CHIARITO**: un solo repair *delle reactions*; restano i due ausiliari preesistenti e distinti (contratto di simulazione / chiusura compatta) |
| O2 `:embargo → trade` inerte | **ACCETTATO E COMMENTATO**: dichiara l'intento di §7; oggi nessuna misura automatica è di categoria `trade`, quindi l'effetto pratico è il divieto di auto-materializzare unità/cantieri |
| O3 riduzioni classificate come militari | **ACCETTATO**: `detectNpcMaterialMeasure` non produce mai `cancel_mobilization`/`remove_unit`; classificazione irraggiungibile, commentata |
| O4 copertura legacy solo sul parse | **CHIUSO**: test end-to-end di non riscrittura in `npc-relevance` |
| O5 rischi del branch di hardening | **CHIUSO**: policy di omissione fissata da test (H8 + integrazione + log); `countryRepository.findByCode` è una ricerca in memoria (nessun accesso DB) |
| O6 `buildSimulationPrompt` standalone senza contratto | **CHIARITO E COPETO**: il contratto vive nella sezione di protocollo dell'output, che ogni prompt assemblato riceve; test anche sul percorso override |

## 13. Limiti residui

1. **Demonomi senza radice comune** («polacca») non riconosciuti: nessuna tabella
   inventata; la reazione fuori contesto può essere omessa dal repair, con log.
2. **`mapChanges` esplicite dell'LLM** non legate all'`optionId`: restano
   validate da `EffectValidator`; il legame con la categoria della decisione vale
   per l'auto-materializzazione del motore.
3. **Nessuno smoke con provider LLM reale**: frequenza reale dei repair e
   robustezza del prompt verso modelli diversi restano non verificate (provider
   mock e test puri).
