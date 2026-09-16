/**
 * World Story — Simulation prompt
 * ==============================
 * Costruzione dei prompt di simulazione (standard, vincolato ai modelli piccoli,
 * output incrementale) e istruzioni di formato.
 *
 * Estratto da `prompts/simulation.ts` (Fase 3): comportamento invariato.
 */
import { PromptVariables } from '../types';
import { buildImmersionContract, EVENT_DESCRIPTION_GUIDE } from '../immersion';
import { buildGovernmentNarrativeGuard } from '../government';
import {
  buildAutoJumpInstruction,
  buildDispatchStyleGuard,
  buildPlayerIdentityGuard,
  buildSubjectCoherenceGuard,
  buildNpcAgencyGuard,
  buildDomesticReactionGuard,
} from './guards';

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
  ? `\n- Modalità auto-jump: emetti da 1 a ${maxEvents} eventi in ordine cronologico, sintetizzando gli ordini collegati. NON fermarti al primo fatto importante in sé: prosegui finché una nazione non decide concretamente in risposta agli ordini del giocatore. Fermati sull'evento che contiene quella decisione (controparte diretta o misura autonoma con "counterAction"): la sua data è il campo targetDate.`
  : '\n- Modalità auto-jump: emetti i fatti di contorno in ordine cronologico e fermati sull\'evento in cui una nazione decide concretamente in risposta agli ordini del giocatore.') : ''}

Per ogni evento emetti immediatamente:
{"type":"event","headline":"Soggetto NPC, decisione/reazione concreta e luogo","description":"${EVENT_DESCRIPTION_GUIDE}","date":"YYYY-MM-DD","mapChanges":[],"reactions":[{"polityName":"NOME politia NPC esistente","role":"counterparty|ally|mediator|observer","stance":"supportive|opposed|conditional|neutral","priority":"priorità del dossier che guida la decisione","response":"decisione ufficiale concreta, motivata e coerente con interessi e risorse","counterAction":"eventuale misura autonoma realmente decisa nel periodo","note":"messaggio diretto al giocatore, prima persona, una o due frasi senza cifre"}]}

Regole obbligatorie per "reactions":
- Se l'ordine nomina, contatta, minaccia, influenza o richiede cooperazione a una politia NPC, quella politia deve comparire e decidere autonomamente; massimo 4 reazioni direttamente pertinenti.
- Segui [Personalità, priorità e memoria NPC]. "priority" nomina l'interesse che guida la risposta; "counterAction" descrive solo una misura davvero decisa nel periodo, non un'intenzione vaga.
- Se un'azione o controazione NPC influenza direttamente un'altra politia NPC, anche quella politia decide autonomamente nel medesimo evento o nel successivo evento causale.
- Iniziativa autonoma: una nazione NPC con una causa documentata adotta una misura concreta, difensiva o offensiva; se è materiale ha la mapChange corrispondente nello stesso evento. In ogni avanzamento con causa documentata compare almeno un'iniziativa NPC autonoma.
- Reazione interna: se qualcuno mobilita, schiera, spende o impone un embargo, la sua popolazione e le sue istituzioni reagiscono nello stesso evento (consenso o protesta, dibattito o repressione) con il costo economico proporzionato preso dal Dossier nazionale.
- Teatro della crisi: reagiscono la controparte diretta e i vicini; non aggiungere potenze lontane senza interesse documentato.
- Un accordo può risultare concluso solo se ogni controparte necessaria risponde "supportive" o "conditional" con condizioni soddisfatte. Altrimenti descrivi proposta, rifiuto, rinvio o controproposta e usa un outcome partial/rejected.
- La descrizione deve raccontare queste decisioni; non elencare banalmente ciò che il giocatore ha ordinato. Per un fatto esclusivamente interno usa "reactions": [].
- "note" è il messaggio che la politia invia al giocatore nel canale diplomatico: prima persona, tono umano e concreto, una o due frasi, senza cifre, punteggi, etichette o nomi di campo. Non ripetere la cronaca: scrivi ciò che la nazione comunica. "response" resta il testo di cronaca del dispaccio.

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
  ? 'In auto-jump targetDate DEVE essere la data dell’evento che contiene la decisione NPC che ferma il salto (reazione di ruolo "counterparty" o misura autonoma con "counterAction"). Non fermarti al primo fatto di cronaca: se i fatti di contorno precedono la decisione, emettili comunque in ordine cronologico. Se nessun evento porta una decisione NPC con causa verificabile entro l’orizzonte, non inventarne uno: non emettere righe event e completa con "targetDate":null.'
  : 'Non aspettare di avere pianificato tutti gli eventi: completa e pubblica il primo, poi passa al seguente.'}`;
}

/**
 * Costruisce il prompt per il turno di simulazione
 * @param opts.autoJump — modalità «al prossimo evento importante»: il modello
 *   sceglie da solo la data effettiva di arrivo e la restituisce in targetDate.
 * @param opts.eventBudget — numero massimo di eventi ammessi nel turno
 *   (auto-jump: budget condiviso col motore, con spazio per attraversare i
 *   fatti di contorno fino alla decisione NPC che ferma il salto).
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

CONTESTO DI REAZIONE (attori e opzioni ammesse dal motore):
${clipForConstrainedModel(vars.REACTION_CONTEXT, 2_500) || '(nessuno)'}

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
2. Il giocatore controlla solo ${vars.PLAYER_POLITY}. Altre politie decidono per sé secondo priorità, risorse, rapporti e memoria. Nessun accordo è concluso senza reaction favorevole/condizionata della controparte. Coerenza dei soggetti: nomina solo chi agisce, subisce o ha un interesse documentato; ${vars.PLAYER_POLITY} compare solo se il fatto la tocca direttamente, mai come comparsa o spettatrice. "reactions"/"startChat" solo per gli attori elencati nel CONTESTO DI REAZIONE.
3. Ordine composto: se solo una fase è fattibile usa partial e mostra soltanto quella fase; se nulla è fattibile usa rejected/voided e nessun mapChanges.
4. Reazione NPC: indica priority, response e solo se reale counterAction. Una controazione materiale (mobilitazione, unità terrestre o navale, cantiere, opera completata) deve avere anche le mapChanges corrispondenti nello stesso evento, nel territorio della politia che agisce. Se influenza un altro NPC, anche quello reagisce autonomamente. Massimo 4 reazioni pertinenti. "note" è il messaggio diretto al giocatore nel canale diplomatico: prima persona, una o due frasi d'uomo politico, senza cifre né etichette.
4b. Iniziativa NPC: le nazioni non giocate non sono comparse. Quando una causa documentata esiste (confine teso, minaccia, alleanza, ultimatum, crisi aperta, opportunità), almeno una adotta una misura autonoma concreta, difensiva (fortification, base, airbase, radar, missile_site, mobilitazione di riserve, patto difensivo) o offensiva (concentramento, raid, blocco navale, ultimatum armato, preparazione d'invasione), con la mapChange corrispondente se materiale. Se non c'è causa, il mondo può restare fermo.
4c. Reazioni interne ed economia: se una nazione mobilita, schiera, spende o impone un embargo, l'evento narra anche cosa ne pensano popolazione e istituzioni (consenso o protesta, dibattito o repressione) e il costo economico proporzionato (deficit, tasse, razionamenti), preso dal Dossier nazionale calcolato dal motore (saldo, stabilità, riserve mobilitate, sforzo bellico, tensione sociale). Niente cifre inventate. Vale anche per le nazioni NPC.
5. Mappa: start_construction/update_construction/complete_construction per cantieri/opere; start_mobilization/complete_mobilization per formazioni in preparazione/operative; spawn_unit/move_unit/remove_unit per unità operative. Tipi unità: battalion|army|fleet|missile. Tipi opere: factory|port|university|base|airbase|naval_base|fortification|radar|missile_site|infrastructure|power_plant. Annunci, studi e ordini respinti non creano marker. Una nuova formazione nasce in una provincia controllata da chi la crea, la più vicina al riferimento citato ("vicino a X", "al confine con X"); non nel territorio di un'altra politia senza incursione esplicita. Se un ordine accettato dispone che una formazione esistente avanzi o si sposti, emetti SEMPRE "move_unit" (unità, origine, destinazione): senza di esso l'unità resterebbe ferma.
6. Scontri: per ogni battaglia scrivi una cronaca militare completa (attaccante, difensore, provincia contesa, andamento, perdite proporzionate, esito e conseguenza) e fai reagire la controparte in "reactions". Province occupate: il motore assegna il colore dell'occupante, usa "transfer" col nome del nuovo proprietario.
7. Genera massimo ${maxEvents} eventi cronologici.${opts.autoJump ? ' In auto-jump NON fermarti al primo fatto importante: prosegui oltre i fatti di contorno e fermati sull’evento in cui una nazione decide concretamente in risposta agli ordini (reazione di ruolo "counterparty" o con "counterAction"): la sua data è il campo targetDate.' : ''}
8. Nei salti lunghi produci più dispacci concreti e datati (mobilitazioni, scontri, occupazioni, trattative, economia), non un unico riassunto.
9. Dispacci in italiano narrativo: headline e description sono frasi complete per il giocatore. VIETATE etichette tecniche o di stato ("neutral", "supportive", "opposed", "conditional", "hostile", "ally", "counterparty", nomi di campi JSON, "partial", "voided", ID). La posizione diplomatica va raccontata («La Turchia annuncia la propria neutralità»), mai scritta come parola chiave («Turchia neutral»).
10. Il giocatore incarna ${vars.PLAYER_POLITY}: ogni suo ordine è un atto ufficiale della nazione. Nei dispacci l'attore è sempre ${vars.PLAYER_POLITY} (governo, capo di Stato, ministri), MAI «il giocatore» o «l'utente»; le altre nazioni la nominano e trattano con lei come soggetto politico reale.

${buildImmersionContract()}
OUTPUT NDJSON, una riga JSON per oggetto, niente markdown.
Riga evento:
{"type":"event","headline":"attore + decisione concreta","description":"${EVENT_DESCRIPTION_GUIDE}","date":"YYYY-MM-DD","mapChanges":[],"reactions":[{"polityName":"nome esistente","role":"counterparty|ally|mediator|observer","stance":"supportive|opposed|conditional|neutral","priority":"interesse rilevante","response":"decisione concreta","counterAction":"misura concreta opzionale","note":"messaggio diretto al giocatore, prima persona, 1-2 frasi"}]}

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

[Contesto di reazione — attori, vincoli e opzioni ammesse dal motore]

Questo contesto è già filtrato dal motore: chi non è elencato qui non è coinvolto causalmente. Scegli le reazioni solo fra gli attori e le opzioni elencate; non introdurre altre nazioni.

${vars.REACTION_CONTEXT || '(nessun contesto disponibile: usa cronaca e stato strategico per identificare controparti dirette e vicini)'}

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
Ogni avanzamento temporale simula l'intero mondo, non soltanto la politia del giocatore: valuta le conseguenze del periodo per gli attori elencati nel [Contesto di reazione].
- Una proposta, richiesta, minaccia o offerta del giocatore non vale come accettazione altrui: senza consenso esplicito della controparte resta proposta pendente o viene respinta.
- Ogni NPC decide per priorità pertinente, capacità e costi, rapporti e memoria; riporta la priorità in "priority" e una misura autonoma effettiva in "counterAction". Le mapChanges riguardano TUTTE le politie: una misura NPC materiale diventa marker nello stesso evento, nel territorio della politia che agisce.
- Anche senza ordini del giocatore, fai progredire almeno un filone già documentato quando esiste una causa verificabile; la politia del giocatore non agisce senza ordine. Se nessuna causa è documentata, non inventare un fatto: avanza comunque tempo ed economia in modo coerente.
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
${vars.ORDER_FUNDING ? `\n[Ordini senza copertura — deciso dal motore]\n\nCassa e credito di questa nazione non coprono questi ordini. Non sono un'opinione narrativa: sono un vincolo di realtà. Nel periodo simulato NON possono riuscire — se il giocatore li ha ordinati, essi falliscono, si arenano o restano sulla carta. L'esito di questi ordini deve essere "voided" (nessuna copertura) oppure "partial" (copertura parziale), mai "accepted".\n\n${vars.ORDER_FUNDING}` : ''}

[Tutte le azioni passate]

${vars.PLAYER_EVERY_ACTION_NOT_PREVIOUS || '(Nessuna azione passata)'}

[Descrizione della mappa]

${vars.GRAND_MAP_DESCRIPTION_NO_CITY}

[Stato strategico attuale — fonte di verità]

${vars.STRATEGIC_STATE}

[Personalità, priorità e memoria NPC — fonte vincolante]

${vars.NPC_STRATEGIC_PROFILES}

[Anime del governo — chi preme dentro la nazione]

${vars.GOVERNMENT_STATE || '(Nessuna anima del governo registrata per questa nazione.)'}
${buildGovernmentNarrativeGuard(vars)}

Questi dossier stabiliscono come le politie valutano ordini e azioni altrui. Mantieni la personalità fra i turni; aggiorna la posizione solo quando capacità, rapporti o memoria mostrano un nuovo fatto concreto. Se un NPC agisce contro interessi o impegni di un altro NPC, anche l'attore colpito decide per sé. Non inventare ricordi assenti.

[Processi in corso]

${vars.ONGOING_PROCESSES || '(Nessun processo in corso)'}

Se la sezione non è vuota, questi impegni sono già avviati e NON risolti:
- se il completamento previsto di un processo cade nel periodo simulato, un evento del periodo deve portarlo avanti o concluderlo in modo causale (risorse, tempo, opposizione), senza ripetere il testo dell'ordine originale;
- per concludere un processo, l'ordine del giocatore che lo porta a termine (anche riformulato) dichiara in actionOutcomes "completesProjectId" copiando il projectId mostrato; mai il titolo;
- se il processo matura ma richiede ancora tempo, aggiorna l'esito dell'ordine collegato con "partial" e una nuova expectedDate;
- non inventare il completamento: se niente nel periodo può concluderlo, lascialo aperto e non menzionarlo.

[Sfide del momento — pressioni di pace]

${vars.PEACETIME_PRESSURES || '(Nessuna sfida aperta: la nazione vive un periodo ordinario, non inventarne di straordinarie.)'}

Queste sfide sono già aperte e attese dal paese. Nel periodo simulato devono produrre conseguenze concrete e coerenti con la scelta del governo: se il giocatore le affronta in un ordine, collegale all'ordine; altrimenti mostra l'effetto dell'inerzia senza risolverle d'autorità.

[Crisi nazionale — quanto la nazione è vicina al collasso]

${vars.NATION_CRISIS || '(Nessuna crisi in corso: il governo non è a rischio di caduta.)'}

La nazione può cadere: rivolta interna, default sul debito, invasione da un vicino più forte. Questi rischi sono calcolati dai numeri reali, non dalle parole. Se una dimensione è critica, il periodo deve mostrarla: nessun ordine può essere un successo pieno mentre lo Stato è sull'orlo del collasso. Non dichiarare mai un esito che i numeri smentiscono — il fallimento fa parte del gioco.

Tutte queste informazioni riflettono la situazione geopolitica alla data: ${vars.ORIGIN_ROUND_DATE}

[Diplomazia]

${vars.CHATS_NON_CONSOLIDATED_ROUNDS || '(Non ci è stata diplomazia)'}

---

Ora simula gli eventi tra il ${vars.ORIGIN_ROUND_DATE} e il ${vars.TARGET_ROUND_DATE}.

Formato di output: vedi il [PROTOCOLLO EVENTI PROGRESSIVI — PRIORITÀ MASSIMA] in coda; gli effetti materiali vanno in "worldChanges.nationalEffects".

Regole nationalEffects (sei tu il motore del cambiamento: le tue decisioni devono avere conseguenze materiali verificabili):
- Servono SOLO quando un fatto del periodo cambia davvero la vita della nazione: mobilitazione, razionamento, requisizioni, aiuti esteri, sanzioni, riforme, perdite al fronte, cattura di depositi, disordini. Niente "effetti di colore".
- Ogni voce DEVE avere una "reason" concreta e, se nasce da un ordine del giocatore, il suo "sourceActionId" esatto. Senza motivo l'effetto viene ignorato.
- Il motore limita ogni delta per turno e per risorsa (il tetto dipende dal PIL e dalle scorte): non chiedere salti enormi, verrebbero ridotti o scartati. Meglio molti effetti piccoli e coerenti lungo i turni.
- "money" può scendere sotto zero: è debito pubblico, entro il tetto di credito. Non regalare denaro: ogni +money va motivato (credito, export, aiuti).
- "modifier" è persistente e poi decade: usalo per cause durature (riforma, repressione, mobilitazione generale), non per un episodio di un giorno.
- Non puoi dichiarare completato un progetto non finito: la chiusura avviene per "completesProjectId" con outcome "accepted", e il motore rifiuta la chiusura sotto la soglia di completamento.
- In strict queste leve sono vietate: lì valgono solo gli effetti canonici.

Regole reactions:
- Segui il dossier persistente dell'NPC: "priority" deve richiamare l'interesse che guida la decisione e "counterAction" contiene soltanto una misura concreta davvero adottata nel periodo.
- Se un'azione o controazione NPC influenza direttamente un'altra politia NPC, anche quella politia decide autonomamente nel medesimo evento o nel successivo evento causale.
- Non eseguire decisioni per le controparti. Un accordo può risultare concluso solo se ogni controparte necessaria risponde supportive o conditional con condizioni soddisfatte. Altrimenti l'ordine resta proposta, rinvio, rifiuto o controproposta e il suo outcome è partial/rejected.
- La descrizione racconta iniziativa, risposta e conseguenza: non deve essere la parafrasi al passato dell'elenco ordini. Per un fatto esclusivamente interno usa "reactions": [].
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
