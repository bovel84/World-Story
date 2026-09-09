# Revisione indipendente — M07 µ4a: scorte minime tick-only

> **Origine:** revisore indipendente read-only. L’ambiente non gli ha consentito di creare il verbale; trascrizione fedele del suo output, non auto-accettazione.

## VERDETTO: **NON ACCETTABILE**

### Sostanziali
1. **S-1 — proprietà non attestata** (`MandateDecisionService.ts:69-73`, `game-session.ts:586-589`): `ledger.stock[].holder` veniva trattato come owner, ma consegna/transito possono collocare merce estera presso un attore della polity. Correzione richiesta: proiezione ownership-aware o mapping server-side, mai contare custodia come proprietà.
2. **S-2 — cancel differito** (`MandateService.ts:289-304`, route cancel): la decisione rimaneva open/ack fino al tick successivo; GET/ack potevano osservarla subito dopo cancel. Correzione richiesta: cancel+risoluzione nella stessa transazione game/branch fenced.

### Minori
- Restore snapshot dichiarato atomico senza wrapper locale.
- PK includeva `decision_kind`, permettendo alternative stale per lo stesso mandato.

### Remediation dichiarata
Vedi M07-report µ4b: ownerRef materiale senza backfill, cancel atomico, restore wrapper e unicità per mandato, con regressioni dedicate. Riesame pendente.
