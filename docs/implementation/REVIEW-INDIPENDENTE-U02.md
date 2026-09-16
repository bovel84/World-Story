# Revisione indipendente — U02 (ordini guidati e catena della fattibilità)

- **Revisore**: ≠ implementatore.
- **Oggetto**: `stores/orderDraft.ts`, `components/Game/ActionsPanel.tsx` (µ1);
  `components/Game/feasibilityExplanation.ts` (µ2); `components/Game/feasibilityChain.ts`
  + `FeasibilityChainPanel.tsx` (µ3).
- **Metodo**: lettura dei call path + prove riproducibili.
- **Esito**: **ACCETTABILE**; U02 chiuso per le parti realizzabili senza dati inventati;
  il passo 3 è dichiarato bloccato con prove.

## Claim verificati

| Requisito U02 | Evidenza |
|---|---|
| Passo 1 — compositore libero senza perdita bozza, limiti espliciti, «Registra ordine» | `orderDraft.ts` (reducer puro) + `orderDraft.test.ts` (**10 casi**): bozza mai persa su errore rete/rifiuto anteprima, `acceptEnhanced` senza anteprima no-op; `ActionsPanel` con etichetta «Registra ordine» e nota «non avanza il tempo né spende risorse»; `registerOrder` svuota la bozza **solo dopo** l'accodamento |
| Passo 4 — alternative a confronto, nessuna accettazione/pagamento silenzioso | `feasibilityExplanation.ts` (`alternative_path`/`research` → `requiresConfirmation: true`) + `feasibilityExplanation.test.ts` (**6 casi**); `FeasibilityCheck` mostra «Alternative possibili» con nota «nessuna parte da sola» |
| Passo 2 — catena dati/deficit/fonti, leggibile senza colori | `feasibilityChain.ts` (modello puro) + `feasibilityChain.test.ts` (**6 casi**); `FeasibilityChainPanel.tsx` (flusso `<ol>` + lista equivalente `<table>`), etichette testuali Richiesta/Costo/Deficit + fonti; `feasibilityCheck.test.ts` (source-contract) |

## Blocco del passo 3 (conflitti batch e priorità) — verificato di nuovo

`allocateBatch` (`src/core/feasibility/BatchAllocator.ts`) è referenziato **solo** da
`tests/batch-allocator.test.ts` (nessun percorso applicativo). Mancano, per un cablaggio
faithful: (a) accessor ai **pool materiali mutabili** (oggi `FeasibilityService` legge solo
`catalog.initialState.inventory`); (b) conversione canonica **mld↔minorUnits** per i fondi;
(c) fonte della **domanda di manodopera** per intent. Cablarlo richiederebbe di inventare
dati (vietato dal piano §1.1). Vedi `U02-report.md` §«µ2 passo 3 — BLOCCATO».

## Osservazioni residue (non bloccanti)

- Il passo 2 usa i dati autorevoli già esposti da `/actions/check-feasibility` (costi
  catalogo/richiesta e blocker del preflight); i **pool runtime**/ledger non sono ancora
  in catena perché non esposti dal contratto (stesso blocco del passo 3).
- Test UI03/UI07/UI10/UI13/UI15 e MAT03/MAT05: UI01/UI02/UI13 coperti via E2E (Q01);
  gli altri richiedono dati M03 (pool) e restano tracciati.

## Esito

Nessun difetto bloccante nelle parti consegnate; prove presenti; unica parte aperta
dichiarata e motivata (passo 3). **U02 CHIUSO** per le parti realizzabili.
