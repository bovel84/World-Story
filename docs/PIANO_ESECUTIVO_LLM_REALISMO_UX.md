# World Story — piano esecutivo per LLM: integrità, realismo e UX

**Versione:** 1.0 — 8 settembre 2026. **Stato:** backlog normativo, tutto da verificare/implementare nei pacchetti sotto.

**Repository esclusivo:** `/Users/bovel/Desktop/World Story`.

**Ordine di lettura obbligatorio:**
1. [Audit di conformità](AUDIT_CONFORMITA_PARITA_2026-09-08.md).
2. [Piano maestro, modelli e UX](PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md), integralmente.
3. [Specifica di parità originaria](SPEC_PARITA_PAX_HISTORIA_AZIONI_EVENTI_TIMELINE.md), conservando T01–T38.
4. Il solo pacchetto assegnato e i sorgenti correnti corrispondenti.

## 1. Regole per gli esecutori

### 1.1 Cosa è autorizzato da questo documento

Questo documento descrive il lavoro, non autorizza deploy, consumo di crediti o migrazioni reali. Il proprietario assegnerà un pacchetto. L'LLM esecutore deve:

- lavorare soltanto sul pacchetto assegnato;
- preservare modifiche locali e salvataggi;
- creare test prima del fix quando si corregge un difetto;
- usare DB e scenari temporanei, provider finti e rete esterna bloccata per default nei test;
- consegnare prove ripetibili e limiti, non «dovrebbe funzionare»;
- fermarsi su contratti o dati mancanti: non inventare unità, prezzi storici, API o permessi.

**Vietati:** `git reset --hard`, cancellazione DB, rigenerazione mondi reali, `git add -A` indiscriminato, disattivare test per ottenere verde, tollerare saldo negativo con un clamp, aggiungere `any` ai nuovi effetti, altro strato di CSS globale per ogni bug, invio automatico di ordini suggeriti.

### 1.2 Contratto di consegna di ogni pacchetto

Creare `docs/implementation/<ID>-report.md` con:

```text
Pacchetto / revisore / fotografia iniziale:
Requisiti audit Axx / invarianti Ixx / test Txx e nuovi test:
File letti e modificati:
Comportamento prima (test rosso o prova statica):
Contratto API/schema e compatibilità:
Algoritmo e invarianti mantenute:
Migrazioni eseguite solo su copie:
Comandi test e risultato completo (inclusi fallimenti):
Screenshot/trace se UI, viewport e browser:
Cosa NON è implementato / dipendenze mancanti:
Nessun credito/DB reale/deploy oppure autorizzazione precisa:
Decisione revisore: accettato / da correggere:
```

Un pacchetto si chiude solo quando un revisore diverso controlla test, call path ed effetti vietati. Non chiudere con sola build o screenshot.

**Come leggere i test citati nei pacchetti:** sono requisiti tracciati, non tutti test di integrazione già eseguibili in quella fase. Ogni rapporto separa (a) test locale del contratto, con fixture e collaboratori esplicitamente finti, (b) test integrato ancora bloccato dalla dipendenza successiva. Esempio: M02 verifica i saldi della fixture tramite comandi ledger/riserve; M05 verifica il progresso; solo M06/Q01 verificano il percorso completo ordine → progetto → mappa. Nessun mock `valid:true` può essere portato nel gameplay e nessun test locale viene etichettato E2E. GATE-3 richiede i test integrati R1, non la somma di stub verdi.

### 1.3 Decisioni tecniche congelate per R1

Salvo ADR approvato prima di cambiare:
- TypeScript, Express attuale, SQLite/better-sqlite3; nessuna migrazione a un framework diverso.
- `bigint` nel dominio, stringhe decimali JSON/storage; codec e calcoli comuni.
- Un worker durevole semplice e un writer DB; niente dipendenza obbligatoria da Redis.
- Tick materiale giornaliero UTC; arrotondamenti con carry persistito.
- Priorità del lotto esplicita, tie-break `queueSequence`; niente ottimizzatore opaco.
- Unità monetaria di scenario dichiarata; multi-valuta rinviata finché non esiste il contratto di cambio.
- Nuove partite rigorose separate da legacy; niente conversione automatica PIL→tesoreria.
- Schemi runtime del dominio con libreria già presente se idonea; se serve introdurne una, adottare una sola soluzione (proposta Zod) e schema condiviso/generato, registrandola in F01. Non scrivere validatori diversi in tre livelli.
- CSS Modules per nuovi componenti operativi; token base condivisi, tema esplicito nei portal.
- Vitest backend/frontend e Playwright per i nuovi E2E. Gli script Puppeteer legacy restano leggibili, ma non sono il gate nuovo.

## 2. Sequenza e responsabilità

```text
F00 baseline e regressioni
 ├─ F01 contratti ID + processi
 └─ U01 prototipo/shell su mock (nessuna dipendenza da API inventate)
F01 → F02 checkpoint/rami/ledger-ready
F02 → F03 playback/protocollo → F04 restore/chat
F02 + F03 → F05 job durevoli
F03 + F04 + F05 → F06 stato client e trasporti

F01 → M01 cataloghi e dati → M02 quantità/contabilità
F04 + M01 → M02 chiusura integrazione snapshot
M01 + M02 → M03 preflight (query pure dei prerequisiti, non runtime engine)
M02 + M03 → M04 produzione/logistica
M03 + M04 → M05 progetti/conoscenze
F02–F06 + M03–M05 → M06 integrazione end-to-end
M06 → M07 mandati, servizi, ampliamento R2

U01 + F06 + M03 → U02 ordini/fattibilità
U01 + F06 + M05 → U03 dossier/chat/lettore
F00 → Q01 harness frontend/E2E (avviabile prima; chiusura dopo integrazione)
F04 + F05 + M06 + U02 + U03 + Q01 → Q02 migrazione/sicurezza/rilascio
```

F02 non crea ancora economia attiva: prepara la transazione e l'estensibilità. M02 può sviluppare ledger su fixture isolate, ma la chiusura richiede F04 per estendere restore/snapshot. **M06 è l'unico punto in cui il nuovo motore viene collegato al flusso reale rigoroso**.

**Nessun ciclo implicito di implementazione:** M01 definisce schemi, grafi e stato iniziale; M03 implementa le query pure di conoscenza/capacità/autorità e la stima dei fabbisogni leggendo quel modello, senza dipendere da M04/M05. M04/M05 evolvono nel tempo gli stessi dati e riusano quelle query. Vietati stub «sempre fattibile» per aggirare una dipendenza. F03 consegna contratto/validazione restore; il test completo di restore C06 si chiude in F04, non è dichiarato verde anticipatamente in F03.

| Gate | Condizione per proseguire |
|---|---|
| GATE-0 | Baseline ripetibile, nessun test che tocchi dati reali, ADR e difetti inventariati |
| GATE-1 | F01–F06 accettati: stato, rami, playback, trasporti integri |
| GATE-2 | M01–M05 accettati su fixture numeriche; catalogo pilota validato |
| GATE-3 | M06/U02/U03 e suite Q01 verdi, nessun bypass materiale |
| GATE-4 | Q02, migrazione/rollback su copie e autorizzazione al rilascio |

Non stimare «2 giorni» per un pacchetto senza misure. Ogni pacchetto può richiedere più sessioni. Per LLM con finestra corta, i passi numerati sono micro-consegne separate; non cambiare semantica tra una sessione e l'altra.

**Proprietà file:** un solo esecutore alla volta per `game-session.ts`, `database.ts`, `prompt-builder.ts`, `App.tsx`, store/contratti condivisi. Lavoro parallelo consentito su moduli nuovi con contratti congelati. Nessun merge automatico di due modifiche concorrenti all'orchestratore.

---

## 3. Pacchetti fondamentali

### F00 — Baseline affidabile e regressioni dei rilievi

**Dipendenze:** nessuna. **Audit:** A01–A22. **Output:** test rossi selettivi e piano di evidence, non fix indiscriminati.

**File da leggere:** suite `backend-nest/tests`, `e2e/*.mjs`, package manifest, `database.ts`, route reali; fonte del rilievo specifico.

**Passi:**
1. Registrare HEAD, diff locale e versioni runtime; imporre DB temporaneo e stub provider. Aggiungere un guard test che fallisca se DB path coincide con `backend-nest/data/world-story.db` o URL target è pubblico.
2. Creare helper fixture con date/ID stabili, delayed provider, failpoint DB e cattura SSE. Nessun import del bootstrap che avvia servizi reali.
3. Aggiungere `integrity-regressions.test.ts` e test route per C01–C18 sotto. Riprodurre almeno A01/A03/A05/A07/A10 prima di procedere. Un test che non riproduce il difetto richiede revisione del rilievo, non un'asserzione artificiale.
4. Inventariare tutti i mutatori/endpoint legacy e dove passano. Separare test parser, dominio, sessione, HTTP e browser: non chiamare «E2E pubblico» un handler mock.
5. Aggiornare il rapporto con mapping T01–T38 a test concreto o «non coperto». Non equiparare il titolo di un test al requisito completo.

**Accettazione:** i 224 test della baseline restano superati (eventuali modifiche di contratto sono motivate e revisionate, non regressioni ignorate); regressioni nuove documentate come rosse in ramo di lavoro, poi corrette nei pacchetti pertinenti. Nessun rosso lasciato nel gate release.

### F01 — ID e contratti end-to-end, continuità dei processi

**Dipende da:** F00. **Audit:** A01/A07/A11. **File:** `prompts/types.ts`, `prompts/simulation.ts`, `prompts/converter.ts`, `agents.ts`, `prompt-builder.ts`, `game-session.ts`, `repositories/game.repository.ts`; nuovo `domain`.

**Passi:**
1. Definire schemi runtime per ordine/outcome/project/event proposal e adapter legacy esplicito; propagare `actionId` attraverso conversione batch senza sostituzione del testo originale.
2. Eliminare fallback indice/testo nel percorso nuovo. Outcome mancante/duplicato/ID esterno → protocol error o outcome tecnico non risolto, mai accettazione implicita.
3. Passare i progetti attivi canonici in `buildGameData`, collegati da `projectId`, con date/stato validi. Chiusura/avanzamento per ID; deprecare `completesProcess` per titolo.
4. Formalizzare delivery versus execution status e `queueVersion`; UI legacy riceve adapter documentato finché F06/U02 non la migrano.

**Test:** C01, C07; testi identici, conversione riformulata, ordine composto, ID inesistente, processo nel prompt con zero ordini. **DoD:** non esiste associazione per indice nel percorso canonico; persistenza backward compatible. La progressione materiale completa resta M05, non va simulata con un altro prompt.

### F02 — Checkpoint atomici, revisioni, rami e outbox

**Dipende da:** F01. **Audit:** A02/A09. **File:** `database.ts`, `game.repository.ts`, `game-session.ts`, `sse.ts`; nuovi `CheckpointService`, `EffectValidator` di base.

**Passi:**
1. Migrazioni additive per head branch, revision/queueVersion, checkpoint immutabile, outbox e idempotency hash. Convertire revisioni legacy senza pretendere che fossero globalmente monotone.
2. Estrarre stato di lavoro copiato e `commitCheckpoint(expectedAnchor, changeset)`. Dentro una sola transazione breve: tutti i dati canonici e outbox; nessuna LLM/network.
3. Aggiornare RAM soltanto dal commit riuscito; catch scarta staging. Pubblicatore outbox separato e ripetibile.
4. Introdurre fencing token per callback e CAS al commit; turn increment una volta per run, revision una volta per checkpoint. Nessun fallback alla data/turno di un risultato precedente.
5. Testare crash/errori dopo ogni categoria di scrittura e prima/dopo pubblicazione. Preparare hook per ledger futuro, senza attivare finanza in questo pacchetto.

**Test:** C02/C09/C15; SQLite integrity/FK su fixture; una revisione dopo 3 eventi deve essere inferiore alla successiva revisione ordinaria, mai il contrario. **DoD:** stato intero vecchio o intero nuovo, mai misto; eventi pubblicati soltanto se durevoli.

### F03 — Protocollo playback senza fughe, Next idempotente e casi 0/1/N

**Dipende da:** F02. **Audit:** A03/A04/A06/A10/A11/A14. **File:** run route/repository, sessione, parser, SSE; test playback.

**Passi:**
1. DTO pubblico allowlist: eliminare `pending_state`/raw completion da qualsiasi JSON pubblico, incluso save/getGame/error log accessibile. Testare la ricerca di stringhe segrete E2 nell'intera risposta.
2. Unificare 0/1/N eventi. Schema malformato non diventa successo; budget senza `complete` resta parziale. Outcome/voided/effects ancorati al checkpoint, senza summary del periodo intero a E1.
3. Next richiede checkpointId/revisione/ramo/requestId; Intervene stesso rigore anche con body vuoto. Idempotenza prima del consumo del prossimo evento.
4. Risultati discriminati (`no_event_found`, `awaiting_next`, ecc.) ritornano dall'orchestratore: eliminare `results.at(-1)` come inferenza dell'esito corrente.
5. Solo evento canonico entra nell'outbox notizie. Eliminare effetti globali non datati dalla finalizzazione nuova; adapter legacy incapace di attribuirli deve rifiutare/richiedere output valido, non inventare una data.
6. Consentire restore tramite checkpoint esatto nella API, implementazione di ramo in F04. Cursore archivio per sequence stabile, non solo turn.

**Test:** C03–C06/C10/C11/C14/C16. **DoD:** replay Next non rivela/applica E3; un singolo evento a metà mese è leggibile prima del completamento; zero-evento non riusa una cronaca vecchia.

### F04 — Save/Load/Rewind e chat sicuri per ramo

**Dipende da:** F03. **Audit:** A05/A06/A08/A12. **File:** `game-session.ts`, `session-registry.ts`, repository game/chat/relazioni, saves/games/chats route.

**Passi:**
1. Snapshot versionato completo, inclusa copia esatta del playback privato; una riga run mutevole non è lo snapshot del save. Applicare il manifest/rebinding del maestro §9.4.1: validazione prima della mutazione, niente ripristino di lease/outbox delivery/fencing vecchi. Catalogo assente o hash incompatibile rifiuta restore; crash dopo restore non deve duplicare il comando.
2. Restore checkpoint/save crea ramo con nuovo fencing token e ripristina tutte le collezioni nello stesso servizio transazionale, compresi processing orders e relazioni.
3. Risposta chat/advisor cattura ramo/revisione all'inizio; prima della scrittura verifica validità. Durante run fissare una politica esplicita: draft o `409`, nessuna mutazione del contesto già congelato.
4. Restore E1 deve funzionare dopo E2 e dopo completed/riavvio. Mantiene storico del ramo abbandonato solo in archivio privato separato, mai nei prompt del ramo corrente.
5. L'API ritorna gameId/branch/anchor/snapshot caricati; non costringe il client a indovinare quale partita sia stata caricata.

**Test:** C05/C08/C12/C17 e T14/T15/T30/T32 ampliati. **DoD:** hash semantico di tutti i sottosistemi restaurati uguale al checkpoint scelto, esclusi metadati del nuovo ramo/revisione; risposta tardiva non muta il ramo nuovo.

### F05 — Job asincroni e recupero dopo crash

**Dipende da:** F02/F03. **Audit:** A09/A13. **File:** route games, registry, nuovo `jobs/SimulationJobService.ts`, entrypoint worker, llm/http/router.

**Passi:**
1. POST valida/crea job e risponde 202; nessun await del provider nel percorso HTTP di accettazione.
2. Worker claim/lease e lock per partita con fencing; richiesta ripetuta stessa chiave/hash restituisce stesso job, payload diverso 409.
3. Persistenza transizioni; heartbeat tecnico non avanza gioco. Arresto controllato e abort provider fino agli adattatori, compreso convertitore quando il run lo usa.
4. Lease scaduta → `paused_recovery` all'ultimo checkpoint. Non fare una seconda chiamata pagata automaticamente per «recuperare». Esporre ripresa/chiusura autorizzabile.
5. Endpoint legacy delegano al medesimo percorso o deprecazione esplicita e compatibile; aggiornare contratto client in F06. Non lasciare `/actions/process` capace di aggirare il lotto/validator.

**Test:** C09/C13/C18; provider bloccato per 5 secondi ma POST risponde prima; kill/restart su fixture; retry nessuna seconda generazione. **DoD:** rete/proxy non è il ciclo di vita del job; stato recuperabile indipendentemente dal browser.

### F06 — Unico stato client, reset del ramo e riconciliazione

**Dipende da:** F03/F04/F05. **Audit:** A06/A12/A13/A14. **File:** `App.tsx`, `stores/{game,chat,actions,ui}Store.ts`, nuovo `simulationStore.ts`, `services/{api,sse}.ts`, reader/Hud.

**Passi:**
1. Reducer di snapshot/delta/outbox con scope, world revision, queueVersion, jobVersion e sequence; test pure functions prima di collegare React. A world revision identica, una coda/job più vecchi non sovrascrivono i nuovi. Cambio branch ammesso soltanto dalla risposta valida del comando esplicito corrente.
2. HTTP/SSE/polling inviano azioni allo stesso reducer; connessione separata da stato run; gestione esplicita di tutti gli stati terminali e pausati.
3. Abort + guardia all'applicazione per risposte vecchie. Game switch e restore invalidano anche richieste di chat/advisor/queue/preflight, non soltanto polling cronaca.
4. `replaceCanonicalSnapshot` resetta mappa inclusi objects, coda/progetti/history/news/chat/advisor/reader; archive cache scoped al ramo e paginazione non sovrascritta dal polling.
5. Caricamento save tramite scelta esplicita; Continue-from-checkpoint continua soltanto dopo risposta restore valida e con il suo nuovo anchor.
6. Stop resta raggiungibile se SSE cade; polling job recupera checkpoint; proposte non entrano mai in newsQueue.

**Test:** C12/C14–C18, UI01–UI05. **DoD:** stesso stato finale per tutte le permutazioni HTTP/SSE/polling; vecchio ramo mai visibile/inviato al provider.

---

## 4. Pacchetti di realismo materiale

### M01 — Cataloghi, preset e qualità dei dati

**Dipende da:** F01. **Audit:** A17/A18. **File:** preset loader/editor, `country-facts.ts`, `WorldStateEngine.ts`, `BalanceAgent`, nuovi schema/catalog loader e `data/presets/**/simulation`.

**Passi:**
1. Fixture `realism_test_world` sintetica, deterministica e dichiaratamente non storica. Poi pilota candidato `cold_war_1951`, in una nuova versione del preset, NON modifica delle partite esistenti.
2. Definire manifest/unità/valuta/knowledge/recipes/facilities/provenienza secondo maestro §4. Includere EconomicActor/diritti d'uso e matrice minima di autorità istituzionale R1; il settore privato non è magazzino del governo. Script `validate:scenario` con rapporto JSON e umano.
3. Validare chiusura filiere, DAG, bilanci iniziali, capacità/stock/owner/date, coerenza lore/start_date. Segnalare fonti insufficienti e `unknown`, non fabbricare dati.
4. Separare «storico rigoroso con stime dichiarate» e «ucronico d'autore». Disabilitare bilanciamento di alleanze/potenze non autorizzato nella modalità rigorosa; cache per hash contenuto/schema, non soltanto data/paesi.
5. UI editor: checklist materiali/tecnologia/unità/fonti, errori per campo e anteprima copertura. Nessuna importazione strict se dati bloccanti irrisolti.

**Test:** MAT01/MAT02/MAT18/MAT24/MAT33/MAT34/MAT35. **DoD:** un catalogo pilota completo validato e approvato; se le fonti non sono disponibili, fixture tecnica accettabile per sviluppo ma gate realismo storico ancora chiuso. Non lasciare che un LLM meno capace «riempia i buchi» per chiudere il ticket.

### M02 — Quantità, ledger, riserve e finanza minima

**Dipende da:** M01/F02 per sviluppo persistence; F04 obbligatorio prima della chiusura snapshot/restore. **Audit:** A15/A17. **File nuovi:** quantities, LedgerService, ReservationService, ledger repository/migrazioni; proiezioni national-state.

**Passi:**
1. Codec bigint/currency/resource/rational e unit test limite; rifiutare unità/segni/overflow conversioni UI. Limitare lunghezza numeri in input contro abuso.
2. Ledger monetario bilanciato e movimenti fisici con origine/causale; ricostruzione e riconciliazione di saldi/stock.
3. Prenotazioni: create/consume/release idempotenti e atomiche, consumi senza doppia sottrazione; available separato da total e committed.
4. Stanziamento/cassa/debito/escrow separati. Aggiungere cashflow datati e carry ratei; gestione carenza/arretrato senza cancellare obblighi.
5. Estendere snapshot/restore di F04 PRIMA di collegare i fondi al gameplay. Testare anche default schema legacy sconosciuto.

**Test:** MAT03–MAT06/MAT13/MAT19/MAT36. **DoD:** esempio numerico §7.1 torna esattamente; due client non ottengono la stessa riserva; nessun dato ricavato dal PIL moderno fisso è spacciato per cassa.

### M03 — Interpretazione controllata e preflight del lotto

**Dipende da:** M01/M02. **Audit:** A01/A15/A16. **File:** FeasibilityService, domain schemas, converter, evaluate route; integrazione limitata a preview.

**Passi:**
1. Normalizzazione con ID, union actionKind, target esatti, limiti e quantità. Chiedere chiarimenti prima di aggiungere intenzioni non scritte.
2. Implementare ordine dei gate del maestro §5.3, assessment strutturato e reason codes. Server sceglie ricette/costi ammessi, non quelli inviati dal client/LLM. Implementare qui le query pure allOf/anyOf, proprietà/diritto d'uso, approvazioni e conoscenze/capacità; leggere il modello M01, non attendere gli engine di progressione M04/M05. Missing model data e informazione nascosta sono stati distinti.
3. Eseguire valutazione batch su allocatore temporaneo con priorità e dipendenze; dimostrare conflitti su fondi, materiali e personale.
4. Preview nessuna mutazione né riserva canonica. Persistenza solo della bozza/assessment tecnico se utile; TTL/anchor e invalidazione queueVersion.
5. Alternative sono proposte confermabili; se avvio parziale non autorizzato, nessun avvio parziale nascosto. Ordine qualitativo senza effetti materiali non viene impropriamente bloccato come ricetta mancante.

**Test:** MAT05/MAT07–MAT12/MAT15/MAT20/MAT33/MAT34/MAT35. **DoD:** dato identico → stesso assessment senza LLM; assessment stale non autorizza commit. Registrare resta distinto da emettere.

### M04 — Produzione, energia e logistica

**Dipende da:** M02/M03. **Audit:** A16/A17. **File:** EconomyEngine, LogisticsEngine, inventory/facility/contract repository, cataloghi.

**Passi:**
1. Ricette con consumi/output/capacità/lavoro/energia e durate; estrazione decrementa deposito e produce stock solo dopo lavoro reale.
2. Tick giornaliero su stato di lavoro, resti persistiti, output non disponibile prima del confine temporale. Nessun doppio motore di crescita sui dati strict.
3. Allocazione capacità per intervallo; bottleneck riduce produzione/consumi, carichi fissi solo se definiti.
4. Contratto bilaterale e spedizione: disponibilità seller, escrow buyer, prenotazione, rotta/capacità, partenza, arrivo, perdita/ritardo. R1 passaggio proprietà alla consegna.
5. Test NPC e player con medesimo resolver. Tutte le quantità in transito devono comparire nel bilancio, non sparire o duplicarsi.

**Test:** MAT04/MAT09/MAT13/MAT14/MAT16/MAT17/MAT21/MAT36. **DoD:** filiera chiusa e partita contabile fisica riconciliata; blocco porto/energia ferma effetti, non solo modifica il testo del dispaccio.

### M05 — Progetti a fasi, tecnologia e personale

**Dipende da:** M03/M04. **Audit:** A07/A16. **File:** ProjectEngine, TechnologyEngine, ongoing_processes evoluta, queue/outcomes, scheduler.

**Passi:**
1. WBS/DAG fasi con workload/minDays/budget/input, stati e condizioni di collaudo. Fasi future non anticipano asset né costo non ancora dovuto.
2. Progresso dal lavoro effettivo, assegnazioni materiali/personale/capacità; bloccato se fattori necessari indisponibili. Nessun avanzamento dal numero di eventi LLM.
3. Capability graph separa conoscenza/progetto/produzione/uso/manutenzione; import di bene non concede capacità produttiva.
4. Formazione rialloca personale; ricerca a milestone con seed/stato e costi verificati. Non sbloccare in base al solo anno o al denaro infinito.
5. Annullamento come nuovo ordine, liberazione solo riserve residue, costi sommersi preservati. Dati inclusi nel checkpoint e contesto anche con zero ordini.

**Test:** MAT07/MAT08/MAT10–MAT12/MAT19/MAT22/MAT23; §7.1. **DoD:** progetto decennale non finisce al primo salto breve, impianto non appare al semplice «avviato»; nessuna necessità di reinviare il testo.

### M06 — Collegamento al simulatore e rimozione dei bypass

**Dipende da:** GATE-1 + M01–M05. **Audit:** A15/A16/A17. **File:** TurnOrchestrator, EffectValidator, game-session, agents/prompt-builder/simulation, route legacy, Map projection.

**Passi:**
1. Feature flag server **immutabile per partita/versione modello**. Il client non può selezionare legacy per evitare un vincolo strict.
2. Orchestrare preflight → reservation staging → tick/conseguenze → proposal LLM → effect validation → checkpoint. Le scadenze deterministiche precedono eventi narrativi più tardivi.
3. `build_facility`/`spawn_battalion` non sono più comandi LLM diretti nel percorso strict: la proiezione mappa deriva da progetto/unità verificati. Territorial transfer e movement richiedono resolver/autorità/condizioni del modello, nessun `random`/first-unit fallback.
4. Nessun `worldChanges` assoluto crea PIL/fondi/militare per testo. Tutti gli effetti strict hanno causale e tipi consentiti; qualitative events senza mutazioni restano possibili.
5. NPC, diplomazia, mandati, suggerimenti e advisor usano stato verificato/proiezione informativa appropriata. Stesse risorse per player/NPC, anche su route legacy.
6. Fallback narrativo deterministico soltanto per prosa inaffidabile sopra fatti strutturati già validati. Protocollo, ID o effetti invalidi → errore/pausa all'ultimo checkpoint, mai simulazione riuscita per fallback. Logging reason codes e costo provider. Nessun evento finto sugli errori.

**Test:** MAT25–MAT30/MAT37/MAT38, C03/C04/C10, T26/T27/T35 rafforzati; fuzz schema/ID. **DoD:** audit dei call path non trova alcun mutatore materiale strict fuori dal validatore/commit; prove end-to-end con LLM che tenta esplicitamente di creare beni gratuiti.

### M07 — Delega, servizi e politiche nazionali (R2)

**Dipende da:** M06. **File:** mandate engine, catalogo policy/services, nation UI.

**Passi:**
1. Mandati con tetto, periodo, whitelist, scadenza, fornitori/prezzo; ogni esecuzione cita mandateId e consuma il plafond una volta.
2. Priorità manutenzione/servizi e scorte minime; richieste fuori autorizzazione → decisione giocatore.
3. Politiche istituzionali con iter ed effetti dilazionati; non risolvere riforma sanitaria con incremento immediato «stabilità +10» non motivato.
4. Misurare quante decisioni ripetitive vengono eliminate e quante notifiche si producono. Dashboard predefinita per eccezioni, ledger consultabile.

**Test:** MAT31/MAT32 e replay/restore mandati. **DoD:** giocatore può gestire 20 progetti senza 20 micro-click a ogni salto, ma nessuna autonomia estende il mandato da sola.

---

## 5. Pacchetti grafici e di accessibilità

### U01 — Shell operativa e migrazione CSS per componenti

**Dipende da:** F00; può iniziare con mock congelati. **Audit:** A19/A20. **File:** uiStore, App, Fab, Hud, CSS e nuovi `GameShell`, `CommandSheet`, `AccessibleDialog`.

**Passi:**
1. Prototipo desktop/mobile statico sui dati reali di esempio e token del maestro. Screenshot di tutti gli stati: chiuso/aperto/loading/empty/error/disabled.
2. Un `activeModule` enum al posto di booleans concorrenti. Ingresso/reset partita chiude Nazione; apertura Chat chiude il modulo precedente.
3. Shell grid e dialog con gestione focus/inert/return, safe area e tastiera; registry z-index. Portal eredita tema esplicito.
4. Migrare uno per volta shell, Ordini, Chat, Nazione, Timeline/reader; rimuovere le sole regole sostituite dopo comparazione screenshot. Conservare stile dispacci scoped.
5. Non trascinare nel nuovo CSS un blocco vendor minificato; separarlo e non alterarne i selettori indiscriminatamente.

**Test:** UI01/UI06–UI12. **DoD:** nessun nuovo `!important` nei moduli migrati salvo eccezione motivata del vendor; nessun body nascosto o panel-collapsed ancora occupante spazio; pulsanti ≥44×44 e geometria valida da 320 px.

### U02 — Ordini guidati e catena della fattibilità

**Dipende da:** U01/F06/M03. **File nuovi:** ActionsPanel, FeasibilityChain, BatchConflictSummary, order hooks; App ridotta a composizione.

**Passi:**
1. Compositore libero e chiarimenti senza perdita bozza; review dell'intento e limiti espliciti.
2. Catena con dati/deficit/fonti; dettaglio a elenco su mobile, diagramma accessibile e lista equivalente su desktop. Leggibilità anche senza colori.
3. Conflitti batch e priorità modificabile con bottoni/tastiera, non solo drag. «Registra» non muta tempo/cassa; date/costi stimati distinguibili dai fatti.
4. Alternative a confronto: riduci scala, pianifica ricerca, negozia importazione, posticipa. Nessuna accettazione o chiamata a pagamento silenziosa.
5. Preview stale visibile e ricalcolo; errori di rete conservano bozza/coda e non raccontano un fallimento geopolitico.

**Test:** UI02/UI03/UI07/UI10/UI13/UI15; MAT03/MAT05. **DoD:** utente guidato sa indicare cosa manca, quanto è già impegnato e cosa accadrà al click; footer leggibile con testi lunghi in italiano.

### U03 — Dossier Nazione, chat/accordi e lettore causale

**Dipende da:** U01/F06/M05; contratti commerciali da M04. **File:** NationDock e sezioni, ChatsPanel, EventFeed, SimulationEventReader, SaveGameModal.

**Passi:**
1. Dossier sezioni maestro §10.3, default «decisioni richieste». Selezione provincia non rinomina la nazione; denaro/unità/periodi formattati.
2. Disponibile/impegnato/previsto separati; progetti con fase, lavoro, ostacoli e data condizionata; ledger filtrato tramite causal refs.
3. Chat accessibile con card accordo strutturata; nessun bottone conversa che sottoscrive condizioni senza preview/consenso.
4. Lettore checkpoint con data e ancora, cause/effetti, Save/Intervieni/Continua; archivio separato read-only. Continue-from-checkpoint con conferma e restore verificato.
5. Esperienza touch/tastiera/landscape: un foglio alla volta, lista risorse invece di tabella larga obbligatoria, compositore sopra tastiera, ritorno focus corretto.

**Test:** UI04–UI12/UI14/UI15, C03/C05/C06/C12. **DoD:** Nazione resta chiusa all'ingresso, Chat non ha contrasto carta/navy contraddittorio, vecchia notizia non modifica mappa e non consuma crediti.

---

## 6. Qualità e rilascio

### Q01 — Harness frontend, E2E, accessibilità e performance

**Dipende da:** F00 per avvio; F06/M06/U02/U03 per chiusura. **File:** package frontend/e2e, nuovo Playwright config/fixtures, vitest store test, CI.

**Passi:**
1. `test:unit` frontend, `test:e2e:mock`, `test:a11y` e `test:perf` separati; ogni comando fallisce con exit nonzero alle regressioni. Documentare esecuzione offline/sicura.
2. Provider/HTTP/SSE finti con ritardi, duplicati, disconnessione, eventi segreti e rami; nessun browser aperto sul sito pubblico per default.
3. Fixture DB temporanea e server locale; test completi UI01–UI15, C01–C18 e MAT01–MAT30/MAT33–MAT38 per R1. MAT31/MAT32 richiedono M07 e sono gate R2; la protezione istituzionale minima MAT38 è già gate R1. Rete provider bloccata salvo test LLM autorizzati distinti.
4. Matrice viewport/browser e screenshot stabile, aspettando DOM/map readiness e font. Test screenshot non sostituisce asserzioni DOM/stato/rete.
5. axe + tastiera manuale, Safari iOS/Chrome Android reali per tastiera virtuale e viewport. Audit prestazioni profilo del maestro, chunk splitting dopo baseline.
6. Eval narrativa offline su risposte salvate + eventuale campagna con budget approvato. Criteri: nessun fatto strutturato contraddetto, niente successi gratuiti, cause specifiche, italiano chiaro, zero future leak. Non dichiarare qualità perfetta per tutti i modelli.

**DoD:** ogni test ha fixture, assertion e output; CI esegue backend/frontend/E2E mock senza crediti. Report separa test automatici e verifiche manuali non ancora svolte.

### Q02 — Compatibilità, sicurezza e rilascio coordinato

**Dipende da:** GATE-3. **File:** migrazioni, save adapters, health route, deploy script/Worker, auth/ownership middleware dove necessario.

**Passi:**
1. Provare vecchi save copiati: legacy leggibile, conversione mai implicita, catalog hash coerente; migrazioni ripetibili e test abort/rollback su copia.
2. Inventario endpoint mutanti, ownership e budget LLM. Decidere e implementare protezione single-owner o multiutente prima di esposizione ampliata; test accesso di utente diverso, game ID indovinato e settings provider.
3. Health/version con build ID backend/frontend, schema e modelVersion, senza segreti. API same-origin `/api`; niente URL quick-tunnel incorporato per default nel bundle.
4. Script fail-closed: test/build, backup SQLite coerente, inventario run attivi, maintenance/drain, migrazione, aggiornamento backend, verifica readiness, frontend compatibile, smoke e rollback documentato. Non killare un job alla cieca.
5. Rilascio **solo autorizzato**. Smoke pubblico con partita isolata e budget esplicito se richiede provider reale; in alternativa ambiente staging mock separato, non spacciato per prova LLM produzione.
6. Aggiornare matrice audit/spec con prove e date. Confronto Pax residuo resta una campagna separata autorizzata, non condizione inventata per le nuove funzioni uniche World Story.

**DoD:** upgrade e recovery ripetibili; nessun dato reale modificato senza consenso; E2E pubblico/certificazione hanno ambito dichiarato.

---

## 7. Fixture numeriche obbligatorie

Queste cifre sono **dati sintetici di test**, non stime storiche.

### 7.1 Due cantieri che competono per fondi e acciaio

Data iniziale `1951-01-01`, UTC. Valuta `TEST`, unità minima 1; acciaio in kg. Attore esecutore `treasury-A`, autorizzato dallo scenario a costruire sul sito pubblico:
- cassa 1.000; conto controparte `households-A` inizialmente 0 (riceve i pagamenti di lavoro);
- acciaio consegnato di proprietà pubblica 100 kg;
- competenze, diritto d'uso di sito/personale/energia soddisfatti;
- due addetti qualificati, 300 minuti ciascuno al giorno, pool totale 600 minuti/giorno;
- accumulatore pubblico con 50.000 Wh iniziali e massimo erogabile 5.000 Wh/giorno, nessuna ricarica nel periodo;
- nessun incasso/interesse/imposta/costo fisso/manutenzione nella fixture. I valori iniziali sono approvati dati sintetici, non creati al primo ordine.

Ogni ordine P1/P2 richiede autorizzazione dell'intera prima fase, non lavoro tutto istantaneo:
- lavoro totale 1.000 punti-cantiere, capacità sito 100/giorno;
- 1 punto richiede 6 minuti-persona, 50 Wh e 0,06 kg acciaio; implementare in unità base intere (grammi per la ricetta, kg qui solo esposizione);
- costo totale fase 600, pagamento a households-A di 60 per giornata piena;
- durata minima 10 giorni; asset creato solo a fine fase e collaudo (incorporato nella fine del decimo giorno lavorato in questa fixture).

**Risultati attesi:**
1. Preflight P1 priorità maggiore: P1 fattibile, P2 bloccato da fondi/materiali/capacità. Nessuna riserva e nessuna mutazione durante preview.
2. All'avvio **nello staging**: riserva P1 600 e 60 kg, disponibilità nuova 400 e 40 kg; P2 non prende riserve. Non creare un checkpoint canonico d'avvio nascosto: queste mutazioni diventano durevoli soltanto col prefisso autorizzato. P2 è `issued/rejected` al primo commit del lotto, con ragioni esplicite, e non verrà ritentato automaticamente. P1 è `issued/in_progress`.
3. Con `until_date:1951-01-04`, commit dopo 3 giorni: lavoro 300/1.000; cassa 820; riserva monetaria residua 420; households-A 180; acciaio 82 kg; riserva acciaio 42 kg; libero ancora 400/40; batteria 35.000 Wh; nessun asset. Le riserve proprie sono consumabili da P1, non considerate indisponibili a P1 stesso.
4. Interruzione rete valida su `[1951-01-04,1951-01-05)`: nessuna energia erogabile; zero lavoro/consumo variabile, batteria ancora 35.000 Wh, riserve stock/fondi conservate. Il pool lavoro giornaliero inutilizzato viene liberato; nessuna estensione di slot futuri già occupati. La data avanza solo con comando/Continua autorizzati, progetto `blocked` con ENERGY_SHORTAGE.
5. Rete ripristinata al confine `1951-01-05`, altri 7 giorni lavorati, commit a `1951-01-12`: cassa 400, households-A 600, acciaio 40 kg, batteria 0 Wh, riserve zero, lavoro 1.000 e un asset. La durata effettiva è 11 giorni di calendario per 10 giorni lavorati.
6. Retry dell'ultimo checkpoint: invariato, un asset solo. Cassa tesoro + households rimane 1.000 in ogni passaggio; perdita di acciaio corrisponde a consumo nel cantiere, non cancellazione non spiegata.
7. Restore del checkpoint origine (o rewind dell'unico run se il test usa un solo salto con playback): cassa 1.000, households 0, acciaio 100, batteria 50.000 Wh, asset zero, ordini originari recuperati. Il rewind dell'ultimo fra più salti torna solo alla sua origine, non automaticamente al 1 gennaio.
8. Variante `next_event` con nessun evento importante e risposta completa valida: scartare tutto lo staging, ordini ancora queued, zero riserve, data/turno/revisione materiali invariati. C10 deve provarlo anche con ordini presenti, non solo world-only.

### 7.2 Importazione che non appare prima della consegna

Attori `seller-B`, `buyer-A`, `carrier-C` e conto `escrow-contract-1`. Denaro iniziale buyer/seller/escrow = **100/0/0 TEST**; stock seller/buyer = **30/0 kg**. Quantità 20 kg, prezzo 40 TEST, trasporto gratuito per questa fixture, nessun altro flusso. Carrier autorizzato, capacità 20 kg e 3 giorni di transito: partenza al confine `1951-01-01`, arrivo al confine `1951-01-04`. Proprietà del seller fino alla consegna, custodia del carrier in transito; niente assicurazione.

- Firma/ordine senza salto: nessun movimento canonico, nessun tempo. Le condizioni sono già bilateralmente approvate nella fixture, non dedotte da una chat.
- Esecuzione nel prefisso autorizzato: buyer → escrow 40. Saldi **60/0/40**; riserva monetaria d'acquisto residua **0**, perché convertita in trasferimento a escrow. Non sottrarre altri 40 dalla disponibilità buyer.
- Prima del carico: seller 30 kg di cui 20 riservati, libero 10. Dopo partenza: magazzino seller 10, transito 20 owner=seller/custodian=carrier; buyer 0. La riserva magazzino per il carico è estinta, il lotto in transito non è spendibile altrove.
- Dopo 2 giorni, buyer utilizzabile 0; cantiere dipendente non progredisce.
- Consegna al 4 gennaio: buyer +20 kg, transit 0; escrow → seller 40 una volta. Saldi **60/40/0**, merce seller10+buyer20=30. Eventuale costo carrier è zero per definizione della fixture.
- Variante blocco prima della partenza: staging/checkpoint conservano stock seller30 (20 riservati), buyer0, transit0 e saldi60/0/40; nessun arrivo previsto come fatto. In questa variante contratto consente cancellazione senza penale: ordine esplicito di cancellazione al salto libera 20 e rimborsa escrow → buyer40, saldi100/0/0.
- Variante perdita totale in transito prima della consegna: rischio a carico seller, contratto obbliga rimborso integrale da escrow. Registrare perdita fisica di 20 kg, stock seller10/buyer0/transit0, saldi100/0/0. Nessuna ricreazione dei 20 kg e nessun secondo rimborso su retry. Queste clausole sono dati test, non regola universale del mercato.

### 7.3 Tecnologia importata versus prodotta

A non ha `manufacture.machine-X`, ha `operate.machine-X` e personale di manutenzione; B ha un bene X disponibile. Importazione fattibile se logistica e fondi passano. Dopo consegna A può operare X, ma costruire X resta bloccato. Import di un prototipo non sblocca un intero ramo industriale.

### 7.4 Partizionamento del tempo

Stato uguale, stesso seed e decisioni, nessuno shock esterno nuovo:
- salto di 30 giorni;
- 30 salti da un giorno;
- salto fisso con checkpoint ai giorni 3/10/30.

Confrontare ledger aggregato, stock, costi, personale, progressi e stato RNG; uguali salvo metadati run/checkpoint e numero turno logico. Aggiungere variante impianto completato al giorno 10 che produce nei giorni 11–30: deve produrre anche se non esiste un commit pubblico al giorno 10, perché le transizioni interne avvengono nello staging. Gli ID causali casuali non devono dipendere dal numero di richieste o tentativi di rete. Lo stato RNG viene copiato da checkpoint; branch ID non è un salt aggiunto se la promessa è replay riproducibile delle stesse decisioni.

---

## 8. Catalogo nuovi test di accettazione

Ogni riga richiede anche asserzione degli **effetti non applicati**. **Cxx/MATxx/UIxx sono ID di test**, distinti dai pacchetti Fxx/Mxx/Uxx/Qxx. Non sostituiscono T01–T38 della specifica precedente.

### 8.1 Integrità: C01–C18

| ID | Scenario | Asserzione minima |
|---|---|---|
| C01 | Testi identici, convertiti, outcome riordinati/mancanti | Solo ID corretti; nessun completamento per posizione |
| C02 | Failpoint tra ogni scrittura checkpoint e prima/dopo outbox | DB/RAM interamente vecchi o nuovi; zero notizie false |
| C03 | E2 contiene stringa segreta, GET run/game/save a E1 | Stringa e suoi effetti/outcome assenti in ogni DTO pubblico |
| C04 | Auto E1 con outcome/voided globale riferito a E2 | Processo non chiuso, motivo futuro non canonico |
| C05 | Save E1, Next E2, fine run, Load E1, riavvio | Stesso playback E1 e ordini processing durevoli |
| C06 | Next ripetuto; Intervene vuoto/stale; restore E1 | Un avanzamento solo; 409 per ancora invalida; restore esatto |
| C07 | Progetto attivo, zero nuovi ordini | ID/progetto presente nel contesto e non riaccodato |
| C08 | Chat tardiva durante rewind; ricostruzione relazioni | Nessuna risposta del ramo scartato, relazioni durevoli corrette |
| C09 | Stessa chiave payload diverso; checkpoint multipli poi salto normale | Conflitto e revisioni globalmente monotone |
| C10 | Auto no-event: world-only e lotto con ordini/progetti, con/senza cronaca preesistente | Risposta valida completa → origine/coda/riserve invariate, no_event_found; output incompleto → pausa distinta, niente vecchio risultato |
| C11 | Fixed con 0/1/2 eventi e stream senza complete | Nessuna destinazione presunta; pausa corretta anche con 1 |
| C12 | Restore/load/game-switch con richieste pendenti; stessa world revision ma queueVersion/jobVersion diverse | Reset completo; versioni più vecchie mai sovrascritte alle nuove, branch switch solo autorizzato |
| C13 | POST con provider lento, crash worker, lease scaduta | 202 rapido, recovery checkpoint, nessun retry LLM silenzioso |
| C14 | Anteprima, errore LLM, HTTP+SSE duplicati | Nessun dispaccio verificato non committato |
| C15 | Effetto al giorno 10 su impianto/economia | Impianto non produce nei giorni 1–9 |
| C16 | 3 eventi stesso turno, pagina limit=1 | Tutti recuperati una volta, cursore senza buchi |
| C17 | Save legacy/corrotto, catalogo assente, restore e crash prima della risposta | Rifiuto pre-mutation se invalido; rebinding coerente, processing/carry/RNG corretti; lease/outbox vecchi non rianimati e restore retry idempotente |
| C18 | SSE bloccato/disconnesso, no_event e paused_budget | UI recupera snapshot/job e non nasconde stop per errore connessione |

### 8.2 Materiali e gestione: MAT01–MAT38

| ID | Scenario | Asserzione minima |
|---|---|---|
| MAT01 | Catalogo ciclico, unità errata, risorsa senza definizione | Import strict rifiutato con percorso e motivo |
| MAT02 | Dato storico mancante / preset date-lore discordanti | unknown/errore, nessun fallback moderno silenzioso |
| MAT03 | Importi grandi, centesimi, negativi, NaN/Infinity, input client falsato | Aritmetica esatta o rifiuto; niente arrotondamento nascosto |
| MAT04 | Ricostruzione ledger monetario e fisico | Saldi e stock concordano, ogni trasferimento bilanciato |
| MAT05 | P1/P2 fixture §7.1, anche due client | Nessuna doppia spesa/prenotazione/capacità |
| MAT06 | PIL altissimo, cassa zero, nessun credito | Costruzione bloccata; PIL non pagato come moneta |
| MAT07 | Tecnologia fondamentale assente e fondi abbondanti | Produzione bloccata, ricerca come alternativa confermabile |
| MAT08 | Conoscenza presente, fabbrica/capacità industriale assente | Nessuna produzione, blocker distinto dalla conoscenza |
| MAT09 | Deposito minerario senza estrazione/raffinazione | Nessun input industriale disponibile |
| MAT10 | Personale in due progetti o formazione e produzione simultanee | Allocazione entro pool, nessuna creazione di persone |
| MAT11 | Progetto annuale, stop 3 giorni | Progresso limitato, nessun asset completato |
| MAT12 | Obiettivo ambizioso con possibile prima fase, partialStart false/true | Nessuna fase implicita; solo fasi autorizzate |
| MAT13 | Preflight/registrazione/rimozione coda senza salto | Data/cassa/stock/riserve canoniche invariati |
| MAT14 | Import fixture §7.2, ritardo/porto bloccato | Stock utilizzabile soltanto all'arrivo, seller non infinito |
| MAT15 | Assessment vecchio dopo altra spesa/modifica coda | Revalidate o 409, non commit da preview obsoleta |
| MAT16 | Energia 0 o rete insufficiente | Capacità ridotta/zero con consumi coerenti |
| MAT17 | Produce ricetta con sottoprodotto/scarto e input parziale | Output/consumi conservati, nessun ciclo gratuito |
| MAT18 | Clone stesso anno ma regole diverse, cache balance | Nessun riuso baseline di catalogo/scenario differente |
| MAT19 | Save/Load/Rewind dopo consumo e cancellazione progetto | Riserve residue/costi sommersi e ledger esatti |
| MAT20 | Ordine «ignora limiti» / target ambiguo / polity altrui | Nessun bypass, chiarimento o rifiuto autorizzazione |
| MAT21 | Tick 30 giorni versus 30×1 e tre checkpoint | Uguaglianza materiale §7.4 |
| MAT22 | Ricerca con seed, fallimento, restore/retry | Esito riproducibile per stesse decisioni, nessun doppio costo |
| MAT23 | Import macchinario senza capacità di fabbricarlo | Uso ammesso se operativo, fabbricazione ancora bloccata |
| MAT24 | Salvataggio legacy senza tesoreria/tecnologie | Non attivato strict tramite valori inventati |
| MAT25 | LLM emette build_facility/spawn senza progetto | Zero asset, errore validazione tracciato |
| MAT26 | LLM emette enormi worldChanges positivi fuori ledger | Nessuna mutazione materiale autorizzata |
| MAT27 | NPC vende più di quanto ha o costruisce senza tecnologia | Stesso rifiuto materiale del player |
| MAT28 | Scadenza certa giorno 4, LLM propone primo evento giorno 10 | Motore tratta prima il confine giorno 4 |
| MAT29 | Zero ordini con progetto/logistica in corso | Avanzamento verificato solo dopo comando tempo |
| MAT30 | Contratto discusso in chat ma non accettato | Nessuna consegna, spesa o evento di accordo concluso |
| MAT31 | Mandato budget 100, spese 60+60, retry | Seconda non autorizzata; limite non superato |
| MAT32 | Politica proposta, iter istituzionale non concluso | Nessun effetto fiscale/servizio immediato fittizio |
| MAT33 | Acciaio/cassa/personale nazionali privati, tesoro senza diritto | Nessuna allocazione; contratto/diritto richiesto anche per NPC |
| MAT34 | Via tecnica A mancante ma alternativa B fattibile; riciclo a durata positiva | Solo requisiti della via scelta, conferma sostituzione; nessun ciclo istantaneo amplificatore |
| MAT35 | Deposito nascosto ma modellato versus dato autorevole assente | Prospezione rivela solo nel primo caso; needs_data nel secondo, nessun high opportunistico |
| MAT36 | Escrow fixture §7.2: deposito, annullamento/perdita e retry | Saldi 60/0/40 → 60/40/0 oppure 100/0/0; nessuna doppia riserva/rimborso |
| MAT37 | Fatti strutturati validi con prosa errata versus protocollo strutturato invalido | Solo prosa può usare riepilogo deterministico; protocollo invalido non genera successo |
| MAT38 | Approvazione utente presente, approvazione istituzionale/counterparty assente | Nessun effetto fiscale/proprietario/materiale; proposta conservata, gate R1 |

### 8.3 UI: UI01–UI15

| ID | Scenario | Asserzione minima |
|---|---|---|
| UI01 | Ingresso, refresh, ritorno da menu, apertura modulo diverso | Nazione chiusa all'ingresso, un solo modulo attivo |
| UI02 | Ordine registrato, preview e suggerimento scartato | Nessun tempo/asset/costo materiale cambiato |
| UI03 | P1/P2 in conflitto, priorità cambiata | Riepilogo coerente con server, nessun numero calcolato diversamente in UI |
| UI04 | Notizia storica e checkpoint E1 selezionato | Lettura non mutante, restore esplicito esatto |
| UI05 | Risposte asincrone dopo cambio partita/ramo | Nessuna storia/chat/assessment della precedente |
| UI06 | Solo tastiera: dock, chat, dialog, Escape e ritorno focus | Tutte le azioni raggiungibili; Escape non simula |
| UI07 | 320/360/390 px, testi lunghi italiani, zoom 200% | Nessun overflow shell/form; footer e input non tagliati |
| UI08 | Tablet/desktop e altezza 600 px, pannello espanso | Header/footer stabili, mappa non coperta da pannelli collassati |
| UI09 | Browser Safari iOS/Chrome Android con tastiera e rotazione | Compositore/azione visibili, bozza e scroll preservati |
| UI10 | Contrasto di empty/error/disabled/loading | Soglie maestro, non solo stato normale |
| UI11 | Reflow/400%, reduced motion, screen reader | Alternative testuali alla mappa/catena; niente annunci per token |
| UI12 | Player color chiaro/scuro e tema dispaccio/portal | Chat leggibile, niente override carta sui comandi |
| UI13 | Offline/timeout mentre si valuta o registra | Bozza conservata; retry idempotente, stato tecnico non notizia |
| UI14 | Checkpoint in lettura con Save e SSE assente | Save/Intervieni/Continua raggiungibili, nessun futuro mostrato |
| UI15 | Stesso compito desktop/mobile: deficit → alternativa → priorità → stale preview → registrazione → causa committata | Stessi intenti/limiti server, nessuna funzione nascosta su mobile; bozza/selezione/scroll preservati a resize e tastiera |

### 8.4 Matrice browser e viewport del gate

- Chromium, Firefox e WebKit desktop: 1280×800 e 1440×900.
- Chromium/WebKit emulati: 320×740, 360×800, 390×844, 430×932.
- Tablet: 768×1024 e 1024×768; landscape basso: 844×390.
- Browser reali: Safari iOS e Chrome Android, almeno un telefono per piattaforma, versioni annotate; tastiera virtuale, safe area e ritorno da background.
- Keyboard-only e axe in CI; controllo manuale screen reader del flusso ordine/errore/lettore. Se non disponibile un dispositivo, marcare «non verificato», non sostituire la prova con uno screenshot desktop ristretto.

## 9. Tracciabilità finale e priorità di prodotto

| Blocco audit | Pacchetti responsabili |
|---|---|
| A01, A07 | F01, M05 |
| A02, A09 | F02, F05 |
| A03, A04, A06, A10, A11 | F03, F04, F06 |
| A05, A08, A12 | F04, F06 |
| A13, A14 | F03, F05, F06 |
| A15–A18 | M01–M06 |
| A19, A20 | U01–U03, Q01 |
| A21, A22 | Q01, Q02 |

**Priorità P0:** integrità F, validatore non aggirabile M06 prima di dichiarare realismo rigoroso, nessuna perdita salvataggi/futuro rivelato.  
**Priorità P1:** verticale M01–M05, U01–U03, test Q01; sono parte del primo rilascio usabile, non abbellimenti opzionali.  
**Priorità P2:** M07 e ampiezza cataloghi/R2/R3; non anticipare grafici avanzati/automazioni prima della correttezza.

Funzioni da NON aggiungere nel verticale: decine di tecnologie senza filiere, multipli mercati valutari non calibrati, multiplayer competitivo, albero militare enciclopedico, simulazione individuale degli abitanti, autoplay del tempo. Rimandarle non diminuisce il valore della catena della fattibilità completa.

## 10. Prompt di avvio pronto per un LLM meno capace

```text
Lavora soltanto in /Users/bovel/Desktop/World Story.
Pacchetto assegnato: [ID]. Non eseguire altri pacchetti.

Leggi integralmente:
- docs/AUDIT_CONFORMITA_PARITA_2026-09-08.md
- docs/PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md
- docs/PIANO_ESECUTIVO_LLM_REALISMO_UX.md
Poi rileggi la specifica originaria e tutti i sorgenti del tuo pacchetto.

Prima di modificare:
1. Mostra lo stato locale e le dipendenze del pacchetto. Non cancellare modifiche.
2. Elenca il contratto che implementerai, i file e i test associati.
3. Riproduci il difetto con fixture/LLM finta o indica perché la prova è ancora mancante.
4. Se un dato economico/storico o una dipendenza manca, fermati e documentalo.

Implementa una micro-consegna per volta. Il denaro/PIL, stock/flussi,
conoscenza/capacità e preview/esecuzione sono concetti distinti.
Nessun effetto materiale senza validazione server e commit atomico.
Un ordine non avanza tempo; il mondo avanza solo su comando esplicito.
Nessun futuro in API/news/chat/memoria prima del checkpoint autorizzato.

Non chiamare provider reali, avviare partite pubbliche, migrare DB reali,
fare deploy o riscrivere l'architettura fuori dal pacchetto.
Non modificare test per nascondere una regressione e non aggiungere
fallback di successo, dati inventati o CSS globale per aggirare i problemi.

Alla fine esegui i test pertinenti e la suite di regressione, type-check/build
previsti; consegna docs/implementation/[ID]-report.md con risultati,
limiti e prossima dipendenza. Se UI, allega screenshot/test dei viewport
richiesti. Non dichiarare implementato o verificato ciò che non hai provato.
```

**Primo incarico consigliato:** F00, seguito da F01. Il piano non richiede né autorizza di implementare tutto in una sola sessione.
