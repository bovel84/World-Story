# WS-JEV-W7 — Consolidamento deterministico in episodi storici

## 1. Perimetro ed esito

Fase **W7** del piano JEV (memoria narrativa), su base `main@3dc1c80` (W1–W6 già
in `main`), ramo `feat/ws-jev-w7-consolidation`.

Obiettivo: impedire la crescita illimitata della memoria narrativa. Le memorie
grezze di uno scope, una volta uscite dalla finestra più recente, vengono
**sintetizzate in un episodio storico** e passano a `lifecycle='archived'`. Gli
eventi originali **non vengono mai cancellati**: restano ispezionabili, con il
riferimento all'episodio che li ha sostituiti, ma non competono più come memoria
attiva. Il consolidamento è **deterministico**: nessun modello, nessun embedding,
nessun vector DB, nessun numero inventato.

Esito: implementato, verificato e consegnato come **sola PR verso `main`**
(nessun merge/deploy in autonomia).

## 2. File toccati (estensioni, nessun nuovo sistema)

| File | Intervento |
| --- | --- |
| `src/core/government/jev/jev.types.ts` | `jevScopeFromKey`: inverso di `jevScopeKey` con guardia di round-trip (usato per enumerare gli scope) |
| `src/repositories/jev-memory.repository.ts` | `listScopes(gameId, branchId)` (scope distinti, filtrati per gioco **e** ramo) e `archive(scope, ids, episodeId, time)` (archiviazione idempotente); `unarchiveOrphans(gameId, branchId)` (ripristino dopo rewind) |
| `src/core/government/jev/jev-memory.service.ts` | `EPISODE_TEXT_BYTES`, `buildEpisode`, `jevEpisodeId`, `consolidateJevMemory` |
| `src/game/TurnPipelineService.ts` | sidecar best-effort dopo il sidecar W5, prima dell'outbox |
| `src/game/PlaybackService.ts` | sidecar best-effort dopo il sidecar W5 |
| `src/repositories/game.repository.ts` | nel rewind JEV, dopo la potatura, `unarchiveOrphans` |
| `tests/ws-jev-w7-consolidation.test.ts` | **18 test** (archiviazione/non cancellazione, idempotenza, determinismo, finestre, isolamento, rewind, questioni aperte, retrieval) |

Vincoli rispettati: **stesso** `jev_memory` (nessun nuovo store); **nessuna**
duplicazione di `src/core/simulation/FactionMemory.ts` o di `MinisterMemory.ts`;
consolidamento deterministico (fixed window, `model_calls` sempre 0); ogni query
filtra `game_id` **e** `branch_id`; gli eventi originali non vengono mai
cancellati dal consolidamento; flag spento ⇒ prompt e comportamento invariati e
**zero accessi al repository**; nessuna route API nuova.

## 3. Design

- **Finestra pronta**: `readyTurn = floor(turn / interval) * interval - interval`.
  Le ultime `interval` memorie restano grezze: non si consolida il passato più
  recente. `interval` è `consolidationIntervalTurns` (default **10**); il
  consolidamento pesante gira solo al confine di finestra (`turn % interval === 0`),
  mentre ai confini saltati il run successivo recupera le finestre arretrate
  (l'operazione è idempotente). I turni senza finestra pronta non toccano il
  repository.
- **Enumero gli scope** con `listScopes` e li ricostruisco con `jevScopeFromKey`,
  che verifica il round-trip con `jevScopeKey` (ambiguità `nation` vs
  `perception` risolta sul `kind`; chiave non ricostruibile ⇒ scope saltato con
  warning, non errore fatale).
- **Raggruppo per finestra**: `windowEnd = ceil(turn / interval) * interval`; le
  memorie con `turn == null` e gli episodi già esistenti sono esclusi.
- **Episodio deterministico**: id stabile `jev:episode:<sha256>` da scope +
  `gameId` + `branchId` + `windowEnd` + `interval` (stesso input ⇒ stesso id);
  `importance=max`, `confidence=media`, `actors`/`topics`/`sourceEventIds` unione
  ordinata, `parentMemoryIds` = id delle grezze; testo con intestazione
  `[EPISODIO STORICO …] N memorie consolidate` e righe dalle memorie stesse,
  troncato a `EPISODE_TEXT_BYTES` (**2000**). I metadati di accesso
  (`createdAt`/`status`/`lifecycle`/`accessCount`/`lastAccessedAt`) di un episodio
  già esistente sono **conservati**: una riesecuzione non li azzera.
- **Archiviazione, non cancellazione**: `archive` porta le grezze a
  `lifecycle='archived'` e scrive l'id dell'episodio in `parent_memory_ids_json`,
  solo dove `lifecycle <> 'archived'` (telemetria idempotente). Le righe restano
  nella tabella e sono rileggibili.
- **Questioni aperte**: promesse e conflitti `status='active'` sono **esclusi**
  dal consolidamento e restano grezzi, così non spariscono da `UNRESOLVED ISSUES`
  (`buildMinisterContext`). Da risolte entrano nell'episodio e si archiviano.
- **Retrieval invariato**: i retrieval esistenti usano `eligibleOnly`, che
  esclude le archiviate ma include gli episodi (`type='historical_episode'`,
  `status='active'`, `lifecycle='warm'`): la sostituzione avviene senza codice
  dedicato.
- **Rewind**: se la potatura cancella un episodio, `unarchiveOrphans` riporta le
  sue grezze superstiti a memoria leggibile (senza puntatore morto) invece di
  lasciarle archiviate e invisibili.
- **Best-effort**: `consolidateJevMemory` è integralmente in try/catch (flag
  malformato o errore DB ⇒ `result()` a zeri); ogni scope è isolato nel proprio
  try/catch. Il sidecar del turno non può far fallire la risposta.

## 4. Prove e gate

| Gate | Comando | Esito |
| --- | --- | --- |
| Focused W7 | `vitest run tests/ws-jev-w7-consolidation.test.ts` | **18/18** |
| Compatibilità JEV | `vitest run tests/ws-jev-w{1..7}*.test.ts` | **117/117** |
| Backend completo | `npm --prefix backend-nest test` | **215 file / 2298 test** |
| Type-check backend | `tsc --noEmit` | exit 0 |
| Build backend | `npm run build` | exit 0 |

Log in `/tmp/jev-w7-gate/`. Nota: il full-suite locale va eseguito con `dist/`
assente — una build precedente lascia copie `dist/**/*.test.js` che vitest
raccoglie come falsi fallimenti di caricamento (`require()` di vitest). La CI
esegue i test **prima** della build e non è toccata. W7 è backend-only: nessun
frontend, nessun E2E (l'E2E completo 160 va eseguito una sola volta a fine blocco).

## 5. Revisione indipendente — rilievi e chiusure

- **Rewind orfano (CRITICAL)**: la potatura cancellava l'episodio ma lasciava le
  grezze `turn <= cutoff` archiviate e invisibili, con `parentMemoryIds` morto.
  **Chiuso** — `unarchiveOrphans` dopo `pruneAfterTurn` nel rewind; test dedicato
  (episodio cancellato ⇒ grezze superstiti di nuovo leggibili, nessun puntatore
  morto) e contro-test (episodio conservato ⇒ archiviate intatte).
- **Questioni aperte perse (HIGH)**: consolidare una promessa/conflitto attivo lo
  toglieva da `UNRESOLVED ISSUES`. **Chiuso** — promesse e conflitti `active`
  restano grezzi; da risolti entrano nell'episodio. Test: non consolidati /
  consolidati una volta risolti.
- **Cadenza non rispettata (MEDIUM)**: il calcolo della finestra pronta passava a
  ogni turno ≥ 20, quindi `listScopes`+`listMemory` giravano ogni turno.
  **Chiuso** — gate `turn % interval === 0`; i confini saltati sono recuperati
  dal run successivo.
- **Testo episodio troncato a 240 B in retrieval (LOW)**: i retrieval diplomatico
  e di fazione rendono le righe con `memoryExcerpt` a 240 byte: un episodio vi
  appare come estratto breve. **Accettato e documentato** (limite, non bug): il
  testo completo è nel minister context/`buildMinisterContext` (che usa il testo
  intero) e nel repository; il budget resta bounded.
- **Report mancante e test (LOW)**: **chiusi** — questo documento; aggiunti i test
  rewind/orfano, questioni aperte, tetto `EPISODE_TEXT_BYTES`.

## 6. Limiti espliciti

- `maxActiveMemories` (5000) limita la lista per scope: in un singolo scope con
  più di 5000 memorie grezze, le più vecchie oltre il tetto non entrano nel
  consolidamento finché non rientrano. Limite noto, non ancora raggiunto.
- Gli episodi non riassumono le memorie con `turn == null` (non hanno finestra).
- Il testo dell'episodio è una sintesi bounded (2000 B) di righe già narrative:
  non è una cronologia completa; il dettaglio resta nelle grezze archiviate.
- Nessun test con provider reale, multi-processo o partita lunga reale; come
  W1–W6, la prova autorevole su Node 22 è la CI.
- Localmente il full-suite su Node 22 resta bloccato dal nativo `better-sqlite3`
  compilato per Node 26; il risultato Node 22 autorevole è quello della CI.

## 7. Consegna

- Ramo `feat/ws-jev-w7-consolidation` — **sola PR verso `main`**, nessun
  merge/deploy.
- Nessuna scrittura su `main`, nessuna credenziale esposta, nessun tocco allo
  stato deterministico (solo righe `jev_memory`).
