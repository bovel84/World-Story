/**
 * World Story — Simulation guards
 * ==============================
 * Guardie narrative riutilizzabili (auto-jump, stile dispaccio, identità del
 * giocatore, coerenza del soggetto, agenzia NPC, reazione interna, causalità) e
 * contratto narrativo della simulazione.
 *
 * Estratte da `prompts/simulation.ts` (Fase 3): comportamento invariato.
 */
import { PromptVariables } from '../types';
import { buildImmersionContract } from '../immersion';
import { buildGovernmentNarrativeGuard } from '../government';

export function buildAutoJumpInstruction(vars: PromptVariables, eventBudget = 1): string {
  // L'auto-jump non si ferma al primo fatto di cronaca: prosegue finché una
  // nazione non decide concretamente in risposta agli ordini del giocatore.
  // Il budget concede lo spazio per attraversare i fatti di contorno.
  const budgetRule = eventBudget > 1
    ? `- Il turno contiene ordini del giocatore: puoi emettere da 1 a ${eventBudget} eventi significativi in ordine cronologico. NON trasformare automaticamente ciascun ordine in un dispaccio separato: raggruppa gli ordini collegati e narra soprattutto decisioni, opposizioni e controproposte degli altri attori.
- Ogni ordine deve comunque ricevere il proprio actionOutcome, anche quando più ordini confluiscono nello stesso evento.`
    : `- Puoi emettere più eventi in ordine cronologico: prima i fatti di contorno, poi la decisione che chiude il salto.`;
  return `\nRegole auto-jump:
- Il giocatore ha chiesto di avanzare nel tempo FINO AL PROSSIMO EVENTO IMPORTANTE (entro l'orizzonte del ${vars.TARGET_ROUND_DATE}).
${budgetRule}
- NON fermare il salto al primo fatto importante in sé: prosegui attraverso i fatti di contorno finché una nazione non assume una decisione concreta in risposta agli ordini del giocatore. Fermati SOLO sull'evento che contiene quella decisione: una reazione di ruolo "counterparty" (la controparte diretta risponde) oppure una reazione con "counterAction" (misura autonoma realmente decisa). La data di quell'evento deve essere anche il campo "targetDate" (YYYY-MM-DD).
- Se entro l'orizzonte nessuna nazione decide nulla di verificabile, non inventare una reazione: completa con "targetDate":null.
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
- Nessun inglese nei dispacci salvo nomi propri; nessuna sigla tecnica; nessun riferimento a turni, mappe, regole o al fatto che si tratta di una simulazione.
- Il campo "note" è diverso: è il messaggio diretto che la nazione invia al giocatore nel canale diplomatico. Prima persona, tono umano e concreto, una o due frasi, nessuna cifra, punteggio o etichetta, nessun nome di campo. Non è un dispaccio e non deve ripetere la cronaca, né contenere «Misura annunciata», «counterAction» o formule da bollettino.`;
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

[Anime del governo — chi preme dentro la nazione]

${vars.GOVERNMENT_STATE || '(Nessuna anima del governo registrata per questa nazione.)'}
${buildGovernmentNarrativeGuard(vars)}
- Se non esiste una causa verificabile per un fatto ulteriore, non inventarlo: registra gli esiti disponibili e lascia il mondo coerente.${buildImmersionContract()}${presetContext}`;
}
