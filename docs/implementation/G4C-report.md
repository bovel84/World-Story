# G4-C — Cicatrice temporale e dispacci con causa e mappa

**Pacchetto:** terza consegna della fase G4 del piano grafico immersivo.  
**Data:** 10 settembre 2026.  
**Stato:** implementata, da verifica browser.

## Intervento

### Cicatrice temporale

Quando una regione cambia padrone, il confine precedente resta visibile sulla
mappa per ~9 secondi come documentazione del mutamento:

- nuovo modulo `frontend/src/components/Map/TemporalScarLayer.tsx`:
  - layer MapLibre non interattivi (fill evanescente + tratteggio) dipinti
    con il colore del vecchio proprietario;
  - logica pura esportata (`buildScarGeoJson`, `syncScarLayers`) testabile
    senza mappa;
- `applyCheckpointRegions` cattura il padrone precedente **prima** di
  sovrascrivere e crea la cicatrice solo su vero cambio di padronanza:
  aggiornamenti non territoriali (oggetti, statistiche) non lasciano segno;
- le cicatrici scadono da solo tramite timer: nessun segno permanente;
- una nuova cicatrici sulla stessa regione sostituisce la precedente;
- il battito del mondo (`onWorldEvent`) ora passa da
  `applyCheckpointRegions`: anche le conquiste NPC lasciano cicatrice.

### Dispacci: «Perché» e «Mostra sulla mappa»

- `FeedItem` porta ora `regionIds`: gli eventi checkpoint e il battito del
  mondo allegano le regioni toccate;
- l'articolo del dispaccio mostra la spiegazione causale sotto l'etichetta
  «Perché è accaduto» (il dettaglio dell'evento) e, se l'evento ha toccato
  regioni, il pulsante **«Mostra sulla mappa»** che seleziona la regione
  sulla mappa esistente e chiude l'articolo;
- la selezione riusa il percorso esistente (`setSelectedRegion`): zoom e
  highlight sono quelli già in gioco, nessun nuovo canale di controllo.

## File

- `frontend/src/components/Map/TemporalScarLayer.tsx` (nuovo)
- `frontend/src/components/Map/MapboxMapView.tsx` (prop `temporalScars`, sync layer)
- `frontend/src/App.tsx` (cattura cicatrici, regionIds nei dispacci, onFocusRegion)
- `frontend/src/components/Game/EventFeed.tsx` (regionIds, azioni articolo)
- `frontend/src/components/Shell/DeskContent.tsx` (passaggio onFocusRegion)
- `frontend/src/index.css` (stili articolo: why + show-map)
- `frontend/src/components/Game/causalEvents.test.ts` (nuovo)
- `frontend/src/components/Map/temporalScarLayer.test.ts` (nuovo)

## Invarianti

- Nessun contratto di simulazione, ordine, save o regola gameplay modificata.
- La cicatrice è pura presentazione: non intercetta click, non muta lo stato
  di gioco, scade senza intervento del giocatore.
- «Mostra sulla mappa» riusa la selezione esistente: nessun comando nuovo
  verso il server.
- La Cronaca resta consultazione: le azioni dell'articolo non alterano tempo
  né mondo.

## Limiti noti

- La mappa legacy SVG (`MapView`) non mostra le cicatrici: il percorso attivo
  è `MapboxMapView`.
- L'etichetta della cicatrice usa il colore del vecchio padrone senza nome
  sulla mappa; il nome resta nell'articolo del dispaccio.

## Verifiche

```text
cd frontend && vitest run
→ 15 file, 84 test verdi (7 nuovi causalEvents + 4 temporalScarLayer)

npm run build (frontend)
→ OK
```

## Prossimo passo (G4-D)

- Stima dei costi reale nella verifica fattibilità (segnaposto G4-B).
- Consolidamento dei tempi e conseguenze degli eventi nel salto.