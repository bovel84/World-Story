# G6-A — Caricamento differito mappa e impostazioni LLM

- `MapboxMapView`/MapLibre è ora un import dinamico, con fallback `Caricamento mappa…`.
- `LLMSettingsModal` è caricato solo quando richiesto.
- Bundle iniziale JS: da circa 1,4 MB a **293 KB** non compressi; MapLibre resta un chunk differito di circa 1,10 MB.

Verifica: frontend 88/88, build OK.
