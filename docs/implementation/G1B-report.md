# G1-B — Dialog accessibili, portal e focus management

**Pacchetto:** seconda micro-consegna delle fondazioni UI.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Problema

I modali erano implementati in punti diversi dell'albero React. Alcuni avevano `role="dialog"`, ma mancavano una regola comune per portal, isolamento dell'app sottostante, intrappolamento del focus e ritorno al controllo di partenza. Save e impostazioni IA installavano inoltre listener `Escape` autonomi.

## Implementazione

Nuovo primitive: `frontend/src/components/ui/AccessibleDialog.tsx`.

- rende il dialog in `document.body` tramite portal;
- quando il primo dialog si apre, rende `#root` `inert` e `aria-hidden`, blocca lo scroll della pagina e conserva i valori preesistenti;
- sul dialog finale chiuso ripristina stato e focus del chiamante;
- porta il focus al controllo esplicitamente fornito, altrimenti al contenitore;
- gestisce `Escape`, click sul backdrop opzionale e ciclo `Tab` / `Shift+Tab`;
- usa un contatore per non ripristinare app e scroll se più dialog sono sovrapposti;
- conserva classi e layout visuali legacy, quindi non introduce una riscrittura CSS trasversale.

## Adozione

| Componente | Focus iniziale | Backdrop |
| --- | --- | --- |
| `SaveGameModal` | input nome | chiude |
| `LLMSettingsModal` | chiudi | chiude |
| `NewsFlash` | chiudi | non chiude (comportamento precedente preservato) |
| `PresetEditorModal` | chiudi | chiude |
| Prompt editor in `App.tsx` | textarea | chiude |

Il prompt editor ora riceve il backdrop direttamente dall'overlay portal; la vecchia superficie cliccabile interna è stata eliminata.

## Invarianti

- Nessun endpoint, save, preset o meccanica di simulazione è stato modificato.
- I comandi di chiusura e gli stili esistenti restano gli stessi.
- Il click esterno viene accettato solo se avviene sul backdrop, mai attraverso il contenuto del dialog.
- Gli handler di chiusura sono mantenuti in un ref: il focus trap non viene smontato e rimontato a ogni render del chiamante mentre l'utente scrive.

## Test

Nuovo test statico: `frontend/src/components/ui/accessibleDialogContract.test.ts`.

```text
cd frontend && ../node_modules/.bin/vitest run
→ 8 file, 56 test verdi

cd frontend && npm run build
→ tsc + vite OK

git diff --check
→ pulito
```

Il tentativo di verifica interattiva Chrome dopo la build è stato bloccato dal tab precedentemente impegnato nella creazione di un mondo (timeout DevTools). Rimane da eseguire una prova manuale completa: apertura, Tab/Shift+Tab, Escape e ritorno focus per ciascuno dei cinque dialog. Playwright continua a non essere disponibile su macOS 11.6.

## Fuori dallo scope

- Dettaglio dispaccio dell'archivio, Timeline panel e Simulation Event Reader usano ancora strutture modali specifiche: sono la prossima migrazione, dopo la prova manuale della primitive.
- Toast applicativo e sostituzione degli `alert()` legacy.
- Shell grid, command rail e migrazione visiva dei moduli.

## Revisione richiesta

Verificare la pila di due dialog contemporanei (inert/scroll/focus), i controlli MapLibre dentro il gioco e i breakpoint mobile reali.
