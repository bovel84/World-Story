# G4-B — Verifica fattibilità integrata nella registrazione ordini

**Pacchetto:** seconda consegna della fase G4 del piano grafico immersivo.  
**Data:** 10 settembre 2026.  
**Stato:** implementata, da verifica browser.

## Intervento

«Registra ordine» non accoda più direttamente: apre una **verifica di fattibilità** esplicita e solo un esito fattibile accoda l'ordine.

- nuovo endpoint `POST /games/:id/actions/check-feasibility` (sola lettura):
  - converte il testo libero in `OrderIntent` con lo stesso percorso LLM usato
    in simulazione (`convertActionsBatch`), quindi nessun divergenza di interpretazione;
  - normalizza con `normalizeOrderIntent`: un testo incompleto produce
    `needs_clarification` → assessment `blocked` con i chiarimenti come blocker;
  - valuta con `FeasibilityService` e risponde con una proiezione per la UI:
    `feasible`, `cost` (segnaposto G4-D), `prerequisites`, `risks`, `warnings`,
    `summary`, `rawAssessment`;
  - `GameSession.checkFeasibility` non accoda, non simula, non muta lo stato;
- nuovo `frontend/src/components/Game/FeasibilityCheck.tsx` in dialog
  accessibile: esito (fattibile/non fattibile), costi stimati, prerequisiti,
  rischi, avvisi; il pulsante «Registra ordine» è disabilitato finché l'esito
  non è fattibile; «Indietro» torna alla bozza senza perdere il testo;
- in `App.tsx` il flusso U02 cambia così:
  - `registerOrder` → `verifyOrder` (chiamata all'endpoint, dialog in attesa);
  - l'errore tecnico conserva la bozza e apre il dialog con «Riprova»;
  - `handleFeasibilityRegister` accoda solo se `feasible`, poi svuota la bozza;
- wrapper `gameApi.checkFeasibility` in `frontend/src/services/api.ts`.

## File

- `backend-nest/src/game-session.ts` (metodo `checkFeasibility`)
- `backend-nest/src/routes/games.routes.ts` (endpoint `check-feasibility`)
- `frontend/src/App.tsx` (stato, flusso di registrazione, montaggio dialog)
- `frontend/src/components/Game/FeasibilityCheck.tsx` (nuovo)
- `frontend/src/services/api.ts` (wrapper API)
- `frontend/src/components/Game/feasibilityCheck.test.ts` (nuovo)

## Invarianti

- Nessun contratto di simulazione, ordine, save o regola gameplay modificata.
- L'endpoint `POST /games/:id/actions/evaluate` resta invariato e in uso per
  l'anteprima con intent esplicito; il nuovo endpoint è additivo.
- La fattibilità continua a essere valutata definitivamente dal simulatore al
  salto: la verifica è un aiuto prima del registro, non un gate server.
- L'accodamento avviene solo via `queuePlayerAction` dopo un esito fattibile.

## Limiti noti

- Costi stimati a zero (`cost.segnaposto`): la stima reale arriva con G4-D.
- I codici di chiarimento (`MISSING_FIELD`, …) vengono proiettati come blocker
  senza mapping a `ReasonCode` canonico: accettabile per la presentazione.

## Verifiche

```text
cd frontend && vitest run
→ 13 file, 73 test verdi (inclusi 6 nuovi di feasibilityCheck.test.ts)

cd backend-nest && vitest run
→ 66 file, 498 test verdi

npm run build (frontend + backend)
→ OK
```

## Prossimo passo (G4-C)

- Cicatrice temporale sulla mappa al cambio di confine.
- «Perché» e «Mostra sulla mappa» sulle card evento (catena causale completa).