# Revisione indipendente — M07 µ3: replay/restore mandati

> **Origine:** revisore indipendente read-only (subagent), 2026-09-08. Il suo ambiente ha restituito il verbale nel canale di revisione ma non gli ha consentito di creare questo file; questa è una trascrizione fedele del verdetto e dei finding. Non è auto-accettazione dell'implementatore.

## VERDETTO: **ACCETTABILE**

Nessun finding sostanziale.

### Verificato
- `economy-snapshot.repository.ts` cattura tutti i campi semantici di `MandateDefinition`/stato e `MandateExecution`; `created_at` non è necessario alla semantica.
- Ordine robusto a FK future: delete inverso `mandate_executions → mandates`, insert diretto `mandates → mandate_executions`.
- Fencing: capture filtra `game_id`+`branch_id`; restore riscrive `game_id`/`branch_id` al target, non copia gli id sorgente.
- Snapshot v1 senza chiavi M07 produce liste vuote: non inventa autorizzazioni/plafond e rimuove lo stato M07 locale del ramo target. I cashflow presenti nello snapshot restano lo stato finanziario catturato.
- Il restore reale di `GameSession.loadFromSave` è dentro `withCanonicalTransaction`; l'assenza del wrapper nel repository è pre-esistente e non è regressione µ3.

### Warning del revisore, chiusi prima della chiusura µ3
1. Test incompleto su status/definition. **Chiuso:** test data-driven `active/cancelled/expired`, `noNewDebt:false`, price limit, whitelist, suppliers, date, resource/minStock ed execution.
2. Legacy senza execution stale. **Chiuso:** execution stale creata e verificata assente dopo restore legacy.
3. Fencing game/branch non esplicitamente provato. **Chiuso:** mandato `other-game` escluso dalla capture; righe restore verificano game/branch target.

### Nota verifica
Il revisore non ha potuto lanciare suite/tsc nel suo ambiente read-only. Dopo la chiusura dei warning, l'implementatore ha eseguito: backend **63 file / 487 test** verdi, build OK, `git diff --check` pulito.
