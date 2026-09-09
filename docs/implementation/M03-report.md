# M03 — Interpretazione controllata e preflight

## µ1 — Normalizzazione OrderIntent (§5.2)

**Stato:** completata, da revisione indipendente.

- Nuovo `backend-nest/src/core/feasibility/intent.ts`: `OrderIntent` discriminato e `normalizeOrderIntent(unknown)` puro, senza LLM/I/O/mutazioni.
- Union chiusa: `construct`, `produce`, `procure`, `research`, `train`, `maintain`, `move`, `policy`, `diplomatic_proposal`, `cancel_project`, `qualitative`.
- Arity target esatta per kind; `catalogRef` e quantità obbligatori solo dove cambiano materialmente il significato; quantità/valuta IntString canoniche, positive/non-negative secondo il campo; priorità intera 0..1.000.000; dependency e phase ID senza duplicati/self-cycle.
- `authorization` è obbligatoria (`allowPartialStart` esplicito): nessun default o intenzione aggiunta. Input incompleto/ambiguo produce `needs_clarification` strutturato, non una mutazione.
- `qualitative` rifiuta target/catalogRef/quantità materiali: non può diventare spawn, denaro o territorio per omissione.
- `actorPolityId` resta nel payload ma il parser documenta e segnala che la verifica di autorità è server-side (µ2), mai fidarsi del body.

## Test

`tests/feasibility-intent.test.ts`: 6 prove: normalizzazione, chiarimenti obbligatori, target/quantità, qualitative, priorità/dipendenze/budget, actor non canonico.

```
npm --prefix backend-nest test       # 42 file, 373/373 verdi
npm --prefix backend-nest run build  # OK
git diff --check                     # pulito
```

## Prossimo

**µ2:** `FeasibilityService` puro: gate §5.3, reason codes, query allOf/anyOf, autorità/diritti/conoscenze/capacità e distinzione `needs_data` / informazione nascosta. Preview resta non mutante.

## µ2 — FeasibilityService puro, gate §5.3

**Completata.** Nuovo `src/core/feasibility/FeasibilityService.ts`: valutazione deterministica senza LLM/I/O/riserve. Applica scope/identità verificata, entità catalogo, consensi R1, `allOf`+`anyOf` (una via alternativa completa), conoscenze, impianto operativo/compatibile e proprietà/diritto d'uso. `needs_data` distingue esplicitamente `model_data_missing` da `hidden_from_player` senza esporre valori segreti. `qualitative` resta valutabile senza ricetta. Reason code strutturati: `UNKNOWN_ENTITY`, `UNAUTHORIZED_ACTOR`, `KNOWLEDGE_MISSING`, `INDUSTRIAL_CAPABILITY_MISSING`, `DATA_UNAVAILABLE`.

`tests/feasibility-service.test.ts`: 6 test MAT07/MAT08/MAT33/MAT34/MAT35 e ordine qualitativo. Backend **43 file / 379 test** verdi; build e diff puliti.

## Prossimo

**µ3:** allocatore batch temporaneo, priorità/queueSequence/dipendenze e conflitti concorrenti su fondi, materiali e personale (MAT05/MAT10); nessuna riserva canonica.

## µ3 — Allocatore batch temporaneo

**Completata.** Nuovo `BatchAllocator.ts`: copia pool fondi/materiali/personale bigint, ordina per `priority` utente poi `queueSequence` server e rispetta le dipendenze. Restituisce solo assessment `feasible/blocked` con `INSUFFICIENT_CASH`, `MATERIAL_SHORTAGE`, `WORKFORCE_SHORTAGE`, `DEPENDENCY_BLOCKED`: non scrive ledger, riserve, DB o stato canonico. Fixture P1/P2: P1 600 TEST/60kg/600 lavoratori fattibile, P2 bloccato sui tre limiti. Test 3 (MAT05/MAT10, tie-break/dipendenze/ciclo); backend **44 file / 382 test** verdi.

## Prossimo

**µ4:** endpoint evaluate preview con anchor/TTL/queueVersion e nessuna mutazione; assessment stale non autorizza commit (MAT13/MAT15).

## µ4-a — Contratto preview anchor/TTL

**Completata (solo contratto cache).** Nuovo `AssessmentStore<T>` puro: cache TTL in memoria, anchor completo `{gameId, branchId, checkpointId?, revision, queueVersion}` e `StaleAssessmentError` (`STALE_ASSESSMENT`) per TTL, queue, revisione o ramo diversi. Nessuna scrittura DB/ledger/riserve; la cache non è autorità di commit. Test `assessment-store.test.ts`: 2 prove MAT13/MAT15.

**Endpoint non ancora esposto deliberatamente:** `games` non conserva un binding server-side immutabile a preset/catalogo/fatti effettivi; accettarli nel body permetterebbe al client di falsificare conoscenze, diritti e risorse. Il prossimo micro-step µ4-bis deve persistere/ricostruire tale binding e solo allora esporre `POST /games/:id/actions/evaluate` con `canonicalMutation:false`. Backend **45 file / 384 test** verdi.

## µ4-bis — Binding catalogo server-side e route evaluate

**Completata.** Migrazione additiva `worlds.template_id`; la generazione del mondo persiste il `templateId` e il repository lo conserva. `POST /games/:id/actions/evaluate` accetta solo `body.intent`, normalizza, carica il catalogo da `data/presets/<template_id>` e risolve polity/tesoro dalla sessione+catalogo: non accetta catalogo, diritti, conoscenze o risorse dal client. Risposta sempre `canonicalMutation:false`, con anchor `{gameId,branchId,revision,queueVersion}` e assessment cache TTL. Mondo legacy senza binding → `409 catalog_binding_missing`; schema ambiguo → 422 chiarimenti; nessuna scrittura di queue/ledger/riserve. Il binding dei consensi/knowledge dinamici resta da M03 successivo: preview può quindi restituire blocker conservativi, mai un successo inventato.

Verifica: backend **45 file / 384 test** verdi, build/diff OK.

## µ5 — Alternative e partial start espliciti

**Completata.** `OrderAssessment` include `alternatives` solo come `research`/`alternative_path` con `requiresConfirmation:true`; nessuna via `anyOf` viene scelta o applicata dal service. `allowPartialStart:true` senza `allowedPhaseIds` produce warning esplicito e non avvia frazioni/materiali. Test aggiunto: 7 prove FeasibilityService; backend **45 file / 385 test** verdi.

**M03 non ancora chiusa:** servono test d'integrazione della route `/actions/evaluate` (binding reale template→world→game, `canonicalMutation:false`) e binding server-side di consensi/conoscenze/diritti dinamici prima dell'accettazione indipendente.

## µ6 — Route evaluate verificata e ID catalogo

**Completata.** Corretto il normalizzatore: ID d'intento/catalogo (`ALPHA`, `ALPHA-nord`) sono distinti dagli ID minuscoli di valuta/risorsa. Nuovo test di integrazione `evaluate-route.test.ts`: world con `template_id` → sessione → `POST /actions/evaluate`; il server carica il solo catalogo bindato e ritorna `canonicalMutation:false`/anchor, con queueVersion e conteggio ledger invariati. Intent senza quantità → 422 `needs_clarification`, non raggiunge il motore. Backend **46 file / 387 test** verdi.

**M03 implementata µ1–µ6;** facts dinamici di conoscenza/consensi/diritti restano volutamente conservativi (non client-supplied) finché M04/M05 non ne diventano fonte canonica. Accettazione soggetta a revisione indipendente. Prossimo pacchetto: M04.
