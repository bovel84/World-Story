# WS-JEV-W3 — Retrieval selettiva del ministro

## 1. Perimetro ed esito

Prima milestone di **retrieval ministeriale**, dopo W1. Estensione del modulo esistente; nessun secondo store proprietario dei ricordi della sedia. Non è completamento dell'intera roadmap né di W2/W4–W8. Base `main@ce12bf964e3040f18363b9514ea12ff447c6e4cc`; nessun merge/deploy.

## 2. Innesto e proprietà

- `backend-nest/src/core/government/MinisterMemory.ts`: la grammatica e le API esistenti restano. `ministerMemoryLine` condivide il renderer della `memorySection` senza cambiarne il testo legacy. `recallMinisterMemory` aggiunge selezione **pura**, query-aware, su ricordi esistenti ed evidenze narrative JEV; nessun accesso DB nel modulo.
- `backend-nest/src/core/government/jev/jev-memory.service.ts`: facade `getMinisterMemory(gameId, branchId, seat, mandate, query, maxTokens=1200, asOf?)`. Legge il repository MinisterMemory **esistente** e lo scope ministeriale JEV, senza travasi o ingestion. Non è un servizio parallelo proprietario di MinisterMemory: grammatica/selezione rimangono nel modulo esteso.
- `backend-nest/src/prompt-builder.ts:305`: **lo stesso `PromptBuilder`** produce la sorgente long-term mediante `buildMinisterMemorySection`; nessun context builder sostitutivo. Import della facade solo quando flag e richiesta ministeriale sono attivi, evitando inizializzazione DB dai prompt puri/legacy.
- `PromptEngine.getAdvisor` / `getAdvisorStream`: innesto in entrambi i percorsi, sia default sia preset. Il template advisor standard non usa `ALL_EVENTS_WITH_CONSOLIDATION`: la memoria va perciò nel suffisso di dialogo esistente, prima del briefing verificato/domanda, anche per preset che non espongono quella variabile. Il blocco legacy non viene duplicato.
- `backend-nest/src/game-session.ts`: inoltra soltanto scope e domanda reali, derivati server-side dal fence, sedia e `mandateFor`. Metadata request-local di GameData, non world state persistito. Identità/tono continuano a provenire da `MinisterPersona` e `MinisterChat` esistenti; nessun profilo rigenerato. I contratti di cancellazione/AbortSignal restano invariati.

## 3. Selezione, limiti e autorità

Ogni lettura è delimitata da game/branch; per ministro anche seat/mandate. Nessuna lettura world/nation/faction per questa milestone. Il cursor passato dal GameData fenced prevale sul cursor persistito; il richiamo standalone senza cursor esplicito usa solo il ramo attivo, altrimenti restituisce vuoto. Data **e** turno escludono il futuro, anche nei ricordi legacy. L'eredità legacy deliberata da `forkMemory` resta la preesistente copia con nuova identità: nessuna query trasversale o nuovo fork JEV.

Ranking lessicale deterministico con normalizzazione, termini fiscali/bilancio e difesa, importanza/confidence, recency non dominante, stato active e tie-break per ID indipendente dalla locale. Il consiglio pertinente non viene escluso da un pre-cap legacy di 40: lo storage preesistente può contenere più righe delle singole batch. JEV usa candidati eligible prima di LIMIT (max 5000); archiviati/superseded non consumano quel cap.

Estratti centrati sui termini rilevanti, motivo del rifiuto preservato separatamente, Unicode non spezzato. Evidenze in JSON citato con ID/data/riferimenti originali: sono dati narrativi, **non istruzioni né seconda contabilità**. Il dossier verificato rimane derivato dal motore, non dai numeri dei ricordi. Nessuna conversione del testo JEV in economia, coda ordini, consenso, territori o altre mutazioni deterministiche. Vengono aggiornati solo accessCount/lastAccessedAt delle evidenze JEV effettivamente selezionate.

Budget del blocco attivo: massimo configurabile, default **1200**. Si conteggiano i byte UTF-8 come **upper bound conservativo di token**, includendo header e JSON; non si spaccia char/4 per un tokenizer. Se non entra una citazione completa, viene saltata; nessun overflow o testo assemblato come nuova verità. Il budget complessivo per identità/stato/dialogo e tutti i ruoli è W4, non una garanzia globale di questa fase.

Flag off: renderer, priorità, cronaca e prompt legacy identici; zero query/update JEV, anche con la tabella assente. Il nuovo budget non altera retroattivamente la composizione legacy disattivata.

## 4. Prove e TDD

`backend-nest/tests/ws-jev-w3-minister.test.ts`: **18 test**, con SQLite temporaneo e provider stub, nessun credito o provider remoto.

1. Scenario A rappresentato da record reali del repository e cursor a turno 21: consiglio contrario al taglio tasse, decisione non conforme ed esito verificato. Selezione conserva i tre riferimenti, esclude rumore militare e non copia nulla in JEV. È una **fixture di venti turni trascorsi**, non venti simulazioni realmente eseguite né un giudizio sulla risposta libera di un modello.
2. Consiglio remoto dietro 40 record legacy più prioritari: resta selezionabile.
3. Motivo di rifiuto e conclusione pertinente in fondo a testi lunghi: non spariscono nel prefisso.
4. 5000 archiviati ad alta importance non nascondono un ricordo attivo.
5. Game/branch/seat/mandato diversi non contaminano il richiamo; claim numerico rimane claim, game/coda invariati.
6. Evento importante remoto supera dettaglio recente; futuro e archiviati esclusi, accessi aggiornati solo sui selezionati.
7. Unicode, budget minuscolo, testo stabile tra accessi e zero model_calls di retrieval.
8. Tabella JEV assente con flag off: stesso prompt legacy.
9. Percorsi reali `GameSession` normal/stream: memoria una volta, domanda autentica e briefing presenti.
10. Matrice normal/stream × default/preset × enabled/disabled (8 casi): legacy byte-identico quando disattivato.
11. Fixture 500 risultati raw (>150.000 token **stimati byte/4**) e 500 scambi: prompt ministro <5000 **stimati**, senza intera cronologia e con vecchio consiglio presente. Non è un test di 500 turni del motore, di diplomazia/NPC o della tokenizzazione effettiva del provider.

RED iniziale: modulo assente. RED funzionale su fallback minimo: **4 failed / 2 passed**. Prima revisione ha individuato pre-cap legacy, troncamento del motivo e cap consumato dagli archiviati: aggiunte regressioni prima delle correzioni, **3 failed / 7 passed**; GREEN successivo **18 passed**. Un primo fixture di isolamento riusava impropriamente un ID tra scope nello stesso game/branch: corretto il fixture, non la protezione del repository.

Gate completi e comandi in `WS-JEV-W1-report.md`: backend **210/2208**, frontend **123/1034**, tipi/build verdi, mock **160**, a11y **4**. Focus combinato W1/W3 e regressioni ministre/cancellazione: **47 passed**. `frontend npm test` resta **Missing script: "test"**; il runner reale è Vitest. Log: `/tmp/jev-w1-w3-gate/`, `/tmp/jev-w3-*.log`.

## 5. Telemetria e limiti espliciti

La facade restituisce scope consultato, candidati considerati, ID selezionati, raw bytes, upper bound del blocco, latenza e `model_calls=0`. Il tempo non entra nel testo/ranking. Sono metriche locali del richiamo, **non** W8 sul traffico reale. Nessun modello `tev1:0.8b` è chiamato: classificazione/ingestion e fallback restano W2.

Nuove conversazioni, nomine/relazioni e osservazioni numeriche non vengono automaticamente ingerite da questa fase. Si richiamano i ricordi già persistiti dall'infrastruttura MinisterMemory e gli eventuali record narrativi JEV. Non sono certificati richiamo semantico di un provider reale, tutte le memorie oltre il cap di candidati, multi-process stress, consolidamento, diplomazia/fazioni, debug API o limite universale del prompt completo. Il dato originale non viene cancellato dai tagli del prompt.

## 6. Consegna

Branch `feat/ws-jev-w1-w3-memoria-selettiva`, PR verso `main`. Report W1 e W3 separati, commit coerenti, nessuna modifica frontend o ai moduli di simulazione. Backend build con outDir temporaneo: nessun restart o dist operativo sostituito. Nessun deploy Cloudflare, backfill o migrazione del DB di produzione.
