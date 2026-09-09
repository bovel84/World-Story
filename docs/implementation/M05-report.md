# M05 — Progetti a fasi, tecnologia e personale

## µ1 — WBS/DAG e macchina a stati

**Stato:** completata, da revisione indipendente.

Nuovo `src/core/projects/ProjectEngine.ts`, puro:
- `ProjectPlan`/`ProjectPhase` con workload bigint, minDays, budget/input dichiarati, dipendenze e commissioning/asset;
- validazione DAG, ID, workload e durata positivi;
- stati `planned → authorized → active/blocked`, più commissioning/completed/cancelled/failed previsti dal contratto;
- una fase non parte prima delle dipendenze; fasi future non creano asset, costi o riserve; cancellazione conserva le fasi già completed.

`tests/project-engine.test.ts`: 3 prove DAG, dipendenza, asset non anticipato e cancellazione. Backend **52 file / 403 test** verdi; build/diff puliti.

## Prossimo

**µ2:** progresso giornaliero da lavoro effettivo/minDays, stato blocked↔active e commissioning; nessun progresso da eventi LLM (MAT11/MAT12, §7.1).

## µ2 — Progresso giornaliero e commissioning

**Completata.** `advancePhaseDay` avanza solo `workDone` effettivo: zero → blocked senza progresso; ripresa → active. Workload e minDays devono entrambi maturare. Completamento con commissioning entra in stato `commissioning`; solo `completeCommissioning` crea asset pending e `activatePendingAssets` lo rende operativo al confine successivo. Nessun testo/evento LLM chiude fasi. `project-progress.test.ts`: 3 prove MAT11/MAT12 (progetto non finisce in 3 giorni, block/resume, commissioning/boundary). Corrette due inferenze TypeScript emerse in compilazione (`intToString`, literal status). Backend **53 file / 406 test** verdi.

## Prossimo

**µ3:** capability graph separato conoscenza/progetto/produzione/uso/manutenzione; import non concede manufacture (MAT07/MAT08/MAT23).

## µ3 — Capability graph separato

**Completata.** Nuovo `CapabilityEngine.ts`: grafo con kind `knowledge/design/manufacture/operate/maintain`, prerequisiti transitivi e ID/dipendenze validati. `grantImportedCapabilities` accetta solo operate/maintain esplicitamente contrattuali: rifiuta design/manufacture. `capability-engine.test.ts`: 3 prove MAT07/MAT08/MAT23. Backend **54 file / 409 test** verdi.

## Prossimo

**µ4:** formazione/personale e ricerca milestone con seed/costi/riproducibilità; nessuno sblocco per anno o denaro (MAT10/MAT22).

## µ4 — Personale e ricerca seedata

**Completata.** Nuovo `PeopleResearchEngine.ts`: allocazione giornaliera persone per qualification in ordine stabile, senza duplicare pool; milestone ricerca richiede workload e costo espliciti, poi estrae esito con SHA-256(seed,milestone), persistibile/riproducibile. Retry su stato risolto è rifiutato; denaro senza lavoro non sblocca. `people-research.test.ts`: 3 prove MAT10/MAT22. Backend **55 file / 412 test** verdi.

## Prossimo

**µ5:** annullamento come ordine: liberare solo riserve residue/costi non spesi, preservare costi sommersi; snapshot e contesto progetto (MAT19).

## µ5 — Annullamento, residui e snapshot

**Completata.** Nuovo `ProjectFunding.ts`: `initialReserved = remainingReserved + spent + released`; spesa converte solo residuo in costo sommerso, annullamento restituisce il comando di release per ReservationService e conserva spent, incrementando released. Snapshot/restore è esplicito e legacy/identità incoerente → null (mai fondi inventati). Difetto corretto: la prima bozza perdeva la quota liberata; introdotto `released` per mantenere la conservazione. `project-funding.test.ts`: 3 prove MAT19. Backend **56 file / 415 test** verdi.

**M05 implementata nel verticale isolato (µ1–µ5).** Persistenza/contesto gameplay effettivi saranno collegati soltanto da M06; accettazione resta a revisione indipendente. Prossimo: M06.
