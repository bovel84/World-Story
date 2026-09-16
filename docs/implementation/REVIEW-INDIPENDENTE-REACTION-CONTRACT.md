# Revisione indipendente — Contratto motore ↔ LLM per le reazioni NPC

- **Repo**: `/Users/bovel/Desktop/World Story`
- **Revisione oggetto**: `main` @ `74a37c8` (merge PR #18, branch `fix/reaction-contract-final`)
- **Base diff**: `416d1fd..main`
- **Task di riferimento**: `/tmp/pi-task-reaction-contract.md`
- **Delivery contract**: `docs/implementation/REACTION-CONTRACT-report.md`
- **Metodo**: sola lettura. Codice `main` isolato in un worktree `git worktree add --detach /tmp/ws-main-review main`; test e `tsc` eseguiti lì (il worktree locale era su `improve/reaction-repair-fallback` con modifiche non committate, quindi non rappresentativo di `main`).
- **Ambiente test**: `vitest 4.1.11` (binario di root; il `node_modules` di `backend-nest` è incompleto e non contiene vitest), Node con `node_modules` di root linkato.

---

## 1. Verdetto sintetico

**ACCETTABILE CON RILIEVI.**

Il nucleo del contratto è implementato e coperto: il trigger usa il lotto corrente (`currentActions`), `actorId`/`optionId` sono nel contratto e nel parser, il validator è fail-closed sull'attore e sull'opzione *di quell'attore*, `reactions: []` è valido, i dati legacy restano leggibili e il prompt è stato ripulito dai duplicati. La suite backend completa passa (126 file / 1062 test) e `tsc --noEmit` è pulito.

Restano però **due rilievi bloccanti** nel percorso di repair (il quale non è la happy path ma è esattamente il meccanismo su cui il task costruisce il fail-closed): il repair non è vincolato a preservare `mapChanges`/`description`/numero di reactions, e in streaming l'evento riparato viene ri-emesso in coda, fuori ordine, potendo essere scartato in silenzio dal guard di data. Ci sono inoltre diversi rilievi non bloccanti (disallineamento `actorId`↔`polityName`, budget `maxReactions`, contesto costruito sulle azioni *pre-conversione*).

---

## 2. Tabella requisito → stato → prova

| § | Requisito | Stato | Prova |
|---|---|---|---|
| §1 | Trigger = ordine del turno corrente, mai lo storico; `summary`+`sourceRef` stessa azione; nessun ID arbitrario | **SODDISFATTO** | `ReactionContext.ts:283-305` (priorità `currentActions`→`focusTexts`→processi→pressioni); `TurnPipelineService.ts:190-193` passa il lotto corrente con `actionId` reali. Test A/A2/A3 in `tests/reaction-context.test.ts` (eseguite, verdi) |
| §2 | Il motore decide chi/cosa; struttura `RelevantActor`/`ActorOption`/`MaterialConstraint` mantenuta | **SODDISFATTO** | `ReactionContext.ts:60-83`; `renderReactionContext` `:396-415` |
| §3 | `actorId`+`optionId` obbligatori per NUOVE reaction; opzione dell'attore specifico (non solo `allowedOptionIds`) | **SODDISFATTO** (con riserva, N1) | `prompts/types.ts:66-80`; parser `prompts/simulation/parse.ts:244-245`; validator `ReactionDecisions.ts:184-189`; test B/C/D/E/I (verdi) |
| §4 | Validator fail-closed + **un solo** repair, nessuna rigenerazione, nessun fallback vuoto, nessun silent-ignore | **PARZIALE** | Validator ok (`ReactionDecisions.ts:137-208`, test B–F/J); repair singolo (`:262-296`, test H/H2/H3/H5). **Ma** `eventKey` non verifica `mapChanges`/`description`/reactions (**B1**) e la ri-emissione del riparato è fuori ordine/scartabile (**B2**) |
| §5 | Compatibilità save/timeline/eventi legacy; nessuna riscrittura | **SODDISFATTO** (con riserva, O4) | Campi `?` in `types.ts`; nessuna migrazione che li scriva; test G (parse legacy). Nessun test di round-trip DB |
| §6 | L'LLM conserva il ruolo politico dentro la categoria dell'opzione | **SODDISFATTO** | Guard `prompts/simulation/guards.ts:22-28` («Dentro la categoria scelta decidi tu il resto») |
| §7 | `counterAction` narrativo, nessun effetto materiale arbitrario; gate minimo optionId↔categoria | **PARZIALE** | Gate attivo solo sull'auto-materializzazione `WorldIntelService.ts:216-221` (test `npc-relevance` "un negoziato non materializza…"); `validateReactionMaterialScope` è **codice morto**; le `mapChanges` esplicite dell'LLM restano fuori (limite dichiarato §10.2) |
| §8 | Rimozione regole duplicate di riselezione; una regola autoritativa unica | **SODDISFATTO** | `prompts/simulation/guards.ts:15-28`; duplicati rimossi (`SubjectCoherenceGuard`, `Teatro della crisi`); test `reaction-contract-prompt.test.ts` conta 1 occorrenza per prompt |
| §9 | Contratto applicato a prompt compatto E standard/incrementale | **SODDISFATTO** | `prompt.ts:55` (`buildIncrementalOutputInstruction`) e `:119` (`buildConstrainedSimulationPrompt`); test dedicati (verdi) |
| §10 | Test A–J | **SODDISFATTO con 1 gap** | A, B–F, G, H, I, J presenti e verdi. H4 copre solo la modifica di `headline`, **non** `mapChanges`/reactions → non copre B1 |
| §11 | Nessun refactoring fuori scope / nessuna modifica UI-frontend-routes | **SODDISFATTO** | `git diff --stat 416d1fd..main`: solo `backend-nest/src|tests` + docs; nessun file `frontend/`, `routes/`, schema API o migrazione |

---

## 3. Rilievi

### BLOCCANTE

**B1 — Il repair non preserva davvero l'evento: `mapChanges`, `description` e numero di reactions non sono verificati.**
- File/righe: `backend-nest/src/core/simulation/ReactionDecisions.ts:242-247` (`eventKey` = `headline|date`) e `:275-284` (controlli in `repairReactionDecisions`).
- Prova (codice):
  ```ts
  function eventKey(event: ReactionEventLike): string {
    return `${String(event.headline || '').trim()}|${String(event.date || '').trim()}`;
  }
  ...
  if (!Array.isArray(repairedEvents) || repairedEvents.length !== events.length) { throw ... }
  for (let index = 0; index < events.length; index += 1) {
    if (eventKey(repairedEvents[index]) !== eventKey(events[index])) { throw ... }
  }
  ```
  Il repair riceve `parseSimulationResponse(repaired.content).events` (`prompt-builder.ts:1120-1134`) e viene accettato se numero di eventi, `headline` e `date` coincidono. `mapChanges`, `description` e l'elenco delle reactions possono cambiare senza che nulla lo rilevi. Il test H4 (`tests/reaction-decisions.test.ts`) altera solo `headline`: nessun test su `mapChanges` o sull'azzeramento delle reactions.
- Impatto:
  1. Il repair (una chiamata LLM) può iniettare/modificare `mapChanges` → effetti materiali reali **non legati all'`optionId`**, quindi aggira il gate §7 proprio nel percorso fail-closed.
  2. Il repair può eliminare una reaction problematica (basta omettere `polityName`/`response`: `parse.ts:224` scarta la reaction) e superare la rivalidazione: la decisione NPC scompare **in silenzio**, contro §4 («non ignorare silenziosamente il problema») e contro il commento del modulo («correggere solo `actorId`/`optionId`»).
  3. Il report §3 afferma «stesse `mapChanges`»: affermazione non enforced e non testata.
- Per chiuderlo: confrontare `mapChanges` (deep/JSON), la lunghezza di `reactions` per evento e i campi diversi da `actorId`/`optionId` (whitelist), oppure far restituire al repair solo le coppie `(evento, reaction, actorId, optionId)` e ricomporre l'evento originale nel motore. Aggiungere un test H6 (cambio `mapChanges` → `LLMContractError`) e H7 (reaction omessa → rifiuto o policy dichiarata).

**B2 — In streaming l'evento riparato è ri-emesso in coda fuori ordine e può essere scartato silenziosamente.**
- File/righe: `backend-nest/src/prompt-builder.ts:974-983` (`emitEvent`/`emittedCount`), `:1074-1083` (repair + `for (const event of result.events) emitEvent(event)`); `backend-nest/src/game/TurnPipelineService.ts:224-232` (`dateInPeriod(canonicalEvent.date, previousDate, horizonDate)`).
- Prova (traccia di codice):
  - Durante lo streaming, `emitEvent` **scarta** l'evento con reaction invalida **senza** incrementare `emittedCount` (`prompt-builder.ts:979`): `if (reactionContext && validateReactionDecisions(...).length > 0) return;`.
  - Gli eventi successivi validi ricevono quindi indici compressi (E0 invalido scartato → E1 emesso con `index = 0`).
  - Dopo il repair, il loop finale (`:1083`) riemette solo l'evento riparato, **dopo** tutti gli altri e con indice più alto.
  - In `TurnPipelineService`, `previousDate` è la data dell'ultimo evento già applicato/proposto; se l'evento riparato è cronologicamente precedente, `dateInPeriod` restituisce `false` → l'evento è scartato con un `console.warn`, senza errore e senza entrare in `appliedEvents`/`proposedEvents`. Anche l'indice del broadcast `jump_event` risulta invertito.
- Impatto: il flusso dichiarato «invalido → un repair → continua» **non riparte con l'evento corretto** per gli eventi non-finali; il turno può perdere un evento della cronaca e la mappa non riceve le sue `mapChanges`. Nessun test copre un repair *riuscito* in streaming (i test puri H2 usano il callback direttamente; `npc-relevance` copre solo il repair fallito).
- Per chiudere: riservare posizione/indice agli eventi scartati in streaming (o non scartarli lì e validare/riparare l'intero output prima dell'emissione ordinata). Test di integrazione auto-jump con reaction invalida sul **primo** evento e verifica che l'evento riparato finisca nel checkpoint nella posizione corretta.

### NON BLOCCANTE

**N1 — `actorId` è validato, ma attribuzione, chat e persistenza usano ancora `polityName`.**
- `backend-nest/src/game-session.ts:1449-1470` (`canonicalizeEventReactions` risolve `reaction.polityName`, filtra con `crisisRelevantPolityIds`, non guarda mai `actorId`); `:1490+` (`reactionChatStarts`), `eventDetail`.
- Impatto: un `actorId` valido con `polityName` incoerente (es. `actorId:"FRA"`, `polityName:"Germania"`) supera il validator ma viene attribuito/visualizzato come un altro attore; un `polityName` di una polity rilevante ma non inclusa nel `ReactionContext` può comparire nel dispaccio. La garanzia «nessun attore fuori dal contesto» vale solo sull'`actorId`, non sull'attore effettivo.
- Chiusura: derivare il `polityName` canonico da `actorId` e rifiutare il disallineamento.

**N2 — `maxReactions` non conta gli attori interni, ma il validator sì.**
- `backend-nest/src/core/simulation/ReactionContext.ts:392` (`actors.filter(role !== 'economic_sector' && role !== 'internal_faction')`) vs `backend-nest/src/core/simulation/ReactionDecisions.ts:197` (`list.length > context.maxReactions`, su tutte le reaction).
- Impatto: un contesto con 1 polity + 2 attori interni ha `maxReactions = 1`; 1 reaction di polity + 1 di fazione = 2 → `too_many_reactions` su un uso legittimo.
- Chiusura: allineare il budget (includere gli attori interni o contare solo le polity in fase di validazione).

**N3 — Il `ReactionContext` è costruito sulle azioni grezze; la simulazione usa quelle convertite.**
- `backend-nest/src/game/TurnPipelineService.ts:190-193` costruisce `gameData`/`reactionContextData` dal testo del lotto **pre-conversione**; `backend-nest/src/agents.ts:87-99` converte (`convertActionsBatch`) e passa `convertedActions` a `runSimulation`.
- Prova aggiuntiva: nel diff `stage2.test.ts` compare il nuovo flag `converterPreservesOriginal` e un ordine di test cambiato da «Attendere la risposta polacca» a «Attendere la risposta della Polonia» — cioè un caso prima valido è stato corretto nel testo per far passare il contratto.
- Impatto: se il converter parafrasa e perde/rinomina la controparte, il fail-closed può rifiutare un turno legittimo (o far svuotare le reactions dal repair).
- Chiusura: costruire il `ReactionContext` dopo la conversione, sui testi effettivamente simulati.

**N4 — La relazione `optionId`↔categoria materiale esiste solo per l'auto-materializzazione; `validateReactionMaterialScope` è codice morto.**
- `backend-nest/src/game/WorldIntelService.ts:221` è l'unico uso; `backend-nest/src/core/simulation/ReactionDecisions.ts:211-226` (`validateReactionMaterialScope`, codice `material_scope_violation`) **non è mai chiamato** (grep su `src` e `tests`: solo definizione).
- Impatto: le `mapChanges` esplicite dell'LLM non sono legate all'`optionId`; il report (§3, tabella) elenca `material_scope_violation` fra i controlli del validator, ma nessun percorso può produrlo.
- Chiusura: o collegare il controllo alle `mapChanges` dell'evento, o rimuovere il codice morto e togliere la riga dalla tabella del report (il limite §10.2 resta accettabile se dichiarato come tale).

**N5 — Demonymi senza radice comune non riconosciuti.**
- `backend-nest/src/core/simulation/ReactionContext.ts:200-217` (`sameStem`); limite dichiarato in report §7/§10.1.
- Impatto: «risposta polacca» non produce `POL` → fail-closed su un turno legittimo (o reaction svuotata dal repair). È la stessa classe di regressione emersa in N3/stage2.
- Chiusura: mappa dei demonimi o fallback esplicito a monte.

### OSSERVAZIONE

- **O1 — «Massimo un repair» non vale sul totale delle chiamate ausiliarie.** In una sola risposta possono coesistere: `repairSimulationContract` (`prompt-builder.ts:1028`) **oppure** la chiusura compatta (`:1051-1060`) e il repair reactions (`:1074`). Il claim del report («un solo repair») è corretto solo se riferito alle reactions; il §4 del task non vieta i repair preesistenti, ma la formulazione del report è ambigua.
- **O2 — `:embargo → trade` è inerte.** `measureMaterialCategory` (`ReactionDecisions.ts:95-113`) non ritorna mai `'trade'`, quindi lo scope `['trade']` non è mai esercitato in produzione.
- **O3 — De-escalation bloccata.** `measureMaterialCategory` classifica `cancel_mobilization` e `remove_unit` come `'military'`: una decisione non militare (`:negotiate`, `:condition`) impedisce l'auto-materializzazione di un annullamento/scioglimento, che è un effetto di riduzione.
- **O4 — Copertura legacy parziale.** Il test G verifica il parse di un payload senza `actorId`/`optionId`; nessun test verifica il round-trip di persistenza (scrittura su DB e rilettura invariata). Nel codice non esiste alcuna riscrittura automatica (tipi opzionali, nessuna migrazione), quindi il requisito è ragionevolmente soddisfatto ma non provato end-to-end.
- **O5 — Rischi del branch successivo `improve/reaction-repair-fallback` (non mergiato).**
  - Il repair è ora autorizzato a **omettere** le reaction fuori contesto (`git diff` su `ReactionDecisions.ts` e `prompt-builder.ts`): unito a B1, rende possibile soddisfare il contratto **svuotando** le reactions senza toccare gli eventi. Il fail-closed regge formalmente ma la decisione NPC sparisce in silenzio; da coprire con un test di policy esplicita.
  - `polityNameAliases` unifica resolver e ReactionContext (riduce la divergenza), ma `GameDataService.build` ora chiama `countryRepository.findByCode` (`git diff` su `GameDataService.ts`): accesso DB aggiunto in un percorso di costruzione del read model — da valutare per costo/cicli di vita.
- **O6 — `buildSimulationPrompt` da solo non contiene il contratto `actorId`/`optionId`** (è in `buildIncrementalOutputInstruction`). In `runSimulation` viene sempre concatenato (`prompt-builder.ts:964-969`), quindi oggi è coperto, ma l'uso standalone del prompt standard non dichiarerebbe il contratto.

---

## 4. Comandi eseguiti ed esito reale

Worktree isolato: `git worktree add --detach /tmp/ws-main-review main` (HEAD `74a37c8`).

1. Test mirati richiesti (vitest 4.1.11, binario root):
   ```
   cd /tmp/ws-main-review/backend-nest
   /Users/bovel/Desktop/World\ Story/node_modules/.bin/vitest run \
     tests/reaction-context.test.ts tests/reaction-decisions.test.ts \
     tests/reaction-contract-prompt.test.ts tests/npc-relevance.test.ts \
     tests/chats.test.ts tests/stage2.test.ts
   ```
   **Esito reale: 6 file passati, 107 test passati.**

2. Suite backend completa (per verificare il claim del report §9):
   ```
   cd /tmp/ws-main-review/backend-nest
   /Users/bovel/Desktop/World\ Story/node_modules/.bin/vitest run
   ```
   **Esito reale: 126 file passati, 1062 test passati.** (Claim del report confermato.)

3. Type-check:
   ```
   cd /tmp/ws-main-review/backend-nest
   /Users/bovel/Desktop/World\ Story/node_modules/.bin/tsc --noEmit
   ```
   **Esito reale: exit 0, nessun output.**

4. `git diff --stat 416d1fd..main` → solo `backend-nest/src|tests` + `docs/`; nessuna modifica a frontend, routes, schema API o migrazioni.

**Non eseguiti (e quindi non dichiarati verdi):** test/build frontend, build backend, e2e/a11y/perf, smoke con provider LLM reale. Il report §9 li dichiara verdi: non li ho eseguiti in questa revisione (fuori dal perimetro richiesto), quindi restano affermazioni del solo implementatore.

---

## 5. Limiti residui accettati e motivazione

Accettati come dichiarati e non bloccanti:
1. **Demonomi senza radice comune** (report §10.1). Accettabile come limite di riconoscimento, a condizione che il repair non trasformi il fallimento in uno svuotamento silenzioso (vedi B1/O5). Con la sola logica di `main` il turno può fallire in modo esplicito: comportamento fail-closed corretto.
2. **`mapChanges` esplicite dell'LLM non legate all'`optionId`** (report §10.2). Accettabile *solo* perché `EffectValidator` continua a validare le mutazioni materiali. Non accettabile è che **anche il repair** possa introdurre `mapChanges` senza controllo (B1).
3. **Nessuno smoke con provider LLM reale** (report §10.3). Accettabile, ma lascia non verificate la frequenza reale dei repair e la robustezza del prompt verso modelli diversi.

Non accettati come "limiti" ma come difetti da correggere: **B1** e **B2**.

---

## 6. Giudizio finale

Il contratto è sostanzialmente quello richiesto: la direzione «motore decide lo spazio, LLM sceglie e racconta» è implementata in modo pulito, testabile e deterministico, con buona copertura dei requisiti §1–§3, §5–§6, §8–§9, §11. Il punto debole è la **seconda metà del fail-closed**: il repair non è vincolato a preservare l'evento (B1) e in streaming non garantisce che l'evento corretto venga applicato in ordine (B2). Finché questi due punti non sono chiusi, il claim «output invalido → un repair → continua» è vero per il validator puro ma non per il percorso end-to-end di gioco.
