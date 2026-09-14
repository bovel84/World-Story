/**
 * World Story — Simulation Prompt
 * ============================
 * Motore principale della simulazione (time-rewind.md)
 */

import {
  PromptVariables,
  SimulationResult,
  SimulationEvent,
  SimulationChatStart,
  VoidedAction,
  ActionOutcome,
  type MapChange,
  type SimulationPolityReaction,
} from './types';
import { parseJsonLoose } from '../utils/json-repair';
import { buildImmersionContract, EVENT_DESCRIPTION_GUIDE } from './immersion';
import { DomainContractError, parseActionOutcome } from '../domain/contracts';

/**
 * Istruzione della modalità auto-jump: il modello sceglie da solo la data
 * effettiva di arrivo («al prossimo evento importante») e la restituisce
 * in targetDate. Esportata: viene usata sia dal prompt di default sia
 * dai template preset sovrascritti (prompt-builder la aggiunge dopo il render).
 */
export function buildAutoJumpInstruction(vars: PromptVariables, eventBudget = 1): string {
  // Con più ordini in coda l'auto-jump può produrre più svolte, ma gli ordini
  // collegati vanno sintetizzati in catene causali: non un dispaccio-copia per riga.
  const stopRules = eventBudget > 1
    ? `- Il turno contiene ${eventBudget} ordini del giocatore: genera da 1 a ${eventBudget} eventi significativi in ordine cronologico. NON trasformare automaticamente ciascun ordine in un dispaccio separato: raggruppa gli ordini collegati e narra soprattutto decisioni, opposizioni e controproposte degli altri attori.
- Ogni ordine deve comunque ricevere il proprio actionOutcome, anche quando più ordini confluiscono nello stesso evento.
- Fermati dopo l'ultimo evento: la data dell'ultimo evento emesso deve essere anche il campo "targetDate" (YYYY-MM-DD). Non descrivere né calcolare fatti successivi all'ultimo evento.`
    : `- Genera ESATTAMENTE un solo evento davvero significativo: il primo in ordine cronologico.
- Fermati immediatamente a quell'evento: la sua data deve essere anche il campo "targetDate" (YYYY-MM-DD). Non descrivere né calcolare fatti successivi.`;
  return `\nRegole auto-jump:
- Il giocatore ha chiesto di avanzare nel tempo FINO AL PROSSIMO EVENTO IMPORTANTE (entro l'orizzonte del ${vars.TARGET_ROUND_DATE}).
${stopRules}
- Questa modalità PREVALE su qualunque istruzione del preset che chieda di distribuire eventi sull'intero periodo, generare molti eventi o non interrompere la simulazione.`;
}

/**
 * Vincolo aggiunto anche ai prompt dei preset, che possono sostituire il
 * template standard completo. Impedisce a un override vecchio di aggirare la
 * continuità causale della simulazione.
 */
/**
 * Stile dei dispacci: headline, descrizioni, narrazioni e riepiloghi sono
 * testi narrativi per il giocatore, mai metadati o etichette tecniche
 * (es. «Turchia neutral»): la posizione diplomatica va raccontata, e i
 * valori enumerati restano soltanto nei campi JSON dedicati.
 */
export function buildDispatchStyleGuard(): string {
  return `
[STILE DEI DISPACCI — regola non negoziabile]
I campi letti dal giocatore — "headline", "description", "narration", "summary", "response", "counterAction", "topic" e il testo di "reason" — sono dispacci di cronaca in italiano: frasi complete, tono giornalistico-storico, con attori e luoghi nominati.
- VIETATO in questi campi: etichette di stato o ruolo ("neutral", "supportive", "opposed", "conditional", "hostile", "ally", "counterparty", "mediator", "observer"), nomi di campi JSON o meccaniche di gioco ("headline", "description", "mapChanges", "reactions", "stance", "partial", "rejected", "voided", "targetDate", "actionId"), ID, hashtag, parentesi quadre, elenchi puntati o sequence di etichette separate da virgole.
- La posizione diplomatica va RACCONTATA in forma narrativa, mai riportata come parola chiave: scrivi «La Turchia annuncia la propria neutralità nel conflitto», NON «Turchia neutral». I valori enumerati (stance, relationship, role, status) appartengono soltanto ai campi JSON dedicati.
- Nessun inglese nei dispacci salvo nomi propri; nessuna sigla tecnica; nessun riferimento a turni, mappe, regole o al fatto che si tratta di una simulazione.`;
}

/**
 * Identità del giocatore: il giocatore incarna la nazione che parla e agisce.
 * Nei testi visti dal giocatore l'attore è sempre la sua politia (governo,
 * capo di Stato, ministri), mai «il giocatore» — così la cronaca, la
 * diplomazia e la narrazione restano immerse nel mondo, non nella meccanica.
 */
export function buildPlayerIdentityGuard(vars: PromptVariables): string {
  return `
[IDENTITÀ DEL GIOCATORE — regola non negoziabile]
Il giocatore INCARNA il governo e la voce ufficiale di ${vars.PLAYER_POLITY}: ogni suo ordine è un atto ufficiale di quella nazione, deciso dal suo governo.
- In tutti i testi visti dal giocatore ("headline", "description", "narration", "summary", "response", "counterAction", "topic", "reason") l'attore delle sue decisioni è sempre ${vars.PLAYER_POLITY}, il suo governo, il suo capo di Stato o i suoi ministri: MAI «il giocatore», «l'utente», «il controllore» o «la sua politia». Scrivi «${vars.PLAYER_POLITY} ordina la mobilitazione generale», NON «Il giocatore ordina la mobilitazione generale».
- Le altre nazioni riconoscono ${vars.PLAYER_POLITY} come soggetto politico reale: la nominano, la sfidano, negoziano con lei alla pari e la citano come fonte delle proprie reazioni.
- ${vars.PLAYER_POLITY} esiste nel mondo anche quando non agisce, ma entra nella cronaca SOLO quando un fatto la riguarda direttamente: un suo ordine, un confine conteso, un trattato, un interesse o un rischio documentato. Non aggiungere righe di pura presenza per nominarla.
- Nessun testo parlato da una nazione menziona giocatori, turni o meccaniche di gioco.`;
}

/**
 * Coerenza dei soggetti: un evento nomina solo chi agisce, subisce o ha un
 * interesse documentato. Impedisce che una nazione (spesso quella del
 * giocatore) compaia come comparsa in fatti che non la riguardano.
 */
export function buildSubjectCoherenceGuard(vars: PromptVariables): string {
  return `
[COERENZA DEI SOGGETTI — regola non negoziabile]
- In un evento nomina soltanto le politie che AGISCONO, che SUBISCONO il fatto o che hanno un interesse/esposizione documentati in questo contesto. Nessun'altra.
- Non aggiungere nazioni estranee come spettatrici, osservatrici o mediatrici non richieste: un evento non è «mondiale» perché elenca molti paesi.
- ${vars.PLAYER_POLITY} compare in un evento delle altre politie solo se quel fatto la tocca direttamente (confine, accordo, risorsa, rischio, richiesta). Evita frasi di pura presenza come «${vars.PLAYER_POLITY} osserva con attenzione» o «${vars.PLAYER_POLITY} segue gli sviluppi».
- Le altre politie nominano ${vars.PLAYER_POLITY} soltanto se hanno un motivo verificabile per farlo; altrimenti il dispaccio resta fra i soli soggetti coinvolti.
- "reactions" e "startChat" contengono esclusivamente le politie direttamente toccate dal fatto, non il vicinato in generale né tutte le grandi potenze.
- Crisi locali e conflitti di confine restano fra i soggetti del teatro: la controparte diretta, i suoi vicini e quelli della nazione del giocatore, e le organizzazioni regionali realmente presenti. Non far reagire grandi potenze lontane né Stati senza un interesse documentato (basi, alleanze, rotte commerciali, debiti, minoranze, legami coloniali).
- "reactions" e "startChat" non producono «note di comodo» da capitali irrilevanti: se una nazione non ha vicinanza geografica, un rapporto registrato o una causa esplicita nel testo dell'evento, non compare.
- La controparte direttamente attaccata o minacciata reagisce sempre e, se mobilita, schiera o costruisce, lo fa con le mapChanges corrispondenti nello stesso evento.`;
}

/**
 * Iniziativa autonoma delle nazioni non giocate. Senza questa regola il modello
 * tende a usare gli NPC solo come comparse che reagiscono agli ordini del
 * giocatore: qui ogni politia persegue attivamente il proprio dossier con
 * misure difensive e offensive concrete, che il motore traduce in oggetti di
 * mappa (unità, cantieri, fortificazioni, spostamenti).
 */
export function buildNpcAgencyGuard(vars: PromptVariables): string {
  return `
[INIZIATIVA AUTONOMA DELLE NAZIONI NPC — regola non negoziabile]
- Le nazioni diverse da ${vars.PLAYER_POLITY} NON sono comparse che attendono gli ordini del giocatore: perseguono attivamente il proprio dossier. Quando lo stato strategico, la cronaca, la diplomazia o i processi in corso offrono una causa verificabile (tensione di confine, minaccia, imminenza, alleanza, ultimatum, crisi aperta, opportunità economica o territoriale), quella nazione adotta nel periodo una misura autonoma e concreta.
- Misure difensive ammesse: mobilitazione di riserve, fortificazioni e opere di difesa (fortification, base, airbase, radar, missile_site), difesa aerea e costiera, schieramento difensivo su un confine, pattugliamento navale, patto o garanzia difensiva, evacuazione, embargo difensivo.
- Misure offensive ammesse: concentramento e piano offensivo, incursione o raid, blocco navale, bombardamento, ultimatum armato, preparazione d'invasione, sostegno a un alleato in guerra, taglio delle forniture.
- Ogni misura adottata compare in "reactions" nel campo "counterAction", con la priorità del dossier che l'ha motivata; se è materialmente iniziata o operativa, compare anche nelle "mapChanges" dello stesso evento, nel territorio della nazione che agisce: cantieri con start_construction, mobilitazioni con start_mobilization, formazioni operative con spawn_unit, spostamenti con move_unit, fortificazioni e opere finite con complete_construction.
- Prima di chiudere un evento rileggi "headline" e "description": ogni misura materiale nominata come avviata o operativa deve avere la mapChange corrispondente; una proposta, un annuncio o uno studio non crea oggetti.
- In ogni avanzamento temporale in cui esiste una causa documentata deve comparire almeno un'iniziativa autonoma di una nazione non giocata, con il relativo marker quando è materiale. Non inventare cause per giustificarla: se non ne esiste alcuna, il mondo può restare fermo.`;
}

/**
 * Reazioni interne ed economia della guerra. Senza questa regola il modello
 * racconta la mossa del governo (mobilitazione, spesa, embargo) come un atto
 * asettico: nessun costo, nessun consenso, nessuna opposizione. Qui ogni
 * decisione materiale deve produrre una conseguenza interna narrata e
 * proporzionata, ancorata al Dossier nazionale calcolato dal motore.
 */
export function buildDomesticReactionGuard(vars: PromptVariables): string {
  return `
[REAZIONI INTERNE ED ECONOMIA DELLA GUERRA — regola non negoziabile]
- Nessuna decisione materiale del governo resta senza conseguenze interne. Quando una nazione mobilita riserve o un battaglione, schiera o sposta unità, apre un cantiere, taglia forniture, impone un embargo o destina risorse a un settore, l'evento DEVE raccontare anche la reazione interna di quella nazione: come la prendono la popolazione e le istituzioni, e quanto costa.
- Reazione della popolazione (una o più, secondo il caso): consenso o protesta, code di reclutamento o renitenza, famiglie dei richiamati, scioperi o turni straordinari, stampa, associazioni di categoria, studenti, clero, veterani, minoranze, migrazione interna. Non è sempre negativa: può essere slancio patriottico o malcontento, in base a causa, legittimità e costo documentati. Non inventare folle, nomi o citazioni.
- Reazione delle istituzioni e del governo: dibattito parlamentare e voto sul bilancio, opposizione e tenuta della coalizione, ministero del Tesoro e banca centrale, governatori locali, autorità militari, appalti e corruzione, tribunali o stampa. Se il governo è democratico mostra dibattito, opposizione ed elezioni; se è autocratico mostra censura, epurazioni, repressione o consenso forzato.
- Conseguenza economica concreta e proporzionata: costo della mobilitazione, deficit e debito, inflazione e razionamenti, conversione dell'industria, opportunità perdute, nuove tasse o tagli, salari e prezzi. Usa il Dossier nazionale calcolato dal motore (saldo, stabilità, riserve mobilitate, sforzo bellico, tensione sociale) come fonte: non inventare cifre nuove.
- Una misura molto costosa o impopolare non può restare senza attrito: mostra almeno un effetto sociale o istituzionale negativo. Una misura popolare e sostenibile mostra consenso e consolidamento. Il segno della reazione dipende dalle cifre del dossier, non dal gusto della scena.
- Vale anche per le nazioni NPC: se mobilitano o spendono, la loro popolazione e il loro governo reagiscono nello stesso evento.
- Se l'evento è una battaglia o un'occupazione, aggiungi l'effetto su chi la subisce: profughi, requisizioni, coprifuoco, amministrazione militare, resistenza o collaborazione.`;
}

export function buildCausalityGuard(vars: PromptVariables): string {
  return `

[VINCOLO CAUSALE OBBLIGATORIO]
Genera un evento soltanto se è conseguenza verificabile di un ordine del giocatore, della cronaca precedente, della diplomazia o dello stato strategico qui sotto. Le politie NPC possono avere iniziative proprie soltanto quando obiettivo, risorse, impegno o crisi sono visibili in queste fonti. Non creare crisi, guerre, colpi di Stato, alleanze o svolte economiche indipendenti solo per riempire il periodo.
Ogni ordine del giocatore deve avere un esito realistico, una reazione o un rifiuto in "voided". L'apertura di ogni descrizione ricostruisce il contesto e il grilletto concreto; il seguito distingue la nuova decisione dalle condizioni precedenti e ne spiega le conseguenze proporzionate.

[CICLO MONDIALE OBBLIGATORIO]
Ogni avanzamento temporale simula l'intero mondo, non soltanto la politia del giocatore. Valuta per tutte le altre politie le conseguenze nel periodo: reazioni a ordini, sviluppo di trattative, mobilitazioni, commercio, crisi o impegni già presenti nella cronaca e nello stato strategico.
- Se un ordine del giocatore coinvolge o influenza un'altra politia, inserisci nello stesso evento una risposta autonoma e concreta della controparte nel campo "reactions". Una proposta, richiesta, minaccia o offerta del giocatore non vale come accettazione altrui: senza consenso esplicito della controparte resta proposta pendente o viene respinta.
- Anche senza ordini del giocatore, fai progredire almeno un filone già documentato di una politia non giocante quando esiste una causa verificabile; il giocatore può osservare il mondo ma la sua politia non agisce senza ordine.
- Dai priorità a 1-3 reazioni o iniziative internazionali collegate, invece di elencare notizie scollegate. Se nessuna causa è documentata, non inventare un fatto: avanza comunque tempo ed economia in modo coerente.
${buildDispatchStyleGuard()}
${buildPlayerIdentityGuard(vars)}
${buildSubjectCoherenceGuard(vars)}

[Stato strategico attuale — fonte di verità]
${vars.STRATEGIC_STATE}

[Personalità, priorità e memoria NPC — fonte vincolante]
${vars.NPC_STRATEGIC_PROFILES}
- Per ogni NPC coinvolto: identifica la priorità pertinente, confronta costi/rischi e scegli una risposta coerente con dottrina, linee rosse, rapporti e precedenti registrati.
- La personalità è persistente: non renderla improvvisamente aggressiva, remissiva o generosa per creare spettacolo. Può cambiare strumento o posizione solo se un nuovo fatto verificabile ne cambia il calcolo.
- Se una politia decide una misura concreta nel periodo, registrala come "counterAction" nella sua reaction e, quando produce un effetto territoriale realmente operativo, rappresentala anche in mapChanges. Le mapChanges riguardano TUTTE le politie: mobilitazioni e unità terrestri o navali, movimenti di formazioni esistenti, cantieri e opere completate delle altre nazioni appaiono sulla mappa come mapChanges dello stesso evento, collocate nel territorio della politia che agisce (una flotta in una provincia con porto o sulla costa).
- Se la controazione di un NPC colpisce interessi, territori o impegni di un altro NPC, anche quest'ultimo reagisce autonomamente secondo il proprio dossier: nessun NPC decide o accetta per un altro.
${buildNpcAgencyGuard(vars)}
${buildDomesticReactionGuard(vars)}`;
}

/**
 * Protocollo di output progressivo. Ogni oggetto JSON concluso può essere
 * estratto dallo stream e mostrato subito, mentre il modello pensa al seguito.
 */
/**
 * Contratto di qualità che non può essere rimosso da un preset. I preset
 * possono aggiungere contesto e regole, non trasformare il simulatore in un
 * generatore di colpi di scena scollegati. Per un override completo riportiamo
 * anche il canone, perché il suo testo potrebbe non usare i placeholder.
 */
export function buildSimulationNarrativeContract(
  vars: PromptVariables,
  includePresetContext = false,
): string {
  const presetContext = includePresetContext ? `

[Canone del preset — fonte storica]
${vars.WORLD_BEFORE_ROUND_ONE_TEXT}

[Regole del preset — vincolanti]
${vars.HISTORICAL_PRESET_SIMULATION_RULES}` : '';
  return `

[CONTRATTO NARRATIVO NON AGGIRABILE]
- La premessa, la cronaca consolidata, la diplomazia, le date, le risorse e la mappa fornite sono la fonte di verità. Non colmare lacune con leader, trattati, eserciti, tecnologie, cifre o crisi inventati.
- Il giocatore controlla solo ${vars.PLAYER_POLITY}: questa politia non prende iniziative senza un ordine esplicito nel turno. Un ordine può fallire, richiedere preparazione o restare parziale; non diventa mai automaticamente un successo. Il giocatore non controlla Israele, Stati Uniti o alcuna controparte: non dichiarare firmato un accordo, accolta una richiesta o riuscita un'azione esterna senza una loro decisione esplicita in "reactions".
- Ogni evento segue una catena databile «causa già visibile → decisione o reazione → conseguenza proporzionata». Distingui sempre proposta, misura avviata, processo in corso e risultato ottenuto.
- Negli ordini composti valuta separatamente le fasi: un obiettivo finale irrealistico non cancella una preparazione fattibile, ma l'outcome resta partial e la mappa mostra soltanto ciò che è materialmente iniziato o diventato operativo.
- Rispetta i tempi: trattative, mobilitazioni, riforme, cantieri, guerre e mutamenti di regime maturano in più fasi salvo prova contraria nel contesto.
- Narra in italiano sobrio da cronaca storica. Ogni dispaccio deve nominare attore, luogo, data o periodo, grilletto concreto e conseguenza; una narrazione finale riassume solo i fatti effettivamente emessi.
- Un evento diplomatico può aprire una chat diretta, un vertice, una conferenza, un negoziato, un confronto su ultimatum o un tavolo tecnico. In tal caso inserisci in "startChat" tutte e sole le politie non giocanti direttamente coinvolte e collega la chat al titolo esatto del dispaccio con "eventHeadline". Con più politie nasce una riunione di gruppo; non aggiungere osservatori senza una causa nel contesto.
- Le politie NPC seguono il dossier [Personalità, priorità e memoria NPC]: la risposta deve indicare quale interesse guida la decisione e quale eventuale controazione concreta viene adottata. Una controazione militare, diplomatica o economica deve essere proporzionata alle capacità e ai precedenti registrati. Quando incide direttamente su un altro NPC, quest'ultimo valuta e risponde per sé.
- Una misura NPC materialmente avviata (mobilitazione, unità terrestre o navale creata o spostata, cantiere aperto, opera completata) diventa un marker reale: registrala nelle "mapChanges" dello stesso evento, nel territorio della politia che agisce.
${buildNpcAgencyGuard(vars)}
${buildDomesticReactionGuard(vars)}
- Se non esiste una causa verificabile per un fatto ulteriore, non inventarlo: registra gli esiti disponibili e lascia il mondo coerente.${buildImmersionContract()}${presetContext}`;
}

export function buildIncrementalOutputInstruction(
  vars: PromptVariables,
  maxEvents: number,
  autoJump = false,
): string {
  const completionTargetDate = autoJump
    ? 'YYYY-MM-DD'
    : vars.TARGET_ROUND_DATE;
  return `

[PROTOCOLLO EVENTI PROGRESSIVI — PRIORITÀ MASSIMA]
Ignora SOLO il formato JSON finale descritto sopra e serializza invece la risposta come JSON Lines (NDJSON).
- Scrivi ogni oggetto JSON su una singola riga, senza array esterno, markdown o testo aggiuntivo.
- Emetti UN evento completo appena lo hai deciso, prima di elaborare il successivo.
- Gli eventi devono essere cronologici e ciascuno deve tenere conto degli eventi già emessi.
- Emetti un evento SOLO se deriva da una causa verificabile: un ordine del giocatore, un fatto della cronaca, una trattativa diplomatica o lo stato strategico/mappa fornito. Non riempire il limite con fatti indipendenti.
- Ogni evento è una REAZIONE: a un ordine del giocatore, a un altro evento già emesso o a un fatto documentato della cronaca. NON limitarti a riscrivere l'ordine al passato. Ordini collegati confluiscono nella stessa catena; ordini scollegati possono produrre eventi distinti.
- Non superare ${maxEvents} eventi significativi.${autoJump ? (maxEvents > 1
  ? `\n- Modalità auto-jump: emetti da 1 a ${maxEvents} eventi, sintetizzando gli ordini collegati, e fermati sulla data dell’ultimo evento emesso.`
  : '\n- Modalità auto-jump: emetti soltanto il primo evento importante e fermati sulla sua data.') : ''}

Per ogni evento emetti immediatamente:
{"type":"event","headline":"Soggetto NPC, decisione/reazione concreta e luogo","description":"${EVENT_DESCRIPTION_GUIDE}","date":"YYYY-MM-DD","mapChanges":[],"reactions":[{"polityName":"NOME politia NPC esistente","role":"counterparty|ally|mediator|observer","stance":"supportive|opposed|conditional|neutral","priority":"priorità del dossier che guida la decisione","response":"decisione ufficiale concreta, motivata e coerente con interessi e risorse","counterAction":"eventuale misura autonoma realmente decisa nel periodo"}]}

Regole obbligatorie per "reactions":
- Se l'ordine nomina, contatta, minaccia, influenza o richiede cooperazione a una politia NPC, quella politia deve comparire e decidere autonomamente; massimo 4 reazioni direttamente pertinenti.
- Segui [Personalità, priorità e memoria NPC]. "priority" nomina l'interesse che guida la risposta; "counterAction" descrive solo una misura davvero decisa nel periodo, non un'intenzione vaga.
- Se un'azione o controazione NPC influenza direttamente un'altra politia NPC, anche quella politia decide autonomamente nel medesimo evento o nel successivo evento causale.
- Iniziativa autonoma: una nazione NPC con una causa documentata adotta una misura concreta, difensiva o offensiva; se è materiale ha la mapChange corrispondente nello stesso evento. In ogni avanzamento con causa documentata compare almeno un'iniziativa NPC autonoma.
- Reazione interna: se qualcuno mobilita, schiera, spende o impone un embargo, la sua popolazione e le sue istituzioni reagiscono nello stesso evento (consenso o protesta, dibattito o repressione) con il costo economico proporzionato preso dal Dossier nazionale.
- Teatro della crisi: reagiscono la controparte diretta e i vicini; non aggiungere potenze lontane senza interesse documentato.
- Un accordo può risultare concluso solo se ogni controparte necessaria risponde "supportive" o "conditional" con condizioni soddisfatte. Altrimenti descrivi proposta, rifiuto, rinvio o controproposta e usa un outcome partial/rejected.
- La descrizione deve raccontare queste decisioni; non elencare banalmente ciò che il giocatore ha ordinato. Per un fatto esclusivamente interno usa "reactions": [].

Regole oggetti territoriali (mapChanges):
- Le mapChanges descrivono il mondo intero, non solo gli ordini del giocatore: anche le iniziative materiali decise dalle altre politie nel periodo (mobilitazioni, spostamenti, cantieri, opere) compaiono qui, nel territorio della politia che agisce.
- Cantiere materialmente aperto: {"type":"start_construction","regionName":"provincia esatta","feature":{"type":"factory|port|university|base|airbase|naval_base|fortification|radar|missile_site|infrastructure|power_plant","name":"nome univoco"}}
- Opera terminata e operativa: {"type":"complete_construction","regionName":"provincia esatta","feature":{"type":"stesso tipo finale","name":"stesso nome"}}. "build_facility" è ammesso come sinonimo legacy solo per un'opera già completata.
- Mobilitazione/reclutamento materialmente iniziato ma non operativo: {"type":"start_mobilization","regionName":"provincia esatta","feature":{"type":"battalion|army|fleet|missile","name":"nome univoco della formazione"}}. Quando diventa operativa usa "complete_mobilization" con stesso nome/tipo; se annullata usa "cancel_mobilization".
- Nuova formazione già reclutata, equipaggiata e operativa: {"type":"spawn_unit","regionName":"provincia esatta","feature":{"type":"battalion|army|fleet|missile","name":"nome univoco"}}
- Collocazione: una nuova unità, mobilitazione o fortificazione va in una provincia CONTROLLATA dalla politia che la crea. Se l'ordine dice "vicino a X", "al confine con X" o "di frontiera", scegli la provincia controllata più vicina a X: non creare una formazione dentro il territorio di un'altra politia se non è ordinata un'incursione o un'invasione esplicita.
- Movimento reale di un'unità esistente: {"type":"move_unit","regionName":"origine esatta","targetRegionName":"destinazione esatta","feature":{"type":"battalion|army|fleet|missile","name":"nome esistente"}}. Per distruzione o scioglimento usa "remove_unit".
- Una proposta, un ordine respinto, uno studio o un annuncio senza lavori NON crea oggetti. Un outcome partial può mostrare una mobilitazione soltanto se reclutamento/addestramento sono materialmente iniziati: non rappresentare in anticipo la formazione come operativa.
- Non aggiungere città/capitali e non duplicare oggetti. Ogni modifica deve appartenere allo stesso evento che ne attesta l'avvio, completamento, movimento o rimozione.

Quando il periodo è concluso emetti come ULTIMA riga:
{"type":"complete","narration":"Sintesi complessiva","actionOutcomes":[{"actionId":"ID esatto ordine","status":"accepted|partial|rejected","summary":"esito specifico","expectedDate":"YYYY-MM-DD opzionale per partial","eventHeadlines":[]}],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"${completionTargetDate}"}

Se un dispaccio richiede un contatto diplomatico, non lasciare "startChat" vuoto. Usa:
{"participants":["NOME politia promotrice","ALTRA politia coinvolta"],"topic":"primo messaggio concreto e ordine del giorno","kind":"meeting|summit|negotiation|conference|ultimatum|technical|statement","eventHeadline":"titolo ESATTO di una riga event emessa"}
- "participants" contiene solo politie esistenti non controllate dal giocatore. La prima è la promotrice e parla per prima.
- Una politia crea una chat diretta con il giocatore; due o più creano una riunione di gruppo con il giocatore.
- "eventHeadline" è obbligatorio: impedisce che una chat riferita a un evento futuro o scartato entri nella partita.

${autoJump
  ? maxEvents > 1
    ? 'In auto-jump targetDate DEVE essere identica alla data dell’ultimo evento emesso. Se nessun evento importante è causalmente giustificato entro l’orizzonte, NON inventarne uno: non emettere righe event e completa con "targetDate":null.'
    : 'In auto-jump targetDate DEVE essere identica alla data dell’unico evento emesso. Se nessun evento importante è causalmente giustificato entro l’orizzonte, NON inventarne uno: non emettere righe event e completa con "targetDate":null.'
  : 'Non aspettare di avere pianificato tutti gli eventi: completa e pubblica il primo, poi passa al seguente.'}`;
}

/**
 * Costruisce il prompt per il turno di simulazione
 * @param opts.autoJump — modalità «al prossimo evento importante»: il modello
 *   sceglie da solo la data effettiva di arrivo e la restituisce in targetDate.
 * @param opts.eventBudget — numero massimo di eventi ammessi nel turno
 *   (auto-jump: massimo pari agli ordini in coda; gli ordini collegati si raggruppano).
 */
const clipForConstrainedModel = (value: string | undefined, maxChars: number): string => {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

/**
 * Protocollo breve per modelli gratuiti/piccoli. Conserva i vincoli
 * sostanziali ma elimina ripetizioni e atlanti non pertinenti: meno contesto
 * significa meno JSON troncato, ID copiati male e ordini parafrasati.
 */
export function buildConstrainedSimulationPrompt(
  vars: PromptVariables,
  opts: { autoJump?: boolean; eventBudget?: number; presetOverride?: string } = {},
): string {
  const maxEvents = Math.max(1, Math.min(12, opts.eventBudget || 1));
  const completionDateJson = opts.autoJump ? '"YYYY-MM-DD"' : JSON.stringify(vars.TARGET_ROUND_DATE);
  return `SIMULAZIONE STRATEGICA — PROTOCOLLO COMPATTO
Lingua: italiano. Periodo: ${vars.ORIGIN_ROUND_DATE} → ${vars.TARGET_ROUND_DATE}. Giocatore: ${vars.PLAYER_POLITY}.

ORDINI (copia ogni actionId ESATTAMENTE):
${vars.PLAYER_ACTIONS_THIS_ROUND || '(nessun ordine)'}

FATTI MATERIALI E DIPLOMATICI:
${clipForConstrainedModel(vars.STRATEGIC_STATE, 5_000)}

NPC RILEVANTI — identità e memoria vincolanti:
${clipForConstrainedModel(vars.NPC_STRATEGIC_PROFILES, 6_500)}

PROCESSI GIÀ APERTI:
${clipForConstrainedModel(vars.ONGOING_PROCESSES, 2_000) || '(nessuno)'}

CRONACA RECENTE:
${clipForConstrainedModel(vars.ALL_EVENTS_WITH_CONSOLIDATION, 4_500) || '(nessuna)'}

DIPLOMAZIA RECENTE:
${clipForConstrainedModel(vars.CHATS_NON_CONSOLIDATED_ROUNDS, 2_500) || '(nessuna)'}

MAPPA — usa solo nomi presenti:
${clipForConstrainedModel(vars.GRAND_MAP_DESCRIPTION_NO_CITY, 5_000)}

PREMESSA STORICA — fonte del contesto, anche con un prompt personalizzato:
${clipForConstrainedModel(vars.WORLD_BEFORE_ROUND_ONE_TEXT, 2_000)}

REGOLE SCENARIO:
${clipForConstrainedModel(vars.HISTORICAL_PRESET_SIMULATION_RULES, 1_000)}
${opts.presetOverride ? `\nISTRUZIONI AGGIUNTIVE DEL PRESET (non sostituiscono premessa e cronaca):\n${clipForConstrainedModel(opts.presetOverride, 1_000)}\n` : ''}

REGOLE:
1. Ogni evento: causa già visibile → decisione autonoma → conseguenza proporzionata. Non copiare l’ordine come notizia.
2. Il giocatore controlla solo ${vars.PLAYER_POLITY}. Altre politie decidono per sé secondo priorità, risorse, rapporti e memoria. Nessun accordo è concluso senza reaction favorevole/condizionata della controparte. Coerenza dei soggetti: nomina solo chi agisce, subisce o ha un interesse documentato; ${vars.PLAYER_POLITY} compare solo se il fatto la tocca direttamente, mai come comparsa o spettatrice. "reactions"/"startChat" solo per le politie direttamente coinvolte: in una crisi locale reagiscono la controparte e i vicini, non potenze lontane senza interesse documentato.
3. Ordine composto: se solo una fase è fattibile usa partial e mostra soltanto quella fase; se nulla è fattibile usa rejected/voided e nessun mapChanges.
4. Reazione NPC: indica priority, response e solo se reale counterAction. Una controazione materiale (mobilitazione, unità terrestre o navale, cantiere, opera completata) deve avere anche le mapChanges corrispondenti nello stesso evento, nel territorio della politia che agisce. Se influenza un altro NPC, anche quello reagisce autonomamente. Massimo 4 reazioni pertinenti.
4b. Iniziativa NPC: le nazioni non giocate non sono comparse. Quando una causa documentata esiste (confine teso, minaccia, alleanza, ultimatum, crisi aperta, opportunità), almeno una adotta una misura autonoma concreta, difensiva (fortification, base, airbase, radar, missile_site, mobilitazione di riserve, patto difensivo) o offensiva (concentramento, raid, blocco navale, ultimatum armato, preparazione d'invasione), con la mapChange corrispondente se materiale. Se non c'è causa, il mondo può restare fermo.
4c. Reazioni interne ed economia: se una nazione mobilita, schiera, spende o impone un embargo, l'evento narra anche cosa ne pensano popolazione e istituzioni (consenso o protesta, dibattito o repressione) e il costo economico proporzionato (deficit, tasse, razionamenti), preso dal Dossier nazionale calcolato dal motore (saldo, stabilità, riserve mobilitate, sforzo bellico, tensione sociale). Niente cifre inventate. Vale anche per le nazioni NPC.
5. Mappa: start_construction/update_construction/complete_construction per cantieri/opere; start_mobilization/complete_mobilization per formazioni in preparazione/operative; spawn_unit/move_unit/remove_unit per unità operative. Tipi unità: battalion|army|fleet|missile. Tipi opere: factory|port|university|base|airbase|naval_base|fortification|radar|missile_site|infrastructure|power_plant. Annunci, studi e ordini respinti non creano marker. Una nuova formazione nasce in una provincia controllata da chi la crea, la più vicina al riferimento citato ("vicino a X", "al confine con X"); non nel territorio di un'altra politia senza incursione esplicita. Se un ordine accettato dispone che una formazione esistente avanzi o si sposti, emetti SEMPRE "move_unit" (unità, origine, destinazione): senza di esso l'unità resterebbe ferma.
6. Scontri: per ogni battaglia scrivi una cronaca militare completa (attaccante, difensore, provincia contesa, andamento, perdite proporzionate, esito e conseguenza) e fai reagire la controparte in "reactions". Province occupate: il motore assegna il colore dell'occupante, usa "transfer" col nome del nuovo proprietario.
7. Genera massimo ${maxEvents} eventi cronologici.${opts.autoJump ? ' Fermati al primo/ultimo evento significativo consentito dal budget.' : ''}
8. Nei salti lunghi produci più dispacci concreti e datati (mobilitazioni, scontri, occupazioni, trattative, economia), non un unico riassunto.
9. Dispacci in italiano narrativo: headline e description sono frasi complete per il giocatore. VIETATE etichette tecniche o di stato ("neutral", "supportive", "opposed", "conditional", "hostile", "ally", "counterparty", nomi di campi JSON, "partial", "voided", ID). La posizione diplomatica va raccontata («La Turchia annuncia la propria neutralità»), mai scritta come parola chiave («Turchia neutral»).
10. Il giocatore incarna ${vars.PLAYER_POLITY}: ogni suo ordine è un atto ufficiale della nazione. Nei dispacci l'attore è sempre ${vars.PLAYER_POLITY} (governo, capo di Stato, ministri), MAI «il giocatore» o «l'utente»; le altre nazioni la nominano e trattano con lei come soggetto politico reale.

${buildImmersionContract()}
OUTPUT NDJSON, una riga JSON per oggetto, niente markdown.
Riga evento:
{"type":"event","headline":"attore + decisione concreta","description":"${EVENT_DESCRIPTION_GUIDE}","date":"YYYY-MM-DD","mapChanges":[],"reactions":[{"polityName":"nome esistente","role":"counterparty|ally|mediator|observer","stance":"supportive|opposed|conditional|neutral","priority":"interesse rilevante","response":"decisione concreta","counterAction":"misura concreta opzionale"}]}

ULTIMA riga obbligatoria:
{"type":"complete","narration":"sintesi dei soli eventi emessi","actionOutcomes":[{"actionId":"ID ESATTO","status":"accepted|partial|rejected","summary":"esito specifico","expectedDate":"YYYY-MM-DD solo se partial","eventHeadlines":[]}],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":${completionDateJson}}
Per nessun evento in auto-jump: nessuna riga event e targetDate:null.`;
}

export function buildSimulationPrompt(vars: PromptVariables, opts?: { autoJump?: boolean; eventBudget?: number }): string {
  const autoJumpInstruction = opts?.autoJump ? buildAutoJumpInstruction(vars, opts?.eventBudget ?? 1) : '';
  return `Simuli un gioco strategico a turni. Il giocatore controlla la politia-stato ${vars.PLAYER_POLITY}; tutte le altre politie del mondo sono gestite da te.

Il giocatore può tentare qualsiasi cosa, ma il successo delle sue azioni dipende dal realismo. NON eseguire MAI azioni PER conto del giocatore: un evento compiuto dalla politia ${vars.PLAYER_POLITY} avviene SOLO se il giocatore ne ha dato ordine esplicito in questo turno. Persino le azioni storiche di questa nazione simulale solo se il giocatore le ha realmente intraprese. Se il giocatore non ha compiuto azioni, la sua politia non prende iniziative.

${buildPlayerIdentityGuard(vars)}
${buildSubjectCoherenceGuard(vars)}

${vars.DIFFICULTY_DESCRIPTION_JUMP_FORWARD}

[Contesto di gioco]

Questa è la descrizione della linea temporale e del mondo prima dell'inizio della partita:

${vars.WORLD_BEFORE_ROUND_ONE_TEXT}

[Regole di simulazione]

${vars.HISTORICAL_PRESET_SIMULATION_RULES}

Ogni politia in questa partita ha un colore e un nome propri.

*Cambiamento di regime (Regime Change).* Nome e colore di una politia cambiano SOLO quando muta il modo fondamentale di governare: una democrazia diventa comunista, una monarchia diventa repubblica, un regime fascista ne sostituisce un altro. Un nuovo presidente, re o primo ministro NON è un cambio di regime: non toccare nome e colore. Non confondere gli Stati fantoccio con i loro sovrani. Se il giocatore chiede di cambiare nome o colore della propria politia, consenti anytime.

[Causa ed effetto — regola non negoziabile]

La simulazione NON è un generatore di notizie: ogni evento è una conseguenza del mondo già esistente o di un ordine del giocatore. Prima di scrivere ogni evento, individua internamente una catena «causa verificabile → reazione → conseguenza»; se non trovi una causa nelle sezioni qui sotto, NON generare l'evento.

Fonti di causa ammesse, in ordine di priorità:
1. un ordine del giocatore del turno corrente (deve produrre un esito, una reazione o essere inserito in "voided");
2. un fatto irrisolto della [Storia degli eventi], citandone il soggetto e l'effetto già in corso;
3. un impegno/rifiuto/ultimatum della [Diplomazia];
4. risorse, confini e rapporti indicati nello [Stato strategico attuale];
5. la premessa storica iniziale, soltanto se è coerente con data e cronaca.

Nell'apertura della descrizione spiega il contesto e il grilletto concreto: una mobilitazione documentata, un trattato precedente, una perdita territoriale o un problema già presente nel preset. Non dare per scontato che il lettore ricordi gli antefatti. Il seguito espone lo sviluppo nuovo e le conseguenze proporzionate, senza formule ripetitive.

- Un ordine del giocatore non dà automaticamente successo: verifica risorse, confini, diplomazia e tempi. Se è impossibile, usa "voided"; se richiede tempo, mostra una misura preparatoria e rinvia l'esito.
- Per un ordine composto non usare un rifiuto indiscriminato: separa mentalmente le fasi. Se il risultato finale è impossibile ma una preparazione proporzionata è davvero attuabile, usa outcome partial e rappresenta soltanto l'effetto concreto iniziato (per esempio mobilitazione, non conquista). Se nessuna fase è attuabile, rejected/voided senza mapChanges.
- Le altre politie possono reagire a un incentivo visibile (minaccia al confine, commercio, guerra, trattato, crisi già avviata) oppure prendere un'iniziativa propria SOLO se deriva da un obiettivo già dichiarato, risorse disponibili, un impegno diplomatico o una crisi documentata nello stato strategico. Non far nascere colpi di Stato, invasioni, alleanze o crisi economiche dal nulla.
- Mantieni proporzione temporale: in 30 giorni predominano decreti, mobilitazioni, negoziati e primi effetti; conquiste, regimi rovesciati e svolte economiche richiedono cause e preparazione nei turni precedenti.
- Le conseguenze non maturano tutte all'istante: semina nell'evento i presupposti del turno successivo e riprendili nella cronaca.
- Preferisci pochi eventi collegati in una stessa catena a molti eventi indipendenti. Se nel periodo non segue altro in modo credibile, fermati prima del limite.

[CICLO MONDIALE OBBLIGATORIO]
Ogni avanzamento temporale simula l'intero mondo, non soltanto la politia del giocatore. Valuta per tutte le altre politie le conseguenze nel periodo: reazioni a ordini, sviluppo di trattative, mobilitazioni, commercio, crisi o impegni già presenti nella cronaca e nello stato strategico.
- Se un ordine del giocatore coinvolge o influenza un'altra politia, inserisci nello stesso evento una risposta autonoma e concreta della controparte nel campo "reactions". Una proposta, richiesta, minaccia o offerta del giocatore non vale come accettazione altrui: senza consenso esplicito della controparte resta proposta pendente o viene respinta.
- Ogni NPC decide in quest'ordine: priorità pertinente → capacità/costi → rapporti e memoria → posizione → eventuale controazione. Riporta la priorità in "priority" e una misura autonoma effettiva in "counterAction". Non cambiare personalità per rendere il turno più spettacolare. Le mapChanges riguardano TUTTE le politie: una misura NPC che avvia una mobilitazione, crea o sposta un'unità terrestre o navale, apre un cantiere o completa un'opera diventa marker nello stesso evento, nel territorio della politia che agisce.
- Anche senza ordini del giocatore, fai progredire almeno un filone già documentato di una politia non giocante quando esiste una causa verificabile; il giocatore può osservare il mondo ma la sua politia non agisce senza ordine.
- Dai priorità a 1-3 reazioni o iniziative internazionali collegate, invece di elencare notizie scollegate. Se nessuna causa è documentata, non inventare un fatto: avanza comunque tempo ed economia in modo coerente.
${buildNpcAgencyGuard(vars)}
${buildDomesticReactionGuard(vars)}

*Qualità dei dispacci.* Ogni evento è un breve articolo verificabile, non un titolo generico.
- Titolo: soggetto + verbo d’azione + luogo/oggetto concreto (massimo 12 parole). Per un ordine del giocatore, usa il nome della sua politia o della controparte coinvolta. Mai “Tensioni crescono”, “Nuova crisi”, “Bollettino”, “Evento”, una cifra di bilancio o formule vaghe.
- Corpo: ${EVENT_DESCRIPTION_GUIDE}. Indicativamente 4-6 frasi: chiarisci perché questa notizia conta nel contesto della partita, non limitarti a registrare l'esito dell'ordine.
- Usa cifre solo se presenti nello stato o proporzionate e necessarie; non inventare presidenti, ministri o dati statistici non forniti. Distingui chiaramente proposta, misura avviata e risultato ottenuto.
- Tono da cronaca storica: sobrio, concreto, senza linguaggio da videogame né aggettivi promozionali. Preferisci la precisione di un dispaccio d’agenzia o di un articolo di prima pagina.

*Notizie sugli scontri.* Quando due o più politie vengono alle armi, il dispaccio di battaglia è una cronaca militare completa, non un titolo riassuntivo:
- nomina chi attacca e chi difende, il fronte o la provincia contesa e la data o il periodo;
- descrivi l'andamento (sfondamento, controffensiva, assedio, ritirata, bombardamento, blocco navale) con coerenza rispetto a forze e geografia;
- riporta l'esito e le perdite in forma proporzionata e plausibile (vittime, prigionieri, mezzi, territorio perduto o riconquistato), senza inventare cifre precise non giustificate;
- aggiungi la conseguenza immediata (provincia occupata, governo in fuga, tregua, appello internazionale) e una reazione della controparte nel campo "reactions".

*Volume della cronaca.* Nei salti lunghi non limitarti a un solo dispaccio: copri cause e conseguenze con più eventi distinti e datati (mobilitazioni, scontri, occupazioni, dichiarazioni, trattative, effetti economici), mantenendo ogni evento agganciato a una causa verificabile. Meglio 4-8 dispacci concreti e collegati che un unico riassunto generico.

[Struttura di gioco]

Nel gioco esiste una mappa dinamica. Curalo con attenzione i trasferimenti di regioni.

*Comprensione delle regioni.* Nel gioco esistono esattamente ${vars.GRAND_MAP_DESCRIPTION_NO_CITY.split('\n\n').length} regioni. Le regioni non sono solo terraferma: includono mari e stretti.

*Battaglioni e unità.* Appaiono sulla mappa e possono muoversi (battalion|army|fleet|missile). Quando un ordine del giocatore dispone che una formazione esistente avanzi, invada, si schieri o si sposti, l'esito accettato DEVE contenere una mapChange "move_unit" con il nome esatto dell'unità, la provincia di origine e quella di destinazione; se non è possibile muoverla, spiega il motivo e usa rejected/voided, non lasciare l'ordine senza effetto. Non creare una seconda unità identica al posto di quella esistente.

*Regole di output importanti:*
- Ogni evento ha un titolo, una descrizione ed eventualmente modifiche alla mappa
- Il titolo è una frase singola
- La descrizione contiene dettagli di qualità
- Il numero di eventi è proporzionale alla durata del salto temporale: più tempo passa, più eventi ci sono, ma MAI più di 25-30 per turno. In un salto lungo distribuisci gli eventi uniformemente su tutto il periodo — non interrompere la simulazione a metà
- Citazioni per il quaderno (notebook): 0-3 eventi
- NON creare eventi-fantoccio: "Niente è accaduto", "Inizio dell'anno", "Fine dell'anno", "Bilancio dell'anno". Costruisci una cronaca: ogni evento è significativo
- NON inventare un secondo filone mondiale solo per coprire più paesi: segui prima le conseguenze delle azioni del giocatore e delle crisi già aperte. Un paese lontano entra nella cronaca soltanto se ha un collegamento esplicito con tali cause
- Copri il mondo tramite catene causali reali: politica, economia e guerra devono restare collegate alla politia del giocatore, alla cronaca o alla diplomazia
- NON scrivere MAI "(fictional)", "(a-historical)" o "Player Polity" nei titoli e nei testi degli eventi. Chiama la politia del giocatore semplicemente con il suo nome

[Regole di modifica della mappa]

- Creare una nuova politia — nuovo nome, colore, regioni
- Eliminare una politia — tutte le regioni diventano neutrali
- Aggiornare una politia — cambiare nome/colore di una esistente
- Trasferire una regione — semplice cambio di proprietario (il motore assegna sempre il colore della nazione che la controlla: non serve indicare un colore per una nazione già esistente).
- Rappresentare oggetti territoriali concreti: cantieri, opere completate, unità operative, movimenti e rimozioni. Gli oggetti compaiono soltanto nello stesso evento che prova l'effetto materiale, mai perché un ordine li nomina. Anche le iniziative materiali delle altre nazioni usano le stesse regole e la stessa mappa.
- IMPORTANTE: regioni e politie vanno indicate SOLO con i nomi, esattamente come
  compaiono nell'[Descrizione della mappa] qui sotto (es. "Germania", "USA").
  Nessun id, nessuna coordinata, nessun nome inventato.

*Trasferimento di regioni.*
- In guerra e in conflitto i passaggi sono frequenti; in tempo di pace sono rari ma possibili (cessione, vendita, trattato)
- Trasferisci le regioni in modo graduale e logico: la regione conquistata deve confinare con il fronte / territorio del conquistatore. Non lasciare una regione completamente accerchiata dal nemico senza una spiegazione plausibile (sacca, enclave)
- Al momento del trasferimento di una regione NON è obbligatorio creare una nuova politia — dipende dalla situazione

*Ciclo di vita delle politie.*
- Se una nuova politia sorge sulle regioni di quella distrutta, crea prima la nuova politia, poi trasferiscile le regioni
- Sciogli una politia SOLO se non le restano regioni E il suo governo e il suo popolo hanno perso la volontà di esistere come tale politia; in caso contrario — governo in esilio sull'ultima regione
- Guerra civile: crea polizie-fazione in regioni plausibili (o storicamente coerenti) della vecchia politia. Se la vecchia politia partecipa lei stessa alla guerra — aggiorna il suo nome/colore; se si frantuma in fazioni — scioglila e creane di nuove
- Stati fantoccio: ogni Stato subordinato proclamato è una nuova politia distinta nel posto giusto

[Bandiere]

Le politie possono avere bandiere. Descrivi la nuova bandiera se è logico farlo.

[Lingua]

Il tuo output deve essere SEMPRE in italiano.

[Storia degli eventi]

Questa è la cronaca di tutto ciò che è accaduto nei turni precedenti:

${vars.ALL_EVENTS_WITH_CONSOLIDATION || '(Non ci sono ancora eventi — è il primo turno)'}

[Date]

Data iniziale della partita: ${vars.STARTING_ROUND_DATE}
Data corrente (Origin Date): ${vars.ORIGIN_ROUND_DATE}
Data obiettivo (Target Date): ${vars.TARGET_ROUND_DATE}

Turno: ${vars.CURRENT_ROUND_NUMBER}

[Azioni del giocatore]

Azioni del giocatore in questo turno:

${vars.PLAYER_ACTIONS_THIS_ROUND || '(Nessuna azione)'}

[Tutte le azioni passate]

${vars.PLAYER_EVERY_ACTION_NOT_PREVIOUS || '(Nessuna azione passata)'}

[Descrizione della mappa]

${vars.GRAND_MAP_DESCRIPTION_NO_CITY}

[Stato strategico attuale — fonte di verità]

${vars.STRATEGIC_STATE}

[Personalità, priorità e memoria NPC — fonte vincolante]

${vars.NPC_STRATEGIC_PROFILES}

Questi dossier stabiliscono come le politie valutano ordini e azioni altrui. Mantieni la personalità fra i turni; aggiorna la posizione solo quando capacità, rapporti o memoria mostrano un nuovo fatto concreto. Se un NPC agisce contro interessi o impegni di un altro NPC, anche l'attore colpito decide per sé. Non inventare ricordi assenti.

[Processi in corso]

${vars.ONGOING_PROCESSES || '(Nessun processo in corso)'}

Se la sezione non è vuota, questi impegni sono già avviati e NON risolti:
- se il completamento previsto di un processo cade nel periodo simulato, un evento del periodo deve portarlo avanti o concluderlo in modo causale (risorse, tempo, opposizione), senza ripetere il testo dell'ordine originale;
- per concludere un processo, l'ordine del giocatore che lo porta a termine (anche riformulato) dichiara in actionOutcomes "completesProjectId" copiando il projectId mostrato; mai il titolo;
- se il processo matura ma richiede ancora tempo, aggiorna l'esito dell'ordine collegato con "partial" e una nuova expectedDate;
- non inventare il completamento: se niente nel periodo può concluderlo, lascialo aperto e non menzionarlo.

Tutte queste informazioni riflettono la situazione geopolitica alla data: ${vars.ORIGIN_ROUND_DATE}

[Diplomazia]

${vars.CHATS_NON_CONSOLIDATED_ROUNDS || '(Non ci è stata diplomazia)'}

---

Ora simula gli eventi tra il ${vars.ORIGIN_ROUND_DATE} e il ${vars.TARGET_ROUND_DATE}.

Il tuo output DEVE essere nel seguente formato JSON:
{
  "events": [
    {
      "headline": "Titolo dell'evento",
      "description": "${EVENT_DESCRIPTION_GUIDE}",
      "date": "YYYY-MM-DD",
      "mapChanges": [
        {
          "type": "transfer|create|update|delete|create_polity|start_construction|update_construction|complete_construction|build_facility|start_mobilization|complete_mobilization|spawn_unit|move_unit|remove_unit",
          "regionName": "NOME della regione dalla descrizione della mappa",
          "targetRegionName": "NOME destinazione solo per move_unit",
          "newOwner": "NOME della politia dalla descrizione della mappa (se transfer/create)",
          "newColor": "#hex (se update o nuova politia)",
          "feature": { "type": "tipo oggetto", "name": "nome univoco" }
        }
      ],
      "reactions": [
        {
          "polityName": "NOME politia NPC esistente",
          "role": "counterparty|ally|mediator|observer",
          "stance": "supportive|opposed|conditional|neutral",
          "priority": "priorità del dossier che guida la decisione",
          "response": "decisione ufficiale concreta e motivata",
          "counterAction": "eventuale misura autonoma realmente decisa nel periodo"
        }
      ]
    }
  ],
  "narration": "Narrativa complessiva del periodo (3-5 frasi)",
  "actionOutcomes": [
    { "actionId": "ID esatto di ciascun ordine ricevuto", "status": "accepted|partial|rejected", "summary": "esito specifico dell'ordine", "expectedDate": "YYYY-MM-DD solo se partial", "eventHeadlines": ["titolo evento pertinente"] }
  ],
  "voided": [
    { "action": "testo dell'azione del giocatore", "reason": "perché è irrealistica" }
  ],
  "startChat": [
    {
      "participants": ["NOME della politia promotrice", "EVENTUALE altra politia coinvolta"],
      "topic": "primo messaggio concreto e ordine del giorno",
      "kind": "meeting|summit|negotiation|conference|ultimatum|technical|statement",
      "eventHeadline": "titolo ESATTO dell'evento che apre il contatto"
    }
  ],
  "relationshipChanges": [
    { "from": "NOME politia", "to": "NOME politia", "relationship": "ally|neutral|hostile", "reason": "accordo o evento che causa il cambiamento" }
  ],
  "worldChanges": {
    "regionOwners": { "NOME regione": "NOME politia" },
    "regionColors": { "NOME regione": "#hex" }
  }
}

Regole mapChanges:
- Territorio/politie: "transfer", "create"/"update"/"delete", "create_polity".
- Cantiere materialmente aperto: "start_construction" con feature.type finale fra factory, port, university, base, airbase, naval_base, fortification, radar, missile_site, infrastructure, power_plant. Opera divenuta operativa: "complete_construction" con stesso nome e tipo finale; "build_facility" è il sinonimo legacy per un'opera già completata.
- Mobilitazione/reclutamento realmente iniziato ma non ancora operativo: "start_mobilization"; quando la formazione diventa operativa usa "complete_mobilization" con stesso nome/tipo, se annullata "cancel_mobilization". Una formazione già operativa usa "spawn_unit" con feature.type battalion, army, fleet o missile.
- Movimento reale di unità esistente: "move_unit" con targetRegionName; distruzione/scioglimento: "remove_unit". "spawn_battalion" e "move_battalion" restano sinonimi legacy.
- Una richiesta, un annuncio, uno studio, un ordine respinto o un piano senza lavori NON crea oggetti. Un outcome partial può creare un cantiere o una mobilitazione soltanto se attività materiali sono iniziate: non rappresentare in anticipo il risultato finale desiderato.
- Collocazione: una nuova formazione, mobilitazione o fortificazione nasce in una provincia controllata dalla politia che la crea; se l'ordine dice "vicino a X", "al confine con X" o "di frontiera", scegli la provincia controllata più vicina a X. Non creare una formazione nel territorio di un'altra politia senza un ordine esplicito di incursione o invasione.
- Misure NPC difensive e offensive (fortificazioni, basi aeree, radar, batterie costiere e missilistiche, mobilitazioni di riserve, concentramenti, raid, blocchi navali, preparazioni d'invasione) delle altre nazioni seguono le stesse regole e diventano marker quando sono materialmente iniziate o operative.
- "regionName", "targetRegionName" e "newOwner" usano SOLO nomi presenti nella mappa (salvo nuova politia). NON usare coordinate e non duplicare oggetti già esistenti.
- Se non cambia né il controllo territoriale né un oggetto fisico/operativo, lascia "mapChanges" vuoto. "worldChanges.regionOwners" duplica i passaggi di proprietà finali per nome.

Regole reactions:
- Se un ordine nomina, contatta, minaccia, influenza o richiede cooperazione a una politia NPC, quella politia deve comparire nello stesso evento e decidere autonomamente; massimo 4 reazioni direttamente pertinenti.
- Segui il dossier persistente dell'NPC: "priority" deve richiamare l'interesse che guida la decisione e "counterAction" contiene soltanto una misura concreta davvero adottata nel periodo.
- Se un'azione o controazione NPC influenza direttamente un'altra politia NPC, anche quella politia decide autonomamente nel medesimo evento o nel successivo evento causale.
- Non eseguire decisioni per le controparti. Un accordo può risultare concluso solo se ogni controparte necessaria risponde supportive o conditional con condizioni soddisfatte. Altrimenti l'ordine resta proposta, rinvio, rifiuto o controproposta e il suo outcome è partial/rejected.
- La descrizione racconta iniziativa, risposta e conseguenza: non deve essere la parafrasi al passato dell'elenco ordini. Per un fatto esclusivamente interno usa "reactions": [].
- Teatro della crisi: in un conflitto o in una crisi di confine reagiscono la controparte diretta, i vicini (del giocatore e della controparte) e le organizzazioni regionali pertinenti. Non aggiungere potenze lontane senza interesse documentato né note di comodo da capitali irrilevanti.
${buildDispatchStyleGuard()}
${buildPlayerIdentityGuard(vars)}
${buildSubjectCoherenceGuard(vars)}

Regole actionOutcomes e voided:
- Restituisci ESATTAMENTE un actionOutcomes per ogni ordine ricevuto, copiando il suo actionId esatto. Non usare il testo o la posizione come identificatore. accepted = effetto avviato/conseguito, partial = preparazione o risultato incompleto, rejected = non attuabile; summary descrive solo quell'ordine. expectedDate è ammessa solo per partial, deve essere una data YYYY-MM-DD futura e causalmente stimabile; omettila se non conosci una data realistica.
- Se un'azione del giocatore è irrealistica per questo mondo e questo periodo
  (es. "conquistare il mondo in una settimana", tecnologie del futuro) — NON
  eseguirla e inseriscila in "voided" con una spiegazione chiara per il
  giocatore. Le altre azioni eseguile normalmente. Se tutto è realistico,
  usa "voided": [].
- "startChat": se un evento provoca una risposta diplomatica, una riunione,
  un vertice, una conferenza, un negoziato, un ultimatum o un tavolo tecnico,
  crea qui il relativo canale. "participants" deve contenere tutte e sole le
  politie NPC direttamente coinvolte (prima la promotrice), usando nomi
  esistenti nella mappa; il giocatore viene aggiunto automaticamente. Una
  politia apre una chat diretta, due o più una riunione di gruppo.
  "eventHeadline" deve copiare ESATTAMENTE il titolo dell'evento causale e
  "topic" deve essere il primo messaggio concreto, non un'etichetta generica.
  Non creare chat per ogni notizia: soltanto quando gli attori hanno davvero
  motivo di comunicare. Se nessuna, usa "startChat": [].
- Le chat nella sezione [Diplomazia] sono impegni reali: accordi, patti,
  ultimatum e rifiuti devono influenzare eventi e narrazione. Quando cambiano
  concretamente i rapporti fra due politie, registralo in relationshipChanges;
  altrimenti usa "relationshipChanges": []. Usa soltanto ally, neutral, hostile.
${autoJumpInstruction}

VERY IMPORTANT: Rispondi SOLO con JSON valido, senza formattazione markdown, senza spiegazioni.`;
}

export type IncrementalSimulationRecord =
  | { type: 'event'; event: SimulationEvent }
  | { type: 'complete'; result: SimulationResult };

/** Estrae oggetti JSON completi anche se il modello li formatta su più righe. */
export function extractCompleteJsonObjects(text: string): any[] {
  const records: any[] = [];
  let start = -1, depth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start < 0) {
      if (ch === '{') { start = i; depth = 1; }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      const candidate = text.slice(start, i + 1);
      try {
        records.push(JSON.parse(candidate));
      } catch {
        try { records.push(parseJsonLoose(candidate)); } catch { /* record non riparabile */ }
      }
      start = -1;
    }
  }
  return records;
}

/** Normalizza un record dello stream usando lo stesso validatore del formato batch. */
export function parseIncrementalSimulationRecord(raw: any): IncrementalSimulationRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const recordType = normalizedToken(raw.type || raw.recordType || raw.kind);
  const looksLikeEvent = ['event', 'evento'].includes(recordType)
    || (!recordType && typeof firstString(raw.headline, raw.title, raw.titolo) === 'string'
      && (typeof raw.date === 'string' || typeof raw.eventDate === 'string' || typeof raw.data === 'string'));
  if (looksLikeEvent) {
    const candidate = raw.event && typeof raw.event === 'object' ? raw.event : raw;
    const event = parseSimulationResponse(JSON.stringify({ events: [candidate] })).events[0];
    return event ? { type: 'event', event } : null;
  }
  const looksLikeCompletion = ['complete', 'completion', 'final', 'result', 'risultato'].includes(recordType)
    || (!recordType && !Array.isArray(raw.events) && !Array.isArray(raw.eventi)
      && typeof raw.narration === 'string' && (Array.isArray(raw.actionOutcomes) || Array.isArray(raw.action_outcomes)));
  if (looksLikeCompletion) {
    const result = parseSimulationResponse(JSON.stringify({ ...raw, events: [] }));
    return { type: 'complete', result };
  }
  return null;
}

/** Converte l'intero NDJSON in SimulationResult; accetta anche il vecchio JSON batch. */
export function parseIncrementalSimulationResponse(text: string): SimulationResult {
  const records = extractCompleteJsonObjects(text)
    .map(parseIncrementalSimulationRecord)
    .filter((r): r is IncrementalSimulationRecord => !!r);
  if (records.length === 0) return parseSimulationResponse(text);

  const events = records.filter((r): r is Extract<IncrementalSimulationRecord, { type: 'event' }> => r.type === 'event')
    .map(r => r.event);
  const complete = [...records].reverse().find((r): r is Extract<IncrementalSimulationRecord, { type: 'complete' }> => r.type === 'complete');
  // §9.2/T36: eventi emessi ma nessuna chiusura del periodo = budget esaurito
  // prima della destinazione. Il chiamante non può dichiarare il salto
  // completato sulla parola di una risposta troncata.
  return { ...(complete?.result || parseSimulationResponse('{}')), events, incomplete: records.length > 0 && !complete };
}

const MAP_CHANGE_TYPES = new Set<MapChange['type']>([
  'transfer', 'create', 'update', 'delete', 'spawn_battalion', 'move_battalion',
  'spawn_unit', 'move_unit', 'remove_unit', 'start_mobilization', 'complete_mobilization',
  'cancel_mobilization', 'create_polity', 'build_facility', 'start_construction',
  'update_construction', 'complete_construction', 'cancel_construction',
]);

const MAP_TYPE_ALIASES: Record<string, { type: MapChange['type']; featureType?: string }> = {
  create_army: { type: 'spawn_unit', featureType: 'army' },
  spawn_army: { type: 'spawn_unit', featureType: 'army' },
  add_army: { type: 'spawn_unit', featureType: 'army' },
  create_battalion: { type: 'spawn_unit', featureType: 'battalion' },
  add_battalion: { type: 'spawn_unit', featureType: 'battalion' },
  create_fleet: { type: 'spawn_unit', featureType: 'fleet' },
  move_army: { type: 'move_unit', featureType: 'army' },
  move_fleet: { type: 'move_unit', featureType: 'fleet' },
  move_troops: { type: 'move_unit', featureType: 'army' },
  move_troop: { type: 'move_unit', featureType: 'army' },
  relocate_unit: { type: 'move_unit' },
  relocate_army: { type: 'move_unit', featureType: 'army' },
  transfer_unit: { type: 'move_unit' },
  occupy: { type: 'transfer' },
  occupied: { type: 'transfer' },
  occupation: { type: 'transfer' },
  occupy_region: { type: 'transfer' },
  annex: { type: 'transfer' },
  annex_region: { type: 'transfer' },
  conquer_region: { type: 'transfer' },
  capture_region: { type: 'transfer' },
  destroy_unit: { type: 'remove_unit' },
  disband_unit: { type: 'remove_unit' },
  mobilize: { type: 'start_mobilization' },
  mobilise: { type: 'start_mobilization' },
  start_recruitment: { type: 'start_mobilization' },
  finish_mobilization: { type: 'complete_mobilization' },
  finish_mobilisation: { type: 'complete_mobilization' },
  start_building: { type: 'start_construction' },
  finish_construction: { type: 'complete_construction' },
  build_fortification: { type: 'complete_construction', featureType: 'fortification' },
  build_base: { type: 'complete_construction', featureType: 'base' },
};

const FEATURE_TYPE_ALIASES: Record<string, string> = {
  troops: 'army', unit: 'battalion', division: 'battalion', brigade: 'battalion',
  fort: 'fortification', fortress: 'fortification', military_base: 'base',
  air_base: 'airbase', airfield: 'airbase', navalbase: 'naval_base',
  naval_base: 'naval_base', missilebase: 'missile_site', missile_base: 'missile_site',
  powerplant: 'power_plant', power_station: 'power_plant', construction: 'construction_site',
};

function normalizedToken(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
}

function firstString(...values: unknown[]): string | undefined {
  const found = values.find(value => typeof value === 'string' && value.trim());
  return typeof found === 'string' ? found.trim() : undefined;
}

/** Adapter tollerante per errori di schema tipici dei modelli piccoli. */
function normalizeMapChange(raw: any): MapChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawType = normalizedToken(raw.type || raw.changeType || raw.action);
  const alias = MAP_TYPE_ALIASES[rawType];
  const type = alias?.type || rawType as MapChange['type'];
  if (!MAP_CHANGE_TYPES.has(type)) return null;

  const rawFeature = raw.feature && typeof raw.feature === 'object' ? raw.feature : {};
  const featureTypeToken = normalizedToken(
    rawFeature.type || raw.featureType || raw.unitType || raw.facilityType || alias?.featureType,
  );
  const featureType = FEATURE_TYPE_ALIASES[featureTypeToken] || featureTypeToken;
  const featureName = firstString(rawFeature.name, raw.featureName, raw.unitName, raw.facilityName);
  const featureId = firstString(rawFeature.id, raw.featureId, raw.unitId);
  const feature = featureType || featureName || featureId
    ? {
        type: featureType as NonNullable<MapChange['feature']>['type'],
        name: featureName || '',
        ...(featureId ? { id: featureId } : {}),
        ...(rawFeature.metadata && typeof rawFeature.metadata === 'object' && !Array.isArray(rawFeature.metadata)
          ? { metadata: rawFeature.metadata }
          : {}),
      }
    : undefined;

  return {
    type,
    regionName: firstString(raw.regionName, raw.region, raw.province, raw.location),
    regionId: firstString(raw.regionId),
    newOwner: firstString(raw.newOwner, raw.owner, raw.targetOwner),
    newColor: firstString(raw.newColor, raw.color),
    newName: firstString(raw.newName),
    targetRegionName: firstString(raw.targetRegionName, raw.targetRegion, raw.destination, raw.toRegion),
    feature,
  };
}

function normalizeReaction(raw: any): SimulationPolityReaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const polityName = firstString(raw.polityName, raw.polity, raw.country, raw.nation, raw.actor);
  const counterAction = firstString(raw.counterAction, raw.counter_action, raw.measure, raw.actionTaken);
  const response = firstString(raw.response, raw.decision, raw.message, raw.statement, raw.text, counterAction);
  if (!polityName || !response) return null;

  const roleAliases: Record<string, SimulationPolityReaction['role']> = {
    counterparty: 'counterparty', controparte: 'counterparty', ally: 'ally', alleato: 'ally',
    mediator: 'mediator', mediatore: 'mediator', observer: 'observer', osservatore: 'observer',
  };
  const stanceAliases: Record<string, SimulationPolityReaction['stance']> = {
    supportive: 'supportive', favorevole: 'supportive', support: 'supportive', accepted: 'supportive',
    opposed: 'opposed', contraria: 'opposed', contrario: 'opposed', rejected: 'opposed',
    conditional: 'conditional', condizionata: 'conditional', condizionato: 'conditional',
    neutral: 'neutral', neutrale: 'neutral', pending: 'neutral',
  };
  return {
    polityName: polityName.substring(0, 200),
    role: roleAliases[normalizedToken(raw.role)] || 'counterparty',
    stance: stanceAliases[normalizedToken(raw.stance || raw.position)] || 'neutral',
    response: response.substring(0, 2_000),
    priority: firstString(raw.priority, raw.interest)?.substring(0, 300),
    counterAction: counterAction?.substring(0, 800),
  };
}

export function parseSimulationResponse(text: string): SimulationResult {
  const emptyWorldChanges = { regionOwners: {}, regionColors: {}, newFeatures: [], deletedFeatures: [] };
  try {
    const parsed = parseJsonLoose<any>(text);

    // Normalizzazione severa degli eventi: gli elementi corrotti vengono
    // scartati invece di far fallire il parse
    const events: SimulationEvent[] = [];
    const rawEvents = Array.isArray(parsed.events) ? parsed.events : Array.isArray(parsed.eventi) ? parsed.eventi : [];
    for (const raw of rawEvents) {
      const headline = firstString(raw?.headline, raw?.title, raw?.titolo);
      if (!raw || !headline) continue;
      const reactions = (Array.isArray(raw.reactions) ? raw.reactions : Array.isArray(raw.reazioni) ? raw.reazioni : [])
        .map(normalizeReaction)
        .filter((reaction: SimulationPolityReaction | null): reaction is SimulationPolityReaction => reaction !== null)
        .slice(0, 6);
      events.push({
        headline: headline.substring(0, 500),
        description: firstString(raw.description, raw.detail, raw.descrizione) || '',
        date: firstString(raw.date, raw.eventDate, raw.data) || '',
        mapChanges: (Array.isArray(raw.mapChanges) ? raw.mapChanges : Array.isArray(raw.map_changes) ? raw.map_changes : [])
          .map(normalizeMapChange)
          .filter((change: MapChange | null): change is MapChange => change !== null)
          .slice(0, 40),
        reactions,
      });
    }

    const actionOutcomes: ActionOutcome[] = [];
    const rawOutcomes = Array.isArray(parsed.actionOutcomes)
      ? parsed.actionOutcomes
      : Array.isArray(parsed.action_outcomes) ? parsed.action_outcomes : [];
    const statusAliases: Record<string, ActionOutcome['status']> = {
      accepted: 'accepted', accettato: 'accepted', approved: 'accepted', completed: 'accepted',
      partial: 'partial', parziale: 'partial', pending: 'partial', in_progress: 'partial',
      rejected: 'rejected', rifiutato: 'rejected', denied: 'rejected', voided: 'rejected',
    };
    for (const raw of rawOutcomes) {
      try {
        const normalizedRaw = {
          ...raw,
          actionId: firstString(raw?.actionId, raw?.action_id, raw?.orderId, raw?.order_id),
          action: firstString(raw?.action, raw?.order, raw?.text),
          status: statusAliases[normalizedToken(raw?.status || raw?.esito)] || raw?.status,
          summary: firstString(raw?.summary, raw?.result, raw?.reason, raw?.sintesi) || 'Esito non specificato dal modello.',
          expectedDate: firstString(raw?.expectedDate, raw?.expected_date),
          eventHeadlines: Array.isArray(raw?.eventHeadlines)
            ? raw.eventHeadlines
            : Array.isArray(raw?.event_headlines) ? raw.event_headlines : [],
          completesProjectId: firstString(raw?.completesProjectId, raw?.completes_project_id),
        };
        // Le proprietà opzionali vuote vanno omesse: il contratto distingue
        // assente da stringa vuota.
        if (!normalizedRaw.actionId) delete normalizedRaw.actionId;
        if (!normalizedRaw.action) delete normalizedRaw.action;
        if (!normalizedRaw.expectedDate) delete normalizedRaw.expectedDate;
        if (!normalizedRaw.completesProjectId) delete normalizedRaw.completesProjectId;
        const outcome = parseActionOutcome(normalizedRaw, { allowLegacyText: true });
        actionOutcomes.push({
          ...outcome,
          action: outcome.action || '',
          // Conservato unicamente nel DTO legacy/audit: GameSession non lo usa
          // per chiudere un processo nel percorso canonico.
          completesProcess: typeof raw?.completesProcess === 'string' && raw.completesProcess.trim()
            ? raw.completesProcess.trim().substring(0, 300)
            : undefined,
        });
      } catch (error) {
        if (!(error instanceof DomainContractError)) throw error;
        // Un record individuale corrotto non rende valido un esito inventato.
      }
    }

    const voided: VoidedAction[] = [];
    const rawVoided = Array.isArray(parsed.voided) ? parsed.voided : Array.isArray(parsed.rejected) ? parsed.rejected : [];
    for (const raw of rawVoided) {
      if (!raw || typeof raw.action !== 'string') continue;
      voided.push({ action: raw.action, reason: typeof raw.reason === 'string' ? raw.reason : '' });
    }

    const allowedChatKinds = new Set(['meeting', 'summit', 'negotiation', 'conference', 'ultimatum', 'technical', 'statement']);
    const rawStartChat = Array.isArray(parsed.startChat) ? parsed.startChat : Array.isArray(parsed.start_chat) ? parsed.start_chat : [];
    const startChat: SimulationChatStart[] = rawStartChat
      .filter((c: any) => c && typeof c === 'object')
      .map((c: any) => {
        const legacyName = firstString(c.polityName, c.polity, c.country) || '';
        const rawParticipants = Array.isArray(c.participants)
          ? c.participants
          : Array.isArray(c.countries) ? c.countries : Array.isArray(c.nations) ? c.nations : [];
        const participants = rawParticipants
          .filter((name: unknown): name is string => typeof name === 'string')
          .map((name: string) => name.trim())
          .filter(Boolean);
        if (legacyName && !participants.some((name: string) => name.toLocaleLowerCase('it') === legacyName.toLocaleLowerCase('it'))) {
          participants.unshift(legacyName);
        }
        const uniqueParticipants = participants
          .filter((name: string, index: number, all: string[]) =>
            all.findIndex((candidate: string) => candidate.toLocaleLowerCase('it') === name.toLocaleLowerCase('it')) === index)
          .slice(0, 8);
        if (uniqueParticipants.length === 0) return null;
        const normalizedKind = normalizedToken(c.kind);
        const kindAliases: Record<string, string> = {
          riunione: 'meeting', vertice: 'summit', negoziato: 'negotiation',
          conferenza: 'conference', ultimatum: 'ultimatum', tecnico: 'technical', nota: 'statement',
        };
        const canonicalKind = kindAliases[normalizedKind] || normalizedKind;
        const kind = allowedChatKinds.has(canonicalKind)
          ? canonicalKind as NonNullable<SimulationChatStart['kind']>
          : undefined;
        return {
          // Compatibilità con il percorso/provider precedente.
          polityName: legacyName || uniqueParticipants[0],
          participants: uniqueParticipants,
          topic: (firstString(c.topic, c.message, c.argomento) || '').substring(0, 2_000),
          kind,
          eventHeadline: firstString(c.eventHeadline, c.event_headline, c.eventTitle)?.substring(0, 300),
        };
      })
      .filter((chat: SimulationChatStart | null): chat is SimulationChatStart => chat !== null);
    const rawRelationshipChanges = Array.isArray(parsed.relationshipChanges)
      ? parsed.relationshipChanges
      : Array.isArray(parsed.relationship_changes) ? parsed.relationship_changes : [];
    const relationshipAliases: Record<string, 'ally' | 'neutral' | 'hostile'> = {
      ally: 'ally', allied: 'ally', alleato: 'ally', alleata: 'ally',
      neutral: 'neutral', neutrale: 'neutral',
      hostile: 'hostile', ostile: 'hostile', enemy: 'hostile', nemico: 'hostile',
    };
    const relationshipChanges = rawRelationshipChanges
      .map((c: any) => ({
        from: firstString(c?.from, c?.actor, c?.source),
        to: firstString(c?.to, c?.target, c?.destination),
        relationship: relationshipAliases[normalizedToken(c?.relationship || c?.relation || c?.rapporto)],
        reason: firstString(c?.reason, c?.motivation, c?.motivo),
      }))
      .filter((change: any) => !!change.from && !!change.to && !!change.relationship);

    // M06 µ3: gli effetti strict (ledger/project_tick/shipment/qualitative)
    // sono conservati dal parser e validati nel percorso run strict. Un
    // effetto malformato resta nel risultato: il validatore lo rifiuta.
    const effects = (Array.isArray(parsed.effects) ? parsed.effects : [])
      .filter((e: any) => e && typeof e === 'object')
      .map((e: any) => ({
        kind: e.kind,
        effectId: typeof e.effectId === 'string' ? e.effectId : '',
        cause: typeof e.cause === 'string' ? e.cause : undefined,
        account: typeof e.account === 'string' ? e.account : undefined,
        currency: typeof e.currency === 'string' ? e.currency : undefined,
        amount: typeof e.amount === 'string' ? e.amount : undefined,
        resource: typeof e.resource === 'string' ? e.resource : undefined,
        quantity: typeof e.quantity === 'string' ? e.quantity : undefined,
        projectId: typeof e.projectId === 'string' ? e.projectId : undefined,
        date: typeof e.date === 'string' ? e.date : undefined,
      }));

    return {
      events,
      narration: firstString(parsed.narration, parsed.narrazione, parsed.summary) || 'Il mondo è cambiato...',
      diplomacy: Array.isArray(parsed.diplomacy) ? parsed.diplomacy : [],
      worldChanges: { ...emptyWorldChanges, ...((parsed.worldChanges ?? parsed.world_changes) || {}) },
      actionOutcomes,
      voided,
      startChat,
      relationshipChanges,
      targetDate: firstString(parsed.targetDate, parsed.target_date),
      effects,
    };
  } catch (e) {
    console.error('[PARSER] Failed to parse simulation response:', e);

    // Fallback: restituisci il testo come narrativa
    return {
      events: [],
      narration: text.substring(0, 500),
      diplomacy: [],
      worldChanges: emptyWorldChanges,
      voided: [],
    };
  }
}