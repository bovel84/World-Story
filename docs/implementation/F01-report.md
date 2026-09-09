# F01 — ID e contratti end-to-end, micro-consegne `actionId`/`projectId`/coda/outcome

## Pacchetto / revisore / fotografia iniziale

- **Pacchetto:** F01, micro-consegne 1–7 (identità, progetti, contratti runtime, stati coda/queueVersion, outcome tecnico, scenari DoD, backward compatibility).
- **Revisore/esecutore:** pi coding agent; revisione indipendente richiesta prima dell'accettazione.
- **Base:** F00 con fixture SQLite temporanee e C01 dinamico riprodotto.
- **Modifiche preesistenti preservate:** `prompt-builder.ts`, `prompts/simulation.ts` e `tests/prompts.test.ts` erano già modificati localmente. Le modifiche di questa consegna sono limitate ai blocchi dei contratti ID; nessun hunk preesistente è stato ripristinato.

## Requisiti audit / invarianti / test

| Audit | Invarianti | Test | Risultato |
|---|---|---|---|
| A01 | I15 | C01 | Verde: due ordini con testo e conversione identici ricevono outcome invertiti associati dai rispettivi `actionId`. |
| A01 | I15, I18 | Nuovo negativo C01 | Verde: un `actionId` esterno genera `simulation_protocol_error`; la coda torna `pending`. |
| A07 | I15 | C07 | Verde: processi nel contesto riportano `projectId`/`sourceActionId`; la chiusura modifica soltanto il `projectId` dichiarato, anche con titoli duplicati. |
| A01 | I05, I15 | Nuovi contratti runtime | Verde: parser runtime rifiuta ID, enum, date, progetto, evento e batch outcome malformati/duplicati/estranei. |
| A05 | I13 | C05 locale | Verde nel repository: replacement conserva `processing` con `issued/in_progress`; il restore completo di ramo resta F04. |
| A01 | I17 | C01 outcome mancante | Verde: lotto con un solo esito persiste `unresolved` (tecnico) per l’ordine senza risposta; nessuno status inventato in memoria; mai `accepted` implicito. |
| A01 | I15 | C01 riformulazione | Verde: l’esito che cita il testo riformulato (senza ID) risolve solo se individua un’unica azione; la scomposizione implicita resta vietata. |
| — | I02, I03 | C01 ordine composto | Verde: un ordine multi-intento resta un solo ID/lotto/esito, un solo avanzamento; il testo originale resta nella cronaca. |
| A07 | I01, I15 | C07/MAT29 locale | Verde: salto senza nuovi ordini mantiene i progetti (projectId/sourceActionId) nel contesto e non li chiude. |
| A05 | I13 | Migrazione legacy | Verde: uno schema pre-F01 (senza colonne nuove) viene risanato da `initDatabase`; gli stati legacy `processing`/`completed`/`pending` tornano `issued`/`in_progress`, `issued`/`completed`, `queued`/`not_started`; la coda resta operativa. |

## File letti e modificati

**Letti:** contratti/prompt/controller/sessione/repository e test F00/F01 pertinenti (`prompts/types.ts`, `converter.ts`, `simulation.ts`, `prompt-builder.ts`, `agents.ts`, `game-session.ts`, `game.repository.ts`, `stage2.test.ts`).

**Modificati:**

- `backend-nest/src/database.ts`
- `backend-nest/src/domain/contracts.ts`
- `backend-nest/src/repositories/game.repository.ts`
- `backend-nest/src/routes/games.routes.ts`
- `backend-nest/src/prompts/types.ts`
- `backend-nest/src/prompts/converter.ts`
- `backend-nest/src/prompts/simulation.ts`
- `backend-nest/src/prompt-builder.ts`
- `backend-nest/src/agents.ts`
- `backend-nest/src/game-session.ts`
- `backend-nest/tests/outcome-contract.test.ts`
- `backend-nest/tests/queue-contract.test.ts`
- `backend-nest/tests/domain-contracts.test.ts`
- `backend-nest/tests/queue-contract.test.ts`
- `backend-nest/tests/id-contract-regression.test.ts`
- `backend-nest/tests/integrity-regressions.test.ts`
- `backend-nest/tests/stage2.test.ts`
- `docs/implementation/F01-report.md`

## Comportamento prima / prova

Prima, il converter riceveva una lista di testi, il prompt chiedeva outcome con `action`, e `GameSession` cercava prima lo stesso testo quindi usava l'indice dell'array. Testi duplicati o outcome riordinati potevano attribuire l'esito a un ordine diverso. Inoltre un ordine senza esito LLM veniva persistito come `accepted` (accettazione implicita, vietata da F01 passo 2).

La nuova prova usa due ordini con testo duplicato e risposta volutamente invertita. Gli outcome portano `actionId`; la prova verifica che ogni summary raggiunga il rispettivo ID, non la rispettiva posizione. La prova negativa invia un ID non appartenente al lotto: il batch rigetta il protocollo e il rollback lascia l'ordine disponibile. Una seconda prova crea due processi dallo stesso titolo e verifica che solo il `projectId` dichiarato venga chiuso. Una terza prova lascia un ordine del lotto senza esito: il record tecnico persistito diventa `unresolved`, mai `accepted`.

Scenari DoD residui coperti da nuove prove: (1) **conversione riformulata** — l'esito che cita il testo convertito senza ID risolve solo se univoco; (2) **ordine composto** — un testo multi-intento non viene mai scomposto implicitamente: un solo ID, un solo salto, un solo esito e testo originale preservato; (3) **processo nel prompt con zero ordini** — il salto world-only include projectId/sourceActionId nel contesto e lascia il progetto aperto; (4) **persistenza backward compatible** — le migrazioni additive reinstallano le colonne su uno schema pre-F01 e riallineano gli stati senza perdere righe.

## Contratto API/schema e compatibilità

Contratto interno LLM aggiornato:

- `ConvertedAction.actionId?` conserva l'identità dell'ordine; `legacyIndex?` è confinato al parser/adattatore di conversione legacy.
- `ActionOutcome.actionId?` è la chiave canonica; `action` resta una etichetta legacy di compatibilità.
- I prompt batch mostrano `[actionId:…]`, il converter deve restituirlo e il prompt simulazione deve copiarlo in ogni `actionOutcomes`.
- `GameController` e `PromptEngine.runSimulation` ricevono riferimenti `{ actionId, text }`, non soltanto stringhe, nel percorso `GameSession` canonico.
- `src/domain/contracts.ts` fornisce parser runtime per `OrderIntent`, `ActionOutcome`, batch outcome, `ProjectReference` ed `EventProposal`; l'input JSON non viene considerato affidabile per il solo tipo TypeScript.
- `ActionOutcome.completesProjectId?` identifica il processo da concludere. `completesProcess` resta solo nel DTO legacy/audit e non viene mai usato per la chiusura canonica.
- Il contesto `ongoingProcesses` comprende `id` (`projectId` nel prompt), `sourceActionId`, stato e date.
- `pending_actions` ha ora `delivery_status`/`execution_status` additive; il vecchio `status` è un adapter UI. `games.queue_version` cresce a ogni mutazione della coda, senza aumentare data/turno/revisione del mondo.
- `simulation_action_outcomes.status` ammette il valore tecnico `unresolved`: un ordine del lotto senza esito LLM non è mai `accepted`. Il DTO in memoria (`result.outcome`) resta `undefined` invece di fabbricare uno status; `unresolved` vive nel record tecnico persistito e nell’endpoint run.

L'adapter legacy è esplicito: un outcome senza ID è accettabile soltanto se il testo individua **una sola** azione fra originale e conversione. Testo ambiguo, ID esterno o ID duplicato producono `simulation_protocol_error`; non esiste più fallback `actionOutcomes[index]` né matching diretto nel percorso di finalizzazione. Un `completesProjectId` non esistente, o associato a un outcome diverso da `accepted`, fallisce chiuso.

Compatibilità: le chiamate pubbliche storiche a `PromptEngine.convertActionsBatch(game, string[])` restano supportate; sono marcate legacy e non attraversano il percorso canonico della sessione. I vecchi provider che restituiscono un `index` dichiarato possono essere adattati solo nel converter; quell'indice non viene mai usato per associare gli outcome di simulazione.

## Algoritmo e invarianti mantenute

1. La sessione invia ID+testo al controller.
2. Il converter conserva/restituisce l'ID e il simulatore riceve la stessa coppia.
3. Il parser conserva `actionId` strutturato.
4. `outcomesByActionId` verifica esistenza e unicità degli ID prima della finalizzazione/playback.
5. Solo l'adapter legacy, esplicito e univoco, può derivare l'ID dal testo convertito; ambiguità fallisce chiuso.
6. `buildGameData()` inserisce tutti i processi attivi nel contesto; alla finalizzazione `completeOngoingProcessById` modifica una sola riga del gioco e solo per `completesProjectId` esplicito.
7. La repository esegue in transazione mutazione coda + incremento `queue_version`; route e snapshot espongono versione/stati duali. `queued/not_started` e `issued/in_progress` non avanzano il mondo.
8. Split F01 passo 2: outcome duplicato/ID esterno → `simulation_protocol_error`; outcome mancante → record tecnico `unresolved` con la cronaca comune come summary leggibile. Nessuna accettazione implicita in nessuno dei due casi; il percorso paused e quello ordinario usano la stessa regola.

Non è stata aggiunta una libreria schema: il repository non ne possiede una già adatta e questa micro-consegna usa un solo modulo runtime comune, senza validatori divergenti. Un'eventuale adozione di Zod richiede ADR/F01 esplicito prima di introdurre una nuova dipendenza.

Questo mantiene I15 e non modifica tempo, ledger, DB reale o effects. Il check avviene prima dell'esito persistito; l'errore segue il rollback già esistente del batch.

## Migrazioni eseguite solo su copie

Sono state aggiunte migrazioni additive (`games.queue_version`, `pending_actions.delivery_status`, `pending_actions.execution_status`) ed eseguite esclusivamente da fixture SQLite temporanee. Nessun DB reale è stato aperto intenzionalmente, migrato o cancellato.

## Comandi test e risultato completo

```text
npm --prefix backend-nest test -- id-contract-regression.test.ts integrity-regressions.test.ts
PASS: 2 file; 5 verdi, 3 expected-fail F00 residui.

npm --prefix backend-nest test -- id-contract-regression.test.ts integrity-regressions.test.ts prompts.test.ts stage2.test.ts
PASS: 5 file; 82 verdi, 3 expected-fail F00 residui.

npm --prefix backend-nest test
PASS: 24 file; 243 verdi, 2 expected-fail F00 residui (245 totali).

npm --prefix backend-nest run build
PASS: tsc.
```

## Screenshot/trace UI

Non applicabile: nessun componente UI è stato modificato.

## Cosa NON è implementato / dipendenze mancanti

- F01 non è chiuso: il parse permissivo delle proposte evento (A11) resta deliberatamente nel percorso legacy e viene recepito in F03 secondo la tabella di tracciabilità (A11 → F03/F06); F01 fornisce lo schema runtime `parseEventProposal` già pronto per quell’integrazione.
- La scomposizione esplicita di un ordine in sottoazioni padre/figli (SPEC §6.2) non è implementata: richiede il contratto OrderIntent di M03/§5.2. F01 garantisce che non avvenga nessuna scomposizione implicita e che il testo originale sia preservato.
- La progressione materiale deterministica dei progetti è responsabilità M05; F01 ha soltanto corretto identità, contesto e chiusura per ID.
- Gli adapter legacy sono transitori: M06 dovrà vietarli nel percorso strict per partita/versione modello.
- F00 conserva due riproduzioni expected-fail (A03, A10); non dichiarare GATE-0/F01 accettati.

## Crediti / DB reale / deploy

Nessun provider reale, rete esterna, DB reale, partita pubblica, deploy o migrazione reale.

## Decisione revisore

**Da correggere / proseguire.** Le micro-consegne rimuovono il fallback ID, chiudono i progetti solo per `projectId`, separano consegna/attuazione con `queueVersion` e vietano l’accettazione implicita; F01 richiede ancora l’integrazione runtime completa delle proposte evento e la revisione indipendente.
