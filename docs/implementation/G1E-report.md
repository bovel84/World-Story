# G1-E — Dialog di conferma accessibili per azioni distruttive

**Pacchetto:** sostituzione degli ultimi `confirm()` bloccanti con `ConfirmDialog`.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Intervento

- Nuovo `frontend/src/components/ui/ConfirmDialog.tsx`: dialog modale accessibile basato su `AccessibleDialog`, con focus su «Annulla» per default (scelta sicura), variante `destructive` per azioni irreversibili.
- Stili in `foundations.css` con token `--ws-*` e z-index coerente.
- Sostituiti tre `window.confirm()`:
  1. **Rewind** in `App.tsx` (torna al turno precedente) — conferma con etichetta esplicita «Annulla mossa» / «Mantieni».
  2. **Carica salvataggio** in `App.tsx` — conferma con nome salvataggio e turno, varianti distruttive.
  3. **Sovrascrittura preset** in `TemplateSelector.tsx` — conferma import con ID duplicato.

## Invarianti

- Nessun dato, API, simulazione o salvataggio modificato.
- Le azioni restano identiche; cambia solo l'interfaccia di conferma.
- I dialog non rubano il focus in modo inatteso e chiudono con Escape/backdrop.
- Varianti `destructive` usano `--ws-danger` per coerenza visiva.

## Test

```text
cd frontend && ../node_modules/.bin/vitest run
→ 9 file, 60 test verdi

cd frontend && npm run build
→ tsc + vite OK (9.45s)

git diff --check
→ pulito

rg "\\bconfirm\\(" frontend/src --glob '*.{ts,tsx}' --glob '!**/*.test.ts'
→ nessuna occorrenza
```

## Prossimo passo

La base di dialog e feedback è ora completa e accessibile. Il prossimo blocco (G2) avvia la shell operativa: mappa dominante, command rail persistente, moduli a tab e migrazione CSS componente per componente sui token già introdotti.