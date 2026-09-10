# F09 — Scalabilità zoom mobile

- Culling viewport per marker oggetto: fuori dalla camera non partecipano a layout/paint.
- Budget di 90 etichette territoriali nel viewport; selezione e hover restano prioritari.
- Le province diventano eleggibili a zoom territoriale (`>= 3.8`) senza riesporre migliaia di label.

Verifica pubblica a 390×844 dopo tre zoom: superficie mappa 390×792, controlli visibili, marker oggetto renderizzati 110 invece di 2.317. Frontend 88/88.
