# WS-JEV-W5 — Diplomazia: memoria condivisa e viste di percezione

## 1. Perimetro ed esito

Fase **W5** del piano JEV (memoria narrativa), su base `main@156bbfa` (W1–W4 già
in `main`), ramo `feat/ws-jev-w5-diplomacy`.

Obiettivo: dare alle nazioni una memoria **diplomatica** che distingua due cose
che non vanno mai fuse:

- il **fatto condiviso** tra due nazioni, indicizzato con la coppia **ordinata
  alfabeticamente** (`diplomacy:FRA:ITA`, identica per `ITA/FRA` e `FRA/ITA`);
- la **percezione** di una nazione verso l'altra, direzionale e separata
  (`nation:ITA:view:FRA` ≠ `nation:FRA:view:ITA`), come prescrive il taskfile §4.

Esito: implementato, verificato e consegnato come **sola PR verso `main`** (nessun
merge/deploy in autonomia). Nessuna modifica allo stato deterministico: JEV resta
memoria narrativa/politica/diplomatica.

## 2. File toccati (estensioni, non nuovi sistemi)

| File | Intervento |
| --- | --- |
| `src/core/government/jev/jev.types.ts` | nuovo scope `perception` → chiave `nation:<observer>:view:<subject>`; guardie «distinct» anche per `a===b` / `observer===subject` |
| `src/core/government/jev/jev-classify.ts` | KEEP per `diplomacy_relationship`, `diplomacy_alliance`, `diplomatic_exchange`, `diplomatic_view` |
| `src/core/government/jev/jev-memory.service.ts` | adapter `diplomaticMemoryInputs` (1 condivisa + N viste, id namespaciati e codificati), `relationshipMemoryInputs` (adapter condiviso dei cambi di relazione), retrieval `getDiplomaticMemory` in **campi separati** `shared`/`view` |
| `src/core/government/MinisterMemory.ts` | estratto `memoryExcerpt` (riuso) e `jevMemoryScore` (formula condivisa W3/W4/W5), comportamento invariato |
| `src/game/TurnPipelineService.ts` | sidecar best-effort dopo la transazione canonica: cambi di relazione → memoria condivisa + 2 viste |
| `src/game/PlaybackService.ts` | stesso sidecar sul percorso scaglionato/in pausa (la memoria non dipende dal percorso) |
| `src/game/DiplomacyService.ts` | `recordDiplomaticExchange` sugli scambi di chat; `diplomaticSpeaker` per l'attribuzione in chat di gruppo; innesto di `getDiplomaticMemory` nel briefing dell'interlocutore |
| `tests/ws-jev-w5-diplomacy.test.ts` | 21 test (chiavi, guardie, adapter, ingestion, isolamento, retrieval, budget, attribuzione) |

Tutte le query filtrano per `game_id` **e** `branch_id`. Feature flag spento:
nessun accesso al repository e prompt invariato.

## 3. Design

- **Separazione shared/view**: `getDiplomaticMemory` restituisce due sezioni
  distinte (`scopeKey` condivisa vs percezione), mai un testo unico. La percezione
  usa ciò che resta del budget, così il totale resta entro `maxDiplomaticContextTokens`.
- **Id namespaziati e codificati**: `diplomacy:<a>:<b>:<source>` e
  `nation:<observer>:view:<subject>:<source>`, con `encodeURIComponent` sulle
  parti identitarie: niente collisioni di classe tra scope diversi.
- **Adapter unico dei rapporti**: `relationshipMemoryInputs` è chiamato sia dal
  percorso ordinario (`TurnPipelineService`) sia dal playback (`PlaybackService`),
  così la memoria non dipende dal percorso. Etichette narrative deterministiche
  (`alleanza`/`ostilità`/`neutralità`), mai il valore interno (`ally`).
- **Innesto nel briefing esistente**: `getDiplomaticMemory` alimenta
  `chatParticipantVarsFor` (l'array `memory` del prompt chat), non un prompt
  parallelo. Best-effort: un errore di memoria non fa fallire la risposta.
- **Attribuzione del parlante**: in una chat di gruppo la replica può venire da
  una nazione terza; `diplomaticSpeaker` la attribuisce a chi ha davvero risposto,
  con fallback al titolare del canale.
- **Query-aware con ripiego sui fatti salienti**: se la domanda ha termini in
  comune con il testo, restano solo quelli (`score > 0`); se non c'è alcun
  riscontro, la sezione non si azzera: mostra i fatti più salienti. La pertinenza
  **ordina**, non censura l'intero briefing. Scelta deliberata e testata (vedi §5).

## 4. Prove e gate

| Gate | Comando | Esito |
| --- | --- | --- |
| Focused W5 | `vitest run tests/ws-jev-w5-diplomacy.test.ts` | **21/21** |
| Compatibilità JEV + graft | `vitest run tests/ws-jev-w{1..5}*.test.ts tests/ws-minister-ux-05-graft.test.ts` | **91/91** |
| Diplomazia/chat | `vitest run tests/diplomacy-service.test.ts tests/chats.test.ts tests/chat-fence.test.ts tests/chat-threads.test.ts` | **49/49** |
| Turn/playback | `vitest run tests/{atomic-commit,mg02-turn-commit,mg03-turn-delivery,npc-turn-service,playback-crisis-leg,playback-intermediate-over,routes-playback,turn-orchestrator}.test.ts` | **66/66** |
| Backend completo | `npm --prefix backend-nest test` | **213 file / 2263 test** |
| Frontend completo | `vitest run` (frontend) | **123 file / 1034 test** |
| Type-check backend | `tsc --noEmit` | exit 0 |
| Type-check frontend | `tsc --noEmit` | exit 0 |
| Build backend / frontend | `npm run build` | exit 0 / exit 0 |
| E2E mirato | `playwright test tests/modules.spec.mjs tests/chat-order.spec.mjs` | **14 passed** |

Log in `/tmp/jev-w5-gate/`. L'E2E completo (160) resta da eseguire una sola volta
a fine blocco, come da direttiva di regia.

## 5. Revisione indipendente — rilievi e chiusure

- **`getDiplomaticMemory` non consumato** (stessa situazione di `getMinisterMemory`
  dopo W4): **chiuso** — ora alimenta il briefing dell'interlocutore in
  `chatParticipantVarsFor`.
- **Zero-relevance**: **chiuso** con floor di pertinenza + ripiego documentato e
  testato (`commerciale` filtra, `astronautica` ripiega sui fatti salienti).
- **Chat di gruppo**: **chiuso** con `diplomaticSpeaker` + test mirato.
- **Naming `perception` vs prefisso `nation:`**: **conforme al taskfile §4**, che
  prescrive esattamente `nation:ITA:view:FRA`; documentato, nessuna modifica.
- **Salienza/localizzazione del rapporto**: **chiuso** — `RELATIONSHIP_LABEL`.
- **Percorso playback senza sidecar**: **chiuso** — adapter condiviso e hook anche
  in `PlaybackService`.

## 6. Limiti espliciti

- `recordDiplomaticExchange` registra una coppia per scambio (parlante effettivo ↔
  giocatore); in chat multi-nazione con più repliche nello stesso turno ogni
  replica produce la propria coppia (comportamento voluto, non un aggregato).
- La memoria diplomatica non ha ancora UI dedicata: entra nel prompt dell'NPC e
  resta ispezionabile via repository/API debug.
- Crescita non consolidata (`maxActiveMemories`/consolidation = W7) e stress
  multi-processo/provider reale non provati (rimandati, come per W1–W4).
- Localmente il full-suite su Node 22 è bloccato da `better-sqlite3` nativo
  compilato per Node 26; il risultato Node 22 autorevole è quello della CI.

## 7. Consegna

- Ramo: `feat/ws-jev-w5-diplomacy` — **sola PR verso `main`**, nessun merge/deploy.
- Nessuna modifica allo stato deterministico, nessuna scrittura su `main`, nessuna
  credenziale esposta.
