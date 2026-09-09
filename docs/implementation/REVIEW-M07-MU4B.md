# Riesame indipendente — M07 µ4b

> **Origine:** revisore indipendente read-only; il suo ambiente non consentiva di creare file. Trascrizione fedele, non auto-accettazione.

## VERDETTO: **NON ACCETTABILE**

### Sostanziali
1. `StrictEffectProducerService.ts:165`: bootstrap legacy rilevato erroneamente anche per tesorerie money (senza ownerRef legittimo), nascondendo conflitti nuovi. Richiesto distinguere solo materiali legacy e verificare il contenuto.
2. `EconomyCommitService.ts:7`: consumo energia senza ownerRef lasciava disponibilità ownership-aware fittizia.

### Minore
`economy-snapshot.repository.ts`: restore accettava ledger snapshot `money` con owner_ref, aggirando il codec. Richiesta validazione pre-delete, preservando invalidazione staging M06.

### Remediation
Vedi `M07-report.md` µ4c: rilevazione legacy materiale+confronto rigoroso, owner energia, validazione ledger snapshot e regressioni. Terzo riesame pendente.
