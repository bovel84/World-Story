# G4-D — Stima costi reale nella verifica fattibilità

**Pacchetto:** quarta consegna della fase G4 del piano grafico immersivo.  
**Data:** 10 settembre 2026.  
**Stato:** implementata, da verifica browser.

## Intervento

### Segnaposto rimosso: costi autorevoli dal catalogo

La stima a zero del G4-B (`cost: { money: 0, ... }`) è sostituita da una
proiezione onesta dai dati del catalogo:

- nuovo modulo puro `backend-nest/src/core/feasibility/costs.ts`
  (`estimateIntentCosts`), nessuna ricerca LLM: solo dati autorevoli;
  - **produce / train / maintain** (catalogRef = ricetta): input materiali del
    ciclo, **scalati per eccesso** alla quantità richiesta, più la durata
    autorevole della ricetta (`durationDays`);
  - **construct** (catalogRef = facilityType): mantenimento dichiarato
    dell'impianto con il suo periodo; il tempo di costruzione non è
    autorevolato dal catalogo e non viene inventato;
  - **procure / move**: la richiesta esplicita (`intent.quantity`) è il
    consumo da sostenere;
  - **policy / research / qualitative / diplomatico**: nessun consumo
    materiale dichiarato → `basis: 'none'`, il UI non mostra cifre.
- `GameSession.checkFeasibilityWithCosts`: un **solo percorso LLM** produce
  assessment + costi (la stima riutilizza l'intent già normalizzato);
  `checkFeasibility` resta come delega per il solo assessment;
- l'endpoint `check-feasibility` risponde ora con `costs` (timeDays, inputs,
  upkeep, basis) al posto del segnaposto `cost`.

### UI

- `FeasibilityCheck` mostra «Costi stimati dal catalogo»: righe di consumo
  (nome risorsa, quantità, unità), durata per ciclo e mantenimento periodico;
  quando non ci sono consumi dichiarati mostra esplicitamente «Nessun consumo
  materiale dichiarato per questo tipo d'ordine» invece di zeri fittizi.
- Aggiunti gli stili del dialog fattibilità (mancanti dal G4-B): header,
  spinner, sezioni costi/prerequisiti/rischi/avvisi, azioni.

## File

- `backend-nest/src/core/feasibility/costs.ts` (nuovo)
- `backend-nest/src/game-session.ts` (`checkFeasibilityWithCosts`)
- `backend-nest/src/routes/games.routes.ts` (risposta `costs`)
- `backend-nest/tests/costs-estimate.test.ts` (nuovo)
- `frontend/src/services/api.ts` (tipo `costs`)
- `frontend/src/components/Game/FeasibilityCheck.tsx` (sezione costi reale)
- `frontend/src/styles/foundations.css` (stili dialog fattibilità)
- `frontend/src/components/Game/feasibilityCheck.test.ts` (aggiornato)

## Invarianti

- Nessun contratto di simulazione, ordine, save o regola gameplay modificata.
- La stima è sola lettura: nessun consumo, prenotazione o mutazione di stato.
- Il catalogo resta l'unica fonte: ciò che non dichiara non viene stimato.
- L'ordine resta registrabile solo se fattibile (invariante G4-B).

## Limiti noti

- Tempo di costruzione per `construct` non steso: il catalogo non lo autorevola.
- Gli input sono per ciclo completo; l'arrotondamento è per eccesso per non
  sottostimare i consumi.

## Verifiche

```text
cd backend-nest && vitest run
→ 67 file, 506 test verdi (8 nuovi in costs-estimate.test.ts)

cd frontend && vitest run
→ 15 file, 85 test verdi

npm run build (backend + frontend)
→ OK
```

## Prossimo passo

- Verifica browser dell'intero ciclo G4 (ordine → verifica → salto → evento →
  cicatrice → dispaccio).