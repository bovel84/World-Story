# World Story — roadmap per Pi: colloquio con il ministro e tavola presidenziale

## Obiettivo da realizzare

Trasformare la seduta con un ministro in un colloquio di governo. A sinistra il ministro parla al Presidente, si presenta, comprende gli obiettivi del giocatore, propone alternative e ricorda le discussioni precedenti. A destra dispone su una tavola visiva le evidenze che servono a quel preciso passaggio della conversazione: grafici, porzioni di mappa, confronti, sequenze operative e conseguenze delle proposte.

La tavola deve sembrare il materiale che il ministro sta mostrando al Presidente. Non deve aprirsi come una collezione permanente di tutti i dati disponibili. La chat deve essere subito visibile e utilizzabile, senza scorrere un dossier per raggiungerla.

## Base verificata

Repository: https://github.com/bovel84/World-Story

Analisi di `main` al commit `336e170b2642e90e395e148afa5fb220ea4b8eef`, 30 settembre 2026. Pi deve verificare il nuovo HEAD e le eventuali modifiche prima di implementare. Questa è una roadmap: nessuna modifica al repository è stata effettuata durante la sua preparazione.

Punti di partenza verificati:

- `frontend/src/components/Game/GovernmentOffice.tsx`: nella colonna sinistra monta `CabinetSession` dettagliata e, sotto, `MinisterChat`. A destra monta `TreasuryActPanel` per il Tesoro e `SeatCanvas`.
- `CabinetSession.tsx`: la variante dettagliata mostra apertura, questioni e cifre prima del dialogo. Questo è il principale ostacolo alla centralità della conversazione.
- `MinisterChat.tsx`: esistono streaming, composer e cronologia per sedia. Il contesto inviato comprende al massimo gli ultimi 20 messaggi; l'apertura visualizzata a conversazione vuota è un suggerimento, non un primo messaggio completo del ministro.
- `SeatCanvas.tsx` e `seatCanvasModel.ts`: esistono blocchi tipizzati `metrics`, `chart`, `strategy`, `map`, `ideas`. La derivazione dipende dalla sedia e dai read model, non dai messaggi del ministro.
- `seatCanvasConfig.ts`: esiste una configurazione dei contenuti per ministero. I piani curati descritti nel report WS-GOVOFFICE-07 sono statici.
- `advisorCharts.ts`, `AdvisorChart.tsx`, `StrategicPlanDiagram.tsx`: grafici SVG e diagrammi riutilizzabili.
- `frontend/src/stores/chatStore.ts`: conversazioni ministeriali separate per sedia in Zustand. Nel percorso letto non emerge una memoria persistente dedicata all'identità del ministro e alle sue decisioni.
- `backend-nest/src/core/government/MinisterChat.ts`: prepara competenza e fatti. Il prompt prescrive già una risposta discorsiva, ma vieta opinioni e nomi aggiunti: deve distinguere meglio fatti verificati e caratterizzazione del personaggio.
- `backend-nest/src/routes/games/advisor.routes.ts` e `backend-nest/src/game-session.ts`: percorsi di risposta ministeriale e streaming già presenti.

Limiti da rispettare: il report `docs/implementation/WS-GOVOFFICE-07-report.md` documenta un CORE ENGINE FREEZE, piani statici e assenza di un'azione deterministica di rimborso titoli. La roadmap non autorizza implicitamente nuovi effetti economici. Pi deve leggere le istruzioni attuali del repository e distinguere modifiche di presentazione, servizi conversazionali e simulazione. Se un requisito supera un freeze applicabile, completare le parti consentite e documentare il preciso innesto necessario, senza presentare una simulazione finta come implementazione conclusa.

## Direzione grafica

Impostare la seduta come una sala di lavoro presidenziale sobria e leggibile.

- Desktop: circa 42% dialogo e 58% tavola, con divisore ridimensionabile e larghezze minime. Il rapporto è una base di design da verificare su schermo.
- Un'intestazione compatta: identità del ministro, incarico, Stato e data di gioco. La personalità emerge soprattutto dal dialogo.
- Sfondo scuro uniforme nella stanza; testo della chat ad alto contrasto; tavola avorio o superficie chiara con grafici e annotazioni. Niente alternanza casuale di documenti chiari e schede scure annidate.
- Sans leggibile per dialogo e dati; eventuale serif solo per pochi titoli istituzionali. Corpo della chat indicativamente 16–18 px, interlinea almeno 1,5, paragrafi brevi.
- Chat con cronologia e composer ancorato in basso. La prima schermata della seduta deve contenere già un saluto e l'area di scrittura.
- Tavola con una visualizzazione principale e, normalmente, non più di due elementi di supporto. Gli approfondimenti restano espandibili.
- Fonte, data e metodo disponibili vicino all'evidenza, anche tramite dettaglio accessibile. Evitare di ripetere spiegazioni tecniche in ogni frase del dialogo.
- Nessun obbligo di immagini o ritratti: partire da tipografia, nome e incarico, rispettando il precedente orientamento del progetto. L'identità non richiede un volto.
- Mobile: una superficie alla volta con passaggio chiaro «Dialogo / Tavola», badge per nuove evidenze e ritorno al messaggio collegato. Nessuna compressione delle due colonne in due strisce illeggibili.

## Roadmap esecutiva

### WS-MINISTER-UX-00 — Audit e contratto della nuova esperienza

**Lavoro**

Leggere istruzioni del repository, report GOVOFFICE recenti, componenti, API, store, salvataggi e flussi di ordine. Ricostruire con precisione dati disponibili, provenienza, identità ministeriali eventualmente esistenti, scope dei rami e vincoli del freeze. Preparare due schermate di riferimento: ingresso nella seduta e confronto tra due proposte.

Definire i confini: conversazione, memoria conversazionale, evidenze e coda degli ordini sono oggetti distinti. Parlare e mostrare non modifica il mondo.

**Accettazione**

Documento breve con percorsi effettivi, dipendenze, contratto dei messaggi/evidenze e matrice «disponibile / derivabile con metodo / assente». Nessun refactoring generico dell'intera applicazione. Nessun numero di impatto inventato nel prototipo.

### WS-MINISTER-UX-01 — Rifacimento visivo e chat come superficie principale

**Lavoro**

Riorganizzare `GovernmentOffice`: mantenere la scelta iniziale dei ministri, ma nella seduta montare direttamente il dialogo come contenuto principale. Spostare le questioni e le cifre di `CabinetSession` nel catalogo delle evidenze o in un riepilogo espandibile. Evitare di duplicare gli stessi dati nella chat, nell'atto del Tesoro e nella tela.

Introdurre una shell del colloquio, cronologia leggibile, composer fisso, tavola ampia, controlli essenziali e stati di caricamento. Conservare le funzioni esistenti di streaming e accodamento. Il footer deve essere compatto: la schermata allegata mostra molto spazio sottratto al colloquio.

Non accumulare ulteriori override globali in fondo ai CSS: verificare la cascata di `editorial.css`, `index.css` e foundations, usare stili delimitati alla seduta e rimuovere solo le regole realmente superate.

**Accettazione**

Screenshot prima/dopo a 1440×900, 1024×768 e 390×844. Saluto, messaggi e composer visibili subito. Nessuna scroll area annidata superflua, nessun overflow orizzontale. La colonna destra comunica una tavola di lavoro e non una pila di KPI.

### WS-MINISTER-UX-02 — Ministro discorsivo con identità e priorità

**Lavoro**

Riutilizzare eventuali personaggi dello scenario; in loro assenza definire un profilo stabile di ministro compatibile con lo scenario, senza inventare biografie storiche. Separare almeno: competenza, stile di parola, priorità politiche, propensione al rischio e rapporto con il Presidente.

Aggiornare il briefing: consentire raccomandazioni e opinioni coerenti con il profilo, chiaramente distinte dai dati. Un ministro prudente può preferire una riserva di cassa; uno riformista può sostenere un investimento. I fatti e le possibilità di esecuzione restano quelli verificati.

All'apertura della prima seduta il ministro produce un vero primo messaggio: presenta il proprio incarico, riassume una o due questioni rilevanti e invita il Presidente a indicare la priorità. Alla riapertura riprende il filo senza ripetere ogni volta la presentazione.

Il dialogo segue l'intento del giocatore: comprendere l'obiettivo, chiedere solo i dettagli necessari, spiegare compromessi, suggerire alternative e accompagnare la scelta. Evitare risposte sempre costruite come elenco di dati. Il Tesoro può discutere la copertura finanziaria di un ospedale e coinvolgere Sanità per l'effetto sanitario, invece di respingere interamente il tema.

**Accettazione**

Due ministri rispondono alla stessa domanda con priorità e voce riconoscibili. La domanda «Voglio aiutare le famiglie senza peggiorare troppo il bilancio» produce un ragionamento e una richiesta di chiarimento utile, non soltanto un rinvio al collega. Nessuna promessa di effetti non disponibili.

### WS-MINISTER-UX-03 — La conversazione guida la tavola

**Lavoro**

Trasformare i blocchi esistenti in un catalogo di evidenze utilizzabili. Dare al ministro una capacità strutturata di presentazione: scegliere cosa mostrare, su quale soggetto e per quale proposta. Il modello seleziona riferimenti; il resolver costruisce dati e geometrie dalle fonti autorizzate.

Contratto concettuale, da adattare all'architettura effettiva:

```ts
type PresentationDirective = {
  id: string;
  messageId: string;
  operation: 'show' | 'focus' | 'compare' | 'annotate' | 'dismiss';
  evidenceId: string;
  proposalId?: string;
  regionIds?: string[];
};
```

Non accettare HTML, JavaScript, geometrie o serie numeriche arbitrarie dal modello. Tipi, riferimenti, soggetti e scope della partita vanno validati. Preferire eventi strutturati separati dal testo; se il provider non li supporta, usare un formato delimitato rigorosamente validato e rimosso dalla prosa. Non renderizzare strutture parziali durante lo streaming.

Correlare messaggi, direttive e blocchi con ID stabili e contesto di partita/ramo/revisione. Gli eventi di una richiesta vecchia non devono cambiare la tavola di un altro ministro. Gestire ripetizioni, annullamento, errori e cambi di ramo. Se una direttiva fallisce, conservare la risposta testuale.

**Accettazione**

«Mi mostri dove va la spesa?» apre il grafico pertinente; «E quali province coinvolge?» porta in primo piano la mappa pertinente; «Confronta le due strade» mostra il confronto. Il cambio è legato al messaggio. Non compaiono automaticamente tutti i blocchi solo perché esistono dati.

### WS-MINISTER-UX-04 — Grafici, mappe e confronto delle conseguenze

**Lavoro**

Riutilizzare `AdvisorChart`, diagrammi e infrastruttura geografica del progetto. Realizzare una vista geografica focalizzata sulle regioni interessate: adattamento del viewport, evidenziazione, legenda, annotazioni e selezione. Verificare coordinate e viewBox; l'attuale `ZoneMap` usa un viewBox fisso, che non garantisce da solo un ritaglio geografico corretto. Se manca geometria valida, mostrare un elenco territoriale esplicito.

Il confronto tra proposte distingue costo iniziale, spesa ricorrente, tempi, copertura, vincoli, benefici attesi e incertezza. Confrontare grandezze omogenee e dichiarare unità e orizzonte temporale.

Per gli effetti sulla società separare:

1. **Situazione attuale**, da read model.
2. **Effetti calcolabili**, solo da formule o anteprime già supportate e verificabili.
3. **Ipotesi qualitative**, discusse dal ministro e indicate come tali.

Non dedurre automaticamente «+X consenso», «−Y disoccupazione» o una previsione temporale dal solo aumento della spesa. Il catalogo delle opere comprende effetti dichiarativi che non equivalgono a una simulazione sociale operativa. Un diagramma può spiegare «finanziamento → opera → capacità del servizio», ma deve indicare quali passaggi sono previsti e quali effettivamente simulati.

**Accettazione**

Il giocatore vede chi potrebbe beneficiare, dove, quando e con quali limiti. Se il motore non supporta una previsione numerica, la tavola lo comunica nel contesto della proposta. Nessuna curva di crescita creata solo per riempire spazio.

### WS-MINISTER-UX-05 — Memoria persistente del ministro

**Lavoro**

Estendere la cronologia esistente con una memoria conversazionale persistente, separata dai numeri del mondo. Riutilizzare i meccanismi di salvataggio e repository applicabili prima di introdurre nuovo storage.

Scope minimo: partita, ramo, identità del ministro e mandato. Il solo nome della sedia non basta se il ministro cambia. Definire le regole di copia della memoria al fork e di ripristino al rewind: una decisione futura non deve comparire nel passato.

Conservare obiettivi esplicitati dal Presidente, proposte discusse, proposte respinte con motivo, questioni aperte, decisioni accodate ed esiti verificati. Ogni ricordo importante ha riferimenti a messaggio/atto, data di gioco e stato. «Il Presidente valuta una scuola» è diverso da «ha firmato l'ordine» e da «la scuola è operativa».

Preparare il prompt con profilo, sintesi breve dei ricordi pertinenti, scambi recenti e fatti aggiornati. Evitare di reinviare indefinitamente tutta la cronologia o di generare nuove chiamate LLM a ogni apertura solo per riassumere. La memoria non è una seconda fonte contabile.

**Accettazione**

Chiudere, cambiare ministro, ricaricare il browser e riavviare il server non perde la memoria prevista dal contratto. Le partite restano isolate. Un rollback non lascia ricordi del futuro. Il ministro ricorda una proposta respinta e il motivo, senza trasformarla in un atto approvato.

Nota di dipendenza: persistenza e protocollo strutturato richiedono un innesto backend reale. Una cache frontend può essere una tappa intermedia, ma non soddisfa questa fase. Se il freeze corrente impedisce quell'innesto, il report deve indicare quali requisiti restano aperti.

### WS-MINISTER-UX-06 — Dalla proposta alla decisione del Presidente

**Lavoro**

Collegare la proposta discussa alla bozza concreta tramite il flusso esistente di fattibilità e ordini. La tavola può offrire «Prepara l'atto», «Confronta» e «Modifica proposta». L'azione esplicita del Presidente «Firma e inserisci nel registro» accoda l'ordine secondo la semantica vigente; non aggiungere conferme ridondanti.

Il ministro non firma autonomamente. Spiegare se una strada ha un comando supportato dal motore, una bozza testuale da valutare o una funzione ancora assente. Per esempio, l'ammortamento dei titoli non deve sembrare eseguito solo perché esiste un ordine in testo.

Aggiornare la conversazione con l'esito reale: preparato, accodato, eseguito o fallito. Ricostruire questo stato dai dati disponibili, evitando il solo flag locale «accolta». Gestire doppio clic, tentativi ripetuti e fallimenti senza duplicare atti. Il nulla di fatto resta un esito possibile; non cancella ordini già accodati.

**Accettazione**

Conversazione → confronto → atto → registro → avanzamento del tempo → esito verificato. Aprire grafici e discutere alternative non modifica cassa o coda. La UI distingue sempre atto in attesa ed effetto applicato.

### WS-MINISTER-UX-07 — Verifica completa e rifinitura

**Lavoro**

Verificare almeno Tesoro, Sanità/Istruzione e Guerra, includendo un caso con dati mancanti. Usare gli harness e test esistenti, aggiornandoli per il comportamento intenzionalmente nuovo senza allentare le invarianti.

Copertura essenziale: schema delle direttive, riferimenti invalidi, eventi fuori ordine, isolamento dei ministri, persistenza e rewind, fonti dei numeri, ordini duplicati, percorso di firma ed esito. Verifica visiva e di accessibilità a desktop/tablet/mobile, navigazione da tastiera, gestione del focus, reduced motion e lettura dello streaming senza annunci continui di ogni token.

Durante lo streaming l'autoscroll segue il fondo solo se il giocatore lo sta già leggendo. Chi risale la cronologia non deve essere riportato in basso. La tavola deve mantenere il focus durante gli aggiornamenti e permettere di fissare un'evidenza per continuare a leggerla.

Misurare latenza e numero di chiamate LLM: usare, ove possibile, una risposta per testo e presentazione; nessuna chiamata aggiuntiva per ciascun grafico o movimento della mappa.

**Accettazione**

Build, controlli TypeScript, test pertinenti ed E2E del percorso completi. Screenshot comparabili e report finale con limiti reali. Il frontend è verificato prima/dopo: i soli test verdi non dimostrano che la grafica sia migliorata.

## Scenario di riferimento per la demo

1. Il Presidente entra dal Ministro del Tesoro. Il ministro saluta, presenta il proprio ruolo e solleva una questione pertinente ai dati della partita.
2. Il Presidente: «Vorrei investire nella sanità, ma tenere una riserva per le emergenze».
3. Il ministro chiarisce copertura, priorità e limiti; sulla tavola appare il bilancio con la voce pertinente evidenziata.
4. Il Presidente: «Dove sarebbe più utile intervenire?».
5. Il ministro mostra le regioni per cui esistono dati pertinenti. Non usa il solo PIL come prova di un bisogno sanitario.
6. Il Presidente: «Confronta una proposta prudente con una più ambiziosa».
7. La tavola confronta le alternative realmente disponibili, con copertura e limiti; gli effetti sociali non calcolabili restano ipotesi qualitative.
8. Il Presidente prepara e firma una proposta supportata. L'atto entra nel registro.
9. Alla visita successiva il ministro ricorda il confronto e distingue l'ordine accodato dall'esito eventualmente già applicato.

## Ordine e modalità di consegna a Pi

Sequenza: UX-00 → UX-01 → UX-02 → UX-03 → UX-04 → UX-05 → UX-06 → UX-07. UX-05 deve orientare già il contratto di UX-00, anche se la persistenza viene realizzata dopo. Non promettere memoria definitiva nelle fasi anteriori.

Una fase per PR, oppure accorpare UX-00/01 se l'audit è breve. Ogni fase deve consegnare comportamento funzionante, file modificati, verifica pertinente, screenshot quando cambia la UI e limiti residui. Evitare una PR unica che mescoli rifacimento visivo, nuove memorie e nuove meccaniche economiche.

**Prima consegna richiesta:** UX-00 + UX-01. La grafica e la centralità della chat devono migliorare subito; la tavola può ancora usare evidenze selezionate dal frontend come passaggio intermedio dichiarato. Le fasi successive la rendono guidata dalla conversazione.

## Prompt iniziale da incollare a Pi

Lavora nel repository bovel84/World-Story seguendo questa roadmap. Inizia con WS-MINISTER-UX-00 e WS-MINISTER-UX-01: verifica HEAD e istruzioni attuali, leggi i report GOVOFFICE pertinenti e riorganizza la seduta del ministro in un dialogo principale a sinistra e una tavola visiva ampia a destra. La chat deve essere accessibile subito; sposta fuori dalla cronologia il dossier numerico che oggi la precede. Riutilizza MinisterChat, SeatCanvas, grafici e flussi degli ordini esistenti. Mantieni un linguaggio visivo coerente e verifica desktop, tablet e mobile con screenshot prima/dopo. Non limitarti a ritoccare colori e bordi: cambia gerarchia, composizione e uso dello spazio. Prepara il contratto per identità, memoria e direttive di presentazione, distinguendo chiaramente cosa è già funzionante e cosa appartiene alle fasi successive. Rispetta le invarianti e il freeze applicabile; non creare effetti sociali o economici finti. Consegna la prima fase concreta, i controlli eseguiti e un report dei passi successivi.
