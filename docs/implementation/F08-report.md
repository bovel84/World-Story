# F08 — Mappa mobile e overlay di caricamento save

## Correzioni

- Su mobile, `GameShell` ora usa una singola colonna `minmax(0, 1fr)` e il contenitore mappa è un blocco vincolato a larghezza/altezza viewport. La precedente regola `.game-shell:not(.desk-open)` lasciava la grid nella colonna rail da 0 px: la canvas esisteva ma il suo contenitore React misurava 0 px.
- Il toast «Partita caricata» è rimosso dal ripristino del save: su telefono copriva la parte bassa della mappa ed era percepito come log verde.
- L’attribuzione `Immagini © Esri, Maxar, Earthstar Geographics` resta visibile in basso: è richiesta dalla licenza delle tile. Non è presente alcun banner «Licenza gratuita» nella build prod.

## Verifica produzione

Viewport 390×844: `.map-keyboard-surface` e canvas misurano 390×792, MapLibre è montato e non ci sono errori console. Screenshot: `/tmp/ws-prod-mobile.png`.
