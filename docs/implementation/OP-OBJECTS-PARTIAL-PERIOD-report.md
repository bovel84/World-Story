# OP-OBJECTS PARTIAL-PERIOD — 15 giorni sono davvero mezzo mese

**Ambito:** coerenza temporale del flusso materiale degli oggetti persistenti, dopo lo step a
periodi massimi di 30 giorni (`OP-OBJECTS TIME-STEP`).
**Principio non negoziabile:** *quindici giorni devono essere mezzo mese in ogni parte della
simulazione* — e un salto lungo deve essere la stessa storia economica dei suoi periodi più
piccoli, non soltanto lo stesso risultato apparente del magazzino.

Due difetti residui, entrambi chiusi qui:

- **P1 — periodi parziali.** L'allocazione degli impianti confrontava la disponibilità del periodo
  con il fabbisogno **mensile** e poi il tempo veniva applicato una seconda volta da `advanceStock`
  (o non applicato affatto al prelievo dai giacimenti).
- **P2 — conto nazionale.** `advanceWorldState(days)` faceva avanzare il `WorldStateEngine` **una
  volta sola** e passava gli stessi conti finali a tutti i periodi materiali.

Nessun nuovo motore, nessuna nuova risorsa, nessuna formula nuova: solo il **tempo** rimesso al
posto giusto. Un solo loop temporale, il periodo materiale come unità di misura comune al mondo e
al magazzino.

---

## §1. Causa del difetto P1 — dove si perdeva il tempo

`core/simulation/OperationalState.ts` → `allocateFacilityProduction` calcolava:

```
required[id] = fabbisogno MENSILE             (invariato: giusto, è l'unità delle ricette)
share[id]    = min(1, availability(id) / demand[id])
               └── demand era la somma dei fabbisogni MENSILI
factor       = base × ratio
```

`game/NationStateService.ts` → `advancePolityMaterialStep` passava poi quel risultato a
`advanceStock(stock, account, stepDays, …, overlay)` che applica `period = stepDays / 30`.

Il **rapporto di copertura** veniva perciò calcolato su un fabbisogno che non era quello del
periodo: con `need = 4/mese`, `step = 15 giorni`, `stock = 2`:

| grandezza | valore vecchio | valore corretto |
|---|---|---|
| fabbisogno da coprire | 4 (un mese) | **2** (mezzo mese) |
| copertura `share` | 2/4 = 50% | 2/2 = **100%** |
| `factor` | 0,5 | **1** |
| input preso dalle scorte | 4 × 0,5 × 0,5 = **1** | 4 × 1 × 0,5 = **2** |
| output | 1 × 0,5 × 0,5 = **0,25** | 1 × 1 × 0,5 = **0,5** |

E il prelievo dai giacimenti era **scalato zero volte**: `naturalInputs` arrivava a
`drawResourceStockpile` come quantità mensile, quindi su 15 giorni si prendeva dal silo il
fabbisogno di un mese intero.

## §2. Il doppio scaling e lo scaling mancante, esattamente

| percorso | prima | adesso |
|---|---|---|
| scorte (`inputs`/`outputs` → `overlay.production`/`consumption` → `advanceStock`) | rapporto calcolato sul fabbisogno mensile, poi × `period` ⇒ **doppio scaling** | rapporto sul fabbisogno del periodo, `advanceStock` × `period` ⇒ **un solo scaling** |
| giacimenti (`naturalInputs` → `drawResourceStockpile`) | quantità **mensile**, nessuno scaling ⇒ **scaling mancante** | quantità **del periodo** (`× period`), nessun altro scaling ⇒ **un solo scaling** |
| fattore dell'impianto (`factor`/`materialFactor`) | frazione della copertura **mensile** | frazione della copertura **del periodo** |
| fabbisogno militare (`militaryNeeds`) | mensile, scalato da `advanceStock` | **invariato** (era già corretto) |

## §3. Il contratto nuovo: `stepDays` → `period`

Una sola aggiunta di firma, opzionale e retrocompatibile:

```ts
allocateFacilityProduction({
  facilities, availability, stock, endowment, activity,
  stepDays?: number,   // default 30 = un mese: la lettura del Dossier resta identica
})
```

```
period = max(0, stepDays ?? 30) / 30        // 1 di default, 0,5 per quindici giorni
required[id]   = fabbisogno mensile × base   // MENSILE (invariato)
periodNeed[id] = required[id] × period       // fabbisogno DEL PERIODO
share[id]      = min(1, availability(id) / periodNeed[id])
factor         = base × ratio                // formula invariata: cambia cosa copre `ratio`
inputs[id]     = required[id] × ratio        // MENSILE
outputs[id]    = ricetta × factor            // MENSILE
naturalInputs  = Σ inputs × period           // DEL PERIODO, già scalato
```

`FacilityAllocation` espone `period` (per i chiamanti e per i test) e i campi sono documentati con
la tabella delle unità. Con `stepDays` assente o 30 il risultato è **identico** a prima: nessuna
regressione sul mese pieno, nessun cambio nella lettura del Dossier.

## §4. Semantica delle unità (tabella del contratto)

| campo | unità | chi lo scala |
|---|---|---|
| `FacilityAllocation.facilities[].factor` / `materialFactor` | frazione 0…1 del fabbisogno **del periodo** coperta | già scala |
| `FacilityAllocation.facilities[].inputs` / `.outputs` | **mensile** | `advanceStock` × `period` |
| `FacilityAllocation.totalInputs` / `.totalOutputs` | **mensile** | `advanceStock` × `period` |
| `FacilityAllocation.naturalInputs` | **quantità del periodo** (già × period × ratio) | nessuno: la preleva `drawResourceStockpile` |
| `FacilityAllocation.remaining` | quantità del periodo | diagnostica |
| `MaterialFlowOverlay.production` / `.consumption` | **mensile** | `advanceStock` × `period` |
| `MaterialFlowOverlay.militaryNeeds` | **mensile** | `advanceStock` × `period` (via `effectiveMaterialNeeds`) |
| `MaterialFlowOverlay.naturalInputs` | **quantità del periodo** | nessuno: prelevata dal silo |
| `MaterialFlowOverlay.facilityFactors` | frazione 0…1 del fabbisogno **del periodo** | già scala (lo usano gli ordini) |

La trappola da evitare — e verificata dai test — è che nessun campo venga scalato due volte:
`naturalInputs` **non** passa da `advanceStock` (che lo ignorerebbe), `inputs`/`outputs` **non**
passano da `drawResourceStockpile`.

## §5. Correzione del prelievo dai giacimenti

`drawResourceStockpile(ledger, overlay.naturalInputs)` riceve adesso la quantità del periodo. Con
silo 10, fabbisogno 4/mese e 15 giorni: si prelevano **2**, non 4, e il silo scende a **8**.

La disponibilità dei giacimenti resta **una sola fonte**: nel tick l'estrazione del periodo è già
stata versata nel silo da `advanceLedger(stepDays)` e l'allocazione legge il silo con
`monthlyExtraction: false` (`OperationalStateStore.availability`). La lettura del Dossier continua a
sommare il gettito mensile (`monthlyExtraction: true`), e se le si passa un `stepDays` parziale ne
somma solo la parte che il tempo concede.

## §6. Periodi parziali: i numeri del nuovo contratto

| caso | fabbisogno | disponibilità | `factor` | preso | output |
|---|---|---|---|---|---|
| 15 giorni, scorta 2 | 4/mese → **2** | 2 | **1** | 2 | 0,5 (metà del mensile) |
| 15 giorni, scorta 1 | 4/mese → **2** | 1 | **0,5** | 1 | 0,25 (un quarto) |
| 5 giorni, scorta 2 | 6/mese → **1** | 2 | **1** | 1 | 1/6 |
| 30 giorni, scorta 4 | 4/mese → 4 | 4 | 1 | 4 | 1 (identico a prima) |
| 30 giorni, scorta 2 | 4/mese → 4 | 2 | 0,5 | 2 | 0,5 (identico a prima) |
| 15 giorni, estrazione 1,5 | 4/mese → **2** | 1,5 | **0,75** | 1,5 | 0,375 |
| 45 giorni = 30 + 15 | — | — | — | 4 + 2 | 1 + 0,5 |

L'ultimo caso *prima* valeva 0,1875 (37,5% di copertura su un fabbisogno mensile già scalato dal
tempo): la suite lo codificava, ed è stato **aggiornato** invece di essere conservato.

## §7. P2 — causa: un solo `WorldStateEngine.advance`, molti periodi materiali

```ts
const rawTick = WorldStateEngine.advance(this.regions.values(), days, opts);
const tickAccounts = applyModifiersToAccounts(rawTick.accounts, …);
this.nationState.advanceResources(days, tickAccounts, asOfDate, { … });   // TUTTI i periodi
```

Il magazzino del mese 1 leggeva il conto del **giorno finale**: popolazione, PIL, entrate,
`monthlyBalance` e capacità di stoccaggio del sesto mese applicati anche al primo. Erano coerenti
le scorte, non la storia.

## §8. P2 — una sola pipeline temporale

`NationStateService.advanceResources` espone un gancio nuovo:

```ts
export interface MaterialAdvanceHooks {
  onPlayerSlice?: (slice: MaterialSliceInfo) => string[];
  accountsForStep?: (slice: { index, stepDays, stepDate }) =>
    Record<string, NationalAccount> | undefined;
}
```

Il ciclo è ora **periodo → polity**, con il chiamante che possiede il `WorldStateEngine` come
fornitore del conto del periodo:

```ts
lines.push(...this.nationState.advanceResources(days, finalAccounts, asOfDate, {
  accountsForStep: ({ stepDays }) => {
    finalAccounts = applyModifiersToAccounts(
      WorldStateEngine.advance(this.regions.values(), stepDays, this.worldStateOptions()).accounts,
      polityId => this.modifiersFor(polityId),
    );
    return finalAccounts;
  },
  onPlayerSlice: slice => this.advanceProduction(slice.stepDays, finalAccounts[this.playerPolityId], slice.factors, notices),
}));
```

- **Un solo loop temporale**: niente «mondo una volta, poi risorse, poi ordini». Il mondo avanza
  dentro il ciclo dei periodi materiali.
- `accountsForStep` è chiamato **esattamente una volta per periodo**, mai una volta per polity: il
  motore del mondo non può avanzare più volte dello stesso tempo (era il rischio maggiore della
  ristrutturazione, ed è la ragione per cui il ciclo è periodo-esterno/polity-interno).
- `Σ step ≡ days`: `WorldStateEngine.advance` è già composto (PIL, popolazione e readiness crescono
  in modo composto), quindi dodici periodi da 30 giorni sono un anno.
- I periodi restano quelli di `splitMaterialPeriod` (max 30 giorni): il tick giornaliero non esiste.

## §9. Il `WorldStateEngine` non è stato toccato

Nessuna modifica al motore, nessun sub-stepping al suo interno: **viene chiamato con periodi ≤ 30
giorni** invece che con il salto intero. La composizione era già garantita dal motore
(`Math.pow(1 + g, days / 365)`), quindi il risultato del mondo è lo stesso — verificato dai test
full-world su `population`, `gdp`, `militaryPower`.

## §10. Come si ottengono i conti di ogni periodo

- `applyModifiersToAccounts` è una **proiezione pura** regioni → conti (nessun decadimento, nessuno
  stato consumato): chiamarla a ogni periodo è corretto e non altera nulla. `decayPolityModifiers`
  resta **una volta per avanzamento**, come prima (scelta di bilancio, fuori scope).
- Il conto del periodo è la proiezione delle regioni **già avanzate a quel periodo** — le stesse
  che ogni altro lettore (`sessionAccounts`, capacità industriale, ordini) vede in quel momento:
  non esistono due verità temporali nello stesso istante.
- Il conto iniziale (per l'elenco delle polity e per i percorsi senza mondo) è la proiezione pura
  prima del salto: identica a quella che il motore userebbe a durata zero.
- `days` resta **intero per contratto** (`explicitDays`, `daysBetween`): una durata frazionaria è un
  errore, non un troncamento silenzioso.

## §11. Bollettini, storico, governo, progetti

Emessi **una sola volta** e con lo stato **finale** (dopo l'ultimo periodo), nell'ordine di sempre:
note nazionali pendenti → bollettino `📊` → governo `🏛️` → righe materiali (un solo bollettino di
magazzino per l'intero salto, con la riga aggregata «Nel periodo (N periodi)») → progetti.
`advanceProjects(days)` una volta, `recordAccountSnapshot(asOfDate, finalAccounts)` una volta,
`currentTurn` una volta (è la pipeline del turno a incrementarlo, non questo metodo). Nessun
checkpoint nuovo.

## §12. Equivalenza `180 ≡ 6 × 30` (full-world)

Stesso stato iniziale, `advanceWorldState(180)` contro `6 × advanceWorldState(30)`; mondo di prova
con popolazione 200.000, PIL indice 1, nessun reparto, tre impianti dalla mappa:

| grandezza | salto unico | sei turni | scarto |
|---|---|---|---|
| `money` | 20,044554999999995 | 20,044554999999995 | **0** |
| `food` | 1,8807559269902785 | 1,8807559269902785 | **0** |
| `clothing` | 1,5 | 1,5 | 0 |
| `weapons` | 4 | 4 | 0 |
| `fuel` | 2 | 2 | 0 |
| silo `iron` | 9,935 | 9,935 | 0 |
| `extractedTotal` `iron` | 7,325 | 7,325 | 0 |
| `population` | 200.787,44779210337 | idem | 0 |
| `gdp`, `militaryPower` | identici | identici | 0 |

E l'effetto che il vecchio tick non poteva vedere — la **cassa progressiva** di una nazione grande
(PIL ~570 mld, saldo mensile crescente):

```
saldi mensili   2,245950  2,247131  2,248706  2,250281  2,251856  2,253038
somma progressiva 13,496962   |  salto unico 13,496963   |  naive 6 × ultimo 13,518228
scarto P2 0,021266
```

## §13. Equivalenza `365 ≡ 12 × 30 + 5` (full-world)

Stesso confronto su un anno: `advanceWorldState(365)` contro `12 × advanceWorldState(30)` più
`advanceWorldState(5)`. Mondo, scorte materiali e silo identici (test `365 == 12x30+5 full-world`).

## §14. Comportamento degli ordini di produzione

Il percorso resta quello dello step precedente — `onPlayerSlice` → `advanceProduction(stepDays,
conto del periodo, fattori del periodo)` — e ora riceve **numeri giusti**:

- il **tempo** è quello del periodo (30 giorni, o 15 in un salto parziale);
- il **conto** è quello del periodo (P2): la popolazione cresce di periodo in periodo;
- il **fattore materiale** è quello del passaggio di allocazione di quel periodo, e per un periodo
  parziale significa «frazione del fabbisogno del periodo coperta», non del mese.

Test `production-order-progressive` intercetta il contratto (tempo, conto, fattori) periodo per
periodo e verifica che un salto di 180 giorni consegni ai sei periodi gli **stessi** fattori dei sei
turni separati. Il `facilityFactor` del Dossier resta la lettura del mese pieno.

Il quarto numero che gli ordini ricevono è la **data canonica del periodo** (OP-OBJECTS
SEED-DETERMINISM, §26): il tiro di produzione dipende da quella, non dal turno. Vedi §26 per la
correzione e la nuova prova di equivalenza anche sulla storia produttiva.

## §15. Playback, crisi, branching

- Il modello del **playback** non è stato toccato: le sue gambe continuano a chiamare
  `advanceWorldState(elapsedDays, data)` e ora ogni gamba vive i propri periodi (mondo e magazzino
  insieme). Una gamba da 90 giorni sono tre periodi, come tre turni da 30.
- **Correzione documentale (OP-OBJECTS SEED-DETERMINISM, §26):** il percorso canonico del playback
  **fa avanzare gli ordini di produzione**. `PlaybackService` (righe 262 e 600) chiama
  `ctx.advanceWorldState(elapsedDays, data)` → `game-session.advanceWorldState` (~617-630) →
  `nationState.advanceResources(..., { onPlayerSlice })` → `advanceProduction(stepDays, conto,
  fattori, registro, { stepDate })`. La riga «`time-skip` playback non avanza gli ordini», scritta
  nello step precedente, era **sbagliata** ed è stata corretta in §22. Il limite vero è un altro: il
  percorso **legacy** `advanceDate()` chiama `advanceResources(days, conti, newDate)` **senza hook**,
  quindi lì gli ordini non avanzano.
- **Crisi** (`evaluateCrisis`, soglie 90/180), **branching/rewind**, **FactionMemory**,
  **NpcAgenda/GovernmentVoices**, **PeacetimePressures**, **Commitments** non sono stati modificati.
- Nessun checkpoint nuovo.

## §16. Legacy e strict

- **Legacy `advanceDate()`**: non toccato. Il magazzino continua ad avanzare a periodi, ma quel
  percorso non passa alcun conto di periodo (usa la mappa del salto) e **gli ordini non avanzano
  lì** (nessun `onPlayerSlice`). Limite dichiarato, non una regressione: il percorso non era
  periodico neppure prima.
- **Percorso legacy senza oggetti**: `materialFlow()` → `null`, nessun overlay, formula di sempre.
  Verificato anche sui salti lunghi (`90 ≡ 3 × 30`).
- **Strict**: `advanceResources` esce subito, il magazzino non avanza di un giorno.

## §17. Scadenze del debito

Il rollover continua a maturare alla **data del periodo che contiene la scadenza** (non all'ultimo
giorno del salto): un titolo emesso il 1/1 con scadenza al giorno 100 si rinnova il **1/5**, sia in
un salto unico di 180 giorni sia in sei turni da 30, con lo stesso nuovo tasso. Una sola riga di
bollettino.

## §18. Performance (1 / 10 / 100 anni)

Misurate su questo branch (macchina da sviluppo, suite con un impianto, un'armata, silo e scorte):

| salto | periodi | tempo |
|---|---|---|
| 365 giorni (1 anno) | 13 | **118 ms** |
| 3.650 giorni (10 anni) | 122 | **994 ms** |
| 36.500 giorni (100 anni) | 1.217 | **9.483 ms** (~7,8 ms/periodo, costo lineare) |
| `advanceWorldState(365)` (mondo + magazzino) | 13 | 125 ms |
| 12 × `advanceWorldState(30)` | 12 | 186 ms |

Nessun tick giornaliero: il numero di periodi è `ceil(days / 30)` e il costo resta lineare.

## §19. Test

`backend-nest/tests/op-objects-time-step.test.ts` — da 24 a **37 test**. Nuovi:

| test | cosa difende |
|---|---|
| `partial-period-stock-input` (12) | 15 giorni, `need` 4, scorta 2 ⇒ `factor` 1, consumo 2, output 50% |
| `partial-period-scarcity` (13) | scorta 1 su fabbisogno 2 ⇒ `factor` 0,5, output 25%, consumo 1 |
| `partial-period-natural-input` (14) | silo 10 → **8** (non 6); `naturalInputs.iron` = 2 |
| `5-day-period` (15) | 5 giorni, `need` 6 ⇒ fabbisogno 1, `factor` 1 |
| `30-day-period` (16) | il mese pieno non cambia semantica (1 e 0,5 come prima) |
| `45 == 30+15` (17/44) | popolazione, consumi civili, input naturale, armate |
| `conservation` (18) | Σ(fabbisogno × tempo × fattore) = consumo reale = prelievo: nessun doppio scaling |
| `19` (ex 35-bis) | estrazione parziale: 0,375 (non più 0,1875), semantica vecchia aggiornata |
| `180 == 6x30 full-world` (38) | mondo, scorte, silo, cassa |
| `365 == 12x30+5 full-world` (45) | un anno è i suoi dodici mesi più cinque giorni |
| `civil-needs-progressive` (27) | i fabbisogni civili crescono con la popolazione; il salto somma, non estrapola |
| `treasury-progressive` (28) | la cassa matura col saldo di ogni periodo (`< 6 × saldo finale`) |
| `debt` (29) | la scadenza matura nella stessa data in entrambi i percorsi |
| `production-order-progressive` (32) | tempo, conto e fattori per periodo consegnati agli ordini |

**Prova di mordente:** con il codice precedente (solo `src` ripristinato, test nuovi) **12 test
falliscono** — tutti quelli elencati sopra tranne i due già verdi per costruzione. Non è una suite
che passa perché misura poco.

**Irrobustimento necessario:** i test sugli ordini confrontavano la *percentuale di avanzamento*, che
dipendeva da un imprevisto di produzione deterministico ma **legato all'id di partita** (id casuale a
ogni esecuzione): erano quindi instabili anche prima di questo pacchetto (verificato su `main`: 1
esecuzione su 3 rossa). Ora osservano il **contratto** deterministico (tempo, conto, fattori per
periodo) e resta un'asserzione qualitativa sull'avanzamento. Le altre verifiche sono state lasciate
intatte.

**Aggiornamento OP-OBJECTS SEED-DETERMINISM (§26):** il tiro dipende dalla data del periodo e
dall'id dell'ordine, quindi **non** è più legato all'id di partita. La nuova suite
`op-objects-seed-determinism.test.ts` impone un id d'ordine **fisso** e confronta i percorsi fino ai
semi usati; il conteggio dei bollettini di sospensione in `43` è diventato «mai più di uno» invece di
«esattamente uno», perché l'ordine può ora anche chiudersi prima di arrivare al periodo a secco.

## §20. Quality gate (eseguito davvero)

| comando | esito |
|---|---|
| backend `npx tsc --noEmit` | ✅ |
| backend `npm test` | ✅ **156 file / 1483 test** (erano 156/1470: +13) |
| backend `npm run build` | ✅ |
| frontend `npx tsc --noEmit` | ✅ |
| frontend `npx vitest run` | ✅ 67 file / 488 test |
| frontend `npm run build` | ✅ |
| `npm run test:e2e:mock` | ✅ 45/45 |

Nessuna modifica alla UI: il frontend non è toccato.

## §21. CORE ENGINE FREEZE — nota

Come per i pacchetti precedenti, il fix **tocca file congelati** per necessità dimostrata:

- `core/simulation/OperationalState.ts` — contratto di allocazione (parametro opzionale + un campo
  di risultato + il calcolo del fabbisogno del periodo);
- `core/simulation/MaterialEconomy.ts` — **solo commenti**: il contratto delle unità dell'overlay;
- `game-session.ts` — l'ordine delle chiamate del tick (`advanceWorldState`), nessuna nuova
  semantica di stato;
- `game/NationStateService.ts`, `game/OperationalStateStore.ts` — il livello che possiede scorte,
  silo e periodi.

`WorldStateEngine`, `GameSession` (stato/persistenza), `TurnOrchestrator`, `TurnPipelineService`,
`SessionStateStore`, schema/DB, `repositories`, checkpoint e playback **non** sono stati modificati
nella loro semantica. Nessun nuovo motore, nessuna seconda contabilità, nessun tick giornaliero.

## §22. Limiti residui (reali, dichiarati)

- **Legacy `advanceDate()`**: non passa un conto di periodo e non fa avanzare gli ordini (come
  prima). Il percorso legacy resta legacy per scelta esplicita del task.
- **`decayPolityModifiers`** resta una volta per avanzamento, non per periodo: è una scelta di
  bilancio, fuori scope, e il tick a periodi non la cambia.
- **Un mese parziale con disponibilità mensile**: la disponibilità letta dal Dossier
  (`monthlyExtraction: true` senza `stepDays`) resta mensile — è la lettura «quanto posso lavorare
  questo mese», non un periodo.
- **Impianto con ricetta non allineata al motore**: `refreshRecipes` può riallinearla (comportamento
  preesistente), quindi i test costruiscono impianti con le chiavi del motore.
- **Imprevisti di produzione**: il tiro dipende dalla **data del periodo** e dall'id dell'ordine
  (OP-OBJECTS SEED-DETERMINISM, §26): due percorsi con le stesse date e lo stesso ordine tirano gli
  stessi dadi, ma due partite diverse o due ordini diversi no. Non è più legato all'id di partita né
  al turno, quindi non è più un ostacolo al confronto fra percorsi.
- **Capacità industriale del periodo**: gli ordini ricevono tempo, conto e fattore materiale del
  periodo; la *capacità* industriale resta letta dallo stato corrente del paese (che nei periodi è
  comunque già avanzato), non ricalcolata come serie storica.
- **Ordini di produzione e `time-skip`**: nel percorso **canonico** (`PlaybackService` →
  `advanceWorldState` → `onPlayerSlice` → `advanceProduction`) gli ordini **avanzano**, con il tempo,
  il conto e i materiali di ogni periodo. Resta il limite del percorso **legacy** `advanceDate()`,
  che chiama `advanceResources` senza hook: lì il mondo e il magazzino avanzano ma gli ordini no.

## §23. File toccati

| file | intervento |
|---|---|
| `backend-nest/src/core/simulation/OperationalState.ts` | `MATERIAL_MONTH_DAYS`, `stepDays`, `periodNeed`, `naturalInputs` del periodo, `period` nel risultato, contratto documentato |
| `backend-nest/src/core/simulation/MaterialEconomy.ts` | contratto delle unità documentato su `MaterialFlowOverlay` (nessun cambio funzionale) |
| `backend-nest/src/game/OperationalStateStore.ts` | `availability`/`allocation`/`materialFlow` accettano `stepDays`; estrazione mensile scalata dal periodo nella lettura |
| `backend-nest/src/game/NationStateService.ts` | ciclo periodo→polity, `accountsForStep`, `stepDays` nell'overlay, `index` nella slice |
| `backend-nest/src/game-session.ts` | un solo loop temporale in `advanceWorldState`, conti finali per bollettino/storico, guardia su durata intera |
| `backend-nest/tests/op-objects-time-step.test.ts` | 13 test nuovi + semantica 35-bis corretta + test ordini deterministici |
| `docs/implementation/OP-OBJECTS-PARTIAL-PERIOD-report.md` | questo report |

Nessun file di frontend, nessun `preset.json`, nessuna migrazione.

## §24. Prima → dopo

| | prima | dopo |
|---|---|---|
| 15 giorni con 2 disponibili su 4/mese | fattore 0,5, consumo 1, output 0,25 | **fattore 1, consumo 2, output 0,5** |
| prelievo dal silo in 15 giorni | 4 (un mese) | **2** |
| 5 giorni | copertura sul mese | **fabbisogno di 1/6 di mese** |
| 45 giorni vs 30 + 15 | due storie diverse | **identici** |
| `advanceWorldState(180)` vs `6 × 30` | scorte simili, conti del giorno finale | **identici fino all'ultima cifra, conti progressivi** |
| cassa di un anno (nazione grande) | 6 × saldo finale (13,518228) | **somma progressiva (13,496962)** |
| ordini di produzione | fattore del primo giorno, conto finale | **fattore e conto del periodo** |

---

## §25. Deploy e verifica live

Deploy: `bash scripts/deploy-cloudflare.sh` (il backend locale risale dopo il solito errore di
attesa 150 s), poi `--skip-backend` per frontend, Worker e KV.
Worker Version ID **`93a9ca38-fa82-4f81-91d8-64ae929ad532`**.

`GET /api/health` sul Worker (`https://world-story.bovel-cannas.workers.dev`):

```json
{"status":"ok","build":{"backend":"dev","frontend":"314b883"},
 "schema":{"database":{"tables":52}},"auth":"open-single-user"}
```

`frontend: 314b883` è il commit di questo pacchetto (squash della PR #74) ✓.

**Percorso di lettura invariato** (nessuna regressione: la lettura del Dossier resta il mese pieno,
`stepDays` di default). Partita `23fd1fe361ae`, valori identici a quelli registrati in
OP-OBJECTS FLOW §18-bis e OP-OBJECTS TIME-STEP §18-bis:

| grandezza | valore live |
|---|---|
| `needs` | `{food 1.8674696 · clothing 0.55498784 · weapons 1.6 · fuel 0.74}` |
| `capacity` | `{food 11.205 · clothing 4.44 · weapons 25.6 · fuel 4.44}` |
| `flow` cibo | `army −0.48 · civilian −1.387 · natural +5.304 → total +3.437` |
| `flow` vestiario | `facilities +7 · civilian −0.555 · natural +0.278 → total +6.723` |
| `flow` armamenti | `facilities +6.354 · army −1.6 · natural +0.3 → total +5.054` |
| `flow` carburante | `facilities +3.93 · army −0.24 · civilian −0.5 · natural +3.85 → total +7.04` |
| `balance` | `balancePerMonth` = `flow.total` per ogni materiale |
| `/arsenal` | `GBR-garrison` Carburante **0,24** · Armamenti **1,6** · Cibo **0,48**; `factory-GBR-10` Ritmo **100%**, Ferro/Carbone **0,016**, output Vestiario **0,7** · Armamenti **0,5** · Carburante **0,4** |

La verifica **mutante** di un salto reale via HTTP resta bloccata dal **provider LLM**
(`POST /api/games/:id/time-skip` → `424 openai-compatible: HTTP 401`, `LLM_API_KEY` assente in
`backend-nest/.env`): è il blocco noto, non un effetto di questo pacchetto. L'equivalenza del salto
lungo è quindi provata su dati controllati e ripetibili — suite `op-objects-time-step` (37 test) e
misure §12–§13 — mentre il percorso di lettura è verificato live come sopra.

---

## §26. OP-OBJECTS SEED-DETERMINISM — il tiro dipende dal periodo simulato

*(micro-fix successivo a questo pacchetto, stesso report perché corregge ciò che §14/§15/§22
dichiaravano)*

### §26.1 Causa esatta

`MilitaryService.advanceProduction` calcolava il seme del tiro di produzione così:

```ts
const base = `${this.ctx.gameId}:${order.id}:${this.ctx.currentTurn()}`;
const seed = index === 0 ? base : `${base}:${index}`;
const result = advanceOrder(order, context, months * materialFactor, seed);
```

Nel percorso a periodi `advanceProduction` è chiamata **una volta per periodo materiale** (il tick
passa `slice.stepDays`, sempre ≤ 30 giorni), quindi `splitMaterialPeriod(days)` produce **un solo**
step e `index` è **sempre 0**: il suffisso `:${index}` non entrava mai. Poiché `currentTurn()` **non
cambia** durante un salto, i sei periodi di `advanceWorldState(180)` usavano **lo stesso seme** — lo
stesso identico tiro, ripetuto sei volte. Un anno fermo non poteva quindi differire dalla somma dei
suoi dodici mesi su `progress`, `qualityLoss`, `failure` e unità consegnate, a parità di materiali,
conto e capacità.

### §26.2 Vecchio seme → nuovo seme

| | seme |
|---|---|
| prima | `${gameId}:${orderId}:${turno}` (+ `:${index}` solo nel ciclo interno, mai nel percorso a periodi) |
| dopo | `${orderId}:${data del periodo}` |

La coordinata temporale del tiro è la **data simulata** del substep, non il turno né il numero di
chiamate: il risultato di un evento deterministico dipende da *(stato del mondo, ordine, data
simulata)*, non da quanto era grande il bottone «avanti».

`productionRollSeed({ orderId, date, phase? })` è la funzione pura che lo costruisce
(`core/simulation/MilitaryProduction.ts`, accanto a `stableRoll`). `stableRoll`, le probabilità
(`setbackChance`: instabilità, tensione, complessità, tecnologie, `techReady`) e le formule **non sono
state toccate**: è cambiata solo la coordinata del dado.

**L'id di partita non è nel seme** (percorso «a» della specifica): l'id dell'ordine è già unico per
partita e casuale (`shortId`), quindi il `gameId` non aggiungeva informazione temporale ma impediva
soltanto di confrontare due percorsi della stessa simulazione (due partite non possono avere lo stesso
`gameId`). Così il seme esprime esattamente *(ordine, data)* e il test non deve normalizzare nulla.
`phase` resta nella firma come **secondo tiro sulla stessa data**, mai come coordinata: il
chiamante di produzione non lo usa, perché un indice di chiamata rimetterebbe in piedi il difetto
(dipendenza dalla granularità delle chiamate).

### §26.3 Come arriva `stepDate`

`NationStateService.advanceResources` conosce già la data di ogni substep
(`MaterialSliceInfo.stepDate`) e la passa nel gancio:

```
game-session.advanceWorldState  (una sola pipeline temporale)
  → nationState.advanceResources(days, conti, asOfDate, { onPlayerSlice })
      → onPlayerSlice({ stepDays, stepDate, factors })
          → advanceProduction(stepDays, conto del periodo, factors, registro, { stepDate })
              → productionRollSeed({ orderId, date: stepDate })
```

`advanceProduction` ha un **quinto parametro opzionale** `temporal?: { stepDate?: string }`: non è
stata rifatta la firma a oggetto e nessun altro chiamante è cambiato. Se la data non è dichiarata
(percorso legacy/test) il seme ripiega su `this.ctx.currentDate()`, come prima.

Con un blocco di più periodi in **una sola** chiamata (`advanceProduction(90, …, { stepDate })`) le
date interne sono `endDate − (days − elapsed)`: 90 giorni in una chiamata e tre chiamate da 30 vedono
le **stesse** date, quindi gli stessi tiri.

`updatedDate` dell'ordine segue il periodo vissuto: dopo ogni periodo è la data del substep appena
lavorato (nessuna data inventata).

### §26.4 `productionContext` leggeva lo snapshot sbagliato

`productionContext()` usava `this.ctx.accounts()[player]`, e `nationCapacity()`/`industrialCapacity()`
leggevano a loro volta `ctx.accounts()`. Quel conto è `sessionAccounts()`, cioè **conti + modificatori
+ peso sociale del debito** dello stato **corrente**: in un salto lungo è il conto dell'ultimo mese,
non quello del mese che si sta lavorando. Ora:

- `productionContext(account?)` costruisce il contesto dal conto **passato al periodo**
  (stabilità, tensione, fabbriche, porti, università, tecnologie);
- `nationCapacity(polityId, account?)` usa lo stesso conto (`creditHeadroom` compreso);
- il tick chiama `industrialCapacity(polityId, this.nationCapacity(polityId, account))`.

Le letture del Dossier restano sul default (nessun cambio di read model).

**Prova che le due fonti sono davvero diverse:** con un titolo da 1,5 mld su un PIL di 1 mld (150%),
il conto *mostrato* dalla sessione porta `socialTension` più alta e `stability` più bassa del conto
del tick. Il test asserisce che il contesto del tiro coincide **con il conto del periodo** e — con il
codice precedente — fallisce.

### §26.5 Test con imprevisto reale

`tests/op-objects-seed-determinism.test.ts` (nuovo, **11 test**). Il caso §20 non pesca un tiro
buono: cerca sul motore vero la prima data il cui `stableRoll` cade sotto `setbackChance × 0,4`
(escludendo il ramo catastrofico) e la prima data con tiro `> 0,6`, poi fa vivere alle due partite lo
**stesso mese** cambiando solo la data. La prima produce `note = "imprevisto: −17% (linea rallentata,
rischio …)"`, `qualityLoss > 0` e la riga «imprevisto in produzione» nel bollettino; la seconda ha
`note = ""` e `qualityLoss = 0`. Un secondo caso (§21) cerca la data che attiva il ramo catastrofico
(`roll < chance × 0,25` e `stableRoll(seed:fail) < 0,5`) e verifica l'ordine rimosso e il bollettino
«Produzione fallita».

### §26.6 `180 == 6 × 30` e `45 == 30 + 15` (storia produttiva, non solo stock)

Ordine a id fisso `ord-seed-fixed`, `missili_corto` (13,4%/mese: resta aperto sei periodi).

| | semi usati (6 periodi) |
|---|---|
| `advanceWorldState(180)` | `2026-01-31 · 2026-03-02 · 2026-04-01 · 2026-05-01 · 2026-05-31 · 2026-06-30` |
| `6 × advanceWorldState(30)` | **identici** |

Sei date, **sei tiri diversi** (prima: un solo tiro ripetuto). `progress` all'ingresso di ogni
periodo, nei due percorsi: `[0, 0, 3,6697, 7,3394, 11,0091, 14,6788]` — identici, conto e contesto di
ogni periodo compresi. Stato finale dell'ordine identico: `progress 18,3485 · qualityLoss 2,55 ·
status in_progress` (il primo periodo ha incassato un imprevisto da −17% che ha azzerato
l'avanzamento: il tiro è reale, non un caso `roll > chance`).

`45 giorni` ≡ `30 + 15`: semi `2026-01-31` e `2026-02-15`, `progress` in ingresso `[0, 0]`, finale
`1,8349` in entrambi i percorsi — e il secondo periodo vale esattamente **metà** del primo
(18,35 × 0,5), cioè quindici giorni sono mezzo mese anche nel tiro.

**Equivalenza di consegna** (`fucili`, ordine che si chiude): nei due percorsi l'ordine risulta
`null` (completato) e l'arsenale contiene le **stesse 1949 unità** (2000 − 2,55% difettose) — i
difetti dipendono dai dadi, e i dadi ora sono gli stessi.

**Prova di mordente:** rimettendo il vecchio calcolo del seme (solo la riga del seed, resto del
pacchetto presente) **8 degli 11 test falliscono**; rimettendo `productionContext()` senza il
parametro **falliscono i 2 test del contesto**, compreso quello sul salto reale con debito.

### §26.7 Documentazione corretta

- §15: il percorso canonico del playback (`PlaybackService` righe 262 e 600 → `advanceWorldState` →
  `advanceResources` → `onPlayerSlice` → `advanceProduction`) **fa avanzare gli ordini**: la riga
  «`time-skip` non avanza gli ordini» era sbagliata.
- §22: il limite vero è il percorso **legacy** `advanceDate()`, che chiama `advanceResources` senza
  hook; gli «imprevisti di produzione» non sono più legati all'id di partita né al turno, ma a
  *(data, ordine)*.

### §26.8 Test e quality gate (eseguiti)

| comando | esito |
|---|---|
| backend `npx tsc --noEmit` | ✅ |
| backend `npm test` | ✅ **157 file / 1494 test** (erano 157/1483: +1 file, +11 test) |
| backend `npm run build` | ✅ |
| frontend `npx tsc --noEmit` / `npx vitest run` / `npm run build` | ✅ 67 file / 488 test, build ok |
| `npm run test:e2e:mock` | ✅ 45/45 |

Nessuna modifica di frontend, nessun `preset.json`, nessuna migrazione, nessun nuovo motore.

### §26.9 Limiti residui

- Il **seme degli ordini in corso cambia** rispetto alla versione precedente (era
  `gameId:order:turno`): l'imprevisto di un ordine già aperto può cadere in un mese diverso da quello
  che il giocatore aveva visto. Nessuna partita si rompe, nessun salvataggio migra: cambia solo
  *quando* arriva l'imprevisto, ed è il prezzo della coerenza temporale.
- Il **percorso legacy** `advanceDate()` non avanza gli ordini (nessun hook) e il suo fallback di
  data è la data della sessione: invariato e dichiarato.
- La **probabilità** di imprevisto non è scalata dal tempo (`max(1, period)`): un periodo da 15 giorni
  ha la stessa probabilità di un mese. Scelta preesistente, non toccata da questo micro-fix.
- Il **numero di tiri** resta uno per ordine per periodo materiale: non esiste una storia dei tiri
  persistita, quindi il seme è ricostruito dalle date (deterministico e rigiocabile, ma senza memoria
  dei dadi già tirati).

### §26.10 File toccati (micro-fix)

| file | intervento |
|---|---|
| `backend-nest/src/core/simulation/MilitaryProduction.ts` | `productionRollSeed({ orderId, date, phase? })`: il seme è *(ordine, data del periodo)*. `stableRoll`, `setbackChance`, `productionRate`, `advanceOrder` **non** cambiano |
| `backend-nest/src/game/MilitaryService.ts` | quinto parametro `temporal.stepDate`; date dei periodi interni; `productionContext(account?)` e `nationCapacity(polityId, account?)` dal conto del periodo; `industrialCapacity(polityId, conto)`; `updatedDate = stepDate` |
| `backend-nest/src/game-session.ts` | il gancio del tick materiale passa `{ stepDate: slice.stepDate }`; il wrapper `advanceProduction` inoltra il parametro |
| `backend-nest/tests/op-objects-seed-determinism.test.ts` | **nuovo**, 11 test (§24, §18/§22, §23, §11, §19, §20, §21, §25, legacy) |
| `backend-nest/tests/op-objects-time-step.test.ts` | il tick di prova passa la data come la produzione; il conteggio delle sospensioni in `43` è «mai più di uno» |
| `docs/implementation/OP-OBJECTS-PARTIAL-PERIOD-report.md` | §14, §15, §19, §22 corretti; §26 nuovo |

### §26.11 Deploy e verifica live

Deploy: `bash scripts/deploy-cloudflare.sh` (il backend locale risale dopo il solito errore di attesa
150 s), poi `--skip-backend` per frontend, Worker e KV.

```json
{"status":"ok","build":{"backend":"dev","frontend":"4696b29"},
 "schema":{"database":{"tables":52}},"auth":"open-single-user"}
```

`frontend: 4696b29` è il commit di questo micro-fix (squash della PR #76) ✓.

**Percorso di lettura invariato** (il micro-fix non tocca né le formule né i read model). Partita
`23fd1fe361ae`, valori **identici** a quelli registrati in OP-OBJECTS FLOW §18-bis, OP-OBJECTS
TIME-STEP §18-bis e PARTIAL-PERIOD §25:

| grandezza | valore live |
|---|---|
| `needs` | `{food 1.8674696 · clothing 0.55498784 · weapons 1.6 · fuel 0.74}` |
| `capacity` | `{food 11.205 · clothing 4.44 · weapons 25.6 · fuel 4.44}` |
| `flow` | cibo `army −0.48 · civilian −1.387 · natural +5.304 → +3.437`; vestiario `facilities +7 · civilian −0.555 · natural +0.278 → +6.723`; armamenti `facilities +6.354 · army −1.6 · natural +0.3 → +5.054`; carburante `facilities +3.93 · army −0.24 · civilian −0.5 · natural +3.85 → +7.04` |
| `/arsenal` | 17 impianti, 6 miniere, 1 armata, 1 forza; `factory-GBR-10` Ferro/Carbone **0,016**, output Vestiario **0,7 · Armamenti 0,5 · Carburante 0,4** |

La verifica live **mutante** (un salto che tira i dadi dell'ordine) resta bloccata dal provider LLM
(`POST /api/games/:id/time-skip` → `424 openai-compatible: HTTP 401`, `LLM_API_KEY` assente): il salto
lungo è provato dalla sonda su dati controllati (§26.6) e dalla suite di 11 test, mentre il percorso
di lettura è verificato live come sopra.
