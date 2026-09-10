# G2-B — Catalogo scenari: pitch, ricerca e Studio separato

**Pacchetto:** G2 (ingresso al gioco), §5.2 del piano.  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Intervento

`frontend/src/components/Game/TemplateSelector.tsx`:

- **Pitch limitato a 160 caratteri** per card confrontabili; le descrizioni lunghe (prompt, lore) restano disponibili con «Leggi di più / Leggi meno», come pannello inline.
- **Ricerca** per nome o descrizione, con stato vuoto esplicito.
- **Studio scenari** separato dal percorso di gioco: «Nuovo preset», «Importa scenario» e le azioni autore sulle card (modifica, copia, export) sono visibili solo attivando l'interruttore. Di default le card restano pulite, con un solo controllo di apertura.
- Il toggle «Leggi di più» è ora **fratello** del bottone di selezione, non annidato: nessun controllo interattivo dentro un altro.

## Accessibilità

- Ricerca e toggle sono controlli nativi con `aria-label`/`aria-pressed`.
- `aria-expanded` sul toggle di descrizione.
- Nessun annidamento button-in-button (verificato da test statico).

## Test

- `templateSelectorCatalog.test.ts` (2 prove): pitch 160, presenza ricerca/studio/toggle, e non-annidamento del toggle.
- Suite completa: **64 test verdi**.
- Build tsc + vite OK.
- Verifica browser: ricerca presente, 9 card, azioni autore nascoste di default, 6 card con «Leggi di più»; Studio scenari rivela import/nuovo/azioni.

## Invarianti

- Nessun API/backend/dato modificato.
- Il comportamento di selezione scenario resta identico.
- Import con conflitto resta coperto da `ConfirmDialog`.

## Prossimo passo (G2-C)

Scelta paese (§5.3): dossier paese (posizione, alleati, pressioni, forze, sfide), ricerca/filtri, difficoltà contestuale integrata, legenda mappa con contorni distinti per selezionato/alleato/rivale.