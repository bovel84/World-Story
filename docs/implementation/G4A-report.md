# G4-A — Desk Tempo separato dalla Cronaca

**Pacchetto:** prima consegna della fase G4 del piano grafico immersivo.  
**Data:** 10 settembre 2026.  
**Stato:** implementata, da verifica browser.

## Intervento

È stata separata la decisione di avanzamento dalla lettura dello storico:

- nuova CTA HUD **«Avanza»**, con badge del numero di ordini già registrati;
- nuovo `frontend/src/components/Game/TimeDesk.tsx` in dialog accessibile;
- il Desk Tempo mostra, prima del salto:
  - data corrente;
  - ordini pronti, senza suggerire che siano già eseguiti;
  - processi in corso che potrebbero maturare;
  - salto al prossimo evento importante, preset e data scelta;
  - blocco esplicito quando un checkpoint è attivo;
- il pannello Timeline resta **Cronaca** read-only: contiene archivio, dettagli e operazioni esplicite di checkpoint, ma non controlli per muovere il calendario.

## File

- `frontend/src/App.tsx`
- `frontend/src/components/Game/HudBar.tsx`
- `frontend/src/components/Game/TimeDesk.tsx` (nuovo)
- `frontend/src/styles/foundations.css`
- `frontend/src/components/Game/timeDeskSeparation.test.ts` (nuovo)

## Invarianti

- Nessun endpoint, contratto di simulazione, ordine, save o regola gameplay modificata.
- Il salto continua a passare esclusivamente da `onTimeSkip`/`gameApi.timeSkip`.
- Un checkpoint in pausa impedisce un nuovo salto come in precedenza.
- La Cronaca non anticipa eventi non committati.

## Verifiche

```text
cd frontend && vitest run
→ 12 file, 67 test verdi

cd frontend && npm run build
→ tsc + vite OK

git diff --check
→ pulito
```

## Prossimo passo G4-B

Integrare la verifica di fattibilità già disponibile nel dominio (`POST /games/:id/actions/evaluate`) in un flusso UI che richieda dati strutturati senza inventare costi lato client; poi rendere esplicita la catena causale ordine → processo → evento → regione.
