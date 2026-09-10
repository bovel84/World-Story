# G1-D — Feedback non bloccante con toast accessibili

**Pacchetto:** feedback coerente dopo l'unificazione dei dialog.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Problema

`App.tsx` usava `alert()` per errori e conferme di esito: interrompeva il flusso, non condivideva il linguaggio visivo dell'app e non offriva una gerarchia di tono. I messaggi riguardavano salvataggio, caricamento, rewind, prompt, generazione mondo e le funzioni editor mappa residue.

## Implementazione

- Nuovo `frontend/src/components/ui/ToastProvider.tsx`, montato in `main.tsx`.
- API interna: `const { notify } = useToast()` e `notify(messaggio, 'success' | 'error' | 'info')`.
- Viewport portal con `aria-live="polite"`, fino a tre messaggi e auto-dismiss dopo cinque secondi; ogni messaggio ha chiusura esplicita raggiungibile da tastiera.
- Stili in `foundations.css`, con token e z-index `2100` per restare sopra gli overlay legacy che arrivano a `1900`.
- Tutte le chiamate `alert()` del codice frontend sono state rimosse. Le conferme distruttive (`confirm`) restano intenzionalmente fuori da questa micro-consegna: richiedono una decision dialog, non un toast.

## Invarianti

- Nessun API/backend/dato partita è stato toccato.
- Le azioni e i messaggi semantici precedenti restano, ma non bloccano più il browser.
- I toast non rubano il focus e possono apparire anche accanto a un dialog portal.

## Test

```text
cd frontend && npm run build
→ tsc + vite OK

cd frontend && ../node_modules/.bin/vitest run
→ 9 file, 60 test verdi

git diff --check
→ pulito

rg "\\b(alert|prompt)\\(" frontend/src --glob '*.{ts,tsx}' --glob '!**/*.test.ts'
→ solo commenti storici su prompt; nessun alert o prompt invocato
```

La build impiega circa 3 minuti nell'ambiente corrente e segnala solo il warning di chunk Vite già noto.

## Prossimo passo

Sostituire i due `confirm()` rimasti con una `ConfirmDialog` accessibile e poi iniziare la shell operativa (mappa dominante, command rail e moduli) sui token già introdotti.
