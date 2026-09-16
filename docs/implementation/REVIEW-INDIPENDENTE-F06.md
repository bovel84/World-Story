# Revisione indipendente — F06 (unico stato client, reset del ramo, riconciliazione)

- **Revisore**: ≠ implementatore (gate F00–F06).
- **Oggetto**: `frontend/src/stores/simulationStore.ts` (reducer puro),
  `frontend/src/stores/simulationRuntime.ts` (runtime + guardia anti-stale) e i
  call-site reali del wiring HTTP/SSE/restore/save.
- **Metodo**: lettura dei call path + prove riproducibili
  (`simulationStore.test.ts`, nuovo `branchReplaceObjects.test.ts`).
- **Esito**: **ACCETTABILE** (dopo la correzione del difetto M-1).

## Claim verificati

| Audit | Claim F06 | Evidenza |
|---|---|---|
| A14 | A revisione identica un delta con `sequence` più vecchio è scartato; `eventId` duplicato non duplica la timeline | `applyEnvelope` scope `timeline`; test µ1 |
| A14 | Coda con `queueVersion` più vecchia e job con `jobVersion` più vecchia non sovrascrivono; i terminali sono espliciti | scope `queue`/`job`; `TERMINAL_JOB_STATUSES`; test µ1 |
| A06 | Le proposte sigillate e gli ordini «processing» NON entrano in newsQueue/timeline (whitelist dei soli campi pubblici) | `toPublicEntry` legge solo `payload.event`; test µ1 |
| A12/A13 | Un envelope di un altro ramo è scartato; il cambio ramo avviene SOLO da `applyBranchReplace` | `branchMatches` + scope `branch`/`snapshot` → `state`; test µ1 |
| A14 | `replaceCanonicalSnapshot` resetta mappa, coda, history, news, chat, advisor, reader; `awaitingNext` segna la pausa, il terminale la cancella | test µ1 + µ3 |
| A06/A12 | `initGame` resetta e invalida i comandi; i token presi prima di uno switch/restore sono scaduti | `simulationRuntime.ts` (`commandGeneration`, `beginCommand`/`isStale`/`invalidateCommand`); test µ2 |
| A13 | Caricamento save via `branchReplace`: timeline svuotata, comandi invalidati | test µ2/µ3; `useResumeSave.ts` |
| A13/A14 | Continue-from-checkpoint procede solo con ramo nuovo valido e anchor di origine | `useWorldAdvance.handleContinueFrom` (`branchId !== 'unknown'` + `reader.checkpointId`) |

## Difetto trovato e corretto (M-1) — objects mappa persi sul ramo nuovo

La µ3 dichiara che il reset canonico copre **anche gli objects mappa**. Due
punti lo contraddicevano:

1. **`applyMapChanges`** (overlay dei delta `map`/`timeline`) riscriveva l'intera
   entry con soli `{ owner, color }`, **cancellando** gli `objects` già noti da
   uno snapshot canonico.
2. **Call-site del restore** (`useWorldAdvance.handleRestoreCheckpoint`) costruiva
   `mapRegions` con soli `{ owner, color }`, mentre il call-site del caricamento
   save (`useResumeSave`) includeva già `objects: region.objects || []`:
   **incoerenza tra i due percorsi** dello stesso comando.

Nessuno dei due era coperto da test. **Prove rosse→verdi:**
- `simulationStore.test.ts` — nuovo caso «un delta mappa aggiorna owner/color senza
  cancellare gli objects già noti» (rosso: `objects` `undefined`).
- `branchReplaceObjects.test.ts` — source-contract: **entrambi** i call-site di
  `branchReplace` devono passare `objects` (rosso: `useWorldAdvance` mancava).

**Fix:** `applyMapChanges` preserva `change.objects ?? next[…].objects`;
`useWorldAdvance` include `objects: region.objects || []` come `useResumeSave`.

## Osservazioni residue (non bloccanti)

1. **Latente, non visibile all'utente:** la mappa *renderizzata* è guidata da
   `currentWorld`/`uiStore` (che già preserva gli objects: `objects: region.objects
   ?? regions[id].objects`). `simulationStore.mapRegions` non è ancora consumato dai
   componenti mappa, perciò M-1 non produceva un artefatto visivo — ma era una
   bomba a orologeria per chi collegherà la mappa al reducer canonico.
2. Un envelope **senza `branchId`** è accettato (`branchMatches` ritorna `true`):
   il filtro di ramo è efficace solo se il server dichiara il ramo. Da mantenere
   come contratto esplicito lato server.
3. `replaceCanonicalSnapshot` imposta `lastSequence = worldRevision`: funge da
   fencing contro delta del ramo precedente (timeline già svuotata). Da rivalutare
   se in futuro `sequence` e `revision` avessero scale diverse.

## Esito

Nessun difetto bloccante residuo dopo M-1. Frontend: **35 file / 201 test** verdi;
`tsc` pulito; build OK.
