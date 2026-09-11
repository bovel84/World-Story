# F11 — HUD e scroll del dossier mobile

## Correzioni

- HUD mobile a colonne esplicite: menu, dispacci, turno, avanzamento e data non possono più comprimersi o uscire dal viewport.
- La data conserva il formato esteso su desktop e usa `gg/mm/aaaa` su mobile.
- Il nome mondo viene nascosto solo sotto 480px, dove non era leggibile; il turno resta sempre visibile.
- `game-shell-desk` mobile ora ha `overflow-y: auto`, inerzia touch e overscroll contenuto. Il dossier Nazione è consultabile fino al termine.

## Verifica produzione

- HUD: nessun elemento fuori viewport a 360×844 e 390×844.
- Dossier Nazione: area 590px, contenuto 2450px; scroll utente verificato da 0 a 1800px senza errori.
- Desktop e mobile: Ordini, Diplomazia, Consulente, Notizie, Nazione, Cronaca e zoom verificati senza errori console/HTTP.
- Frontend: 88/88 test e build completata.
