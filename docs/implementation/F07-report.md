# F07 — Ripristino dei salvataggi legacy e mappa produzione

## Problema

Il save pubblico storico aveva `content_hash` vuoto (formato precedente all’hash). Il backend lo trattava come manomesso e rispondeva 404: la shell non veniva montata, quindi la mappa non poteva apparire.

## Correzione

- Un save con hash **assente** viene sigillato una sola volta con l’hash semantico corrente.
- Un hash presente ma non corrispondente resta rifiutato: nessun bypass dell’integrità.
- Nei giochi legacy `GET /mandates/decisions` restituisce una dashboard vuota (200), evitando un 409 rumoroso nel browser; il conto nazionale resta indipendente.

## Verifica

- API `POST /api/saves/f6cd91b94881/load`: 200; hash persistito a 64 caratteri.
- Browser produzione: shell presente, `canvas: 1`, `.maplibregl-map: 1`, nessun fallback né errore console.
- Frontend 88/88; backend 507/507; entrambe le build OK.
