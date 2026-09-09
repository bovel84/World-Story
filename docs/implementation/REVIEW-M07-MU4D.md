# Quarto riesame indipendente — M07 µ4d

> **Origine:** reviewer indipendente read-only, senza facoltà di scrivere file. Trascrizione fedele, non auto-accettazione.

## VERDETTO: **NON ACCETTABILE**

### Sostanziali
1. Il check iniziale dello snapshot strict era solo strutturale: un ledger semanticamente invalido mutava RAM prima del fallimento restore; staging RAM non includeva players/consolidazione/difficulty.
2. La pulizia staging poteva essere rollbackata dal catch restore; snapshot invalidi bloccati prima del repository non la pulivano.

### Minore
Chiavi snapshot sconosciute non validate.

### Remediation µ4e
Preflight puro semantico prima della RAM, staging RAM completo, invalidatore staging in transazione indipendente per tutti i rifiuti strict; tabelle v1 richieste e chiavi ignote rifiutate; E2E strict aggiunto. Quinto riesame pendente.
