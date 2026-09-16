# Revisione indipendente — M06: chiusura formale (consolidata)

- **Revisore**: ≠ implementatore.
- **Oggetto**: collegamento al simulatore e rimozione dei bypass (GATE-1 + M01–M05).
- **Metodo**: le **cinque** revisioni indipendenti già prodotte + verifica dei test
  end-to-end strict; questo documento ne formalizza la chiusura.
- **Esito**: **M06 CHIUSO**.

## Revisioni indipendenti (cronologia)

| # | Verbale | Esito |
|---|---|---|
| 1ª | `REVIEW-INDIPENDENTE-M06.md` | remediation richieste |
| 2ª | `REVIEW-INDIPENDENTE-M06-2.md` | remediation richieste |
| 3ª/4ª | (vedi `M06-report.md` µ5e/µ5f) | remediation richieste |
| 5ª | `REVIEW-INDIPENDENTE-M06-5.md` | **ACCETTABILE** — nessun finding sostanziale; B1 (denaro) e B2 chiusi; residui non bloccanti (R-3, O-1/O-2/O-4) |

## Invarianti verificate (sintesi)

- Il percorso strict valida l'intero completion (`validateStrictResult`) **prima** di
  mutatori/commit; protocollo/ID/effetti invalidi → pausa all'ultimo checkpoint, mai
  commit narrativo (`m06-strict-integration.test.ts`, 8 casi E2E).
- Nessun `worldChanges` assoluto crea PIL/fondi/militare per testo; tutti gli effetti
  strict hanno causale e tipi consentiti (`EffectValidator`); `applyWorldChanges`/
  `applyMapChanges` ri-validano in strict (nessun bypass legacy).
- Tick deterministico (preflight → staging riserve → scadenze → proposta LLM →
  validazione → checkpoint); nessuna rete dentro la transazione canonica.
- Adapter materiali server-staged (`ledger`, `shipment`, `project_tick`) con
  staging/anchor e promozione atomica attraverso i checkpoint; fail-closed in assenza.
- Producer gameplay reali via route e bootstrap (µ6a): bootstrap catalogo idempotente,
  route cashflow/reservations con binding server-side, catena E2E reale
  (`court 400000`, tesoro `600000`, cashflow `paid`).

## Residui dichiarati (non bloccanti, ereditati dalla 5ª revisione)

- R-3: rehash post-migrazione senza test dedicato.
- O-2: mappatura 422 suggerita per `catalog_conflict` (miglioramento futuro).
- O-1/O-4: osservazioni minori.
- `scheduleVerifiedProjectWork`/`createShipmentRuntime` **server-internal** (nessuna
  route di gameplay): collegamento producer→gameplay demandato a M07/ordini strutturati
  (vedi `REVIEW-INDIPENDENTE-M07.md`); lato consume automatico e fail-closed.

## Esito

Il validatore non è aggirabile sui percorsi analizzati e le prove E2E strict sono verdi.
**M06 CHIUSO.**
