# Audit World Story — conformità della specifica e basi del realismo

**Data:** 8 settembre 2026. **Tipo:** audit del sorgente locale e suite automatica, non certificazione della produzione.

**Documenti collegati:**
- [Specifica originaria](SPEC_PARITA_PAX_HISTORIA_AZIONI_EVENTI_TIMELINE.md)
- [Progetto tecnico e UX](PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md)
- [Pacchetti esecutivi per gli LLM](PIANO_ESECUTIVO_LLM_REALISMO_UX.md)

## 1. Verdetto

**Il progetto ha seguito una parte sostanziale della direzione richiesta, ma non ha completato tutte le garanzie della specifica.** Non è corretto chiamarlo oggi «parità completa», né affermare che tutti gli ordini siano materialmente realistici perché il prompt lo prescrive.

Sono presenti coda persistente, separazione ordini/tempo, simulazione batch, avanzamento mondiale, calendario, registro dei run, playback manuale e una prima interfaccia unificata. Rimangono difetti nei percorsi meno semplici: ripristini, retry, errori intermedi, progetti già avviati, eventi futuri e riconciliazione del client.

Il micromanagement richiesto è un **ampliamento del perimetro**: la specifica originaria escludeva la sostituzione generalizzata dell'economia, ma richiedeva già fattibilità, risorse condivise e progetti graduali (§§6.3, 8.2, T26/T27). Il nuovo piano rende questi principi verificabili dal motore, senza rinunciare agli ordini liberi.

### La decisione fondamentale

> La LLM interpreta intenzioni e descrive conseguenze consentite. Non può inventare fondi, riserve, conoscenze, impianti o capacità produttive. Il server autorizza gli effetti mediante dati versionati e regole deterministiche.

Questo garantisce coerenza con il **modello dichiarato**, non conoscenza perfetta della realtà storica. Dati mancanti e stime devono essere visibili; non vanno mascherati con precisione numerica apparente.

## 2. Metodo, limiti e verifiche eseguite

- Specifica originaria letta integralmente: 762 righe nella fotografia esaminata.
- Sorgenti esaminati: orchestrazione, route, repository, schema, prompt, motori economici, generazione iniziale, UI/store/trasporti, script E2E e deploy. Due revisioni separate, backend e frontend, integrate in questo audit.
- Indice strutturale disponibile: generazione **2026-09-03T08:59:18Z**, obsoleta rispetto ai file correnti. Coverage segnala `metadata_changed`/`not_tracked`; i rilievi si basano sulla lettura e ricerca nei sorgenti, non su assenze nel grafo.
- HEAD locale: `384dac7909dbd8ac6aaf79d75fae43e6ae7ed947`, **con modifiche locali preesistenti**. L'hash da solo non identifica la fotografia analizzata.
- `npm --prefix backend-nest test`: **19 file, 224 test superati**, esecuzione locale con DB temporanei e provider finti. È stato imposto anche un DB temporaneo di fallback tramite `OPEN_PAX_DB_PATH`. Log, comandi e fingerprint aggregato di 142 file sorgente sono conservati in [audit/2026-09-08-baseline.txt](audit/2026-09-08-baseline.txt). Il fingerprint non include preset/dati/configurazioni esterne.
- Type-check backend e frontend (`tsc --noEmit`): entrambi superati.
- Nessuna nuova simulazione LLM reale, partita pubblica, migrazione su DB reale, visita comparativa a pagamento o deploy in questo audit.
- I rilievi sotto sono **confermati dalla lettura statica**, salvo dove diversamente indicato. I nuovi casi limite non sono stati tutti riprodotti con test: devono diventare regressioni nel pacchetto F00. La suite verde attuale non li certifica.
- Nessuna certificazione visuale nuova di Safari, tastiera virtuale, screen reader o produzione. Gli screenshot e smoke della conversazione precedente sono evidenze limitate ai flussi allora provati.

**Riferimenti:** percorsi relativi alla radice; numeri di riga indicativi di questa fotografia. Cercare anche i simboli: le righe cambieranno.

### 2.1 Registro del grado di prova dei rilievi

Le sezioni Axx distinguono osservazione nel codice («Evidenza») da conseguenza runtime dedotta («Rischio»/«Conseguenza»). **Nessuno dei nuovi scenari di regressione sotto è stato eseguito in questo audit**: F00 dovrà riprodurli e correggere il rapporto se una deduzione non viene confermata. I test baseline superati sono evidenza separata.

| Rilievo | Osservazione statica / artefatto | Nuova riproduzione runtime | Test da associare |
|---|---|---|---|
| A01 | Testo/indice negli outcome, riferimenti §4 | Non eseguita | C01 |
| A02 | Scritture separate/ordine broadcast, riferimenti §4 | Fault injection non eseguita | C02 |
| A03 | DTO run include riga raw con pending_state | Richiesta di leak dedicata non eseguita | C03 |
| A04 | Copia outcome/voided globali | Caso futuro negli outcome non eseguito | C04 |
| A05 | Save riferisce stato run mutevole, processing esclusi da replace | Save E1/load dopo E2 non eseguito | C05 |
| A06 | Ancore opzionali/restore ultimo run, callback client | Retry/bypass/restore esatto non eseguiti | C06 |
| A07 | Campo progetti assente nel contesto e matching titolo | Continuità con zero ordini non eseguita | C07, MAT29 |
| A08 | Nessuna guardia ramo chat, percorso rewind relazioni | Risposta tardiva/riavvio non eseguiti | C08 |
| A09 | POST attende LLM, revisione/idempotenza incomplete | Crash/retry diversi payload non eseguiti | C09, C13 |
| A10 | Wrapper ultimo risultato, soglia playback ≥2 | Zero/un evento/budget non eseguiti | C10, C11 |
| A11 | Cursore solo turno, finalizzazione/parse permissivi | Paginazione stesso turno/parse invalido non eseguiti | C16, MAT37 |
| A12 | Merge/reset parziali nel client | Restore e pending response browser non eseguiti | C12 |
| A13 | Più applicatori stato, polling cronaca, error handling | Matrice trasporti browser non eseguita | C18, UI05 |
| A14 | Anteprima in feed/newsQueue | Errore dopo anteprima non eseguito | C14 |
| A15 | Riferimenti e percorso corrente non usano vecchio gate costi | Bypass materiale end-to-end non eseguito | MAT25, MAT26 |
| A16 | Creazione oggetti senza gate di filiera nel percorso letto | Ordine impossibile reale non eseguito | MAT07–MAT12, MAT25 |
| A17 | Modello conti/valori 2024 senza tesoreria/filiera | Nuove fixture finanziarie non eseguite | MAT03–MAT06 |
| A18 | Loader/cache/fallback/lore, esempi temporali | Nuova validazione storica/fonti non eseguita | MAT02, MAT18 |
| A19 | Conteggi file/CSS e ordine import, misurati localmente | Nuova matrice visuale non eseguita | UI01, UI12 |
| A20 | Markup/accessibilità/layout dei componenti | Nuovo test tastiera/dispositivi non eseguito | UI06–UI11 |
| A21 | Script E2E/deploy letti, comandi e gate mancanti | Nuovo E2E/deploy non eseguito | Q01/Q02: pacchetti di verifica |
| A22 | Bootstrap/controlli osservati, scope security incompleto | Nessun penetration test | Q02: audit e test di autorizzazione |

## 3. Matrice sintetica di conformità

| Area della specifica | Stato riscontrato nel sorgente | Cosa manca per dichiararla completa |
|---|---|---|
| G01, G04: tempo manuale, registrazione | Implementazione standard presente | Audit di tutti i percorsi legacy e timer di sessioni preesistenti |
| G02/G03/G05/G06: lotto unico, mondo senza ordini | Percorso batch presente | Caso mondo-senza-eventi difettoso; non basta il test batch |
| G07/G09/G10: taglio futuro e checkpoint | Parziale | Outcome futuri, API run, atomicità e anteprime non canoniche |
| G11, §6.2: coda e processi | Persistenza presente, semantica incompleta | ID end-to-end, processi nel contesto, avanzamento senza reimpartire ordini |
| G13, §§9.2–9.4: job/concorrenza/idempotenza | Lock e record run presenti | POST ancora lungo; Next non idempotente; revisioni/rami incompleti |
| G14/G15, §10.3: sincronizzazione | Refetch/dedup parziali | Reducer unico, invalidazione risposte obsolete, recupero SSE completo |
| G16, §8.1: evento canonico | ID/eventi persistenti presenti | Effetti validati, sequenza/ramo/cause complete |
| G17/G18/G19: prompt, autonomia, calendario | Implementazione e test presenti | La prescrizione narrativa non garantisce fattibilità materiale |
| G20, §12: Save/Load/Rewind | Happy path presente | Save a E1 ricaricato dopo E2, relazioni durevoli, chat tardive, reset UI |
| G21: diplomazia | Tolte svolte da semplici parole chiave nella timeline | Accordi eseguibili, risorse/logistica e contesto di revisione |
| G22, §§9.3/11.3: lettore distinto | Presente | Fuga future via API, singolo evento/budget, restore dell'evento esatto |
| G24: Enhance/Brainstorm | Presente come proposta distinta | Valutazione di fattibilità comune anche ai suggerimenti |
| §§11.4/11.5: mobile/accessibilità/struttura | Restyling presente, verifiche limitate | Focus, tastiera, shell unificata, test multi-viewport e regressioni CSS |
| §16: confronto Pax Historia | Campagna precedente parziale | Save/Load/Rewind, mese completo, diplomazia, errori e altri casi elencati nel rapporto |
| §17: rilascio | Rilasci precedenti documentati | Procedura ripetibile backend+frontend e test funzionali pubblici autorizzati |

Non assegnare una percentuale: la specifica mescola requisiti, decisioni proposte, note storiche e certificazione. Una media nasconderebbe difetti bloccanti.

## 4. Rilievi di affidabilità, ordinati per rischio

### A01 — Gli esiti non sono associati davvero per ID

**Evidenza:** `game-session.ts:_processActionBatchUnlocked` (~2883) passa testi; `agents.ts:processTurnWithPrompts` passa testi convertiti; `prompts/types.ts:ActionOutcome` contiene `action: string`. Le finalizzazioni (~1935, 2293, 3140) cercano uguaglianza testuale, poi usano la posizione dell'array.

**Rischio:** ordine riformulato, duplicato, omesso o risposta riordinata → esito attribuito all'ordine sbagliato. Avere `action_id` nel DB dopo l'associazione non risolve il difetto.

**Richiesto:** `actionId` immutabile da coda a proposta/outcome/progetto; ID ignoto o duplicato rifiutato, nessun fallback per indice. Test con due testi identici e outcome invertiti. **Pacchetto F01.**

### A02 — Non esiste una transazione dell'intero checkpoint

**Evidenza:** `game-session.ts:_commitPausedStepUnlocked` (~2051–2114) e percorso ordinario (~3132–3292) scrivono separatamente regioni, risultati, coda, data, outcome, checkpoint e run. Le transazioni del repository coprono singole collezioni. `continueSimulation` rimuove una proposta prima del commit senza recupero equivalente al catch del run ordinario.

**Rischio:** errore DB/crash → revisione mista; un catch compensativo non protegge dall'arresto del processo. Alcuni messaggi chat sono pubblicati prima del checkpoint finale.

**Richiesto:** staging isolato + unica transazione breve + outbox; niente `await` LLM in transazione; RAM aggiornata e pubblicazione solo dopo commit. Fault injection dopo ogni scrittura. **F02.**

### A03 — L'API run rivela gli eventi ancora sigillati

**Evidenza:** `game.repository.ts:getSimulationRun` restituisce `SELECT *`; `routes/games.routes.ts` (~562–587) espone `run`; `pending_state` contiene `remainingEvents` e la risposta completa del periodo.

**Rischio:** i contenuti futuri sono leggibili dalla risposta di rete anche se il componente non li disegna. Contraddice §9.3.

**Richiesto:** DTO pubblico con allowlist, separato dalla riga DB; mai serializzare proposte, effetti o riassunti futuri. Test sull'intera risposta JSON, non solo screenshot. **F03.**

### A04 — Il taglio degli eventi non taglia tutti gli outcome futuri

**Evidenza:** finalizzazioni di `game-session.ts` (~2293–2347, 3140–3198) copiano stato/sintesi/data prevista della risposta completa filtrando soltanto i titoli evento; `voided` può provenire dal periodo intero.

**Rischio:** E2 non letto ma outcome «opera conclusa» già persistito o processo chiuso a E1. Il test futuro esistente usa `voided: []` e non include gli outcome problematici.

**Richiesto:** outcome ed effetti per checkpoint/evento, non conclusioni globali; sintesi canonica derivata dal solo prefisso committato. **F03.**

### A05 — Save in playback non conserva la propria posizione durevole

**Evidenza:** `save()` salva `pausedSimulationId`; `_revivePausedRun` usa lo stato attuale della riga run. Il completamento ne cancella `pending_state`. `replacePendingActions` reinserisce solo `pending`, anche quando Load gli passa `processing`.

**Rischio:** salva E1 → continua E2 → carica E1: mappa E1 con cursore E2, oppure playback non ripristinabile dopo fine run; ordini emessi persi al riavvio dopo Load.

**Richiesto:** snapshot versionato comprendente lo stato playback esatto; restore su nuovo ramo; ripristino di tutti gli stati ordine pertinenti. **F04.**

### A06 — Next, Intervene e restore non hanno tutti l'ancora corretta

**Evidenza:** `/next` passa solo run ID e sposta ogni volta il cursore. `/intervene` con body vuoto può evitare il controllo route, mentre `tryIntervenePausedRun` accetta ancore opzionali. Il restore da Timeline passa solo `simulationId`; il server ripristina `run.checkpoint_id`, cioè l'ultimo checkpoint, non necessariamente quello dell'evento selezionato.

**Rischio:** retry di Next salta un'altra lettura; stop non ancorato; «ripristina questo evento» ripristina E2 invece di E1. `App.tsx:handleContinueFromCheckpoint` può avviare il salto anche se restore ha catturato un errore.

**Richiesto:** `checkpointId + branchId + expectedRevision + requestId`; stesso comando ripetuto restituisce lo stesso risultato; restore esatto e nessun avanzamento se fallisce. **F03/F04/F06.**

### A07 — I progetti persistono ma non proseguono come prima classe

**Evidenza:** `game-session.ts:buildGameData` non include `ongoingProcesses`; `prompt-builder.ts` li cerca e riceve `[]`. Gli aggiornamenti processano solo le nuove azioni del lotto; `completeOngoingProcessForAction` confronta il titolo; `completesProcess` parsato non governa le finalizzazioni esaminate.

**Rischio:** un progetto scompare dal contesto operativo; il test di completamento reimpartisce il medesimo testo, mentre §12 richiede il contrario.

**Richiesto:** primo fix dei riferimenti ID e del contesto; poi progressione deterministica dei progetti indipendente da nuovi ordini. **F01/M05.**

### A08 — Chat e diplomazia non sono sicure rispetto a restore/rewind

**Evidenza:** `generateChatReply` attende LLM e poi scrive alla data/turno corrente, senza validare il ramo che ha originato la richiesta. Rewind chiama `loadFromSave` ma non il percorso `persistLoadedState` che riscrive `game_relationships`.

**Rischio:** risposta dal futuro nel ramo ripristinato; relazioni annullate che ritornano alla ricostruzione della sessione.

**Richiesto:** fencing di ramo/revisione su ogni risposta asincrona; snapshot completo, unica applicazione durevole anche per rewind. **F04/F06.**

### A09 — Run persistente non equivale a job asincrono

**Evidenza:** `/time-skip` attende `processAllPendingActions`/`processWorldAdvance` prima di `res.json`. Non è il `202` rapido di §9.2. Ricostruzione non costituisce una strategia completa di recupero dei record `running` abbandonati.

**Rischio:** timeout proxy, retry ambigui e lavori orfani. L'idempotenza usa la chiave senza hash payload/ramo; revisioni calcolate da turno e numero checkpoint possono non essere monotone tra run.

**Richiesto:** job durevole, CAS/lease, revisioni globali, rami e idempotenza per comando. **F02/F05.**

### A10 — I casi senza eventi e budget con zero/un evento restano incompleti

**Evidenza:** `processWorldAdvance` restituisce `results.at(-1)` anche se la ricerca non ha creato risultati: può tornare un vecchio risultato o interpretare `null` come conflitto. Il playback viene avviato soltanto con almeno due eventi; uno stream incompleto con uno solo passa dalla finalizzazione storica.

**Rischio:** falso `world_advanced`, falsa destinazione raggiunta, nessuna finestra di intervento sul singolo evento antecedente alla destinazione.

**Richiesto:** risultato discriminato, mai ricostruito dall'ultimo elemento della cronaca; gestire 0/1/N eventi con la stessa macchina a stati. **F03.**

### A11 — Cronaca e protocollo finale hanno percorsi non canonici

**Evidenza:** paginazione `turn > cursor` ma più righe playback condividono un turno; i record eccedenti una pagina possono essere saltati. `complete.worldChanges` rimane una fonte di mutazione separata; un parse fallito può diventare un risultato apparentemente normale e vuoto.

**Richiesto:** cursore stabile `(branch, sequence)` o `(turn, recordId)`; schema runtime rigoroso; parse/protocollo invalido = errore tecnico, non successo o ordine accettato per default. **F03/F06.**

### A12 — Il client non sostituisce coerentemente il ramo

**Evidenza:** `App.tsx` (~819–909) conserva parti di oggetti/feed/history dopo rewind/restore; il caricamento dalla Nazione usa il primo save globale e poi rilegge il game corrente. Chat/advisor hanno stato separato che può conservare il futuro.

**Richiesto:** selettore salvataggi esplicito e singola operazione `replaceCanonicalSnapshot`; invalidare richieste e memoria del ramo precedente. **F06.**

### A13 — Sincronizzazione e stati tecnici sono frammentati

**Evidenza:** HTTP/SSE/polling applicano stato con percorsi diversi in `App.tsx`; alcuni hanno guardie di cancellazione, altri no. Il polling cronaca non recupera l'intero checkpoint; errore SSE cancella lo stato processing e può rimuovere Intervene. `simulation_no_event` non ha una gestione completa. Il polling sostituisce anche pagine della cronaca già caricate.

**Richiesto:** reducer unico e ownership delle risposte; connessione separata dal run; polling attivo del job e checkpoint dopo riconnessione. **F06.**

### A14 — Anteprime non committate sono annunciate come notizie

**Evidenza:** `onJumpEvent` con `checkpoint:false` usa `pushFeed` e apre `newsQueue`; `EventFeed` può etichettare il contenuto «Dispaccio verificato». La finalizzazione elimina anteprime dal feed ma non sempre dalla coda notizie.

**Richiesto:** proposte solo nello stato tecnico di generazione; notizie esclusivamente da eventi canonici committati. **F03/F06.**

## 5. Realismo materiale: cosa esiste e cosa non è garantito

### A15 — Il percorso effettivo non usa il controllo costi del vecchio SimulationEngine

La ricerca in `backend-nest/src` trova `SimulationEngine`/`ActionParser` nelle definizioni e nell'export del relativo indice, non nel percorso ordinario `GameSession → GameController → PromptEngine → applyMapChanges/applyWorldChanges` esaminato.

`SimulationEngine.assertCanAfford` controlla PIL/popolazione/potenza, **ma non è prova di validazione delle azioni del percorso LLM corrente**. Inoltre il PIL non è cassa spendibile. Non collegare semplicemente il vecchio motore: ha semantiche e crescita differenti, e usa `Math.random()` per il combattimento nonostante l'intestazione «deterministic».

### A16 — Creare strutture/unità non richiede fondi o filiere verificati

`game-session.ts:applyMapChanges` valida tipo/nome/posizione e dedup di alcune strutture; poi inserisce `factory`, `port`, `university`, `base`, `radar`. `spawn_battalion` crea un oggetto. Non richiede un progetto completato, un ledger di costo, materiali, personale addestrato o competenze industriali.

`applyWorldChanges` può assegnare direttamente grandezze non negative e proprietari. `resolveRegionFlexible` permette ancora fallback come `random`/direzioni su effetti diversi dalle opere, e `move_battalion` può scegliere il primo battaglione se il riferimento non è trovato.

**Conseguenza:** prompt realistico ≠ impossibilità tecnica di materializzare una richiesta assurda. Occorrono catalogo, preflight batch, progetti ed effetti autorizzati, non altri aggettivi nei prompt. **M01–M06.**

### A17 — Il bollettino economico è un modello indicativo, non contabilità nazionale eseguibile

`WorldStateEngine.accounts` produce entrate/uscite/saldo mensili stimati. Non mantiene una tesoreria persistente, debito, prenotazioni, stock fisici, ordini d'acquisto o capacità di filiera. `advance` evolve indici provinciali con tassi, non paga progetti.

`country-facts.ts` usa valori nominali di riferimento 2024 per codici nazionali noti. Non riceve la data del preset; per quei codici il PIL nominale restituito resta fisso anche quando cambia l'indice economico provinciale. Governo e scala nominale non sono quindi una base storica universale. Non usare questi valori come fondi disponibili.

**Richiesto:** separare flussi/stock e indici legacy, economia datata per scenario, fonte/qualità e contabilità persistente. **M01/M02/M04.**

### A18 — Baseline di scenario non sufficientemente affidabile per il realismo rigoroso

`BalanceAgent` genera indici e applica fallback generici; `balanceWorld` può ridurre potenze o aggiungere un alleato per bilanciamento. Il riuso di mondi seleziona data/paesi senza un'identità completa delle regole dello scenario. Queste sono euristiche di gioco, non fatti storici certificati.

Esempi editoriali da correggere mediante revisione fonti: il preset 1951 menziona il Patto di Varsavia già come blocco esistente; il Patto nasce nel 1955. `modern_world_provinces` ha avvio 2026 e lore che dichiara 2024. Non estendere automaticamente una baseline moderna a scenari del 1939 o 1951.

**Richiesto:** pacchetti dati versionati, provenienza, validazione temporale, approvazione umana e distinguere modalità storica rigorosa da scenario ucronico esplicitamente dichiarato. **M01.**

## 6. UI e gestione tecnica

### A19 — Debito CSS strutturale, non due soli pannelli difettosi

Fotografia corrente: `App.tsx` 2.380 righe; `game-session.ts` 3.467; `index.css` 372.394 byte/1.911 righe/**1.763 occorrenze `!important`**; `editorial.css` 42.322 byte/511 righe/**555 `!important`**. Il conteggio è un indicatore di rischio, non prova autonoma di un bug. La prima riga di `index.css` include un blocco molto grande che rende poco utile la sola conta delle righe.

`main.tsx` importa `editorial.css` dopo `index.css`. Hotfix Nazione/Chat/Timeline sono presenti e vanno conservati nei test. La soluzione duratura è componentizzazione, token e proprietà degli stili; non aggiungere una terza stratificazione globale.

### A20 — Accessibilità e composizione dei pannelli incomplete

Chat/nazioni selezionate tramite `div` cliccabili; dialog con focus iniziale in alcuni casi ma senza gestione comune di trap, background inert e ritorno del focus. Save del checkpoint non è direttamente disponibile nel lettore. Z-index e dimensioni dei pannelli sono governati da regole concorrenti.

**Richiesto:** shell unica, un modulo operativo attivo, dialog accessibili, controlli 44–48 px su entrambi i dispositivi; test con tastiera, zoom, viewport piccoli e tastiera virtuale. **U01–U03.**

### A21 — E2E e rilascio non costituiscono ancora un gate affidabile

Gli script `e2e` esaminati contengono selettori obsoleti e assunzioni sul submit ordini che ora chiude soltanto il piano; viewport configurate desktop. Il comando test E2E è un placeholder e il frontend non ha una suite propria configurata.

`deploy-cloudflare.sh` compila frontend e distribuisce Worker; non automatizza backup coerente, migrazione/backend restart/version check/test funzionali/rollback. Health 200 non prova quale motore sia caricato. **Q01/Q02.**

### A22 — Audit di sicurezza necessario prima di ampliare il servizio pubblico

Il bootstrap Express esaminato abilita CORS generico e monta router; non costituisce prova di autenticazione e ownership delle partite. Non è stato eseguito un penetration test. Richiedere un inventario dei controlli su game/save/LLM settings e una decisione esplicita single-owner versus multiutente. Un game ID non deve diventare un'autorizzazione a consumare il provider o riscrivere i salvataggi. **Q02.**

## 7. Cosa conservare

1. Ordini liberi e conferma esplicita; nessun elenco rigido obbligatorio per esprimere l'intento.
2. Tempo manuale, un lotto unico e mondo attivo soltanto all'avanzamento.
3. Playback senza fretta: l'utente decide quando continuare.
4. Registro/eventi e copie di stato per partita già introdotti: migrare, non ricominciare da zero.
5. Grafica operativa navy e distinzione fra comandi e dispacci, ma con CSS isolato.
6. Provider finti e suite backend esistenti: estendere i casi, non eliminarli per ottenere verde.

## 8. Ordine raccomandato

1. **Integrità:** A01–A14 prima di mettere soldi e materiali veri nei checkpoint.
2. **Dati e fattibilità:** A15–A18; un piccolo verticale completo, non un albero enorme di schermate vuote.
3. **UX unica:** rendere visibili i vincoli e le alternative, poi ampliare il micromanagement.
4. **Certificazione:** regressioni browser, migrazioni, recupero crash, prestazioni, sicurezza e deploy coordinato.

I dettagli normativi sono nel [piano maestro](PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md). Istruzioni, dipendenze, file e test per ogni consegna sono nel [piano esecutivo](PIANO_ESECUTIVO_LLM_REALISMO_UX.md).
