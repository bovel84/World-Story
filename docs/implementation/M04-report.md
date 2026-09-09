# M04 — Produzione, energia e logistica

## µ1 — Ricetta esecutiva e calcolo fisico

**Stato:** completata, da revisione indipendente.

Nuovo `src/core/economy/ProductionEngine.ts`, puro e senza DB/LLM:
- `ExecutionRecipe` richiede esplicitamente input/output, durata positiva, energia per unità, lavoro qualificato e capacità giornaliera; dati assenti/non validi sono rifiutati, non stimati.
- `planDailyProduction` usa bigint e il minimo di capacità, input, energia e lavoro; output, sottoprodotti, input, energia e minuti sono proporzionali al lavoro realmente eseguibile.
- Energia zero → output/consumi zero; capacità non viene sommata a quantità.

`tests/production-engine.test.ts`: 3 prove MAT16/MAT17 (bottleneck, energia zero, schema incompleto). Backend **47 file / 390 test** verdi; build e diff puliti.

## Prossimo

**µ2:** stato di lavoro e tick giornaliero deterministico: output disponibile solo al confine successivo, durata/remaining work e resti persistiti; estrazione decrementa deposito e produce stock solo dopo lavoro reale.

## µ2 — Stato di lavoro, output al confine, estrazione

**Completata.** Nuovo `WorkEngine.ts`: tick puro su `[D,D+1)`, `WorkState` con unità completate e output pending; `releaseOutputs` rende disponibili solo le righe con `availableOn <= D`. `tickExtractionDay` limita il lavoro al deposito, decrementa il deposito solo per output realmente eseguito e lascia output pending fino a D+1. Difetto test-first corretto: estrazione può richiedere input/combustibile; resta vincolata a un solo output corrispondente alla risorsa del deposito. `work-engine.test.ts`: 3 prove (confine D+1, esaurimento deposito, energia zero). Backend **48 file / 393 test** verdi.

## Prossimo

**µ3:** allocazione di capacità per intervallo e logistica/trasporto: pool giornalieri riassegnati in ordine stabile, nessuna prenotazione perpetua di flussi.

## µ3 — Capacità di flusso per intervallo

**Completata.** Nuovo `FlowAllocator.ts`: capacità giornaliera bigint, ordine stabile `priority`/`queueSequence`, quota fino al residuo e nessuna scrittura. Progetti non eleggibili ricevono zero e non trattengono lavoro/trasporto; la domanda viene ricreata ogni giorno, perciò una quota inutilizzata torna subito disponibile. `flow-allocator.test.ts`: 3 prove su tie-break, capacità, progetto bloccato/rilascio il giorno seguente e immutabilità input. Backend **49 file / 396 test** verdi.

## Prossimo

**µ4:** logistica/transito: partenza sposta custodia in transito, stock destinazione disponibile solo alla consegna; blocchi/perdite con ledger fisico riconciliato (MAT14/MAT36).

## µ4 — Logistica e transito

**Completata.** Nuovo `TransitEngine.ts`: spedizione planned→in_transit→delivered/lost, movimenti fisici `partenza/consegna/perdita` e proiezione stock bigint. Partenza trasferisce solo custodia nel ref `transit:<shipment>` (owner dichiarato resta seller); prima della data arrivo buyer resta zero; consegna/perdita sono idempotenti. Blocco prima della partenza non muta stock. `transit-engine.test.ts`: 3 prove fixture §7.2 (20/30kg, arrivo giorno 4, blocco, perdita senza ricreazione). Backend **50 file / 399 test** verdi.

## Prossimo

**µ5:** bridge deterministico verso ledger/repository e stato di lavoro: causali fisiche con effectId, riconciliazione stock e collegamento controllato ai snapshot M02; nessun gameplay LLM finché M06.

## µ5 — Bridge deterministico lavoro→ledger

**Completata.** Nuovo `EconomyCommitService.ts`: `commitWorkDay` usa WorkEngine e appende nel ledger solo input/energia realmente consumati; `commitOutputBoundary` accredita output maturato solo al confine. Entrambe usano effectId/index del ledger: retry è no-op verificato. Test `economy-commit.test.ts`: stock ore/carbone/energia a zero nel giorno D, acciaio zero prima di D+1, acciaio 5 a D+1, retry invariato. Backend **51 file / 400 test** verdi.

**M04 implementata nel verticale isolato (µ1–µ5).** Nessun collegamento a LLM/gameplay prima di M06; accettazione soggetta a revisione indipendente. Prossimo pacchetto: M05 (progetti/fasi).
