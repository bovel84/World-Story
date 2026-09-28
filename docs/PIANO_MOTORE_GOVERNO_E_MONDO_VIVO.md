# World Story — dal consiglio del Governo a un mondo che risponde

Stato: piano e fasi **MG00, MG01, MG02 e MG03 consegnate**, 27 settembre 2026. Il repository contiene la filiera completa — distinta, deficit, autorizzazione, riserve, cantiere, avanzamento, consegna — con 120 test propri. Non è ancora stato giocato un turno con un modello linguistico reale: tutte le prove usano provider simulati o chiamano le funzioni direttamente (§ «limite dichiarato» in MG03). Questo piano non sostituisce i piani E00–E07 sulla cronaca né il piano maestro sul realismo: ne delimita una prima catena giocabile. I riferimenti al codice erano osservazioni del commit `3c87d27`; le fasi consegnate lo hanno superato, e i limiti misurati sono dichiarati nei §§7–11.

## 1. Promessa verificabile

Il Governo descrive problemi documentati della nazione e propone vie alternative, come un consulente radicato nei fatti. Il giocatore sceglie, corregge e autorizza: nessuna proposta spende o costruisce da sola. Un ordine per una strada o un porto deve indicare luogo, tipo, scala, materiali, cassa, competenze, tempi e vincoli di accesso. Se mancano fondi o materiali, il gioco mostra la quantità mancante e percorsi possibili — ridimensionamento, stanziamento, produzione, acquisto o trattativa — senza presentare un accordo o una consegna come già avvenuti. Il cantiere avanza nel tempo solo quando riceve gli input; una volta operativo, il suo effetto entra nei conti e nella mappa. Le altre nazioni possono reagire per interessi e capacità proprie, e le conseguenze confermate entrano nella timeline con un legame causale all'ordine, contratto o progetto.

Questa è una catena di motore, non un cambio del nome «Ordini». Il Governo è la porta di decisione; il motore rimane la fonte di verità; la timeline racconta fatti committati, non suggerimenti o anteprime.

## 2. Diagnosi puntuale dello stato attuale

La UI distingue già proposte strategiche, Governo nel dossier, Consulente e coda degli ordini. Il Governo è una fotografia deterministica delle fazioni e delle loro richieste (`GovernmentFactions.ts`); «Porta in consiglio» apre una bozza in Ordini (`NationDock.tsx`). Le proposte LLM esistono (`prompts/suggestions.ts`), ma il loro testo non certifica fattibilità. Il Consulente è un dialogo privato. L'ordine viene accodato come testo e ID senza imporre l'esito del preflight (`actions.routes.ts`, `OrderExecutionService.enqueue`). Il tempo viene avanzato separatamente.

Il preflight strict conosce identità, autorità, catalogo e alcuni prerequisiti, ma `FeasibilityService.evaluate` non verifica il bilancio materiale del cantiere; la stima `estimateIntentCosts` per `construct` espone solo manutenzione, `timeDays: 0` e nessun input di costruzione. La via legacy stima un addebito economico per categoria testuale (`OrderCost.ts`), non una distinta materiali. La valutazione e il tick strict devono inoltre condividere il medesimo binding del catalogo di scenario: aggiungere soltanto un ID di assessment alla coda non risolve eventuali divergenze fra cataloghi. Non chiamare «fattibile» una costruzione il cui costo di costruzione è ignoto; il risultato va etichettato come parziale/non valutato fino alla modellazione della ricetta.

Nel percorso legacy i `mapChanges` degli eventi sono applicati durante `acceptEvent` (`TurnPipelineService.ts`), mentre `settleOrderCosts` è chiamato più tardi. Quest'ultimo può declassare un esito ad `voided` se cassa e credito non coprono l'ordine. MG00 ha riprodotto questo difetto nel turno legacy con un provider simulato e un evento `start_construction` valido: l'esito diventa `voided` per mancanza di fondi, ma il cantiere resta nella sessione e nel database temporaneo (§9). Questo non misura quanto spesso il provider reale produca l'evento. `WorldMutationService` può anche creare un'opera finita con `complete_construction` senza cantiere precedente, per compatibilità storica: questa scorciatoia non può autorizzare nuovi asset economici senza prova materiale.

Una correzione già mergiata promuove automaticamente un `construction_site` con `plannedType` ed `expectedDate` quando la data arriva (`game-session.ts`, `completeDueConstructions`). Questo risolve la chiusura di alcuni cantieri, **non** prova che gli input siano stati procurati o consumati. Nel mercato delle risorse naturali `executeTrade` sposta cassa e stock del giocatore con una quotazione globale, ma non registra venditore, rotta o accordo; respinge l'acquisto se la risorsa manca del tutto nel ledger nazionale. `trade-agreement` è un impegno diplomatico, non una spedizione quantitativa verificata. `ReactionContext` seleziona gli attori ammissibili, mentre il prompt fa scegliere al modello fra le loro opzioni: una reazione narrata non è di per sé un trasferimento materiale.

I piani del progetto prevedono già molti di questi contratti (`PIANO_MAESTRO_REALISMO_NAZIONALE_UX.md`, §§3, 5–8; `PIANO_TIMELINE_EVENTI_AZIONI.md`, §§4, 9). Non duplicare una seconda verità nel frontend. La forma storica di governo è ancora un tema distinto: cambiare «Ordini» in «Governo» non rende corretto il nome di un esecutivo nel 1815.

## 3. Invarianti del primo ciclo

**MG-I1 — Nessun effetto senza autorizzazione.** Proposta, preflight, bozza e coda sono read/intent state. Solo l'esecuzione ancorata a game, branch, revision e queueVersion può impegnare fondi/materiali o creare un cantiere. Al cambio di stato la verifica si ripete; il lotto non usa due volte la stessa risorsa.

**MG-I2 — Materiali e denaro tracciabili.** Ogni input ha unità e luogo; il disponibile è stock consegnato meno riserve attive. Consumi e pagamenti hanno origine, destinazione, data e ID effetto idempotente. Un pagamento parziale avvia soltanto una fase esplicitamente divisibile e autorizzata; altrimenti il progetto resta bloccato senza opera funzionante.

**MG-I3 — L'opera non nasce dalla prosa.** Un cantiere ha `projectId`, tipo/luogo e fase; nessuna data LLM ne certifica il completamento. Il lavoro avanza con input, capacità e tempo minimo; soltanto il completamento validato abilita l'asset e il suo effetto economico. Gli oggetti legacy vanno letti/migrati con una politica esplicita, senza retro-addebiti inventati.

**MG-I4 — Trattativa ≠ contratto ≠ consegna.** Servono controparte eleggibile, quantità, prezzo, disponibilità, consenso e tragitto. Merce in viaggio non compare nel magazzino del cantiere; rifiuto, embargo, ritardo e insufficienza fondi lasciano uno stato bloccato esplicabile. Il mercato mondiale legacy non si spaccia per una relazione diplomatica.

**MG-I5 — Reazioni causali, non comparse arbitrarie.** Un paese ammesso dal contesto ha un `because`; prima di eseguire un'opzione economica occorrono conti, stock, diritti e limiti propri verificati, non la disponibilità del giocatore. Conserva conti, relazioni e memoria degli impegni anche se non è in chat. Non allargare il filtro indiscriminatamente: correggere il contesto degli attori con dati osservabili e mantenere la guardia sulle chat non pertinenti.

**MG-I6 — Storia controllabile.** La timeline contiene fatti canonici datati con `sourceActionIds`, `projectId` o `contractId`, esito e costo/quantità effettivi; una proposta non vi entra. Preview, SSE, HTTP, polling, reload, salvataggio e playback devono ricostruire lo stesso stato. Gli invarianti E01–E07 su notizie non duplicate, ordini `voided` e salto incompleto restano validi.

## 4. Perimetro e decisioni prima del codice

La prima tranche è **una sola filiera verticale**, non una simulazione economica universale: scegliere una strada *oppure* un porto in un preset e periodo dichiarati, con una ricetta versionata e dati di partenza controllabili. MG00 indica come candidato tecnico `realism_test_world` (strict, data iniziale 1951-01-01, valuta `TEST`) per una **strada sintetica**, non come preset storico o scelta definitiva di bilanciamento. La fixture distingue attori, tesori e stock e possiede acciaio presso `beta_treasury`, non presso ALPHA; però non contiene una strada né una sua distinta di costruzione. MG01 dovrà aggiungere una ricetta versionata, capacità e una misura dell'effetto della strada prima di pretendere un esito giocabile. Un preset storico, la valuta e i costi storici restano decisioni successive fondate su fonti; non importare come prezzi reali i numeri illustrativi del piano maestro. Se il preset non distingue stock consegnato, proprietà, capacità e fondi spendibili, la valutazione deve dare `needs_data`, non promuovere implicitamente il PIL o un deposito a cassa/materiale. Definire se la prima tranche si applica solo alle nuove partite strict; **raccomandazione: sì**, lasciando legacy leggibile e senza retro-addebiti. Estendere legacy è una migrazione successiva esplicita, non un effetto collaterale.

«Governo» è un'interfaccia deliberativa sullo stato, non un nuovo attore onnipotente. Le tre approvazioni distinte restano conferma del giocatore, autorità istituzionale e accettazione della controparte. Per una forma di governo storica corretta occorrono dati datati del motore: non inventarla nel frontend. Mantenere nel percorso di gioco la scrittura libera, la revisione della bozza, la coda, la rimozione e l'avanzamento separato del tempo. La voce di navigazione può cambiare solo quando queste capacità sono equivalenti o raggiungibili.

## 5. Fasi proposte — una PR e un gate per fase

**MG00 — Baseline eseguibile e scelta della fetta verticale.** *Cosa:* congelare commit, preset, modalità, date, ID di partita di prova e schema dati; eseguire in una copia isolata (mai sul salvataggio dell'autore) i casi ordine di costruzione senza fondi, cantiere alla scadenza, acquisto di risorsa non posseduta e turno con possibile reazione. Tracciare ordine → esito → variazioni mappa/tesoro/stock → `turn_results.timeline_events` e, separatamente, `simulation_events`; ripetere avanzamento ordinario e playback. Individuare i punti di commit e scegliere opera e ricetta minima con provenance dei dati. *Attenzione:* il difetto `acceptEvent`/`settleOrderCosts` è ora riprodotto soltanto nel percorso legacy con provider simulato (§9); assenza di chiamate a `createProject`/`authorizeProject` nel codice cercato non prova assenza assoluta di progetto. La copia locale attuale contiene zero cantieri, non i 51 misurati in un'altra fotografia. *Verifica:* fixture e script ripetibili, prima/dopo su stessi ID, risultati classificati confermati/smentiti/non testabili; test automatici ambientati solo dopo aver ripristinato le dipendenze senza cambiare il lockfile. Gate: nessuna correzione basata su una sola inferenza statica.

**MG01 — Contratto di fattibilità per un'opera.** *Cosa:* catalogo server versionato per un tipo e scala di strada/porto, con unità, luogo, materiali per fase, manodopera/capacità, fondi, tempi minimi, manutenzione e fonti; schema runtime dell'intent normalizzato e degli stati `feasible`, `blocked`, `needs_data`. L'endpoint di sola lettura restituisce requisiti, disponibilità, deficit e alternative condizionate, distinguendo stock consegnato, riservato, in viaggio e nel sottosuolo; non muta cassa né data. *Attenzione:* il `construct` attuale con `inputs: []` e `timeDays: 0` non deve ricadere silenziosamente in «fattibile» — la ricognizione di §10 mostra che la funzione pura lo fa già con l'attore giusto, mentre il percorso vivo resta bloccato per la regola di autorità; prezzo e quantità non derivano dal testo LLM. Limitare il primo catalogo ai dati realmente presenti o dichiarare i dati mancanti. *Verifica:* casi quantità/unità errate, fondi insufficienti, capacità assente, risorsa ignota e doppio uso nella preview del lotto; GET ripetute e preflight lasciano lo stato identico. Gate: una ricetta ispezionabile dal server e nessun verde spurio per costi ignoti.

**MG02 — Autorizzazione, riserve e commit atomico del lotto.** *Cosa:* collegare ordine strutturato, bozza rivedibile e valutazione al medesimo anchor (`gameId`, `branchId`, revisione, `queueVersion`), senza eliminare gli ordini liberi legacy; al salto riverificare l'intero lotto con priorità esplicite e riservare una sola volta cassa, lotti materiali e capacità, oppure registrare blocchi. Rendere indivisibile il commit di spesa/riserve, stato d'ordine e avvio della fase; un retry usa ID effetto stabili. *Attenzione:* `assessmentId` oggi non è requisito della coda; richiederlo a tutto il gioco spezzerebbe il flusso esistente. Il settlement successivo ai `mapChanges` va chiuso per la nuova filiera, tenendo conto della perdita di atomicità legacy riprodotta nella sonda MG00, senza assumere che il medesimo percorso sia raggiungibile in strict (§9). *Verifica:* due ordini competono per gli stessi input, due client/stale anchor, retry, interruzione fra staging e commit, `voided` senza cantiere/consumo; confronto delle somme ledger prima/dopo. Gate: nessuna doppia spesa e nessun asset non pagato nella fetta scelta.

> **Consegnata (µ1) — 27 settembre 2026.** Due cose, che erano il prerequisito perché il preflight potesse dire «puoi» e non solo «ti manca»:
>
> **Il blocco di autorizzazione è sciolto, con una regola dichiarata.** La tesoreria
> non aveva alcuna regola R1 per `allocate`: la costruzione restava `blocked` anche
> con cassa e materiali, perché l'unica regola apparteneva all'impresa pubblica
> mentre il percorso vivo usa la tesoreria. Ho aggiunto `auth_treasury_allocate`
> alla fixture con consenso `user`. Il consenso è **dichiarato dal server**, non
> presunto: chiedere la valutazione di un ordine È la decisione del giocatore, e il
> test lo difende — senza quel consenso l'esito torna `blocked`. Gli altri due
> (`institutional`, `counterparty`) restano **non concessi**, perché appartengono a
> un'autorità e a una controparte che nessuno ha interpellato. L'autorità è per
> **tipo** di attore, non per polity: vale anche per BETA, e il test lo dichiara
> invece di lasciarlo implicito.
>
> **Le due rotte di preflight ora leggono lo stesso ledger.** Il difetto misurato in
> MG01 — `check-feasibility` non leggeva affatto, quindi i tre codici di deficit
> erano irraggiungibili da lì e lo stesso ordine aveva due risposte — è chiuso con
> un punto unico, `PreflightReadings.strictReadingsFor`: **quando** si legge, da
> **chi** e **cosa** se ne ricava sono una decisione sola, non due copie da tenere
> allineate. `checkFeasibilityWithCosts` ha ora ramo e modalità economica nel suo
> contesto.
>
> Prova al contrario: tolta la regola R1 falliscono 6 test, tolta la guardia sullo
> stato economico del ramo ne fallisce 1. **138 test verdi su 13 file**, `tsc`
> pulito.
>
> **Consegnata (µ2–µ3) — il cantiere nasce, con le sue riserve.** Due moduli nuovi,
> entrambi verificati su un database vero.
>
> `core/feasibility/WorkPlan.ts` (**puro**) mappa la distinta su un piano che
> `ProjectEngine` accetta: collaudo obbligatorio **sull'ultima fase** (l'asset resta
> `pending` finché non c'è collaudo — invariante MG-I3), id di progetto derivati
> dall'ordine (stesso ordine → stesso progetto, retry idempotente), costo aggregato
> per unità con rifiuto delle valute eterogenee.
>
> `services/WorkCommitService.ts` fa il **commit atomico**: prenota cassa e materiali
> e crea il runtime del progetto, o non fa nulla. Il test provoca un conflitto a metà
> e conta le righe rimaste: senza la transazione esterna le riserve restavano appese
> a un cantiere inesistente — l'ho verificato togliendola, e due test cadono.
>
> **Quattro cose che la misura ha corretto mentre lavoravo, e che l'analisi non
> aveva visto:**
> (a) `withCanonicalTransaction` annida come **savepoint**: un `try/catch` non annulla
> nulla, serve la transazione esterna — la mia prima versione aveva esattamente quel
> buco, e il test l'ha trovato;
> (b) **ALPHA non aveva acciaio affatto**: l'unico lotto era di `beta_treasury`, quindi
> il cantiere non era finanziabile. Ho aggiunto un lotto di proprietà di ALPHA alla
> fixture;
> (c) **chi paga e chi ha la merce sono due attori**, e questa è una separazione reale,
> non teorica: il conto è della tesoreria dell'impresa, utensili e acciaio stanno
> sull'impresa. Il contratto ha ora `holders: { money, materials }` — con un solo
> riferimento la spesa finiva sul conto sbagliato;
> (d) **igiene dei test**: `WorkCommitService` e `project-runtime.repository` toccano
> il database **all'import**, quindi vanno caricati con `await import` dentro i test.
> Con un import statico il test scriveva nel database della copia invece che nel
> temporaneo; c'è ora una guardia che confronta il percorso del database aperto con
> quello atteso. Il database dell'autore è intatto (`0` mondi di prova, `9` partite,
> `0` riserve).
>
> Prova al contrario: tolta la transazione esterna falliscono 2 test, usato un solo
> detentore ne falliscono 4. **126 test verdi su 12 file**, `tsc` pulito.
>
> **Consegnata anche la µ4 — la filiera è chiusa.** L'ordine accettato crea il
> cantiere al salto. L'aggancio è in `WorkCommitTurn.ts`: si guardano **solo** gli
> ordini che dichiarano un'opera del catalogo — la distinta sta nel catalogo, e
> ricavarla dal testo sarebbe far decidere al modello quanto costa un'opera. La
> dichiarazione (`workOrder`: id dell'opera e i due detentori, **nessuna quantità**)
> entra da `POST /actions/queue` e vive sull'ordine; chi non la dichiara ha il
> comportamento di prima.
>
> **Terza revisione indipendente, terza serie di difetti reali.** Un altro agente ha
> tentato di smontare l'aggancio e ha trovato dieci problemi; i tre gravi, verificati
> da me e corretti:
>
> - **(R1) il conto di un'altra nazione era impegnabile.** Con `payerActorId:
>   'beta_treasury'` su un ordine di ALPHA la riserva nasceva sul conto di **BETA** —
>   misurato. Ora i detentori devono appartenere alla polity del giocatore, e il
>   vincolo sta nel motore: il progetto ha già quel binding per gli altri percorsi
>   economici, qui mancava.
> - **(R3) un'opera non finanziata poteva far fallire l'intero salto.** Il blocco che
>   declassa l'esito a `rejected` non azzerava `completesProjectId`, e il ciclo che
>   chiude i processi aperti lancia su un `rejected` che ne porta uno: run `failed`,
>   ordine in coda, nessun cantiere — l'opposto di ciò che il modulo dichiara.
> - **(R4) un ordine respinto dal modello costruiva lo stesso.** I modi di essere
>   respinti sono due — un esito `rejected` **oppure** l'elenco `voided`, che non
>   produce esito — e il gate ne guardava uno solo. Misurato: cantiere nato e
>   `projectId` scritto su un ordine che la narrazione dichiarava respinto.
>
> Corretti anche: l'annullamento non entrava in cronaca, timeline e outbox perché
> l'impegno avveniva **dopo** il calcolo di `voidedHeadlines`; i messaggi del motore
> arrivavano al giocatore con id interni e unità (`wres_…_test: richiesti 20000…`);
> una dichiarazione in partita **legacy** era ignorata in silenzio; e `getHeadBranch
> ?? ''` avrebbe potuto scrivere righe su un ramo vuoto.
>
> Prova al contrario: tolto il vincolo di nazionalità fallisce il test del conto
> altrui, tolta la traduzione fallisce il test del messaggio. **102 test verdi su 8
> file**, `tsc` pulito.
>
> **Consegnate anche µ5 e µ6 — la filiera è raggiungibile dal gioco, e durevole.**
>
> **µ5, la persistenza.** Due colonne, con migrazione idempotente nella posizione
> corretta: `pending_actions.work_order_json` e
> `simulation_action_outcomes.project_id`. La dichiarazione sopravvive al riavvio, il
> legame ordine→cantiere è leggibile dopo un reload, e una riga scritta prima di µ5
> (colonna `NULL`) resta in prosa — il comportamento di prima, non un errore. La
> lettura è **difensiva**: una dichiarazione malformata si scarta, non impedisce la
> ricostruzione della coda. **Migrazione verificata su una copia del database
> dell'autore**: 9 partite, nessuna riga persa, colonne aggiunte. La prima stesura
> aveva le migrazioni **prima** che le tabelle esistessero e il test l'ha trovato.
>
> **µ6, il client.** Il server **risolve** i detentori (`WorkHolders.ts`) e li
> espone con la valutazione; il client li rimanda nella coda e non li inventa — se li
> alterasse, il motore li rifiuterebbe perché non appartengono alla polity del
> giocatore, e c'è il test. Due ruoli distinti, misurati: **il pagatore è la
> tesoreria della polity**, **il detentore dei materiali è chi copre TUTTI i
> materiali dell'opera**, e la tesoreria non fa da magazzino (§4.3.1). Se nessuno
> copre la distinta, non c'è un detentore e si dice quanto manca.
>
> Prova al contrario: tolti i tre controlli dell'aggancio falliscono tre test; tolta
> la scrittura della dichiarazione o del `projectId` fallisce la persistenza; tolta
> la condizione «copre tutti» la risoluzione sceglie un attore a caso. **114 test
> verdi su 10 file**, `tsc` pulito su backend **e** frontend.
>
> **Il gate di MG02 è raggiunto.** «Nessuna doppia spesa e nessun asset non pagato»:
> le riserve sono atomiche e idempotenti, l'ordine dichiarato e coperto crea il
> cantiere, la traccia resta nel database. **Resta un limite dichiarato:** il
> controllo end-to-end del gioco vero — aprire una partita strict, dichiarare una
> strada dall'interfaccia, avanzare il tempo e *vedere il cantiere* — **non è stato
> eseguito**: nessuna delle sonde di questo lavoro ha giocato un turno con LLM reale.
> È il primo passo di MG03.

**MG03 — Cantiere, avanzamento e asset operativo.** *Cosa:* collegare l'ordine autorizzato a un progetto persistito per ID e a un `construction_site` associato, riconciliando il modello dei progetti strict con quello degli oggetti mappa anziché mantenerli indipendenti. Ogni fase consuma input effettivamente allocati, impiega capacità e tempo minimo; blocco e ripresa sono espliciti. Solo collaudo/completamento verificato attiva l'asset e un effetto concreto misurabile (per esempio capacità di trasporto o manutenzione, definito dalla ricetta), non una sola icona. *Attenzione:* `completeDueConstructions` è già mergiato per cantieri legacy datati; per i nuovi progetti non può fungere da scorciatoia che salta input e collaudo. `complete_construction` senza cantiere resta soltanto compatibilità per stati storici, non ingresso per nuove opere economiche. *Verifica:* mancanza di input blocca la fase oltre la data prevista; fornitura e giorni successivi la sbloccano una volta sola; mappa, dossier, economia, salvataggio/ricarica, rewind e playback concordano. Gate: nessun asset operativo prima della condizione di completamento e un effetto osservabile dopo.

> **Consegnata — MG03, 27 settembre 2026.** Il cantiere **avanza**, e alla fine c'è
> un'opera. Era il difetto più grave di tutto il lavoro: `advanceProjects` — il
> percorso dei progetti nazionali — esce subito in partita strict, quindi un
> cantiere nato da `commitWork` restava fermo per sempre, con le riserve impegnate
> e nessun giorno che passava. Un cantiere immobile promette e non mantiene.
>
> Tre pezzi, tre file:
>
> - `game/ProjectWorks.ts` — l'avanzamento. Consuma la distinta della fase (un
>   movimento **vero** nel ledger, `consumo` e `pagamento`, non solo una
>   prenotazione), lavora un giorno per volta commisurato ai giorni minimi della
>   fase, e **persiste** lo stato: il primo giro di test ha trovato che
>   `advancePhaseDay` è pura e l'avanzamento viveva solo nella memoria del salto.
>   Senza materiali la fase **non parte** e il blocco dice quanto manca.
> - `game/WorkDelivery.ts` — la consegna. L'oggetto mappa dell'opera collaudata:
>   tipo finale (non `construction_site`), `status: 'operational'`, data del
>   **collaudo** (non una previsione), `projectId` per il legame causale, e
>   l'**effetto dichiarato dalla distinta** — misurabile, non un'icona.
> - `game-session.ts` — l'aggancio in `advanceWorldState`, nel ramo strict, **prima**
>   del ritorno: avanzamento, collaudo, consegna.
>
> Una decisione di struttura che vale la pena dichiarare: l'avanzamento ha bisogno
> di sapere **chi paga, chi ha i materiali e dove sorge l'opera**, e queste tre cose
> al momento del commit le conosce solo chi crea il progetto. Sono ora una colonna
> (`context_json`) scritta al commit e riletta dal turno: un progetto senza contesto
> **non avanza**, invece di scegliere un detentore a caso.
>
> Difetto trovato dai test, non dall'analisi: la persistenza dello stato. E un
> secondo, dalla prova al contrario: senza la chiamata nel ramo strict, quattro test
> cadono.
>
> Prova al contrario su due guasti indipendenti: tolto l'aggancio al turno
> falliscono 4 test, reso il collaudo implicito ne falliscono 4. **120 test verdi su
> 11 file**, `tsc` pulito.
>
> **Un limite dichiarato, onesto:** l'effetto dell'opera — capacità di trasporto,
> manutenzione — è **dichiarato** nel `metadata` dell'oggetto, ma **non entra ancora
> nei conti**: nessuna ricetta lo consuma, e il motore economico non lo legge. È il
> passo successivo, dopo che l'opera esiste ed è visibile.

 *Cosa:* partire dal deficit di MG01 e proporre produzione/ridimensionamento oppure una richiesta commerciale. La trattativa identifica paese e attore titolare, disponibilità esportabile, prezzo e valuta, autorizzazioni, relazione, rotta/trasporto e tempi; solo l'accettazione verificata crea un contratto con riserve e pagamento definiti. Spedizione, ritardo, perdita/rifiuto e consegna sono transizioni persistite; solo il lotto consegnato e utilizzabile alimenta MG03. *Attenzione:* non riclassificare `ResourceMarket.executeTrade` o `trade-agreement` come import diplomatico completo: il primo è scambio globale legacy senza venditore, il secondo un impegno senza consegna quantitativa dimostrata. La controparte NPC deve rispettare gli stessi limiti materiali, anche se aggregata. Le opzioni «acquista» e «tratta» nel Governo restano percorsi condizionati finché questa fase non è operativa; non promettere che MG05 da sola procuri materiali. *Verifica:* rifiuto, venditore senza scorte, doppia promessa, embargo, rotta assente, insufficienza fondi, ritardo, consegna e retry non creano merce; conservazione per entrambe le parti. Gate: un import accettato e recapitato sblocca una fase, una proposta o chat no.

> **Consegnata (µ1–µ2) — MG04, 28 settembre 2026.** La controparte reale c'è, per la
> parte che si può misurare senza un turno vero. Il piano lo chiedeva in una riga:
> «trattativa ≠ contratto ≠ consegna». Il motore sapeva dire cosa manca a una nazione
> (`Availability.ts`) e sapeva muovere merce fra due punti (`TransitEngine`,
> `createShipmentRuntime`, già consumati dal tick); **non** sapeva rispondere alla
> domanda in mezzo.
>
> `core/economy/TradeOffer.ts` la risponde, con tre vincoli che sono il punto:
> **la disponibilità è dell'NPC, non del compratore** (le scorte di BETA non diventano
> vendibili perché ALPHA ne ha bisogno — MG-I5 applicata al commercio); **ciò che è
> già impegnato non è in vendita** (`available`, non `total`); **il prezzo è
> dichiarato dal catalogo** — se manca, l'offerta non si fa e restituisce
> `needs_price`, invece di inventare un numero plausibile. L'offerta può essere
> **parziale** e lo dichiara: la controparte vende quello che ha.
>
> Un dettaglio che sembra minore e non lo è: il prezzo si arrotonda **in eccesso**.
> Una frazione di unità minima non è un regalo al compratore, e il resto è esplicito
> (§6.1), non nascosto. La prova al contrario lo mostra: arrotondando in difetto, il
> test del prezzo frazionario cade.
>
> Prova al contrario su tre guasti indipendenti: tolto il filtro della polity
> falliscono 2 test, reso il prezzo assente uno zero ne fallisce 1, arrotondato in
> difetto ne fallisce 1. **10 test verdi.**
>
> **Consegnata anche µ3 — il contratto e la consegna.** `TradeContractService.ts`
> esegue il giro che l'invariante MG-I4 descrive, e lo esegue nell'ordine giusto:
> **firma → partenza → arrivo**, con lo stato in un posto diverso ogni volta.
>
> Alla firma il compratore **riserva** la cassa e il venditore **riserva** la merce:
> nessuno ha speso o ricevuto nulla, e la merce non è più disponibile per altri. Alla
> partenza la merce esce dal venditore ed entra in `transit:<id>` — **non** nel
> magazzino del compratore: è sulla strada. All'arrivo entra dal transito al
> destinatario, ed è allora che il pagamento si regola. La partenza e l'arrivo li fa
> il **tick** (`applyDueCanonicalEffects` consuma `shipment_runtime_states`), non
> questa funzione: il contratto dichiara, il tempo esegue.
>
> Perché il venditore riserva e non vende subito: se vendesse alla firma, un contratto
> annullato prima della partenza avrebbe già spostato merce. La riserva è l'impegno,
> la partenza è il fatto — la stessa disciplina che il cantiere usa per i suoi
> materiali.
>
> **I test guardano il LEDGER dopo ogni passo**, non il valore di ritorno: chi detiene
> cosa, prima e dopo. È l'unico modo di distinguere «firmato» da «arrivato», che è
> tutta la differenza che l'invariante difende. Due difetti trovati scrivendoli: il
> primo è che **chi paga non è chi custodisce** (il conto è della tesoreria
> dell'impresa, la merce arriva all'impresa); il secondo è che `runStrictTick` sta in
> `TurnOrchestrator`, non nel producer. Prova al contrario su due guasti: tolta la
> riserva sulla merce, e tolta la verifica di cassa, cadono i test giusti. **9 test
> verdi**, **139 in tutto sui file MG**.
>
> **Quarta revisione indipendente: otto difetti, tutti verificati e corretti.** Due
> erano gravi e nessun test li copriva.
>
> **Il consumo distruggeva merce e denaro.** I movimenti del cantiere uscivano dal
> detentore con `toRef: null`: merce e cassa sparivano dal mondo invece di essere
> spese. Misurato: la somma dei saldi monetari calava di 12000 senza che nessuno li
> incassasse, e l'invariante di `ledger.test.ts` («la somma dei movimenti per unità è
> zero») era violata. Ora i materiali entrano in `site:<progetto>` e la cassa in
> `cost:<progetto>`, e c'è un test che verifica la conservazione.
>
> **Il cantiere si contava contro sé stesso.** La verifica dei materiali usava
> `available`, che sottrae l'impegnato — compreso quello del progetto stesso: un'opera
> coperta al centesimo non partiva mai. Ora la verifica guarda il saldo del detentore.
> Il test lo difende in modo effettivo: esaurisce l'eccesso, verifica che `available`
> sia zero, e pretende che la fase parta lo stesso.
>
> **Il contratto non era atomico e il pagamento non avveniva mai.** `tpay_*` non era
> consumato da nessuno: la cassa del compratore restava riservata per sempre e il
> venditore non incassava — mentre il commento diceva «alla consegna il pagamento si
> regola». Ora c'è `settleTradePayment`, idempotente, e un test che verifica che la
> cassa si muova **davvero** fra i due conti. Corretti anche: la riserva sulla merce
> sull'aggregato di più magazzini (prometteva più di quanto un detentore potesse
> consegnare), e `transportAuthorized` cablato a `true` — la firma autorizzava sé
> stessa.
>
> Restano dichiarati, non corretti: il lavoro perso in un salto che incontra un blocco
> a metà, e un progetto senza `workId` scartato in silenzio. Sono nel piano come
> lavoro aperto.
>
> **Cosa resta aperto in MG04:** il **contratto** (accettazione
> verificata, impegno di entrambe le parti), la **spedizione reale** dal detentore
> alla destinazione con partenza/consegna collegate a `createShipmentRuntime`, il
> pagamento, e l'aggancio al deficit di MG01 — cioè la catena «manca l'acciaio →
> ecco chi ce l'ha → ordino → arriva → la fase si sblocca». Il modulo di oggi
> risponde alla prima domanda; le altre sono la fase successiva.

 *Cosa:* proiettare bisogni verificabili (deficit, costo, fazioni, cassa, progetti, relazioni) in una scheda del Governo; offrire almeno due strade con prerequisiti e conseguenze attese, collegando ogni cifra a snapshot/data/provenienza. La scelta apre una bozza modificabile con preflight, poi la stessa coda e lo stesso controllo del tempo; il Consulente può spiegare, ma non impegnare risorse. Rinominare o sostituire la navigazione «Ordini» solo dopo aver testato l'intero percorso libero e quello assistito. *Attenzione:* una proposta LLM non ottiene autorità per il tono convincente; una raccomandazione che usa dati ignoti è etichettata come ipotesi. Non nascondere gli ordini non infrastrutturali. *Verifica:* stato diverso → opzioni o blocchi diversi; proposta, annullamento e modifica non alterano il mondo; due percorsi conducono allo stesso contratto di ordine. Gate: nessuna capacità attuale di Ordini persa e nessuna spesa prima del salto.

> **Consegnata (µ1–µ2) — MG05, 28 settembre 2026.** Il Governo esisteva come
> **fotografia**: `GovernmentFactions.ts` legge conti, fazioni e memoria politica e ne
> trae uno snapshot che entra anche in cronaca. Ma una fotografia non è una scelta, e
> il piano chiedeva una scheda che proiettasse i bisogni verificabili in **almeno due
> strade**, ognuna con prerequisiti e conseguenze attese, con **ogni cifra collegata
> alla sua provenienza**.
>
> `core/government/GovernmentAgenda.ts` fa quel passaggio, con tre regole:
>
> - **Ogni voce nasce da un fatto misurato** — un deficit che blocca un cantiere, un
>   servizio del debito che mangia le entrate, una fazione che pesa **ed è** scontenta.
>   Niente voci «di atmosfera»: una fazione marginale e serena non entra, e il test lo
>   difende.
> - **Ogni cifra porta la sua origine** (`measured` con la fonte, `estimated` con il
>   metodo, `unknown` con ciò che manca). Un numero senza provenienza non si mostra: è
>   la differenza fra un dato che il giocatore può contestare e una cifra che deve
>   credere.
> - **Almeno due strade, sempre** — la via diretta e almeno un'alternativa con costo
>   diverso (produrre, comprare, ridimensionare; tagliare o crescere; avviare o
>   aspettare). Una via sola non è una scelta, è un ordine travestito.
>
> Il Governo **propone e non impegna**: `canonicalMutation: false` è un campo del
> tipo, non una promessa a parole. La bozza che nasce da una voce passa per il
> preflight e per la coda come qualunque ordine — è l'invariante MG-I1.
>
> Prova al contrario su tre guasti: una via sola per voce, una cifra senza fonte, e la
> fazione marginale ammessa. **11 test verdi.** Una nota di metodo: la prima versione
> del test delle due strade **non** rilevava il guasto — copriva solo le voci presenti
> per caso. È stato rafforzato pretendendo che tutte e tre i tipi di voce siano in
> agenda, ed è la prova al contrario che l'ha rivelato.
>
> **Consegnata anche µ3 — l'agenda legge lo stato vero.** `game/GovernmentReadings.ts`
> raccoglie i fatti — deficit dei cantieri, fazioni, bilancio, debito, opere — e la
> rotta `GET /:id/government/agenda` li espone. Tre vincoli: i deficit dei cantieri
> sono **misurati sul ledger** con la stessa aritmetica del consumo; le cifre che il
> motore non ha **non si inventano**; e leggere l'agenda **non muta nulla** — un test
> conta le righe di ledger e riserve prima e dopo, perché «proposta» e «decisione»
> non devono essere la stessa cosa.
>
> Due difetti trovati scrivendo i test, entrambi del lettore: il primo è che la fase
> attiva ha già consumato la sua distinta, quindi il suo fabbisogno sembrava coperto
> — e una fase già consumata **non** ha un deficit; il secondo è che guardare solo la
> fase attiva fa vedere il problema troppo tardi. Il lettore guarda ora la fase in
> corso **e** quella che sta per partire.
>
> **Un limite dichiarato nel test, non nascosto:** la scelta di guardare anche la
> fase pianificata **non è difesa da un test**. La prova al contrario lo ha mostrato
> — il test passa anche col lettore che guarda solo l'attiva, perché in quello
> scenario l'attiva è scoperta e basta. Per difenderla servirebbe una fixture con la
> fase attiva coperta e quella successiva scoperta. È lavoro dichiarato.
>
> **Consegnata anche µ3 — l'agenda legge lo stato vero.** `game/GovernmentReadings.ts`
> raccoglie i fatti — deficit dei cantieri, fazioni, bilancio, debito, opere — e la
> rotta `GET /:id/government/agenda` li espone. Tre vincoli: i deficit dei cantieri
> sono **misurati sul ledger** con la stessa aritmetica del consumo; le cifre che il
> motore non ha **non si inventano**; e leggere l'agenda **non muta nulla** — un test
> conta le righe di ledger e riserve prima e dopo, perché «proposta» e «decisione»
> non devono essere la stessa cosa.
>
> Due difetti trovati scrivendo i test, entrambi del lettore: il primo è che la fase
> attiva ha già consumato la sua distinta, quindi il suo fabbisogno sembrava coperto
> — e una fase già consumata **non** ha un deficit; il secondo è che guardare solo la
> fase attiva fa vedere il problema troppo tardi. Il lettore guarda ora la fase in
> corso **e** quella che sta per partire.
>
> **Un limite dichiarato nel test, non nascosto:** la scelta di guardare anche la
> fase pianificata **non è difesa da un test**. La prova al contrario lo ha mostrato
> — il test passa anche col lettore che guarda solo l'attiva, perché in quello
> scenario l'attiva è scoperta e basta. Per difenderla servirebbe una fixture con la
> fase attiva coperta e quella successiva scoperta. È lavoro dichiarato.
>
> **Cosa resta aperto in MG05:** il collegamento alla rotta (leggere lo stato vero e
> restituire l'agenda), la bozza che porta la voce scelta nel flusso esistente, e la
> decisione sulla voce di navigazione «Ordini» → «Governo», che va presa **dopo** aver
> verificato che le capacità attuali restino raggiungibili.

 *Cosa:* misurare prima il numero di reazioni candidate, ammesse, narrate e persistite per tipo d'evento e modalità di avanzamento; poi aggiungere al `ReactionContext` gli attori motivati da opera, commercio o territorio, ciascuno con `because`. Prima di offrire opzioni economiche NPC, costruire la proiezione dei **loro** conti, stock, diritti e limiti: oggi `creditHeadroom` passato a `polityOptions` è derivato dalle risorse del giocatore, non del singolo paese. La risposta NPC verificata può cambiare relazione, proporre/rifiutare un contratto o avviare un proprio processo con gli stessi vincoli, anche senza aprire chat. *Attenzione:* non chiamare automaticamente il turno NPC per ogni salto senza una politica su calendario/costi e test di regressione; non riaprire chat irrilevanti risolvendo «il mondo non reagisce». La narrazione non esegue un trasferimento. *Verifica:* attore pertinente reagisce in una fixture, attore estraneo no; reazione senza risorse non produce opera o merce; conti bilanciati, limiti al numero, ordinario/playback e salvataggio coerenti. Gate: almeno una conseguenza NPC reale e attribuibile, senza regressione della guardia sulle chat.

**MG07 — Cronaca causale e percorsi equivalenti.** *Cosa:* pubblicare eventi canonici per autorizzazione/blocco, contratto, partenza/consegna, fase e collaudo, con ID causali e valori **effettivi**; collegare la UI alla notizia e all'ordine/progetto. Definire la fonte canonica e riconciliare le **due rappresentazioni persistite**: `turn_results.timeline_events` alimenta la Timeline del giocatore, mentre `simulation_events` conserva eventi associati ai checkpoint del run; nel turno ordinario questi ultimi sono scritti dagli stessi `turnResult.timelineEvents`, quindi non vanno descritti come semplice telemetria estranea alla cronaca. Integrare, non duplicare, le fasi E02–E06 del piano timeline. *Attenzione:* una previsione non è una notizia; un ordine `voided` non può essere narrato come compiuto, né un salto incompleto pubblicare eventi futuri. Il titolo o l'indice non sostituisce gli ID. *Verifica:* un caso completo riprodotto via HTTP, SSE, polling, reload e playback mostra gli stessi fatti in ordine e senza duplicati; ordini bloccati hanno esito intelligibile senza asset fantasma. Gate: il giocatore risale dalla notizia all'ordine e al costo/consegna che l'ha prodotta.

## 6. Sequenza di consegna e limiti

MG00 precede tutte le modifiche. MG01 → MG02 → MG03 costituiscono la fetta **costruzione interna**; è già giocabile se i materiali esistono nel paese. MG04 aggiunge la via diplomatica ai deficit. MG05 rende il Governo la porta principale senza togliere la strada libera; può iniziare con mock di scheda dopo MG01, ma non essere consegnato come flusso efficace prima di MG02–MG04. MG06 usa gli effetti reali precedenti come cause; MG07 integra la loro storia, mentre gli ID/eventi necessari si definiscono già in MG02. Ogni PR include test delle invarianti toccate e aggiornamento di questo documento con risultato misurato, non soltanto screenshot.

Non rientrano nella prima tranche: catalogo storico completo di ogni infrastruttura e preset, prezzi storici universali, valuta d'epoca inventata, autonomia politica illimitata degli NPC, migrazione automatica di tutti gli oggetti legacy. Questi sono lavori separati dopo dati e metriche. Il piano maestro resta il contratto di lungo periodo, in particolare per attori economici, unità e transazioni; se una fase qui ne richiedesse una semplificazione che viola una sua invariante, fermarsi e registrare la decisione, non introdurre una seconda economia.

## 7. Evidenze, controlli mancanti e criterio di approvazione

Ricognizione statica al commit `3c87d27`: `actions.routes.ts`, `FeasibilityService.ts`, `costs.ts`, `OrderExecutionService.ts`, `TurnPipelineService.ts`, `WorldMutationService.ts`, `game-session.ts`, `ProjectEngine.ts`, `ResourceMarket.ts`, `Commitments.ts`, `GovernmentFactions.ts`, `ReactionContext.ts`, `NpcTurnService.ts`, più `NationDock.tsx` e `DeskContent.tsx`. Il database locale `backend-nest/data/world-story.db` in questa fotografia contiene 9 partite, 3 risultati di turno e 21 `simulation_events`; gli oggetti osservati in `game_regions` includono zero `construction_site`. Non usare come dato attuale i 51 cantieri di una misurazione precedente su un'altra copia. Il conteggio da solo non valida un percorso di gioco.

Nel repository montato i test mirati non sono partiti per il binding nativo `rolldown` mancante (Vite locale `5.4.21`, Vitest `4.1.11`; una sonda `tsx` incontra inoltre un binario `esbuild` macOS su Linux). In una **copia temporanea isolata** del backend, con dipendenze compatibili e DB di test temporanei, sono passati 42 test in quattro file mirati, incluse due asserzioni diagnostiche aggiunte a un test preesistente soltanto nella copia; Non è una suite completa né una verifica verde del repository dell'autore. La riproduzione legacy è confermata nelle condizioni del test; la catena strict ordine→progetto→asset, la parità ordinario/playback e la frequenza delle reazioni in un turno reale restano non verificate o non verificabili con i dati disponibili (§9).

## 8. Controllo indipendente e scarti corretti

Una revisione indipendente in sola lettura ha ricontrollato le asserzioni al commit `3c87d27`. Ha confermato la stima `construct` senza materiali/tempo di costruzione, la coda senza obbligo di assessment, l'ordine di applicazione legacy dei `mapChanges` e del settlement, la promozione dei cantieri per data, il mercato globale senza venditore e i conteggi del database locale; **nessuno di questi controlli statici riproduce da solo un turno**. Ha trovato tre precisazioni sostanziali, applicate qui: `completeDueConstructions` è raggiunta dal ramo legacy (non possiede una propria guardia di modalità); le opzioni di `ReactionContext` ricevono un `creditHeadroom` calcolato per il giocatore e non certificano capacità economiche del paese NPC; `simulation_events` non è soltanto telemetria, poiché nel turno ordinario riceve eventi derivati da `turnResult.timelineEvents`. Ha inoltre segnalato la necessità di verificare che assessment e tick strict usino lo stesso catalogo. Al momento di quella revisione non aveva eseguito la suite né gli esperimenti MG00; le misure successive sono documentate separatamente nel §9, senza attribuirle alla revisione iniziale.

L'autore ha dato l'ok a iniziare con «inizia»; il primo passo concordato è MG00, non l'introduzione immediata di opere, costi o Governo nuovi. La scelta della strada sintetica è una base di test motivata, non l'approvazione di prezzi storici o di una specifica di bilanciamento.

## 9. MG00 — prima baseline isolata (27 settembre 2026)

**Perimetro e ripetibilità.** Snapshot del repository `3c87d27`; nessuna modifica a sorgenti, lockfile o salvataggi dell'autore. Una copia del backend in `/tmp/ws-mg00-501sSs` ha ricevuto dipendenze eseguibili in Linux; i test usano `OPEN_PAX_DB_PATH` su file temporanei. La sonda è una modifica del solo `tests/order-cost-integration.test.ts` **nella copia**: l'evento mock `start_construction` aggiunge una `factory` chiamata «Officina MG00» nella regione Italia dotata di poligono; il test controlla sessione e `game_regions` persistite. Questo è un test che **osserva e asserisce il difetto**, non ancora il test di regressione che richiede la sua assenza. Si può ricreare la sonda partendo dal test omonimo del commit, aggiungendo l'evento e le due asserzioni sulla presenza del sito; nella copia isolata il comando è `cd /tmp/ws-mg00-501sSs && ./node_modules/.bin/vitest run tests/order-cost-integration.test.ts --reporter=dot --hookTimeout=60000 --testTimeout=60000`. Una verifica più ampia sulla medesima copia è stata `./node_modules/.bin/vitest run tests/order-cost-integration.test.ts tests/construction-completion.test.ts tests/m06-strict-integration.test.ts tests/reaction-context.test.ts --reporter=dot --hookTimeout=60000 --testTimeout=60000`: **4 file, 42 test passati**, incluso il test della sonda. Il percorso `/tmp` è effimero: per rendere permanente la riproduzione occorre introdurre un vero test di regressione in una PR successiva, invertendo l'asserzione. I comandi nel repository montato non sono verificabili fino a riparazione delle dipendenze native senza cambiare il lockfile.

**Confermato — ordine legacy senza fondi.** Con provider simulato che restituisce un evento di avvio cantiere valido e con cassa e margine di credito insufficienti a coprire il costo, `processNextAction(30)` produce `outcome.status = voided`, `settlement.kind = unfunded`, `requestedMld = 0.52` e `chargedMld = 0`. Malgrado ciò, «Officina MG00» è un `construction_site` sia nella sessione sia in `game_regions` nel DB temporaneo; il summary dell'outcome continua a dire «L’opera è stata approvata e avviata.». La prova riguarda la combinazione di risposta valida del provider simulato, mutazione mappa e settlement legacy; non misura la probabilità con un LLM reale, non prova che ogni ordine legacy lo faccia e non identifica lo stesso difetto in strict. La prima PR di correzione legacy, se intrapresa, dovrà fallire prima della patch con un test che richiede `voided` → nessun cantiere persistito/nessun annuncio di avvio nel summary, negli eventi e nella `timelineEvents` persistita, e passare dopo; il commit atomico della nuova filiera strict è una fase distinta (MG02).

**Confermato solo nei confini esistenti — scadenza e mercato.** Il ramo strict di `advanceWorldState` passa per `runStrictTick` e ritorna prima della chiamata legacy a `completeDueConstructions`. I test esistenti di completamento mostrano che un cantiere legacy datato può diventare operativo alla scadenza, ma non certificano consumo di input, pagamento o collaudo. Il test legacy `resource-market.test.ts` che riceve `resource_not_held` su una risorsa assente nel ledger non è un test di contratto, spedizione o import diplomatico. Non usare questi due successi per dichiarare realizzata la catena richiesta.

**Non verificato — ordine strict → progetto → asset.** Le funzioni pure di `ProjectEngine` avanzano un progetto quando piano, autorizzazione, lavoro e collaudo sono preparati esplicitamente. Anche `m06-strict-integration.test.ts` precrea e autorizza il progetto e programma il lavoro prima dell'ordine «Continua il progetto verificato»; prova il tick e le sue guardie, non la creazione del progetto da un nuovo ordine. La ricerca nei chiamanti applicativi non ha trovato una catena normale ordine→`createProject`/`authorizeProject`→riserve e consumi→asset mappa operativo. La mancata ricerca positiva non è una dimostrazione d'impossibilità; serve un test di ingresso pubblico su una nuova partita strict con asserzioni su cassa, stock, progetto e mappa.

**Non verificabile qui — parità e reazioni reali.** Una fixture sintetica del contesto produce due polity candidate, due attori interni e `maxReactions = 2`; una proposta sintetica con quattro reazioni mostra che la validazione rileva l'eccesso rispetto al tetto delle polity e segnala un attore sconosciuto. Un unico repair vincolato può ridurre le reazioni, altrimenti l'output è respinto; non esiste un taglio automatico garantito. Questa sonda e i test di `reaction-decisions.test.ts` non fanno parte dei quattro file del comando da 42 test. Questo non è un turno ordinario o un playback reali né una percentuale di reazioni sopravvissute. La fotografia del DB dell'autore conta 9 partite, 3 `turn_results`, 21 `simulation_events`, un run completato e zero `project_runtime_states`/`ongoing_processes`; non contiene due run comparabili né le proposte grezze del modello. Nessuno dei 21 dettagli osservati contiene «Reazioni internazionali». Non si può inferire la parità, una frequenza di reazione o un filtro effettivo da questi soli dati. Per MG06–MG07 occorrono una coppia di run isolati costruiti sullo stesso snapshot e una traccia per fase (candidata, proposta, validata, committata, visibile), distinguendo anche il generatore diplomatico post-commit del turno ordinario dal `ReactionContext`.

**Decisione tecnica per la fetta successiva.** Per MG01 usare inizialmente `realism_test_world` come fixture strict **sintetica**, non un paese storico: `sources.md` dichiara inventati polities, quantità e valuta `TEST`; `initial-state.json` distingue tesori, proprietari, lotti, depositi, capacità e forza lavoro. L'acciaio presente (150 kg) appartiene a `beta_treasury`; ALPHA non lo può trattare come proprio stock consegnato. `facilities.json` e `recipes.json` non specificano una strada, un porto o una distinta per costruirli. La strada di prova, localizzata e con scala/effetto definiti, richiede dunque **nuovi dati espliciti** e verifiche delle unità; se questi dati non sono introdotti, l'esito corretto è `needs_data`. Nessun valore di `TEST` diventa un prezzo o una moneta storica. La decisione di prodotto sul primo preset storico resta aperta.

**Verifica indipendente della baseline.** Un secondo agente in sola lettura ha rieseguito la sonda con timeout espliciti (5/5 test nel file) e la selezione ampia (42/42), controllato i conteggi del DB e trovato quattro rettifiche qui applicate: il comando singolo necessitava di `--hookTimeout`/`--testTimeout`, la sonda modifica un test esistente e non aggiunge un sesto test, la validazione segnala l'eccesso di reazioni anziché tagliarlo automaticamente, e il precedente conteggio di 11 test non era documentato dal log disponibile. Ha inoltre precisato che la futura regressione deve ispezionare la notizia persistita, non soltanto il cantiere. Questa revisione non trasforma la fixture in un turno con LLM reale.

**Gate MG00.** Baseline del difetto legacy raggiunta con un test riproducibile nella copia, confini strict/legacy e lacune di misura dichiarati, candidata tecnica motivata. Non è stata conclusa una prova end-to-end di parità o di import. Prima di chiamare conclusa una fase funzionale occorrono la regressione permanente, dati della ricetta e i gate MG01–MG07: MG00 da sola non rende reale una costruzione.

## 10. MG01 — ricognizione del percorso di fattibilità (27 settembre 2026)

Sonde in sola lettura sul catalogo `realism_test_world` in una copia isolata (`tests/mg01-probe.test.ts` e `tests/mg01-check.test.ts`, **esistenti solo nella copia temporanea**: non sono nel repository e non sono rieseguibili da chi legge questo piano senza rifarle). Nessuna scrittura su database, nessuna chiamata LLM. Servono a stabilire che cosa MG01 deve davvero costruire.

**Il percorso esiste già per metà.** `OrderIntent` normalizza una costruzione con due `targetIds`, un `catalogRef`, priorità, dipendenze e autorizzazione esplicita (`intent.ts`). `FeasibilityService.evaluate` verifica identità, esistenza dei target, regola di autorità R1, requisiti di conoscenza, e per `produce`/`move` l'impianto o il lotto. `estimateIntentCosts` proietta input e durata dalla ricetta. `BatchAllocator.allocateBatch` confronta domanda e disponibilità di fondi, materiali e forza lavoro con priorità e `queueSequence`, e produce `INSUFFICIENT_CASH`, `MATERIAL_SHORTAGE`, `WORKFORCE_SHORTAGE`, `DEPENDENCY_BLOCKED`. Sono tutte funzioni pure, già coperte da test propri.

**Cinque misure che cambiano il piano della fase.** Con il catalogo della fixture:

1. **Il verde spurio esiste come proprietà della funzione, non come comportamento dell'app.** Con l'impresa pubblica e il consenso istituzionale, `targetIds = [ALPHA, ft_works]` e `catalogRef = ft_works`, l'esito è **`feasible`** pur essendo `timeDays: 0`, `inputs: []`, `basis: 'upkeep'`: nessuna disponibilità di fondi, materiali o capacità viene confrontata. Ma quell'attore **non è quello che il percorso vivo usa**: la rotta `evaluate`, `checkFeasibilityWithCosts` e `helpers.ts` scelgono sempre e solo la tesoreria della polity, e nel catalogo della fixture nessuna regola R1 dà `allocate` a una tesoreria. Con la tesoreria, *anche con tutti e tre i consensi*, l'esito resta `blocked`. Quindi oggi il verde spurio è raggiungibile in teoria e non dall'app: **la guardia di MG01 va scritta perché sta per diventare raggiungibile**, non perché il gioco già menta. Il difetto va inoltre corretto in due parti, non una: `ft_works` è l'unico tipo senza manutenzione dichiarata e `costs.ts` risponde `basis: 'upkeep'` con `upkeep: []`, cioè etichetta come «mantenimento dichiarato» un contenuto vuoto.
2. **Le regioni del catalogo non sono i bersagli che il preflight conosce.** `initial-state.json` usa `ALPHA-nord`, `ALPHA-sud`, `BETA-est`, `ALPHA-ovest`, e passare una di esse in `targetIds` produce `UNKNOWN_ENTITY`: `targetKnown` non guarda le regioni. La mappa dichiara i codici `ALP`, `BET` e il manifest **non ha** `regionIdBinding`. Il meccanismo però **esiste ed è completo**: `RegionIdBinding` nei tipi, il resolver in `WorldMapAssets.ts`, la validazione bloccante del binding dichiarato nel loader. Il lavoro è **dichiarare** il binding nella fixture e far usare il resolver al preflight. Due vincoli da rispettare: `ARITY.construct = 2`, quindi la coppia resta [regione, tipo d'opera] e la regione non può essere l'unico bersaglio; e gli id di regione *world-scoped* sono `<worldId>_<codice>` con `worldId` esadecimale generato (`shortId`), mentre `INTENT_ID` vuole una lettera iniziale — un mondo su circa due produce oggi un id che il normalizzatore rifiuta. Il binding va verificato contro `normalizeOrderIntent`, non solo contro `targetKnown`.
3. **La valuta della fixture ha un aliasing silenzioso, non un rifiuto.** Il manifest dichiara `currency.id = "TEST"`, `isIdString('TEST')` è **falso** (il codec vuole `[a-z]`), e `ledgerUnitId()` **normalizza prima di validare**: `'TEST'` → `'test'` non fallisce mai. Il loader confronta `treasury.currencyId` con la stringa letterale del manifest, quindi non segnala nulla. Il rischio non è l'errore: è che `TEST` e `test` — o due valute di catalogo diverse — finiscano sulla **stessa** unità di ledger senza che nessuno le confronti. L'unità canonica va derivata e dichiarata una volta, e il confronto va fatto sull'unità, non sulla grafia. (Il sospetto sulle parole chiave SQLite è stato **misurato e scartato**: su SQLite 3.53.2 `test` e `TEST` funzionano come nomi di colonna e come letterali in un `CHECK`; l'unico errore reale è dichiararli entrambi nella stessa tabella.)
4. **Chiudere la filiera non basta: nessuno la chiama.** `allocateBatch` ha una sola occorrenza in `src/` — la propria definizione — e nessun import: il suo unico uso è un test. `facts.requirements` compare solo nell'interfaccia e in un test. `knowledgeIds` e `capabilityIds` sono costanti vuote nei due punti applicativi. Di conseguenza il grafo in `technologies.json` viene validato ma mai consultato: un requisito di conoscenza non bloccherà nessuno finché una fase non lo collega. Il buco è **più ampio e più grave** di così: mancano i produttori del runtime d'ingresso — `createProject`, `authorizeProject` e `activatePhase` non hanno chiamanti in `src/`, e `pendingAssets`/`activatedAssets` sono letti solo dentro `ProjectEngine.ts`. Il percorso strict è chiuso su due anelli, quello della valutazione e quello del progetto.
5. **Il conto della fixture non è raggiungibile dai read-model.** La rotta `evaluate` carica il catalogo dal `template_id` del mondo e valuta in sola lettura, quindi il meccanismo c'è. Ma `realism_test_world` non è il `template_id` di alcun mondo nel database locale: la rotta esiste, il binding la esclude. Serve una partita di prova costruita sulla fixture, non l'apertura di una partita esistente.

**Conseguenza per MG01.** La fase non consiste nel costruire da zero un motore di fattibilità: consiste nel dare al percorso esistente (a) una **distinta di costruzione** autorevole, (b) un **binding di regione e valuta** che il preflight sappia risolvere, (c) le **letture di disponibilità** da ledger e riserve, (d) il **produttore dei dati mancanti** che oggi non esiste, e (e) la **guardia** che rende `needs_data` un costo non dichiarato. Il perimetro raccomandato è una PR con la distinta minima completa e i suoi test; le fasi ulteriori restano come in §5.

**Forma dei dati — CONSEGNATA nella prima parte, il 27 settembre 2026.** Il punto delicato, misurato: un blocco di costruzione **non va messo dentro `recipes.json`**. Il loader accetta una ricetta di costruzione (`facilityTypeId` noto, `durationDays ≥ 1`, input già giustificati) e **ignora in silenzio** i campi che non conosce: `ok: true, errors: [], warnings: []`. In più la chiusura transitiva delle filiere si costruisce sugli **output** delle ricette, e una strada non produce una risorsa: con `outputs: []` la ricetta non giustifica nulla, e inventare una risorsa «strada» la farebbe comparire come prodotta e mai consumata. Serve quindi una **sezione di catalogo propria per le opere**, con la stessa disciplina di `recipes.json` (validazione bloccante, riferimenti risolti, campi ignoti rifiutati), e la distinta di costruzione deve mappare su `ProjectPhase`, che ha già `workload` (obbligatorio e positivo), `minDays`, `budget`, `inputs`, `assetId`, `requiresCommissioning`. Due traduzioni da dichiarare, non da improvvisare: la durata autorevole è **una sola** fra il `durationDays` di una ricetta e il `minDays` di una fase, altrimenti stima e tick possono divergere; e gli id di fase passano dal codec minuscolo (`isIdString`) mentre i `targetIds` dell'ordine accettano maiuscole — il contratto attraversa due codec diversi e deve dirlo. L'intento resta quello già normalizzato: `actionKind: 'construct'`, `catalogRef` = tipo d'opera, `targetIds` = [regione risolta, tipo d'opera].

**Casi di prova da scrivere prima della distinta** (in una copia, poi nella PR): fondi sotto il costo → `INSUFFICIENT_CASH`; materiale assente dal ledger → `MATERIAL_SHORTAGE`; qualifica non disponibile → `WORKFORCE_SHORTAGE`; tipo d'opera ignoto → `UNKNOWN_ENTITY`; distinta assente → `needs_data` e **non** `feasible`; campo ignoto nel catalogo dell'opera → validazione **bloccante**; due ordini sulla stessa scorta nel lotto → il secondo bloccato senza consumo parziale; GET ripetute e preflight lasciano cassa, stock e data identici. Due avvertenze sui casi di prova: `needs_data` è prodotto **solo** da `modelDataMissingIds`/`hiddenFromPlayerIds`, oggi vuoti in ogni chiamante e calcolati da nessuno — senza un produttore il caso di prova sarebbe verde per costruzione del test, non per comportamento del percorso; e `estimateIntentCosts` non sa esprimere «dato mancante», perché `basis: 'none'` con `timeDays: 0` è identico a una ricetta autorevole a costo zero.

**Ciò che resta non verificato dopo MG01.** Nessuna di queste sonde esegue un turno con LLM reale, accoda un ordine o committa: l'esito è della funzione pura, non del gioco. L'esecuzione dell'ordine, la riserva, il cantiere e l'asset restano MG02–MG03.

> **Consegnata (prima parte) — 27 settembre 2026, MG01 µ1–µ2.** Tre cose, in una PR
> pronta per l'autore: la sezione di catalogo `works.json` con la sua validazione,
> la stima di un `construct` che legge la distinta, la guardia che rende `needs_data`
> un costo non dichiarato. Prova al contrario fatto: togliendo la guardia falliscono
> «senza distinta la valutazione è needs_data», «la stima legge la distinta» e «un
> campo ignoto è un errore»; con le correzioni i 17 test del file passano, insieme ai
> 37 dei cinque file toccati (catalogo, stima, fattibilità, intent, rotta evaluate).
> `tsc` pulito su `src/`.
>
> **Cosa la misura ha smentito durante il lavoro, e che l'analisi non aveva visto:**
> (a) gli input della stima restano **per fase** e non fusi in un totale — il primo
> test che avevo scritto pretendeva la somma, e la somma è una proiezione da
> calcolare, non il dato; (b) `w_road` senza una voce in `facilities.json` sarebbe
> stato un tipo d'asset inesistente, e il loader l'avrebbe giustamente rifiutato;
> (c) `works.json` è **opzionale**, altrimenti gli altri due preset del repository
> (che non lo hanno) si rompevano; (d) la chiusura delle filiere del loader gira
> **dopo** il calcolo di `justified`, e la validazione delle opere va prima: metterle
> nello stesso punto dava un `ReferenceError`, non un test rosso.
>
> **Decisione di struttura.** Le regioni della fixture sono state lasciate come sono
> (`ALPHA-nord`, `BETA-est`) e **non** riscritte nei codici della mappa: riscriverle
> avrebbe corretto un test verde (`map-p6-world-assets.test.ts`) invece di aggiungere
> la capacità mancante. Il binding resta il lavoro di µ3.
>
> **Seconda revisione indipendente, sul codice questa volta.** Un altro agente ha
> tentato di smontare il diff e ha trovato **cinque difetti reali**, tutti verificati
> da me prima di correggerli e tutti coperti da un test che ora li difende:
> (D1) un `works.json` con `phases` o `inputs` non-array **faceva crashare il loader**
> con un `TypeError` — sulla rotta di import di un preset, un 500 invece di un rifiuto
> motivato; (D2) il rifiuto dei campi ignoti era solo epidermico: copriva opera e fase
> ma **non** effetto, manutenzione, materiali, fondi, manodopera e provenienza;
> (D3) la manutenzione d'opera accettava `0` e negativo, mentre i suoi fratelli no;
> (D4) il nome della fase non era validato pur essendo obbligatorio nel tipo e
> propagato in `CostEstimate.phases`; (D5) l'asserzione sulla rotta era una
> **tautologia** — passava anche senza la guardia, perché la tesoreria resta comunque
> bloccata per autorità, e nessun test del repository costruiva un `construct` con
> `catalogRef` di tipo d'impianto. Il revisore ha anche smentito tre affermazioni dei
> miei commenti, corrette qui. Prova al contrario rifatta guasto per guasto: tolto D1
> fallisce «un catalogo malformato è un rifiuto», tolti D2–D4 falliscono i due test
> dei sotto-oggetti e dei fratelli, tolta la guardia fallisce il test del `needs_data`.
>
> **Consegnata anche la seconda parte — MG01 µ3, 27 settembre 2026.** Il deficit
> ora è **misurato**: `Availability.ts` confronta la distinta con le letture del
> ledger e produce `INSUFFICIENT_CASH`, `MATERIAL_SHORTAGE`, `WORKFORCE_SHORTAGE`
> con richiesto, disponibile e mancante per unità, più la fase che scopre il
> debito. `FeasibilityReadings.ts` legge dal ramo i saldi e le giacenze **del
> detentore**, al netto delle riserve attive, in una sola ricostruzione. La rotta
> `evaluate` legge il ledger per le partite strict, ma **solo se il ramo ha già
> uno stato economico**: il bootstrap avviene al primo turno, e leggere un ledger
> vuoto direbbe «disponibili 0» su una cassa che il catalogo dichiara piena.
>
> **Quattro scelte dichiarate dai test.** Il deficit è il fabbisogno **totale per
> unità**, non la differenza della singola fase: contando fase per fase con un
> residuo che avanza, cassa 10000 contro 12000+8000 dava «mancano 2000» invece di
> 10000, e attribuiva il debito alla fase sbagliata a seconda dell'ordine di
> dichiarazione nel catalogo. La **manodopera non si consuma fra le fasi** — è
> capacità, gli stessi operai tornano il giorno dopo — quindi si confronta con il
> picco di fabbisogno, non con un residuo. `workforce: []` e `workforce` assente
> dicono la stessa cosa, «non ho letture», e danno un'ignoranza dichiarata, non un
> blocco inventato. Una qualifica che non compare nelle letture è ignoranza, non
> una qualifica a zero.
>
> **Verifica indipendente, seconda tornata.** Un altro agente ha tentato di
> smontare questo diff e ha trovato sette problemi reali, tutti verificati da me e
> corretti: il falso deficit pre-bootstrap (P1, il più grave); l'attribuzione del
> residuo per fase (P2); un commento **falso** che diceva il preflight legacy
> «resta quello di prima» mentre gli avvisi cambiano lo `status`; i tre codici
> nuovi non mappati nella proiezione per la UI; `workforce: []` che bloccava; il
> costo (una `reconstructBalances` per unità, ~3 s su 20k righe); e i commenti che
> citavano una difesa dei test che non esisteva. Ha anche misurato che il modulo
> legge la **custodia di ledger**, non la proprietà dichiarata dal catalogo: gli
> utensili della fixture sono registrati a `alpha_steel_co` ma il catalogo li dà in
> custodia a `alpha_farms`. Prova al contrario rifatta: tolto il totale per unità
> falliscono 5 test, tolta la guardia sul ramo vuoto fallisce il test del deficit
> inventato.
>
> **MG01 µ3c — non eseguita, ed è una decisione, non una dimenticanza.** Il
> binding `regionIdBinding` per la fixture **non si può dichiarare**: le regioni del
> catalogo (`ALPHA-nord`, `BETA-est`) non sono i codici della mappa (`ALP`, `BET`),
> quindi `world_scoped` risolverebbe `ALPHA-nord -> <worldId>_ALPHA-nord`, che nel
> mondo non esiste. Il resolver è corretto: è il **dato** che non corrisponde. Due
> vie, entrambe da decidere: riscrivere le regioni del catalogo sui codici della
> mappa (tocca `map-p6-world-assets.test.ts`, oggi verde) oppure dare alla fixture
> una mappa con i codici del catalogo. Provvisoriamente le regioni restano quelle,
> e la costruzione usa `targetIds = [polity, opera]` — che `targetKnown` risolve
> senza bisogno del binding.
>
> **Cosa resta aperto dopo µ3, dichiarato:** la costruzione **non è ancora
> eseguibile end-to-end**. Il blocco di autorità c'è ancora (l'unicà regola R1 per
> `allocate` è dell'impresa pubblica, mentre la rotta usa la tesoreria), e
> `check-feasibility` — l'altra rotta di preflight — **non legge il ledger**, quindi
> i tre codici di deficit non sono raggiungibili da lì. Sono lavoro di MG02,
> insieme alla prenotazione vera.

**Verifica indipendente della ricognizione.** Un secondo agente in sola lettura ha rieseguito le sonde e ha **smentito quattro affermazioni della prima stesura di questa sezione**, tutte corrette qui: il `construct` «feasible» non è raggiungibile dalle rotte, che usano sempre la tesoreria; `test`/`TEST` non sono parole chiave SQLite; «tutti e quattro i tipi d'impianto danno la stessa stima» trascura che `ft_works` segue un ramo di codice diverso; e l'elenco dei moduli orfani era incompleto. Ha inoltre trovato tre lacune che il piano non copriva: il produttore mancante di `modelDataMissingIds`, l'incompatibilità fra `worldId` esadecimali e `INTENT_ID`, e la forma sbagliata scelta per la distinta di costruzione. Le misure che ho ricontrollato io stesso prima di applicare: il `feasible` con l'impresa e il blocco con la tesoreria, il rifiuto di un `targetIds` con `worldId` iniziale a cifra, l'accettazione silenziosa di campi ignoti in una ricetta, e il comportamento di `test`/`TEST` in SQLite.
