# G5-B — Picker Save/Load e riallineamento atomico

## Implementazione

- Aggiunto `SavePickerModal`: elenco reale dei salvataggi, ordinato per data, con distinzione fra partita corrente e altre partite. La selezione non muta lo stato: resta soggetta alla conferma esistente.
- Il pulsante «Carica» nel dossier Nazione non sceglie più arbitrariamente il primo salvataggio.
- Landing e picker usano lo stesso percorso `handleResumeSave`.
- Il ripristino rilegge dallo snapshot: partita, mondo, coda, timeline, processi e conto nazionale; azzera feed, bozza, suggerimenti, cicatrici, selezione di modifica e store chat prima di sostituire lo snapshot canonico.

## Verifica

- Playwright: picker aperto dalla partita (`/tmp/ws-e2e-g5-savepicker.png`).
- Frontend: 88/88 test e build OK.
- Backend: 506/506 test e build OK.
