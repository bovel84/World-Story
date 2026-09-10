# G2-A — Landing: promessa di gioco e continua sopra la piega

**Pacchetto:** G2 (ingresso al gioco).  
**Data:** 9 settembre 2026.  
**Stato:** implementata, da revisione indipendente.

## Intervento

`frontend/src/components/Game/Landing.tsx`:

- Sottotitolo sostituito con la promessa concreta del piano §5.1:
  **«Governa una nazione. Cambia una decisione. Osserva un mondo che ricorda.»**
- CTA primaria rinominata in **«Nuova storia»**.
- Il salvataggio più recente è elevato **sopra la piega** come bottone `landing-continue` con kicker «Continua», nome, mossa e data di gioco.
- Il menu del modello IA è declassato a link **«Impostazioni tecniche»** (non compete più con la CTA primaria).
- Aggiunto stato `savesLoaded` per evitare salti di layout: nessuna sezione appare in ritardo senza indicatore.

## Stili

Token aggiunti in `foundations.css`: `landing-continue`, `landing-saves-skeleton`, `landing-tech-link`, con `--ws-*` e focus/accessibilità.

## Test

- `frontend/src/components/Game/landingPromise.test.ts` (2 prove statiche): promessa concreta, «Nuova storia», `landing-continue`, «Impostazioni tecniche», filtro `__rewind__` preservato.
- Build tsc + vite OK.
- Verifica browser Chrome: sottotitolo, CTA, continua sopra la piega e link tecnico tutti presenti.

## Invarianti

- Nessun API/backend/dato modificato.
- Il picker salvataggi nativo continua a filtrare `__rewind__`.
- Le card salvataggio sotto l'hero restano invariate.

## Prossimo passo (G2-B)

Catalogo scenari: pitch limitato (max ~160 caratteri), dettagli in pannello separato, filtri (Consigliati/Storici/Moderni/Provinciali/Sperimentali), separazione «Gioca» da «Studio scenari», fixture nascoste.