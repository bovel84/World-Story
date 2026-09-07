# Open-Pax: parità funzionale con Pax Historia
## Specifica operativa per gli LLM — azioni, eventi e timeline

**Versione:** 1.0 — 6 settembre 2026  
**Progetto:** `/Users/bovel/Desktop/Open-Pax`  
**Destinatari:** LLM incaricati di implementazione, revisione, test e rilascio.  
**Consegna attuale:** documento di specifica; non dichiarazione di funzionalità già implementate.  
**Richiesta del proprietario:** «La gestione degli eventi, delle azioni e della timeline deve essere uguale a Pax Historia».

> **Regola centrale:** il giocatore prepara uno o più ordini alla data corrente. Un comando di avanzamento simula insieme gli ordini e il mondo. Il calendario arriva al primo evento importante oppure alla destinazione esplicitamente scelta. Si ferma e restituisce il controllo al giocatore. Leggere, scrivere, consultare la mappa o lasciare aperta la pagina non fa passare tempo.
>
> **Un salto non è un ordine. Un ordine non è un evento. Uno stesso salto può considerare molti ordini; un evento può dipendere da più ordini; un ordine può avere conseguenze distribuite su più salti.**

---

## 1. Come usare questo documento

1. Leggere prima §§2–5: fonti, limiti della verifica, differenze attuali e invarianti.
2. Implementare per pacchetti secondo §14, senza riscrivere indiscriminatamente il progetto.
3. Usare §§6–11 come contratto funzionale e tecnico. Gli schemi proposti non descrivono il backend privato di Pax Historia.
4. Prima di cambiare un componente, rileggere il sorgente corrente: il repository contiene numerose modifiche locali, anche non tracciate.
5. Collegare ogni modifica agli identificativi `Gxx`, ai requisiti e ai test di §15.
6. Non dichiarare «identico a Pax Historia» prima della verifica comparativa di §16.
7. In caso di conflitto, prevalgono: richiesta esplicita del proprietario → comportamento del riferimento verificato → decisioni progettuali dichiarate qui. Una discrepanza va documentata, non risolta inventando il comportamento originale.

### Stato di implementazione del documento

**Avanzamento iniziale — 6 settembre 2026, non ancora distribuito:**

- G02/G03 sono stati avviati: `GameSession.processAllPendingActions()` ora prende tutti gli ordini `pending` e li passa in **una sola** chiamata a `GameController.processTurnWithPrompts()`, con un solo incremento di turno/data. Il contratto LLM supporta `actionOutcomes`, così ciascun ordine riceve stato, sintesi ed eventi pertinenti pur nello stesso lotto; `simulation_action_outcomes` li persiste per run e l'endpoint run li espone. Gli outcome non dipendono da FK cascade sulle righe `actions`, quindi restano auditabili dopo Save/Load/restore del ramo. I preset legacy ricevono fallback alla cronaca comune. Il caso è coperto da test.
- G03 è stato corretto nel percorso `/time-skip`: anche l'auto-jump considera il lotto completo; il primo evento ferma il tempo, non seleziona arbitrariamente il primo ordine.
- È stato aggiunto il test di regressione «simula tutti gli ordini pendenti nello stesso salto, non un salto per ordine» in `backend-nest/tests/stage2.test.ts`.
- G07 è stato avviato: in auto-jump, `worldChanges`, relazioni e aperture chat globali della risposta finale non sono più applicati; la cronaca usa solo la descrizione degli eventi accettati. È coperto dal test «non applica effetti globali, chat o narrazione successivi al primo evento».
- G01 è stato rafforzato: UI e route standard non possono più attivare il live tick. La vecchia `POST /live-sim` risponde `410 manual_time_only` e il feed indica esplicitamente che il tempo è manuale.
- G04 è stato avviato: `POST /action` registra soltanto un ordine persistente (`201`) e non avanza più tempo. Il frontend aggiorna la coda e non crea una falsa voce di cronaca; solo i controlli Timeline invocano il salto.
- G05/G06 sono stati avviati: un salto senza ordini usa `processWorldAdvance()` e il motore causale con una lista azioni vuota. La route non crea più l'ordine artificiale di osservazione né usa `advanceDate()` per bypassare gli eventi. Il frontend riceve il nuovo esito `world_advanced` e lo inserisce nella cronaca.
- G11 è stato avviato: la tabella `pending_actions` persiste la coda; inserimento, rimozione, presa in carico e completamento aggiornano il DB. Ricostruzione sessione e Save/Load ripristinano gli ordini in attesa. Un outcome `partial` crea inoltre un record `ongoing_processes` persistito (ordine sorgente, run, data d'avvio, sintesi e data prevista opzionale validata). Il server scarta date previste retrodatate; il processo è esposto dal run API e nella sezione Timeline «Processi in corso»: non viene più spacciato per successo concluso. La reiterazione dello stesso ordine con outcome `accepted` chiude il processo. Snapshot, Save/Load, rewind e rollback includono i processi, rimuovendo quelli del futuro del ramo; i test coprono riavvio coda, processo parziale, chiusura e restore.
- G12 è stato avviato: il salto non invoca più generatori NPC/casuali dopo la risposta LLM. Le iniziative NPC devono comparire nella stessa simulazione come eventi causali datati; l'economia deterministica resta un calcolo. Coperto da test che verifica l'assenza dei generatori tardivi.
- G17 è stato avviato: il protocollo NDJSON distingue ora auto-jump e salto fisso. In auto `targetDate` deve coincidere con l'unico evento emesso; se nessun evento è giustificato, richiede `targetDate:null` senza inventare svolte. L'istruzione auto dichiara esplicitamente di prevalere su regole preset contraddittorie (distribuire eventi/non interrompere). Il contratto è coperto da test prompt.
- Auto-jump senza evento: la ricerca non consuma più ordini, non incrementa turno/data, non crea risultati né sostituisce il rewind. Server e UI espongono `no_event_found` con l'intervallo esplorato; il caso è coperto da test.
- G09 è stato avviato: `jump_event` è ora una sola anteprima narrativa (`checkpoint:false`) e non aggiorna più nel browser data o mappa. Il delta mappa viene inviato con `turn_complete`, dopo il commit DB dello stesso checkpoint; è coperto dal test Intervene.
- G10 è stato avviato: il catch di un run ripristina ora checkpoint completo in RAM e DB (mappa, turno/data, relazioni, cronaca, coda e chat) e marca il run failed; non resta più una cronaca futura dopo un errore. Coperto da suite smoke.
- G14/G15 sono stati avviati: dopo qualunque risposta di time-skip il frontend rilegge coda, partita, mappa e cronaca autorevoli dal server; feed e cronaca riusano gli ID canonici server degli eventi e ignorano replay SSE/HTTP dello stesso evento.
- Isolamento per partita: `game_relationships` copia il baseline diplomatico del world alla creazione/migrazione legacy e diventa la sola fonte mutabile della sessione. `game_regions` separa proprietario, colore, economia e oggetti dalla geometria/metadati del world condiviso; API game e ricostruzione sovrappongono la copia dinamica. Save/Load/rollback/processo aggiornano lo stato isolato; una partita non modifica più relazioni o mappa/economia di un'altra sullo stesso preset. Coperto da test con due game.
- Cancellazione LLM: `LLMGenerateOptions` e `postJson` accettano `AbortSignal`; OpenAI-compatible e Anthropic propagano il segnale anche nello streaming e nei retry. Un abort esterno interrompe fetch/backoff con errore non ritentabile distinto dal timeout. `Intervene` ora abortisce anche la richiesta remota: il run crea un `AbortController`, `requestIntervene()` lo abortisce e il fetch `jump` si ferma, mentre eventi già pubblicati e checkpoint restano validi.
- Stato run `intervened`: un lotto fermato da Intervene non è più `completed` ma `intervened` (con checkpoint valido); la risposta idempotente lo tratta come run concluso. Nel lettore Timeline ogni evento con checkpoint offre ora due azioni: «Ripristina il checkpoint» e «Continua da qui», che ripristina il checkpoint e lancia subito il prossimo salto canonico `next_event`. Coperto da build e suite core.
- È stata avviata la persistenza dei run/checkpoint: `simulation_runs` registra ID, modalità, date e stato (`running`, `completed`, `no_event`, `failed`); `simulation_checkpoints` conserva lo snapshot coerente del checkpoint completato (mappa, cronaca, relazioni, coda e chat) con revisione. Tutte le risposte di avanzamento, incluso `no_event_found`, espongono `simulationId`; `GET /games/:id/simulations/:runId` restituisce anche i metadati checkpoint. Intervene accetta/verifica il run ID attivo e rifiuta richieste stale/non in corso. Stati completed/no-event e checkpoint sono coperti da test.
- G20 è stato avviato: Save e rewind serializzano ora chat, partecipanti, messaggi, data mondo e stato letto. Il ripristino elimina le conversazioni/messaggi del futuro e ricrea il ramo esatto; persistLoadedState ripristina anche relazioni, mappa e cronaca. `POST /games/:id/simulations/:runId/restore` ripristina il checkpoint durevole del run se non è in corso una simulazione; il lettore Timeline espone ora il comando di ripristino sul checkpoint dell'evento. Coperto dai test chat/save.
- G21 è stato avviato: i messaggi delle chat non vengono più trasformati in eventi timeline tramite parole chiave. Solo aperture chat e cambi relazionali esplicitamente committati dal simulatore sono eventi diplomatici; le aperture sono datate al checkpoint finale. Coperto dai test chat.
- G18 è stato avviato: i prompt consentono iniziative NPC solo se fondate su obiettivi, risorse, impegni o crisi visibili nella cronaca/diplomazia/stato strategico; restano vietati eventi arbitrari. Il vincolo è coperto da test prompt.
- G19 è stato avviato: i preset UI da 1/3/6/12 mesi calcolano ora la data reale di calendario (fine mese inclusa) e trasmettono al backend il numero effettivo di giorni; il salto personalizzato espone ora «Scegli data» e traduce localmente la data scelta in giorni di calendario prima della richiesta. Il percorso standard usa ora `mode: "next_event"` invece del sentinella `0`; il backend mantiene `0` solo per compatibilità legacy.
- È stata resa esplicita la protezione di concorrenza/idempotenza del turno: una seconda richiesta arrivata mentre una simulazione è in corso riceve `409 simulation_in_progress` invece di un falso esito vuoto. `/time-skip` accetta `Idempotency-Key`, salvata nel run: un retry completato restituisce `simulation_replayed` senza creare un secondo salto; il client genera la chiave. Save, Rewind e Load ricevono lo stesso conflitto, quindi non possono leggere/ripristinare uno stato a metà run. I test verificano lock e chiave persistita.
- G16 è stato avviato: gli esiti di simulazione espongono `eventDetails`; la tabella `simulation_events` persiste ID server, run/checkpoint, data, titolo, dettaglio, fonte e `sourceActionIds`. Ogni TimelineEvent porta anche `simulationId`, così il lettore può risalire al checkpoint che l'ha prodotto. Il server aggiunge i riferimenti agli ordini quando un `actionOutcome` li collega; l'endpoint del run restituisce gli eventi senza ricostruirli dalle sole stringhe.
- G04 è stato completato sul lato modifica: `PATCH /api/games/:id/actions/queue/:actionId` modifica il testo di un ordine ancora in coda (prima della presa in carico) e la persiste nel DB; un ordine già emesso non è riscrivibile. La UI del pannello Ordini offre ora «✎ Modifica» con salvataggio/annullamento. Coperto da test (modifica persistita, testo vuoto e ID inesistente rifiutati).
- G24 è stato avviato: `POST /api/games/:id/actions/enhance` produce un'anteprima riformulata di un ordine libero SENZA accodarlo né simulare; l'accettazione della proposta resta un click esplicito («Usa questa formulazione»). La UI mostra la proposta in un riquadro confrontabile con «Scarta». Coperto da test (nessuna mutazione di coda/data/turno, testo vuoto rifiutato).
- G35 / §10.1 / §11.3 sono stati avviati: `GET /api/games/:id/timeline?after=<turno>&limit=<N>` pagina il registro persistente (`turn_results`) oltre un cursore di turno, restituendo `hasMore` e `nextAfter`. La cronaca sopravvive a refresh, riavvio e consolidazione della memoria; la UI del pannello Timeline offre «Carica la cronaca precedente» per il recupero progressivo. Coperto dal test di paginazione su 150 turni.
- Copertura §15 estesa: aggiunti i test T08 (coda con soli ordini già completati → comportamento identico a zero nuovi ordini, un solo salto) e T24 (due eventi nella stessa data: il salto fisso li applica entrambi con ordinamento, l'auto-jump applica solo il primo senza aggiungere un giorno).
- Verifiche eseguite dopo i cambiamenti: build backend, build frontend e 223 test backend superati.
- **§9.3 playback scaglionato implementato:** il salto fisso con due o più eventi proposti entra in playback «un evento alla volta»: il primo evento diventa checkpoint per-evento (revisione crescente, un solo turno logico per salto), le proposte restanti restano nel run (`simulation_runs.pending_state`) come non canoniche e il run si ferma in `awaiting_next`. `POST /api/games/:id/simulations/:runId/next` («Continua») autorizza il checkpoint successivo; l'ultimo Continua porta il mondo a destinazione applicando solo allora gli effetti globali del periodo; «Intervieni qui» (`POST /intervene` con `simulationId`, `eventId` e `revision`) chiude il run al checkpoint mostrato (`intervened`). Uno stream terminato senza record `complete` chiude il run `paused_budget` alla data dell'ultimo evento, senza dichiarare raggiunta la destinazione (T36). La pausa è durevole: gli ordini emessi restano `processing` e non sono reinviati; ricostruzione sessione, save/load e rewind sono coordinati (rewind invalida i run del ramo scartato e restituisce gli ordini in coda, §12); un nuovo salto durante la pausa riceve `409 simulation_paused`. Durante la generazione di un salto fisso gli eventi non sono più svelati né applicati: il primo `jump_event` arriva con `checkpoint:true` e i successivi solo su conferma. Salti fissi con zero o un evento mantengono il percorso storico in un'unica soluzione; l'auto-jump è invariato. Coperto da test di sessione (playback completo, T24 per-evento, T36 budget, durabilità dopo riavvio, save/rewind in pausa, conflitto 409) e da smoke HTTP sulle rotte (`backend-nest/tests/routes-playback.test.ts`); 223 test totali superati.

- **G22 lettore di sessione separato implementato:** `SimulationEventReader` è distinto da `EventFeed` (ora dichiaratamente archivio in sola lettura) e dalla Timeline. Mostra solo il checkpoint attivo, la data, i dispacci ancora sigillati e l'ancora durevole di revisione; è ricostruito dopo refresh da `GET /games/:id` / `GET /simulations/:runId`. «Intervieni qui» è ora obbligatoriamente ancorato a `simulationId` + `eventId` + `revision`: un'ancora assente restituisce `409 checkpoint_anchor_required`, una pagina superata `409 stale_checkpoint`. La Timeline resta navigabile senza mutare lo stato attivo, segnala il checkpoint in lettura e reindirizza al lettore; salti e comandi storici concorrenti restano bloccati durante il playback. Coperto dagli smoke HTTP del playback.

- **Pacchetti grafici gameplay implementati:** (1) shell operativa navy/indaco con HUD compatto e dock inferiore per Azioni/Diplomazia/Consulente; (2) pannello Azioni riorganizzato come superficie di comando a sinistra con coda, modifica/rimozione, Brainstorm/Enhance e compositore distinti; (3) Timeline come sheet scuro con next-event, preset calendariali e «Scegli data». Il lettore G22 è un foglio modale con la colonna dei soli checkpoint già letti, non un banner; gli eventi futuri restano non mostrati. Il pacchetto usa `frontend/src/App.tsx`, `components/Game/HudBar.tsx`, `components/Game/SimulationEventReader.tsx`, `components/Game/Fab.tsx` e `index.css`; build frontend superata. Le differenze comportamentali ancora aperte restano quelle della campagna §16, non sono mascherate dal restyling.

**Stato attuale (a questa data):** i nodi centrali di G02/G03/G04/G05/G06/G11/G12/G17/G19/G22 (lotto unico per salto, coda e processi persistiti, ordini zero senz'ordine fittizio, modifica/rimozione della coda, esiti individuali persisti, endpoint di run/checkpoint, timeline paginata dal registro persistente, Enhance in anteprima e lettore di sessione separato) sono implementati e coperti da test. L'auto-jump termina al primo evento importante; il salto a data esplicita funziona anche senza nuovi ordini; Intervene, Save/Load, Rewind e il ripristino/continuazione da checkpoint sono affidabili.

- **§17 deploy eseguito (7/9/2026):** dopo backup SQLite coerente e verifica che non esistessero run `running`/`awaiting_next`, backend compilato e riavviato con ricostruzione delle sessioni; Worker `open-pax` pubblicato inizialmente alla versione `73aad6d7-310c-453b-804c-90f4aa791821` e aggiornato con hotfix grafico (`6c6a2d6`) alla versione `906efd11-c982-44c4-bd4e-c23eed7ad3fe`, con hotfix del lettore sospeso (`315534b`) alla `bad2584c-3900-42eb-9268-e0931653901a` e con pass di leggibilità UI (`bd1d0ad`, `2881306`) alla `2550efa1-2509-4f7c-8149-05cccc3c5331` e con Dispacci nella HUD/chat diplomatiche migliorate (`e9512ad`) alla `c63bd1b7-7b74-425d-a7d6-965db214b0e7`, seguita dalla coda di notizie centrali (`65e0fc6`) alla `177936c0-ee42-447a-8c1e-9bfa903262a5` e dal dettaglio archivio centrato (`4e8c2ba`) alla `e9d1add3-b1a1-4709-b6ad-66c56a0f2924`. Smoke non distruttivo riuscito sull'URL pubblico: `/api/health`, proxy `/api/templates` (7 preset) e asset della build corrente (`index-Co78BQfA.js`, `index-bZS6ZZfO.css`); tunnel e backend locale health OK, nessuna simulazione attiva dopo il deploy. Il rilascio è **pubblicato, non ancora certificato**: T01/T04/T06/T19/T20 pubblici e l'E2E comparativo residuo restano da eseguire prima di dichiarare la parità/release completa.

**Rimane aperto:** completare la campagna comparativa E2E su Pax Historia (§16, G23: prima sessione autenticata documentata in `PAX_HISTORIA_VERIFICA_PARITA.md`, ma Save/Load/Rewind, diplomazia, assenza di eventi e limiti restano da provare) e la verifica pubblica completa §17 (T01/T04/T06/T19/T20).

### Ambito

Inclusi: preparazione e invio ordini, avanzamento automatico/al giorno scelto, eventi progressivi, arresto/intervento, cronaca, effetti sulla mappa, diplomazia rilevante per la simulazione, continuità dei piani, salvataggi e rewind necessari a questo flusso.

Esclusi: copia di marchi, asset e testi proprietari, pagamenti, account, arena, catalogo pubblico, rifacimento completo della geografia, sostituzione generalizzata del sistema economico, redesign estetico non necessario. Conservare l'identità Open-Pax e l'interfaccia italiana. Non estendere questo incarico a un altro progetto.

---

## 2. Fonti e grado di verifica

### 2.1 Evidenze disponibili

| ID | Fonte | Cosa dimostra / limite |
|---|---|---|
| R1 | `https://paxhistoria.com` | Il 6/9/2026 reindirizza a `https://www.paxhistoria.co/`. Homepage pubblica raggiungibile. |
| R2 | [Schermata azioni](ref/pax_actions.png) | Pannello con nazione/data, suggerimenti, compositore libero, controllo di invio e icona di miglioramento. L'immagine è una cattura già presente nel repository. |
| R3 | [Azione inviata](ref/pax_action_sent.png) | L'ordine compare fra quelli inviati mentre la data visibile resta 1/12/1935. Conferma la separazione visiva fra invio e salto. |
| R4 | [Timeline di avanzamento](ref/pax_jump2.png) | Data «adesso», prossimo evento importante, settimana, mese, tre/sei mesi, anno e personalizzato. Le date mensili illustrate sono di calendario: 1/12/1935 → 1/1/1936. |
| R5 | [Analisi precedente](open-pax-roadmap.md), datata 17/7/2026 | Riporta più azioni per turno, Brainstorm/Enhance, chat, eventi progressivi, Save/Intervene e Rewind. Fonte secondaria locale: le affermazioni vanno riconfermate dove decisivo. La sua vecchia lista di bug NON fotografa il codice attuale. |
| R6 | `https://wiki.paxhistoria.co/` | Tentato accesso durante questa analisi; richiesta HTTP bloccata con 403, navigazione browser non utilizzabile per verificare le pagine di gameplay. Non citare la wiki come riletta integralmente oggi. |
| R7 | [Verifica autenticata 7/9/2026](PAX_HISTORIA_VERIFICA_PARITA.md) | Partita isolata Modern Day/Italia: coda modificabile, brainstorming separato, auto-jump fermo al primo evento, «Evento successivo» manuale e Intervene con doppia conferma; evidenze screenshot incluse. Copertura parziale, non certificazione di equivalenza. |
| C1 | Sorgenti locali di Open-Pax | Ispezione statica dei percorsi citati in §4. È prova del comportamento scritto, non di quello effettivamente caricato dal server di produzione. |

È stata eseguita una prima campagna autenticata su Pax Historia (R7). Sono ora osservati la cadenza manuale del playback e il flusso Intervene nel lettore; non sono ancora certificati Save/Load/Rewind, politica senza eventi, errori/limiti, diplomazia, soglie di importanza e tutti i dettagli del destino degli ordini non letti.

### 2.2 Convenzione del documento

- **Parità osservata:** evidenza R2–R4.
- **Parità riportata:** analisi R5, da ricontrollare sul gioco accessibile.
- **Requisito utente:** stop al primo evento importante e controllo esplicito del tempo.
- **Decisione Open-Pax:** contratto tecnico proposto per rendere il comportamento affidabile. Non attribuirlo al codice privato del riferimento.

La classificazione interna degli eventi, gli ID causali, i job persistenti, le transazioni e le API descritte sotto sono **decisioni Open-Pax**.

---

## 3. Esperienza da ottenere

### 3.1 Esempio completo

Alla data `1935-12-01` il giocatore prepara:

- A: ampliare gli impianti industriali della Ruhr;
- B: proporre un patto di non aggressione alla Polonia;
- C: rafforzare la difesa del confine occidentale.

L'invio registra i tre ordini ma lascia invariati data e mondo. Il giocatore può consultarli, rimuoverli prima della presa in carico, chiedere consiglio e negoziare.

Con «Fino al prossimo evento importante»:

1. A, B e C entrano **insieme** nel contesto della stessa simulazione, con risorse e possibili conflitti comuni.
2. Si considerano anche processi già attivi, scadenze, diplomazia e iniziative plausibili delle altre nazioni.
3. La prima svolta valida, per esempio una risposta polacca il `1935-12-04`, viene registrata e mostrata.
4. La data diventa `1935-12-04`, non `1936-12-01`, né la conclusione della costruzione industriale.
5. Le opere ancora in corso restano tali. Nessuna fabbrica compare perché è stata soltanto richiesta.
6. Il tempo resta fermo mentre il giocatore legge e decide. Una nuova simulazione richiede un nuovo comando.

Con un salto esplicito fino al `1936-01-01`, il mondo viene invece simulato fino a quella data, con gli eventi pertinenti del periodo e possibilità di intervenire prima. I tre ordini non devono generare tre salti mensili consecutivi.

### 3.2 Stati visibili minimi

- **In attesa di ordini / pronto:** calendario fermo.
- **Ordini registrati:** pronti per il salto, non già realizzati.
- **Simulazione in corso:** elaborazione reale, senza percentuali inventate.
- **Evento disponibile / in lettura:** titolo, data, dettaglio ed effetti coerenti.
- **Arrestato al prossimo evento:** controllo restituito al giocatore.
- **Destinazione raggiunta:** fine del salto a data scelta.
- **Interrotto dal giocatore:** punto di arresto esplicito e confermato dal server.
- **Errore / ricerca senza evento:** nessun esito fittizio; indicazione dello stato conservato.

Il tempo di elaborazione della LLM non è tempo di gioco.

---

## 4. Analisi dello stato attuale e modifiche richieste

Riferimenti per simbolo anziché per numero di riga, perché i file sono in evoluzione.

| ID / priorità | Situazione riscontrata | Modifica richiesta | File / simboli principali |
|---|---|---|---|
| G01 / P0 | `liveSimEnabled=false` e niente auto-start su GET/SSE sono già stati introdotti. Restano timer, endpoint e interruttore live riattivabile. | Rendere il percorso standard esclusivamente a comandi; fermare anche timer già attivi nelle sessioni esistenti. Non confondere streaming con simulazione autonoma in tempo reale. | `game-session.ts`: `startLiveSim`, `worldTick`, `setLiveSim`; `routes/games.routes.ts`; `App.tsx`; `EventFeed.tsx`. |
| G02 / P0 | `processAllPendingActions()` invoca `_processNextActionUnlocked()` ripetutamente: ogni ordine produce un proprio salto, risultato e incremento del turno. | Un orchestratore per salto, con tutti gli ordini del lotto. Eliminare la moltiplicazione del tempo per numero di ordini. | `game-session.ts`; `agents.ts`: `processTurnWithPrompts`. |
| G03 / P0 | La patch auto-jump in `/time-skip` elabora soltanto il primo ordine. | Superare questa soluzione provvisoria: **un solo evento finale non significa un solo ordine considerato**. | `routes/games.routes.ts`: `/time-skip`. |
| G04 / P0 | Il pulsante finale nel pannello ordini chiama `processAllActions(gameId, 30)`. Esistono più vie di invio/risoluzione. | Separare «Registra ordine» da «Avanza». Un unico ingresso di simulazione per tutti i pulsanti. Nessun mese implicito al submit. | `App.tsx`: pannello ordini, `handleSubmitAction`, `handleTimeSkip`; `services/api.ts`. |
| G05 / P0 | Senza ordini l'auto-jump inserisce l'azione artificiale «Osservare ... e curare la politica interna». Il controllo usa la lunghezza di una lista che include anche ordini completati. | Consentire lotti vuoti senza inventare intenzioni del giocatore. Filtrare gli stati effettivi della coda. | `routes/games.routes.ts`; `game-session.ts`: `getPendingActions`. |
| G06 / P0 | Senza ordini un salto fisso chiama `advanceDate()`: avanzano calendario/economia, non la stessa simulazione narrativa. | Usare lo stesso motore di eventi anche con zero nuovi ordini, in modalità automatica e a destinazione. | `routes/games.routes.ts`; `game-session.ts`: `advanceDate`. |
| G07 / P0 | `publishEvent` limita l'auto-jump al primo evento e `resolvePeriod` usa la prima data. Tuttavia il resto della risposta può ancora influire attraverso `worldChanges`, `relationshipChanges`, `startChat`, `voided` e narrazione. | Taglio del futuro su **tutti** gli effetti, non solo su `events[]`. Ogni effetto deve appartenere a un evento/checkpoint accettato. | `game-session.ts`: `_processNextActionUnlocked`, `applyWorldChanges`; `prompts/types.ts`. |
| G08 / P0 | L'auto-jump attende comunque la conclusione dello stream. Non c'è `AbortSignal` nel contratto `LLMGenerateOptions` letto. | Arresto logico immediato al limite; propagare cancellazione ai provider quando disponibile. Output tardivo mai applicabile. | `prompt-builder.ts`: `runSimulation`; `llm/types.ts`, `router.ts`, `http.ts`, adattatori. |
| G09 / P0 | `jump_event` modifica la mappa in memoria e il frontend mostra la data dell'evento; backend/DB aggiornano la data a fine elaborazione. | Data, mappa, economia e cronaca pubblicate devono corrispondere allo stesso checkpoint durevole. | `game-session.ts`: `publishEvent`, `syncRegionsToDB`; `App.tsx`: `onJumpEvent`. |
| G10 / P0 | Il catch ripristina la mappa, non l'intero insieme di mutazioni/record già eseguiti. Il client può conservare anteprime invalide. | Transazioni ai checkpoint, recupero da errore, esito esplicito e riconciliazione del client. Nessuna falsa vittoria dopo un errore. | `game-session.ts`; repository; `App.tsx`; SSE. |
| G11 / P0 | Gli ordini pendenti vivono in memoria. `SaveData` non li include; `loadFromSave` li svuota. Stati limitati a pending/processing/completed. | Persistenza della coda, stato di emissione distinto dallo stato di attuazione, esiti parziali e piani in corso. | `game-session.ts`: `PendingAction`, `SaveData`, queue/save/load; `database.ts`. |
| G12 / P0 | Nell'auto-jump sono stati esclusi NPC/casualità aggiuntivi; nel salto fisso esistono ancora passaggi separati dopo la narrazione. | Un'unica sequenza causale; nessun secondo motore aggiunge conquiste o crisi fuori dagli eventi datati. Conservare l'economia deterministica come calcolo, non generatore di rumore. | `game-session.ts`: `processNPCTurns`, `applyRandomEvents`, `advanceWorldState`; `npc-agents.ts`. |
| G13 / P0 | Mutex booleano solo su alcuni percorsi; `advanceDate`, load/save/rewind e chat richiedono un audit di concorrenza. Nessun contratto di idempotenza del salto. | Una sola simulazione mutante per partita; revisioni, richieste idempotenti, conflitti HTTP espliciti e snapshot coerenti. | `game-session.ts`: `withLock`; tutte le route mutanti; `session-registry.ts`. |
| G14 / P1 | Feed e cronaca vengono alimentati da HTTP, SSE e polling con ID diversi/random; `addHistory` aggiunge senza deduplicare. | Registro normalizzato per ID server e revisioni. Un solo evento visibile anche con riconnessioni e risposta HTTP duplicata. | `App.tsx`: feed/polling/handler; `gameStore.ts`; `services/sse.ts`; `EventFeed.tsx`. |
| G15 / P1 | `handleTimeSkip` aggiorna risultati/data ma non riconcilia integralmente coda/mappa. Polling di data legato a `liveSim`; polling timeline separato. | Sincronizzazione per job/revisione indipendente dalla modalità live, con refetch finale e gestione delle risposte obsolete. | `App.tsx`; store; API/SSE. |
| G16 / P1 | `SimulationEvent` ha titolo, descrizione, data e mapChanges: niente ID persistente, causa, ordine sorgente o stato di commit nel contratto LLM/sessione. | Estendere schema e validazione, assegnando gli ID autorevoli sul server. | `prompts/types.ts`; `prompts/simulation.ts`; repository eventi. |
| G17 / P1 | Prompt auto e formato `complete` possono indicare orizzonte finale; regole generiche parlano ancora di distribuire eventi su tutto il periodo. | Prompt distinti per modalità e una gerarchia senza contraddizioni, anche nei preset. | `prompts/simulation.ts`: istruzioni auto/progressive/default; `prompt-builder.ts`. |
| G18 / P1 | I prompt vietano molto ampiamente eventi indipendenti; senza ordini possono limitare eccessivamente il mondo. | Consentire iniziative NPC fondate su obiettivi, risorse e crisi del mondo, senza pretendere che tutto derivi dal giocatore. Vietare invece eventi arbitrari senza causa. | `prompts/simulation.ts`; contesto in `game-session.ts`/`prompt-builder.ts`. |
| G19 / P1 | Preset «mese» = 30 giorni, «anno» = 365 nel frontend. Alcuni wrapper sostituiscono `0` con `30` mediante `||`. | Mesi/anni di calendario per quei preset; giorni espliciti per il custom. Preservare `0` durante la compatibilità, poi sostituirlo con una modalità nominata. | `HudBar.tsx`: `TIME_PRESETS`; `calendar.ts`; `services/api.ts`; `/action`. |
| G20 / P1 | Rewind conserva un solo snapshot per ordine; save può leggere una mappa parziale con data vecchia. Chat non comprese nello snapshot letto. | Snapshot per salto/checkpoint, rollback di cronaca, coda, relazioni, chat, piani e memoria del ramo. | `game-session.ts`: save/load/rewind; `session-registry.ts`; repository chat/saves. |
| G21 / P1 | `getTimeline()` crea «Svolta nelle trattative» da parole chiave anche in messaggi non conclusivi. Aperture chat nel turno usano la data ancora precedente al completamento. | Separare messaggi da eventi diplomatici effettivi, assegnare data/checkpoint e stato di accordo corretti. | `game-session.ts`: `getTimeline`, `generateChatReply`, `startChat`; `chat.repository.ts`. |
| G22 / P1 | **Implementato:** `SimulationEventReader` separato dall'archivio e stato del checkpoint recuperabile dal run. | Lettura progressiva, controllo Intervene ancorato a ID/revisione, navigazione storica senza mutazioni. | `SimulationEventReader.tsx`; `EventFeed.tsx`; `HudBar.tsx`; `App.tsx`; contratto playback. |
| G23 / P1 | Build+deploy Worker non dimostrano che il backend Express sia aggiornato. Lo script compila solo il frontend e usa URL assoluto di quick tunnel. | Rilascio coordinato backend/frontend e prova del comportamento in produzione; preferire API same-origin via Worker. | `scripts/deploy-cloudflare.sh`; `cloudflare/worker.js`; avvio backend. |
| G24 / P2 | Brainstorm esiste; il compositore non offre un flusso completo di miglioramento con anteprima e conferma. | Enhance senza inviare/attuare automaticamente, conservando intento e riferimenti originali. | `App.tsx`; `prompts/converter.ts`; API azioni. |

**Nota:** l'analisi strutturale ha trovato un indice del codice datato 3/9/2026, non aggiornato per diversi file. I rilievi principali sopra sono fondati sulla rilettura dei sorgenti, non sull'indice né sulla vecchia roadmap.

---

## 5. Invarianti non negoziabili

1. **Tempo esplicito:** nessuna mutazione del calendario da GET, mount React, polling, SSE, token LLM, focus del browser o semplice attesa reale.
2. **Un salto = un lotto:** gli ordini selezionati condividono origine, contesto, risorse e destinazione. Non un salto per ordine.
3. **Un lotto ≠ successo di tutti gli ordini:** avviato, parziale, impedito e rifiutato sono risultati legittimi.
4. **Auto-jump:** un solo primo evento importante accettato, controllo restituito e nessun effetto futuro.
5. **Destinazione esplicita:** mai oltre la data richiesta; eventuali eventi dello stesso giorno sono ordinati per sequenza, non per data soltanto.
6. **Coerenza del checkpoint:** data, mondo, piani, diplomazia e cronaca appartengono alla stessa revisione persistita.
7. **Nessun futuro nella memoria:** eventi scartati/interrotti non entrano in prompt, chat, advisor, riepiloghi, mappe o salvataggi.
8. **Applicazione esattamente una volta:** retry, doppio click e riconnessione non duplicano ordini, eventi, costi o tempo.
9. **Diritto d'intervento reale:** quando il server conferma lo stop a un evento, non possono apparire effetti del successivo.
10. **Lettura non mutante:** aprire una vecchia notizia non simula, non ripristina la mappa corrente e non consuma ordini.
11. **Niente eventi di riempimento:** contabilità ordinaria, «nessuna novità», fine mese e avanzamento tecnico non sono svolte della cronaca.
12. **Esiti non inventati sugli errori:** errore LLM/rete = stato tecnico, non «il mondo ha reagito».
13. **Nomi e ID:** entità risolte e validate; un riferimento ambiguo non autorizza modifiche a una provincia scelta arbitrariamente.
14. **Salvataggi isolati:** nessuna contaminazione fra partite o rami che condividono un preset; verificare l'uso attuale di `world_id` come chiave dello stato mutabile.

---

## 6. Contratto delle azioni

### 6.1 Preparazione

- Il testo è libero: niente necessità di selezionare attacco/commercio/costruzione prima di scrivere.
- «Registra ordine» salva una richiesta alla data corrente e restituisce un ID server.
- «Elabora proposte» suggerisce soltanto; «Usa» registra una proposta solo su click esplicito.
- «Migliora formulazione» produce un'anteprima confrontabile; accettare la riformulazione non equivale a simulare.
- Modifica/rimozione solo fino alla presa in carico; rimozione persistita, non soltanto nascosta nella UI.
- Ordini nuovi durante un salto: conservarli come bozza del turno successivo oppure rifiutarli con spiegazione. Non inserirli di nascosto nel lotto in elaborazione.

### 6.2 Presa in carico e attuazione

**Decisione Open-Pax:** separare due dimensioni:

- consegna: `queued → issued`, oppure `cancelled` prima dell'emissione;
- attuazione: `not_started → in_progress → completed | failed | rejected | cancelled`.

Un ordine `issued/in_progress` è già stato preso in carico: non va reinviato come nuovo al successivo salto. Deve essere recuperato dal registro dei processi attivi. Annullare un ordine già emesso è una nuova decisione con eventuali costi/conseguenze, non la cancellazione del passato.

Il backend deve associare gli esiti mediante `actionId`, non confrontando soltanto il testo. Gli ordini composti possono essere scomposti in sottoazioni con ID figli, conservando il testo originario e la relazione con l'ordine padre.

### 6.3 Simultaneità

Tutti gli ordini del lotto vengono convertiti/normalizzati insieme. Il convertitore esiste già in forma batch nel controller: riutilizzarlo, eliminando la chiamata con `[action.text]` come unità di turno.

- Sommare gli impegni concorrenti prima di autorizzarli: non spendere lo stesso bilancio due volte.
- Esplicitare incompatibilità, dipendenze e sequenze volute dal giocatore.
- Separare costo di avvio, costo distribuito nel tempo e costo di completamento, se applicabili.
- Non trasformare un progetto annuale in una costruzione finita al primo stop di tre giorni.
- La priorità degli ordini non impone che la loro conclusione preceda una crisi esterna cronologicamente precedente.

---

## 7. Contratto del tempo

### 7.1 Modalità `next_important_event`

1. Congelare la revisione iniziale e il lotto di ordini.
2. Costruire il contesto completo: stato materiale, ordini, progetti in corso, scadenze, relazioni, accordi e storia valida.
3. Cercare il primo evento importante causalmente plausibile, non la fine di tutti gli ordini.
4. Validarlo prima di qualsiasi effetto.
5. Portare economia/processi dalla data precedente alla data dell'evento; applicare i suoi effetti puntuali alla data corretta.
6. Salvare un checkpoint coerente, pubblicarlo e terminare l'operazione in stato `paused_at_event`.
7. Non pianificare un nuovo avanzamento automatico. Chiudere la scheda dell'evento non fa ripartire il mondo.

La LLM non può sovrascrivere il calendario con un `targetDate` più lontano. Anche narrazione e metadati devono fermarsi allo stesso punto.

**Importanza, decisione Open-Pax da calibrare:** evento che modifica concretamente opzioni, sicurezza, controllo territoriale, rapporti diplomatici, fattibilità di un ordine, risorse strategiche o una crisi in corso. Esempi: ultimatum, inizio/esito rilevante di un conflitto, trattato accettato/rifiutato, scoperta decisiva, ostacolo sostanziale o completamento di un progetto. Non serve che il giocatore sia l'attore.

La scelta esatta del «primo» da parte di una LLM resta una valutazione simulativa. Il server garantisce l'ordinamento degli eventi accettati e il taglio del futuro; non può dimostrare da solo che nessun fatto plausibile anteriore sia stato omesso. Verificare questo aspetto con scenari e scadenze deterministiche di test.

**Nessun evento:** non inventare una crisi e non saltare automaticamente di un anno. Usare una ricerca interna limitata per budget/orizzonte, senza commit parziali invisibili. Se non emerge una svolta entro il limite, tornare `no_event_found`, indicare l'intervallo esplorato e lasciare invariato il checkpoint iniziale. Offrire «Estendi la ricerca» o una data esplicita. Questa politica è una decisione Open-Pax da confrontare con il riferimento; vietati loop LLM senza limite.

**Evento nella data corrente:** ammesso con `elapsedDays=0`, ID nuovo e sequenza maggiore. Non aggiungere artificialmente un giorno per evitare la gestione delle sequenze.

### 7.2 Modalità `until_date`

- Riceve una data precisa; backend e frontend devono concordare su di essa.
- Gli eventi sono distribuiti in base alle cause, non a quote fisse di notizie.
- Anche senza ordini nuovi, mondo e progetti attivi vengono simulati.
- Se il giocatore interviene, la destinazione non è raggiunta: il risultato riporta il checkpoint effettivo.
- Se nessun evento significativo si verifica, è lecito raggiungere la destinazione con aggiornamenti deterministici e uno stato tecnico «nessun evento», senza aggiungere una notizia falsa alla cronaca.
- Se finisce il budget prima della destinazione, segnalare `paused_budget`, non dichiarare il periodo completato.

### 7.3 Aritmetica del calendario

- Settimana = 7 giorni.
- Mese / tre mesi / sei mesi = mesi di calendario.
- Anno = anno di calendario.
- Salto personalizzato: selezione della data oppure numero esplicito di giorni con data di arrivo visibile.
- Fine mese: proposta di convenzione, da verificare col riferimento: clamp all'ultimo giorno valido del mese di arrivo.
- Esempi: 1/12/1935 + 1 mese = 1/1/1936; 31/1/2024 + 1 mese = 29/2/2024; 29/2/2024 + 1 anno = 28/2/2025.
- Calcoli UTC e parsing severo: niente date locali influenzate da DST.
- Durante la migrazione preservare `jump_days: 0`; usare `??` dove serve un default, non `||`. Preferire infine modalità nominate anziché sentinelle numeriche.

---

## 8. Eventi, effetti e prompt

### 8.1 Registro unico

**Decisione Open-Pax:** un evento canonico include almeno:

```ts
type CanonicalEvent = {
  id: string;              // assegnato dal server
  gameId: string;
  branchId: string;
  simulationId: string;
  sequence: number;
  date: string;            // YYYY-MM-DD
  headline: string;
  description: string;
  importance: 'minor' | 'important' | 'critical';
  source: 'player' | 'world' | 'diplomacy' | 'project';
  causeRefs: string[];     // ordini, eventi, accordi, progetti o fatti canonici
  actionIds: string[];
  polityIds: string[];
  regionIds: string[];
  effects: ValidatedEffect[];
  revision: number;
};
```

`ValidatedEffect` è uno schema tipizzato da definire: trasferimenti territoriali, modifiche materiali consentite, avanzamento progetti, relazioni, apertura chat e cambiamenti di stato degli ordini. Non introdurre `any` come validazione degli effetti. Gli eventi ancora proposti dalla LLM rimangono separati dal registro canonico.

### 8.2 Pipeline obbligatoria

`stato → proposta LLM → validazione → risoluzione entità → effetti controllati → transazione/checkpoint → pubblicazione → cronaca/memoria`

- Verificare data, ordine, schema, riferimenti, plausibilità materiale e compatibilità col checkpoint.
- Mai modificare proprietari/colori da una frase libera non strutturata.
- Un trasferimento aggiorna proprietario e colore coerentemente.
- Una proposta o un cantiere non aggiunge l'oggetto dell'opera completata.
- Non applicare un'intera risposta `worldChanges` dopo averne scartato gli eventi successivi.
- `complete` diventa riepilogo tecnico, non una seconda fonte di mutazioni non datate.
- Per compatibilità legacy, effetti globali non riconducibili al checkpoint vanno scartati o rigenerati; mai attribuiti arbitrariamente al primo evento.

### 8.3 Ordine e output malformato

- Streaming: richiedere eventi cronologici e sequenza monotona; scartare record incompleti fino alla chiusura valida.
- Se un record successivo retrodata una conseguenza già pubblicata, non riordinare a posteriori la storia applicata: segnalare errore di protocollo e conservare l'ultimo checkpoint valido.
- Risposta batch non streaming: validare e ordinare prima di mutare; non ordinare gli eventi senza verificare le dipendenze degli effetti.
- Deduplicare per chiavi server/run/sequence, non soltanto tramite `JSON.stringify` o titolo.
- Un provider che ignora il limite auto-jump non può generare effetti futuri nemmeno tramite chat o riepiloghi.

### 8.4 Autonomia del mondo

Il mondo non resta immobile perché il giocatore non dà ordini. Ma la sua evoluzione viene calcolata **quando il giocatore avanza**, non tramite un timer reale.

Gli NPC possono perseguire obiettivi propri, reagire a condizioni storiche, scadenze, risorse e rapporti. La plausibilità richiede una causa nel canone, non necessariamente un ordine del protagonista. Gli eventuali agenti NPC devono fornire proposte allo stesso orchestratore; non applicare conquiste dopo la chiusura della timeline.

### 8.5 Prompt

- Una modalità = un contratto non contraddittorio.
- Auto: primo evento importante, data effettiva, nessuna conclusione futura.
- Data scelta: copertura del periodo, stop al limite e possibilità di pausa.
- Ordini: tutti quelli del lotto, con ID e dipendenze; nessun successo obbligatorio.
- Contesto: anche progetti emessi nei salti precedenti e impegni diplomatici ancora validi.
- Difficoltà e regole del preset restano, ma non possono autorizzare retrodazioni, doppie applicazioni o avanzamenti oltre il limite.
- Non chiedere descrizioni generiche di reazioni del mondo senza effetti verificabili.
- I limiti di token/eventi sono budget tecnici, non obblighi di riempimento narrativo.
- Una riformulazione del convertitore non può aggiungere nuove intenzioni del giocatore.

---

## 9. Architettura di esecuzione proposta

### 9.1 Un orchestratore per salto

Creare, o estrarre senza duplicazioni, un servizio `SimulationRunService`/`TurnOrchestrator`.

Responsabilità:

1. validazione e idempotenza della richiesta;
2. snapshot iniziale e presa in carico atomica degli ordini;
3. contesto condiviso e conversione batch;
4. ciclo di proposta/validazione/commit degli eventi;
5. gestione di stop, budget, cancellazione e ripresa;
6. aggiornamento dei piani in corso;
7. chiusura unica del salto e notifica del risultato.

`GameSession` diventa facciata dello stato e dei servizi. `GameController`/`PromptEngine` restano adattatori di generazione, non una seconda sorgente di verità.

**Turno:** assegnare un numero logico al salto; non incrementarlo per ogni ordine o evento. La revisione di stato, invece, cresce a ogni checkpoint. Formalizzare il caso del primo checkpoint e della chiusura in test: nessun doppio incremento. Una ricerca senza eventi e senza commit non consuma un turno.

### 9.2 Job persistenti anziché POST lunghi

Decisione Open-Pax, utile anche dietro Cloudflare: il comando crea un job e risponde rapidamente; SSE/polling riportano lo stato. La richiesta HTTP non deve rimanere aperta per l'intera risposta della LLM.

Stati proposti:

`queued → running → paused_at_event | awaiting_next | completed | interrupted | no_event_found | paused_budget | failed`

`paused_at_event`, `completed`, `interrupted` e `no_event_found` terminano quel comando. `awaiting_next` mantiene un salto esplicito sospeso prima di applicare l'evento successivo; `paused_budget` richiede una ripresa esplicita. Documentare se la ripresa mantiene lo stesso job o ne crea uno collegato; in entrambi i casi gli ordini emessi non devono essere reinviati.

### 9.3 Checkpoint e finestra di intervento

**Scelta prudenziale per Open-Pax, da confrontare con il playback reale del riferimento:**

- Auto-jump: commit del primo evento e stop definitivo del comando.
- Salto fisso: eventi leggibili uno alla volta; «Successivo/Continua» autorizza il checkpoint seguente, «Intervieni qui» chiude il salto al checkpoint mostrato.
- Non abilitare inizialmente un auto-play incontrollato che renda impossibile fermarsi al punto letto.
- Se viene aggiunto auto-play dopo la verifica comparativa, deve esistere un protocollo esplicito di conferma del checkpoint; niente affidamento su un semplice timeout visivo.

Save salva l'ultimo checkpoint confermato. Intervene include `simulationId`, `eventId` e `revision`, non un booleano generico privo del punto di arresto.

L'interfaccia non deve mostrare come definitivo un evento non salvato. Eventuali proposte future precaricate non sono canoniche, non modificano il mondo e non devono svelarne la narrazione al giocatore prima dell'applicazione.

### 9.4 Cancellazione, errori e concorrenza

- Propagare `AbortSignal` fino agli adattatori HTTP/LLM.
- Il commit verifica sempre lo stato del job: il solo abort di rete non basta a impedire callback tardivi.
- Mai mantenere una transazione SQLite aperta durante una chiamata LLM.
- Ogni commit atomico salva data, effetti, ordini/progetti, eventi, relazioni/chat e revisione; pubblicare solo dopo il successo.
- Fallimento prima del primo checkpoint: ripristino all'origine, ordini ancora disponibili, errore visibile.
- Fallimento dopo un checkpoint: preservare l'ultimo punto durevole, dichiarare avanzamento parziale e offrire ripresa/rewind. Non «ritentare tutto» riapplicando il passato.
- Save/load/rewind devono coordinarsi con il job; load/rewind invalidano callback e risposte del ramo precedente.
- Chat/advisor ricevono un contesto di revisione stabile. Una risposta tardiva su un ramo cancellato non entra nella memoria corrente.
- Per doppio click/retry HTTP usare chiave idempotente: stessa chiave/stesso payload = stesso job; stessa chiave/payload diverso = conflitto.
- Un altro comando incompatibile sulla stessa revisione riceve `409`, non `200` con coda apparentemente vuota.

---

## 10. API e persistenza proposte

Questi endpoint sono un contratto suggerito; l'LLM può adattare i nomi purché preservi semantica, compatibilità e test.

### 10.1 API

```text
POST   /api/games/:id/actions/queue          registra ordine, nessun salto
PATCH  /api/games/:id/actions/queue/:id      modifica prima della presa in carico
DELETE /api/games/:id/actions/queue/:id      annulla prima dell'emissione
GET    /api/games/:id/actions/queue          coda autorevole con stati
POST   /api/games/:id/actions/enhance        anteprima riformulata (no accoda, no simula)

POST   /api/games/:id/simulations            crea un unico salto
GET    /api/games/:id/simulations/:runId      stato/progresso/checkpoint
POST   /api/games/:id/simulations/:runId/next continua salto esplicito sospeso
POST   /api/games/:id/simulations/:runId/intervene
GET    /api/games/:id/timeline?after=...      cronaca paginata del ramo
GET    /api/games/:id/events                 SSE con cursor/revisione
```

Richiesta auto esemplificativa:

```json
{
  "mode": "next_important_event",
  "actionIds": ["a1", "a2", "a3"],
  "expectedRevision": 42,
  "requestId": "client-request-unique"
}
```

Per un salto fisso: `mode: "until_date"`, `targetDate: "1936-01-01"`. Il server verifica che tutti gli ordini appartengano alla partita/revisione e siano ancora utilizzabili. Gli ordini esclusi dal lotto rimangono in coda, non vengono persi.

Risposta iniziale `202`: `simulationId`, `status`, `startDate`, `revision`. Risultato finale: data effettiva, checkpoint, motivo di stop, eventi applicati, esiti degli ordini, piani residui. Non codificare il successo solo come `processedCount`.

Tutti gli endpoint legacy `/action`, `/actions/process`, `/actions/process-all`, `/time-skip` devono delegare allo stesso orchestratore durante la migrazione. Nessun vecchio pulsante deve poter richiamare il ciclo per-ordine e bypassare gli invarianti.

### 10.2 Entità da persistere

- Coda ordini con ID, testo originale/normalizzato, data, stato, lotto e revisioni.
- Piani/processi con origine, stato, scadenze, costi già contabilizzati e dipendenze.
- Run con modalità, origine/destinazione, revisioni, stato e ultimo checkpoint.
- Eventi con ID stabile, sequenza, cause, effetti e ramo.
- Checkpoint/snapshot con schema versionato.
- Accordi diplomatici con stato e riferimenti ai messaggi/eventi che li fondano.

Usare migrazioni additive e transazionali. I nomi delle nuove tabelle possono essere `pending_actions`, `simulation_runs`, `simulation_events`, `ongoing_processes`, `simulation_checkpoints`, ma la scelta finale deve evitare duplicazioni con lo schema esistente.

### 10.3 SSE, polling e idempotenza del client

Envelope minimo: `gameId`, `branchId`, `simulationId`, `revision`, `sequence`, `eventId` quando applicabile, tipo e payload.

- SSE con `id:`/cursor e recupero dopo disconnessione; se il replay non è possibile, refetch del checkpoint e del delta cronaca.
- HTTP, SSE e polling alimentano lo stesso reducer, mediante upsert per ID server.
- `turn_complete`/chiusura run non ricrea con ID casuali gli eventi già ricevuti.
- Polling attivo durante un job e al recupero della connessione, non solo se `liveSim=true`.
- Ignorare eventi/risposte di altre partite o rami e revisioni più vecchie dello stato già applicato.
- Dopo load/rewind sostituire lo stato canonico e il feed, non fare merge con notizie del futuro eliminato.
- Nessun polling deve avviare una simulazione.

---

## 11. Interfaccia e cronaca

### 11.1 Pannello ordini

- Nazione e data correnti, ordini registrati, compositore, suggerimenti e miglioramento.
- «Registra ordine» non altera il tempo.
- Mostrare chiaramente quanti ordini parteciperanno al prossimo salto.
- «Avanza con questi ordini» apre la scelta della timeline; non esegue un `30` nascosto.
- Al termine aggiornare la coda dal server, distinguendo emessi, in corso, completati e rifiutati.

### 11.2 Timeline di avanzamento

Separare due responsabilità, anche se condividono un pannello:

1. **Navigazione futura:** data adesso, prossimo evento importante, date relative di calendario, personalizzato.
2. **Cronaca passata:** eventi applicati, date, dettagli e collegamenti alle conseguenze.

La selezione di un intervallo è un comando; il click su un vecchio evento è lettura. Non mostrare eventi futuri come già avvenuti.

### 11.3 Lettore eventi

- Data e titolo leggibili, descrizione completa, cause/conseguenze accessibili.
- Mappa aggiornata allo stesso checkpoint, con evidenza delle regioni interessate senza spostamenti obbligatori della camera.
- Controlli Save, Intervene e navigazione dove previsti dal §9.3.
- Dopo auto-jump mostrare «Tempo fermo al …» e «Avanza di nuovo», non «Generazione del prossimo evento» all'infinito.
- La cronaca storica non deve essere limitata irreversibilmente agli ultimi 120 elementi; paginare il registro persistente. Un limite del feed in memoria è ammesso, non la perdita dell'archivio.
- Un evento con due cause compare una sola volta, con due collegamenti.
- Avvisi tecnici, rifiuti di validazione e bollettini economici ordinari hanno sezioni/stili separati; non diventano automaticamente notizie importanti.

### 11.4 Mobile e accessibilità

Mantenere usabili mappa, ordini e stop su schermi piccoli. Pulsante Intervene sempre raggiungibile durante il salto; focus corretto nei dialog, navigazione da tastiera, stato accessibile dei pulsanti. Non basare il successo sul fatto che un utente riesca a cliccare in pochi millisecondi fra due chunk.

### 11.5 Refactoring suggerito

Estrarre da `App.tsx`, se necessario:

- `ActionsPanel.tsx` e un hook/controller della coda;
- `TimelineAdvancePanel.tsx`;
- `SimulationProgress.tsx` / `EventReader.tsx`;
- uno store della simulazione con reducer unico per HTTP/SSE/polling.

Riutilizzare i componenti esistenti quando possibile. Non mantenere nuove e vecchie gestioni concorrenti dello stesso stato.

---

## 12. Diplomazia, memoria, Save e Rewind

### Diplomazia

- Parlare con una nazione non fa passare giorni senza un comando di avanzamento.
- Una proposta è proposta; «non accettiamo il trattato» non è un accordo perché contiene la parola «trattato».
- Registrare impegni confermati, rifiuti e ultimatum con stato, data e origine verificabili.
- Le conseguenze materiali vengono applicate al checkpoint pertinente, non anticipatamente dal parser di parole chiave.
- Una chat aperta dall'evento del 4 dicembre deve avere quella data, non il 1 dicembre ancora presente prima del commit.
- Durante una simulazione, messaggi nuovi devono appartenere a una revisione definita; non mutare retroattivamente il contesto già usato dalla LLM.

### Memoria

- Cronaca e riassunto contengono solo eventi applicati e impegni validi del ramo.
- Progetti in corso e scadenze devono sopravvivere alla finestra degli ultimi cinque turni e alla compattazione testuale.
- Conservare le relazioni causali anche quando il testo vecchio è riassunto.
- Dopo un'azione parziale, i salti successivi riprendono il progetto senza richiedere al giocatore di reimpartire l'intero ordine.
- Non reiniettare eventi annullati tramite la cronologia dell'advisor o trascritti di chat rimasti nel DB.

### Save/Load/Rewind

Snapshot coerente di: calendario, turno, revisione/ramo, mappa ed entità modificate, economia, relazioni, ordini, piani, eventi, chat/impegni, memoria consolidata e stato necessario a riprendere un salto sospeso.

- Save durante la generazione: salva un checkpoint durevole, non una combinazione di mappa futura e data passata.
- Rewind: ritorno all'inizio dell'ultimo salto, non soltanto all'ultimo ordine del lotto.
- Ripristinare anche gli ordini presenti all'origine del salto secondo lo snapshot; eliminare solo quelli nati nel futuro annullato.
- Load/rewind invalidano run/callback del ramo precedente.
- Ricaricamento di una vecchia partita: adapter per campi mancanti e migrazione non distruttiva; niente azioni pendenti inventate.
- Conservare almeno il rewind singolo esistente. Profondità multipla: da confermare sul riferimento, non requisito bloccante aggiuntivo.
- Verificare isolamento fra più partite dello stesso mondo: regioni/relazioni mutabili sono oggi legate a `world_id`; non assumere isolamento senza un test a due partite.

---

## 13. Mappa dei file per gli implementatori

Tutti i percorsi sono relativi alla radice Open-Pax.

| Gruppo | Percorsi da rileggere / modificare secondo necessità |
|---|---|
| Orchestrazione | `backend-nest/src/game-session.ts`, `backend-nest/src/agents.ts`, `backend-nest/src/session-registry.ts` |
| Calendario/economia | `backend-nest/src/core/simulation/calendar.ts`, `WorldStateEngine.ts`, `npc-policy.ts`; preservare le invarianti numeriche esistenti |
| API | `backend-nest/src/routes/games.routes.ts`, `routes/saves.routes.ts`, `routes/chats.routes.ts` |
| Schema/persistenza | `backend-nest/src/database.ts`, `repositories/game.repository.ts`, `world.repository.ts`, `chat.repository.ts`, repository relazioni |
| Generazione | `backend-nest/src/prompt-builder.ts`, `prompts/simulation.ts`, `prompts/converter.ts`, `prompts/types.ts`, `npc-agents.ts` |
| Preset | `backend-nest/data/presets/**/prompts/*`, `rules.md` e loader; modificare solo override che contraddicono la nuova semantica |
| Cancellazione LLM | `backend-nest/src/llm/types.ts`, `router.ts`, `http.ts`, `openai-compatible.ts`, `anthropic.ts` e gli altri provider effettivamente usati |
| Trasporto | `backend-nest/src/sse.ts`, `frontend/src/services/sse.ts`, `frontend/src/services/api.ts` |
| Stato/UI | `frontend/src/App.tsx`, `stores/gameStore.ts`, `stores/actionsStore.ts`, `stores/chatStore.ts`, `types/index.ts` |
| Componenti | `frontend/src/components/Game/HudBar.tsx`, `EventFeed.tsx`, `SaveGameModal.tsx`, `ChatsPanel.tsx`, `AdvisorChat.tsx` |
| Mappa | `frontend/src/components/Map/MapboxMapView.tsx`, `MapView.tsx`: sincronizzazione per revisione, non riscrittura geografica |
| Stili | `frontend/src/index.css`, `frontend/src/editorial.css`: solo adattamenti funzionali |
| Rilascio | `scripts/deploy-cloudflare.sh`, `cloudflare/worker.js`, `cloudflare/wrangler.jsonc`, configurazione del processo backend realmente in uso |

Test esistenti da conservare/adattare consapevolmente: `stage2.test.ts`, `incremental-events.test.ts`, `engine-invariants.test.ts`, `world-state-engine.test.ts`, `chats.test.ts`, `map-features.test.ts`, `prompts.test.ts`, `preset-prompts.test.ts`, `presets.test.ts`, `smoke.test.ts`. La precedente sessione ha eseguito 41 test mirati e build; questo documento non implica che i nuovi requisiti siano già coperti.

---

## 14. Piano di lavoro per più LLM

### Pacchetto A — baseline e contratti, prima di tutto

- Riprodurre G02, G03, G05 e G07 con provider finto e dati isolati.
- Congelare contratti API, stato run, snapshot, eventi ed esiti delle azioni.
- Concordare ID/revisioni/branch, semantica dei checkpoint e migrazione legacy.
- Rilevare il processo backend in produzione e se usa `dist` o sorgenti; non riavviarlo durante l'analisi.
- Output: test rossi riproducibili e breve decision record. Nessuna sostituzione massiva del repository.

### Pacchetto B — backend del salto e persistenza

Dipende da A. Copre G01–G03, G05–G13, G16, G20.

- Un lotto/un salto; zero ordini supportati; coda e piani persistiti.
- Orchestratore, checkpoint atomici, idempotenza e stop.
- Migrazioni e adapter Save/Load/Rewind.
- Endpoint legacy deleganti, niente percorsi per-ordine nascosti.

### Pacchetto C — prompt, causalità e provider

Dipende dai contratti di A; coordinarsi con B sui file condivisi. Copre G07–G08, G12, G17–G18, G21, G24.

- Schemi strutturati, output per evento e limite auto senza contraddizioni.
- Cancellazione e protezione da callback tardivi.
- Piani/scadenze/diplomazia nel contesto; iniziative NPC nello stesso flusso.
- Test con risposta errata, fuori ordine, eccessiva e stream spezzato.

### Pacchetto D — frontend e sincronizzazione

Dipende da A; può procedere con mock del contratto. Copre G04, G14–G15, G19, G22, G24.

- Separazione ordini/avanzamento, timeline e lettore eventi.
- Reducer canonico, deduplicazione, replay/refetch, coda sempre riconciliata.
- Calendario coerente e controlli mobile/accessibili.
- Rimozione dell'interruttore live dal percorso di parità.

### Pacchetto E — revisione, migrazione e rilascio

Dipende da B–D. Copre test completi, confronto §16 e G23.

- Audit dei side effect e dei percorsi alternativi.
- Prove su vecchi salvataggi copiati e due partite isolate.
- Test frontend/backend dietro il percorso Cloudflare.
- Deploy solo su autorizzazione del proprietario e con piano di rollback.

### Regola di collaborazione

Un proprietario per ogni file condiviso. B e C non devono modificare contemporaneamente `game-session.ts`/`prompt-builder.ts` senza coordinamento. D non deve inventare un'API diversa dal contratto approvato. Non usare `git reset --hard`, non cancellare modifiche preesistenti, non fare commit di segreti o DB reali.

Ogni consegna LLM deve riportare:

```text
Pacchetto e requisiti coperti:
File modificati:
Contratti/API/schema cambiati:
Migrazioni e compatibilità:
Test eseguiti con risultato:
Comportamenti Pax verificati / ancora da verificare:
Limiti rimasti e prossima dipendenza:
Stato deploy: non eseguito / eseguito e verificato:
```

---

## 15. Test di accettazione obbligatori

Usare LLM finte con risposte deterministiche per la correttezza meccanica. Le prove con modelli reali misurano qualità narrativa/causalità, non sostituiscono i test di stato. Ogni test deve verificare anche gli effetti NON applicati.

| Test | Scenario | Esito richiesto |
|---|---|---|
| T01 | Partita aperta 90 secondi; GET, polling e riconnessioni SSE | Data, turno e stato materiale invariati; nessuna nuova notizia. |
| T02 | Registrare tre ordini, chiedere suggerimenti/consigli, aprire una chat | Nessun avanzamento del calendario. |
| T03 | Tre ordini, salto di un mese | Una simulazione con tre ordini; un solo turno; destinazione mensile unica, non tre mesi. |
| T04 | Tre ordini, auto-jump con primo evento relativo al secondo ordine | Tutti considerati; stop a quell'evento; gli altri piani restano tracciati senza completamenti fittizi. |
| T05 | Risposta auto: E1 il 4/12, E2 il 10/12, target 1/1 | Solo E1 e i suoi effetti; data 4/12. |
| T06 | Come T05, con `worldChanges`/relazioni/chat/summary di E2 | Nessun effetto o informazione futura in mappa, chat, advisor, memoria e save. |
| T07 | Zero ordini, auto-jump | Il mondo può produrre una svolta plausibile; nessun ordine artificiale registrato. |
| T08 | Coda contenente solo ordini già completati | Comportamento identico a zero nuovi ordini, non risposta vuota bloccante. |
| T09 | Zero ordini, salto esplicito durante una crisi attiva | Passaggio nello stesso motore eventi; la crisi non viene ignorata da `advanceDate`. |
| T10 | Nessun evento nell'auto entro il limite | `no_event_found`, nessun tempo inventato e nessun loop infinito. |
| T11 | Nessun evento nel salto esplicito | Data di destinazione raggiunta, economia coerente, nessuna notizia di riempimento. |
| T12 | Stop a E1 durante un salto fisso | Data/mappa/checkpoint di E1; nessun effetto di E2 dopo conferma server. |
| T13 | LLM invia chunk dopo abort/Intervene | Nessuna mutazione; callback tardivo ignorato. |
| T14 | Save alla lettura di E1 | Load ricostruisce esattamente E1, compresi data/economia/coda e piani. |
| T15 | Rewind di un salto con tre ordini | Ripristino all'origine del salto e degli ordini originali; niente chat/memoria future. |
| T16 | Riavvio backend con ordini accodati o progetto in corso | Gli ordini/piani sopravvivono e non sono eseguiti due volte. |
| T17 | Doppio click, retry dopo timeout e HTTP ripetuto | Stesso job, nessun costo, evento o incremento duplicato. |
| T18 | Due client tentano salti incompatibili | Uno accettato; l'altro conflitto esplicito o riconciliazione idempotente. |
| T19 | Evento via SSE, poi HTTP, poi polling/reconnect | Una sola voce, stesso ID; una sola applicazione degli effetti. |
| T20 | SSE assente o bufferizzato da proxy | Polling recupera stato, mappa, cronaca e coda, anche con live disabilitato. |
| T21 | Errore prima del primo commit | Origine intatta, ordini recuperabili, UI errore senza evento inventato. |
| T22 | Errore dopo E1 persistito | Stato coerente a E1, errore parziale esplicito; retry non riapplica E1. |
| T23 | Data invalida, fuori orizzonte o evento retrodatato | Nessun effetto applicato al record invalido; errore/protocollo gestito. |
| T24 | Due eventi distinti nella stessa data | Ordine stabile per sequenza; auto ne applica uno, salto fisso li può mostrare entrambi. |
| T25 | 31/1 bisestile + mese; 29/2 + anno; periodo con DST | Date secondo §7.3 senza drift. |
| T26 | Due ordini competono per gli stessi fondi | Nessuna doppia spesa, esiti realistici e correlati per ID. |
| T27 | Costruzione annuale e stop dopo tre giorni | Nessun oggetto finito; progetto in corso, progressione coerente nei salti successivi. |
| T28 | Rifiuto diplomatico contenente la parola «accordo» | Non creato un trattato accettato; evento/chat con data corretta. |
| T29 | Riaprire un evento passato e chiudere il lettore | Nessuna mutazione né nuovo salto. |
| T30 | Load/rewind mentre arriva un callback del vecchio ramo | Callback ignorato; nessun merge del futuro eliminato. |
| T31 | Cambiare partita mentre risponde il polling | Nessun evento o stato della partita precedente nella nuova. |
| T32 | Due partite create dallo stesso preset/mondo | Mutazioni e rewind di una non modificano l'altra. |
| T33 | Tutti gli endpoint legacy con `0`, tre ordini e zero ordini | Nessun bypass del contratto, nessun default accidentale a 30 giorni. |
| T34 | Preset con istruzioni di output vecchie/contraddittorie | Regole di tempo e commit rimangono inderogabili. |
| T35 | 30+ salti con consolidazione della memoria | Scadenze e progetti sopravvivono; nessuna amnesia o ripetizione automatica degli ordini. |
| T36 | Budget esaurito a metà salto fisso | Stato parziale segnalato, non destinazione dichiarata raggiunta. |
| T37 | Sessione preesistente con timer live già acceso | Entrando nel flusso di parità il timer viene fermato e non riparte su GET/SSE. |
| T38 | Rilascio pubblico | Build frontend e backend identificabili; stop al primo evento e coda multipla verificati sull'URL pubblico con partita di test. |

Aggiungere unit test su reducer, calendario, parser, esiti per ID e selezione del punto di arresto. Aggiungere integrazione su transazioni, coda/job, route e snapshot; E2E su pulsanti e riconnessione.

Comandi di base, dalla radice del progetto:

```bash
npm --prefix backend-nest run build
npm --prefix frontend run build
npm --prefix backend-nest test
```

Per E2E verificare prima `e2e/package.json` e `e2e/run.mjs`; aggiungere uno scenario dedicato al nuovo contratto. Non eseguire campagne distruttive sui salvataggi reali.

---

## 16. Verifica comparativa con Pax Historia

Prima di dichiarare la parità completa, eseguire con accesso consentito e budget concordato una campagna di prova sul riferimento. Non aggirare login, reCAPTCHA o protezioni. Non usare crediti a pagamento senza autorizzazione.

Registrare schermate/video e una tabella «azione utente → variazione osservata» per:

1. Invio di due o tre ordini alla stessa data e possibilità di modificarli/rimuoverli.
2. Brainstorm, Enhance e distinzione fra accettare una proposta e simulare.
3. Auto-jump con più ordini e senza ordini.
4. Stop, data effettiva e comportamenti successivi alla chiusura di un evento.
5. Salto di un mese/anno, calendario e campo personalizzato.
6. Cadenza reale degli eventi: Next manuale, autoplay, eventuale pausa e controlli disponibili.
7. Intervene durante generazione/playback: quale evento/data rimane canonico.
8. Save durante il salto e successivo Load.
9. Rewind e trattamento degli ordini/chats della linea temporale annullata.
10. Trattative, accordi e loro riflesso nel salto.
11. Periodi senza novità, errori e limiti di generazione.

Salvare risultati in un nuovo file, per esempio `docs/PAX_HISTORIA_VERIFICA_PARITA.md`, distinguendo data/versione del sito e comportamento Open-Pax. Non promuovere una funzione da «da verificare» a «equivalente» basandosi soltanto su questo documento.

Le scelte tecniche interne possono differire dal riferimento. La parità richiesta riguarda il comportamento per il giocatore, non il reverse engineering dell'implementazione privata.

---

## 17. Deploy, migrazione e definizione di completamento

### Rilascio

L'installazione attuale usa un Worker Cloudflare per asset/proxy e un backend Express locale esposto via tunnel. Non è un backend interamente ospitato sul Worker.

Lo script `scripts/deploy-cloudflare.sh` letto compila il frontend, trova il quick tunnel e distribuisce il Worker; non compila né riavvia esplicitamente il backend. Un HTTP 200 su homepage e `/api/health` prova raggiungibilità, non l'avvenuto caricamento della nuova orchestrazione.

Il rilascio futuro deve quindi:

1. Salvare una copia coerente del DB/salvataggi e annotare build/schema/versione precedenti.
2. Verificare che non ci siano simulazioni in corso; pianificare eventuale pausa di servizio.
3. Eseguire test/build e migrazioni sul backend realmente in uso.
4. Riavviare o aggiornare il processo backend con la procedura corretta, verificando anche le sessioni in memoria e i timer precedenti.
5. Distribuire frontend/Worker compatibili col nuovo contratto. Preferire `VITE_API_URL=/api` per usare il proxy same-origin, salvo vincoli verificati; non incorporare URL temporanei del tunnel senza necessità.
6. Usare una versione di API/schema compatibile durante l'aggiornamento non atomico di backend e frontend.
7. Verificare `/api/health` con build ID e almeno T01/T04/T06/T19/T20 sull'ambiente pubblico di prova.
8. Dichiarare il deploy completo solo dopo le prove funzionali. Prevedere rollback applicativo e ripristino dati compatibile con la migrazione.

### Definition of Done

- [ ] Ordini, eventi e avanzamento sono tre concetti separati nell'API e nella UI.
- [ ] Tutti gli ordini del lotto partecipano allo stesso salto.
- [ ] L'auto-jump termina al primo evento importante senza effetti futuri.
- [ ] Il salto a data esplicita funziona anche senza nuovi ordini.
- [ ] Nessun timer reale fa avanzare il percorso standard.
- [ ] Intervene e Save sono affidabili al checkpoint mostrato.
- [ ] Coda, piani, diplomazia e memoria sopravvivono a refresh, riavvio e load.
- [ ] Rewind annulla il ramo futuro coerentemente.
- [ ] HTTP/SSE/polling non duplicano effetti o notizie.
- [ ] Errori e concorrenza non producono stato parziale non dichiarato.
- [ ] Migrazioni preservano i salvataggi esistenti e l'isolamento fra partite.
- [ ] Test automatici ed E2E coprono i requisiti; confronto del riferimento documentato.
- [ ] Backend e frontend pubblici verificati, non soltanto compilati.

---

## 18. Prompt pronto da consegnare al prossimo LLM

> Lavora esclusivamente su `/Users/bovel/Desktop/Open-Pax`. Leggi integralmente `docs/SPEC_PARITA_PAX_HISTORIA_AZIONI_EVENTI_TIMELINE.md` e i sorgenti coinvolti. Il tuo incarico è implementare **il pacchetto [A/B/C/D/E]**, non reinterpretare tutto il gioco. Preserva le modifiche locali e i salvataggi.
>
> L'invariante fondamentale è: più ordini alla stessa data → un unico salto → eventi cronologici → stop al primo evento importante oppure alla data esplicita. Un solo evento NON significa un solo ordine. Nessun timer reale, nessun futuro applicato attraverso worldChanges/chat/narrazione dopo lo stop, nessun doppio commit da HTTP/SSE/polling.
>
> Prima di modificare il codice presenta i file coinvolti, il contratto che mantieni e i test che riproducono il difetto. Distingui comportamento Pax verificato, fonti secondarie e decisioni Open-Pax. Implementa in passi piccoli, aggiungi test positivi e negativi, esegui build/test e consegna il rapporto previsto nel §14. Non fare deploy, migrazioni sul DB reale o consumo di servizi a pagamento senza autorizzazione specifica. Non dichiarare parità completa né deploy riuscito senza le prove richieste.
