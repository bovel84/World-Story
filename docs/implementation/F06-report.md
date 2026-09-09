# F06 — Unico stato client, reset del ramo e riconciliazione

## Pacchetto / revisore / fotografia iniziale

- **Pacchetto:** F06, micro-consegne 1–3 (reducer puro testato prima di collegare React; store runtime con guardia anti-stale e wiring HTTP/SSE/restore al medesimo reducer; snapshot canonico sui flussi reali, continue-from-checkpoint con anchor, polling di recupero senza SSE, anteprime mai in newsQueue).
- **Revisore:** da designare (chi implementa non auto-approva).
- **Fotografia iniziale:** il client applicava gli aggiornamenti SSE/HTTP direttamente ai singoli store Zustand senza ordine canonico: un evento o una coda arrivati fuori ordine (retry, SSE reconnect, polling) potevano sovrascrivere stato più nuovo, il cambio ramo non aveva una guardia e non esisteva una sostituzione snapshot canonica.

## Requisiti audit / invarianti / test

| Audit | Test (`simulationStore.test.ts`, rossi → verdi) | Esito |
|---|---|---|
| A14 (riconciliazione) | A revisione identica un delta con `sequence` più vecchio è scartato (nessuna mutazione, stesso riferimento); un `eventId` duplicato (outbox at-least-once) non duplica la timeline. | Verde |
| A14 | Una coda con `queueVersion` più vecchia non sovrascrive; un aggiornamento job con `jobVersion` più vecchia è scartato; i terminali (`completed`/`failed`/`interrupted`/...) sono espliciti. | Verde |
| A06 (playback privato) | Le proposte sigillate e gli ordini «processing» presenti nel payload NON entrano mai in newsQueue/timeline: whitelist dei soli campi pubblici. | Verde |
| A12/A13 (branch) | Un envelope di un altro ramo è scartato; il cambio branch avviene SOLO da `applyBranchReplace` con risposta valida del comando esplicito (anchor del restore): reset completo con archiveKey `gameId:branch`. | Verde |
| A14 (snapshot) | `simulationStore.test.ts`: `replaceCanonicalSnapshot` resetta mappa INCLUSI objects, coda, history, news, chat, advisor e reader; `awaitingNext` segna la pausa, il terminale la cancella, il `runId` del job running la alimenta. | Verde |
| A06/A12/A13 (µ2) | `simulationStore.test.ts` (runtime): `initGame` resetta e invalida i comandi; i token presi prima di uno switch/restore sono scaduti, quelli dopo validi; `branchReplace` sostituisce ramo e anchor. | Verde |
| A13/A14 (µ3) | `simulationStore.test.ts`: caricamento esplicito di un save via `branchReplace` — mappa INCLUSI oggetti, pausa azzerata, reader azzerato, timeline svuotata e comandi invalidati. | Verde |

## File letti e modificati

- `frontend/src/stores/simulationStore.ts` — **nuovo**: `initialSimulationState`, `applyEnvelope` (scope timeline/queue/job/map; snapshot e branch scartati se in flusso), `replaceCanonicalSnapshot`, `applyBranchReplace`.
- `frontend/src/stores/simulationStore.ts` (µ3) — `MapRegionView` copre anche gli `objects` (reset canonico della mappa inclusi oggetti).
- `frontend/src/stores/simulationRuntime.ts` — **nuovo**: store runtime Zustand (`initGame`/`dispatch`/`replaceSnapshot`/`branchReplace`) + guardia anti-stale (`beginCommand`/`isStale`/`invalidateCommand`).
- `frontend/src/App.tsx` — init del reducer al cambio partita; `handleTimeSkip` con token di generazione, guardia all'applicazione e dispatch dei risultati; SSE `onJumpEvent` dispatcha al medesimo reducer; `handleRestoreCheckpoint` applica `branchReplace` con l'anchor e invalida tutti i comandi in volo.
- `frontend/src/components/Game/AdvisorChat.tsx`, `ChatsPanel.tsx` — le risposte di chat/advisor in volo sono scartate dopo game switch o restore (piano passo 3).
- `backend-nest/src/routes/games.routes.ts` — `GET /:id` espone `headBranchId`/`worldRevision`; `respondTimeSkipResult` aggiunge `revision` a `world_advanced`/`actions_processed` (ordinamento lato client).
- `frontend/src/services/api.ts`, `frontend/src/types/index.ts` — tipi aggiornati (branchId/anchor del restore, headBranchId/worldRevision del gioco, revision degli esiti).

**µ3 (passi 4–6)**
- `frontend/src/App.tsx`:
  - **passo 4** — `handleResumeSave` applica `branchReplace` con lo snapshot del save caricato (mappa INCLUSI oggetti) e invalida esplicitamente tutti i comandi in volo (il gameId può coincidere con la sessione precedente, l'init effect da solo non basta).
  - **passo 5** — `handleContinueFrom` procede col time-skip soltanto dopo una risposta restore valida con ramo nuovo (`branchId !== 'unknown'`) e checkpoint di origine nell'anchor.
  - **passo 6** — polling del run ogni 5s mentre un run è attivo o il lettore è in pausa: gli eventi già commessi vanno allo stesso reducer (dedup per eventId), `awaitingNext` riconcilia il lettore in pausa, un run chiuso senza attesa chiude il lettore. Le anteprime live NON commesse non aprono più il bollettino (news flash riservato ai checkpoint commessi).
- `frontend/src/stores/simulationStore.test.ts` — **nuovo**: 9 prove pure (red → green).
- `frontend/vitest.config.ts` — **nuovo**: runner per i test frontend (usa il vitest già presente nel workspace root, nessuna installazione di rete).
- `frontend/tsconfig.json` — esclusi `src/**/*.test.ts(x)` dal build `tsc`.

## Comportamento prima / prova

- **Prima:** ogni canale (SSE, risposta HTTP, polling) mutava gli store senza confronto di revisione/sequence: retry e reconnect potevano applicare delta vecchi sopra nuovi.
- **Dopo:** ogni canale passa da `applyEnvelope` (ordine canonico); le risposte con token di generazione scaduto sono scartate prima di toccare la UI; il restore applica `branchReplace` con l'anchor del server. Un envelope scartato restituisce lo stesso riferimento (nessuna mutazione). Il DoD «stesso stato finale per tutte le permutazioni HTTP/SSE/polling» è garantito dall'unicità della funzione di riduzione; «vecchio ramo mai visibile» è garantito dal filtro di branch + `applyBranchReplace`.

## Contratti e compatibilità

- Nessun cambio di API: il modulo è nuovo e non ancora collegato alle viste (piano: prima le funzioni pure, poi il wiring in µ2).
- `applyBranchReplace` consuma la risposta del restore F04 (`gameId/branchId/anchor`) — contratto già esistente.

## Comandi test e risultato completo

```
cd frontend && ../node_modules/.bin/vitest run src/stores/simulationStore.test.ts   # 14/14 verdi
npm --prefix frontend run build                # tsc + vite OK
npm --prefix backend-nest test                 # 32 file; 279/279 verdi
```

## Screenshot/trace UI

Nessuno: µ1 è il livello di riduzione pura, non collegato alle viste.

## Cosa NON è implementato / dipendenze mute

- **µ2 (piano passi 2–3):** collegamento di App/SSE/HTTP/polling al reducer, abort + guardia all'applicazione per risposte vecchie, invalidazione di chat/advisor/queue/preflight su game switch e restore.
- **µ3 (piano passi 4–6):** wiring completo di `replaceCanonicalSnapshot` ai flussi reali, caricamento save con scelta esplicita, continue-from-checkpoint con anchor, stop raggiungibile senza SSE, proposte mai in newsQueue a livello di componenti.

## Crediti / DB reale / deploy

Zero chiamate LLM reali, zero deploy. Nessun dato toccato; test puri senza network.