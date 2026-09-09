# Terzo riesame indipendente — M07 µ4c

> **Origine:** reviewer indipendente read-only; impossibilitato a creare file. Trascrizione fedele, non auto-accettazione.

## VERDETTO: **NON ACCETTABILE**

### Sostanziali
1. Bootstrap **ibrido**: bastava un materiale ownerless per entrare nel ramo legacy e ignorare ownerRef divergenti degli altri materiali.
2. Snapshot strict: `isEconomicSnapshot` accettava `tables: []/{}`; le tabelle assenti venivano lette come liste vuote e il restore poteva cancellare tutto. `loadFromSave` non verificava il booleano restore.

### Correzione µ4d
Legacy ammesso solo se tutti i materiali sono ownerless; snapshot v1 richiede tutte le tabelle storiche e righe-record, M07 resta opzionale; strict richiede restore true. Regressioni dedicate aggiunte. Quarto riesame pendente.
