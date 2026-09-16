# Revisione indipendente — M07 consolidata (delega, servizi, politiche nazionali)

- **Revisore**: ≠ implementatore.
- **Oggetto**: MandateEngine/Service, integrazione mandati↔finanza↔snapshot, scorte
  minime ai tick, ownership vs holder.
- **Metodo**: riesame dei verbali di µ2/µ3/µ4a–µ4g + verifica dei test dedicati.
- **Esito**: **ACCETTABILE**; **M07 CHIUSO** con un sotto-passaggio dichiarato bloccato.

## Micro-consegne e relativi verbali

| µ | Contenuto | Verbale | Esito |
|---|---|---|---|
| µ1 | Mandati con tetto, periodo, whitelist, scadenza; esecuzione cita `mandateId` e consuma il plafond una volta | (integrazione) `mandates.test.ts`, `mandate-stock-engine.test.ts` | ✅ |
| µ2 | Mandato → finanza canonica (obblighi datati del tesoro) | `REVIEW-M07-MU2.md` → NON ACCETTABILE; `REVIEW-M07-MU2-2.md` → ACCETTABILE dopo remediation | ✅ |
| µ2-bis | Prefisso `mandate_` riservato (422 `reserved_cashflow_id`), atomicità provata, validazioni preventive 422 | idem | ✅ |
| µ3 | Replay/restore mandati nello snapshot economico | `REVIEW-M07-MU3.md` | ✅ |
| µ4a–µ4g | Scorte minime ai tick + decisione giocatore; ownership (`ownerRef`), decoder M02/runtime, source/target fence | `REVIEW-M07-MU4A…MU4E.md` (remdiation iterata), `REVIEW-M07-MU4G.md` | ✅ (7º riesame ACCETTABILE) |
| µ4g copertura | Claim senza test → `tests/m07-snapshot-review.test.ts` (**18 casi**) | `REVIEW-M07-MU4G.md` | ✅ |

## Sotto-passaggio bloccato: «priorità manutenzione/servizi»

Il catalogo dichiara `FacilityType.maintenance` (`resourceId`/`baseUnits`/`periodDays`) e
gli impianti come `initialState.facilities` (`FacilityInstance`), consumati in **sola
lettura** da `FeasibilityService` (intent `produce`). **Non esiste** un runtime di impianti
(stato operativo mutabile, scadenzario di manutenzione, assegnazione personale/capacità)
né un modello di servizi. Implementarlo richiederebbe di **inventare** dati (vietato dal
piano §1.1). La parte attuabile («scorte minime / fuori autorizzazione") è già coperta da
`MandateStockEngine` + `mandate-decisions.test.ts`.

**Sblocco richiesto**: un modello dati per gli impianti (runtime + scadenzario + personale)
decise a livello di prodotto/catalogo. Documentato in `M07-report.md`.

## Connessione a M06 (producer progetto/spedizioni)

Restano **server-internal** `scheduleVerifiedProjectWork`/`createShipmentRuntime` (nessuna
route di gameplay): il lato consume nel tick è automatico e sicuro (fail-closed). Il
collegamento producer→gameplay è dichiarato in `M06-report.md` (µ6a) e dipende dall'allocazione
forza-lavoro (MAT10) e dall'autorizzazione trasporto: **aperto** ma non un difetto.

## Esito

Nessun difetto bloccante nei mandati/flussi; l'unico residuo è dichiarato e motivato.
**M07 CHIUSO** per le parti realizzabili (R2).
