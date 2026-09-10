# F10 — Audit UI desktop e mobile

## Difetti corretti

1. `.game-shell-grid` era auto-posizionata nella prima colonna della griglia esterna (la rail). A desktop la mappa risultava quindi larga `0px`. Ora estende correttamente l'intera riga sotto HUD.
2. L'apertura del modulo Diplomazia provava automaticamente a creare una conversazione con tutte le 110 nazioni del layer cartografico. Alcune non erano politie risolvibili nella sessione e producevano `404`. Il modulo ora apre la lista conversazioni senza azioni diplomatiche implicite.
3. Le etichette cartografiche fuori camera e l'etichetta politica duplicata della regione selezionata sono escluse dal rendering.

## Verifica produzione

Automazione Playwright contro `world-story.bovel-cannas.workers.dev`:

| Controllo | Desktop 1440×900 | Mobile 390×844 |
| --- | --- | --- |
| Superficie mappa | 1384×846 | 390×736 |
| Ordini, Diplomazia, Consulente, Notizie, Nazione | aprono | aprono dal dock |
| Cronaca | apre | apre |
| Zoom | attivo | attivo |
| errori console / HTTP ≥400 | nessuno | nessuno |

Suite frontend: 88/88; build TypeScript/Vite completata.

I flussi che richiedono un LLM esterno restano verificabili solo quando sono configurate credenziali di provider valide.
