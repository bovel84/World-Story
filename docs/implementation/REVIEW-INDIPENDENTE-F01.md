# Revisione indipendente — F01 (ID e contratti end-to-end)

- **Revisore**: ≠ implementatore.
- **Oggetto**: identità `actionId`/`projectId`, stati coda/`queueVersion`, outcome tecnico,
  migrazioni additive.
- **Metodo**: esecuzione reale + lettura dei test/contratti.
- **Esito**: **ACCETTABILE**.

## Claim verificati (esecuzione reale)

| Requisito F01 | Evidenza |
|---|---|
| A01/C01 — outcome associati per **ID**, mai per testo/indice | `id-contract-regression.test.ts` (8 casi): testo identico con esiti invertiti → assegnati correttamente; `actionId` esterno → protocollo rifiutato e coda intatta; riformulazione risolta solo se **unica**; ordine multi-intento → un solo ID/salto/esito |
| A01/I17 — nessuna accettazione implicita | `outcome-contract.test.ts`: ordine senza esito → `unresolved` persistito, nessuno status fabbricato in memoria |
| Contratti runtime (I05/I15) | `domain-contracts.test.ts` (4 casi): ID/enum/date/progetto/evento/batch malformati/duplicati/estranei rifiutati; testo ammesso **solo** dall'adapter legacy esplicito |
| A05/I13 — stati coda separati + `queueVersion` | `queue-contract.test.ts` (3 casi): `queued/not_started` ≠ `issued/in_progress`, `queueVersion` incrementato solo su mutazione reale, migrazione backward-compatible risana uno schema pre-F01 |
| A07/C07 — chiusura processo per `projectId` | `id-contract-regression.test.ts` (C07): `projectId`/`sourceActionId` nel contesto; chiusura del solo `projectId` dichiarato anche con titoli identici; salto world-only mantiene i progetti aperti |

## Verifica dei residui dichiarati

- **A11** (parse proposte evento) resta assegnato a F03/F06: F01 fornisce `parseEventProposal`
  ma non lo integra nel percorso legacy. Non è un difetto di F01, è fuori perimetro.
- **Scomposizione esplicita** di un ordine in sottoazioni (SPEC §6.2): non implementata (dipende
  dal contratto `OrderIntent` di M03); F01 garantisce che **nessuna** scomposizione implicita
  avvenga e che il testo originale resti in cronaca. Corretto e testato.
- Gli adapter legacy sono transitori: **M06 li vieta nel percorso strict** (verificato in
  `REVIEW-INDIPENDENTE-M06-CHIUSURA.md`).
- Nessun expected-fail residuo.

## Esito

Identità end-to-end, stati coda e assenza di accettazione implicita sono verdi con copertura
dedicata. **F01 CHIUSO.**
