# G5-A — Dossier nazionale alimentato da dati reali

## Obiettivo

Avviare G5 sostituendo gli stati-segnaposto del dossier «Nazione» con un read model esclusivamente derivato da dati già autorevoli nel client: conto nazionale, regioni possedute e processi in corso.

## Implementazione

- Nuovo `frontend/src/components/Game/nationDossier.ts`:
  - `summarizeNationalAssets` privilegia i campi pubblicati da `WorldStateEngine.accounts`;
  - usa oggetti delle regioni possedute solo come fallback per capacità territoriali;
  - non produce stime di stock, tecnologie o flussi;
  - `hasNationalFinance` e `financeBalance` distinguono un conto assente da valori zero reali.
- `NationDock` ora rende tutte le sei sezioni:
  - **Situazione**: bollettino, stabilità, province e decisioni/processi da monitorare;
  - **Progetti**: processi correnti e relative date pubblicate;
  - **Bilancio**: entrate, uscite, saldo e crescita del conto nazionale;
  - **Risorse e produzione**: province, fabbriche, porti, città/capitali;
  - **Conoscenze e personale**: università, forze, popolazione, PIL pro capite quando pubblicato;
  - **Politiche e servizi**: forma di governo, stabilità, territorio amministrato, processi attivi.
- Quando il read model non pubblica una categoria, l'interfaccia lo dichiara esplicitamente e non inventa valori.
- `DeskContent` passa al dossier le regioni della polity giocatore e i processi già recuperati dalla simulazione.

## Verifica

- Test unitari nuovi: `nationDossier.test.ts` (3 casi: precedenza conto, fallback mappa, bilancio dichiarato).
- Browser Playwright: apertura di tutte e sei le sezioni con il preset `cold_war_1951_v2` / USA; screenshot `/tmp/ws-e2e-g5-nation.png`.
- Frontend: **88/88** test, build OK.
- Backend: **506/506** test, build OK.

## Limiti dichiarati

Il backend non pubblica ancora un inventario canonico di tecnologie, stock/consumi o mandati attivi. Il dossier mostra quindi solo le capacità effettivamente pubblicate e rende esplicita l'assenza di quei read model; non amplia contratti API né regole della simulazione.
