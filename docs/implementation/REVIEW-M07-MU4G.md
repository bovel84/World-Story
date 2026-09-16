# Settimo riesame indipendente — M07 µ4g

> Reviewer read-only sul codice consegnato (nessuna scrittura di produzione);
> trascrizione fedele e verificabile. Revisore ≠ implementatore: questa sessione
> non ha scritto le remediation µ4g, si limita a verificarle.

## VERDETTO: **ACCETTABILE** (un rilievo minore di copertura, chiuso in questa sede)

Le tre remediation dichiarate in µ4g risultano **presenti e corrette** nel
codice; non è stato trovato alcun bypass residuo nel perimetro S-12/S-13/S-14.
Il riesame ha però rilevato che i claim erano **privi di test di regressione
dedicati**: la suite copriva µ3/µ4b/µ4e, non µ4g. Il gap è stato chiuso con 18
casi nuovi (sotto).

## Perimetro verificato

| Claim µ4g | Dove | Esito |
|---|---|---|
| **S-12** plafond/execution: `spent` = somma exact delle execution; whitelist/fornitore; date canoniche UTC (rifiuta `1951-02-30`); importi/quantità; `MandateEngine.assertDate` round-trip | `economy-snapshot.repository.ts` `validateMandateTables`; `core/mandates/MandateEngine.ts` `assertDate` | ✅ confermato |
| **S-13** decoder semantico M02/runtime: reservation (range/status), cashflow (amount/outstanding/policy/status), appropriation/debt (denominatore > 0), escrow, schedule/project/shipment JSON + version/status | `economy-snapshot.repository.ts` `validateOtherTables` | ✅ confermato |
| **S-14** source/target fence: `capture` e `restore` verificano `game_branches.game_id` prima di query/delete; ramo inesistente → `snapshot_branch_missing` | `assertSnapshotBranch`, `captureEconomicSnapshot`, `restoreEconomicSnapshot` | ✅ confermato |

## Rilievo (chiuso)

**R-1 (copertura, non comportamento):** µ4g dichiarava le remediation S-12/S-13/
S-14 ma la suite non conteneva casi dedicati; l'unica prova era il blocco µ4e
(M02 v1 + target cross-game). Non è una regressione di comportamento, ma un
claim non verificabile da test — contro la regola di consegna del piano
(«consegnare prove ripetibili, non “dovrebbe funzionare”»).

Evidenza (nuovo `backend-nest/tests/m07-snapshot-review.test.ts`, 18 casi):

- S-12: snapshot reale valido; `spent` divergente → rifiuto; `spent` negativo →
  rifiuto; execution oltre plafond → rifiuto; execution fuori periodo → rifiuto;
  `1951-02-30` → rifiuto; `MandateEngine` rifiuta la data inesistente.
- S-13: residuo riserva > iniziale; cashflow `outstanding > amount`; debito
  `rate_denominator = 0`; escrow negativo; lavoro progetto non positivo;
  `projectRuntime.plan_json` corrotto; `shipmentRuntime.transport_authorized = 2`;
  `strictLedgerSchedule.entry_json` corrotto.
- S-14: `capture` con game diverso → `snapshot_branch_fence`; ramo inesistente →
  `snapshot_branch_missing`; `restore` su ramo di altro game → rifiuto prima di
  qualunque delete.

## Osservazioni residue (non bloccanti, fuori perimetro S-12/13/14)

1. `reservation_operations` e `finance_operations` non sono validati
   semanticamente (`isEconomicSnapshot` richiede solo liste di record). Per le
   partite strict l'hash semantico dello snapshot (`semanticStateHash`) copre
   `economicState`, quindi una manomissione è respinta a monte quando
   `expectedHash` è presente; resta un rischio di **difesa in profondità** solo
   per save legacy senza hash. Non è un claim di µ4g: segnalato, non richiesto.
2. Il campo `sourceBranchId` dello snapshot è metadato e non viene confrontato
   con `gameId`/target in `restoreEconomicSnapshot`; il fence effettivo è sul
   **target** (`assertSnapshotBranch`) e sull'argomento di `capture`. Coerente
   con S-14 come formulato.
3. `validateOtherTables` sugli `appropriations` verifica la non-negatività, non
   la coerenza `committed + spent ≤ authorized`; l'invariante è responsabilità
   del servizio di finanza, non del decoder snapshot.

## Comandi e risultato

```bash
cd backend-nest && npx vitest run tests/m07-snapshot-review.test.ts   # 18/18 verdi
npm --prefix backend-nest test                                         # 118 file, 991/991 verdi
```

Nessun DB reale toccato (DB in `os.tmpdir()`), nessun credito LLM, nessuna rete.

## Decisione

**M07 µ4g: ACCETTABILE** ai fini del settimo riesame. Il rilievo R-1 è chiuso
dai test aggiunti. Restano aperti, per il seguito del pacchetto, i punti
funzionali già noti (priorità manutenzione/servizi) e le osservazioni residue
sopra (fuori perimetro).
