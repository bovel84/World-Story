/**
 * Open-Pax — Simulation Prompt
 * ============================
 * Motore principale della simulazione (time-rewind.md)
 */

import { PromptVariables, SimulationResult, SimulationEvent, VoidedAction, ActionOutcome } from './types';
import { parseJsonLoose } from '../utils/json-repair';

/**
 * Istruzione della modalità auto-jump: il modello sceglie da solo la data
 * effettiva di arrivo («al prossimo evento importante») e la restituisce
 * in targetDate. Esportata: viene usata sia dal prompt di default sia
 * dai template preset sovrascritti (prompt-builder la aggiunge dopo il render).
 */
export function buildAutoJumpInstruction(vars: PromptVariables): string {
  return `\nRegole auto-jump:
- Il giocatore ha chiesto di avanzare nel tempo FINO AL PROSSIMO EVENTO IMPORTANTE (entro l'orizzonte del ${vars.TARGET_ROUND_DATE}).
- Genera ESATTAMENTE un solo evento davvero significativo: il primo in ordine cronologico.
- Fermati immediatamente a quell'evento: la sua data deve essere anche il campo "targetDate" (YYYY-MM-DD). Non descrivere né calcolare fatti successivi.
- Questa modalità PREVALE su qualunque istruzione del preset che chieda di distribuire eventi sull'intero periodo, generare molti eventi o non interrompere la simulazione.`;
}

/**
 * Vincolo aggiunto anche ai prompt dei preset, che possono sostituire il
 * template standard completo. Impedisce a un override vecchio di aggirare la
 * continuità causale della simulazione.
 */
export function buildCausalityGuard(vars: PromptVariables): string {
  return `

[VINCOLO CAUSALE OBBLIGATORIO]
Genera un evento soltanto se è conseguenza verificabile di un ordine del giocatore, della cronaca precedente, della diplomazia o dello stato strategico qui sotto. Le politie NPC possono avere iniziative proprie soltanto quando obiettivo, risorse, impegno o crisi sono visibili in queste fonti. Non creare crisi, guerre, colpi di Stato, alleanze o svolte economiche indipendenti solo per riempire il periodo.
Ogni ordine del giocatore deve avere un esito realistico, una reazione o un rifiuto in "voided". La prima frase di ogni descrizione deve nominare il grilletto concreto; le frasi successive ne spiegano le conseguenze proporzionate.

[CICLO MONDIALE OBBLIGATORIO]
Ogni avanzamento temporale simula l'intero mondo, non soltanto la politia del giocatore. Valuta per tutte le altre politie le conseguenze nel periodo: reazioni a ordini, sviluppo di trattative, mobilitazioni, commercio, crisi o impegni già presenti nella cronaca e nello stato strategico.
- Se un ordine del giocatore coinvolge o influenza un'altra politia, mostra nello stesso periodo una risposta concreta della controparte oppure registra un processo aperto datato che ne spieghi il ritardo. Non lasciare l'ordine isolato.
- Anche senza ordini del giocatore, fai progredire almeno un filone già documentato di una politia non giocante quando esiste una causa verificabile; il giocatore può osservare il mondo ma la sua politia non agisce senza ordine.
- Dai priorità a 1-3 reazioni o iniziative internazionali collegate, invece di elencare notizie scollegate. Se nessuna causa è documentata, non inventare un fatto: avanza comunque tempo ed economia in modo coerente.

[Stato strategico attuale — fonte di verità]
${vars.STRATEGIC_STATE}`;
}

/**
 * Protocollo di output progressivo. Ogni oggetto JSON concluso può essere
 * estratto dallo stream e mostrato subito, mentre il modello pensa al seguito.
 */
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
- Non superare ${maxEvents} eventi significativi.${autoJump ? '\n- Modalità auto-jump: emetti soltanto il primo evento importante e fermati sulla sua data.' : ''}

Per ogni evento emetti immediatamente:
{"type":"event","headline":"Soggetto, azione concreta e luogo pertinenti allo scenario","description":"3 frasi: causa datata, decisione/reazione, conseguenza verificabile o nodo aperto","date":"YYYY-MM-DD","mapChanges":[]}

Costruzioni: SOLO se un evento attesta un'opera completata con risorse e tempi compatibili, aggiungi a mapChanges:
{"type":"build_facility","regionName":"nome esatto della provincia","feature":{"type":"factory|port|university|base|radar","name":"nome univoco dell'opera"}}
Una proposta, un rifiuto, un cantiere avviato o una citazione NON crea oggetti. Non aggiungere città o capitali; non duplicare opere già presenti.

Quando il periodo è concluso emetti come ULTIMA riga:
{"type":"complete","narration":"Sintesi complessiva","actionOutcomes":[{"action":"testo esatto ordine","status":"accepted|partial|rejected","summary":"esito specifico","expectedDate":"YYYY-MM-DD opzionale per partial","completesProcess":"titolo del processo concluso, opzionale","eventHeadlines":[]}],"voided":[],"startChat":[],"relationshipChanges":[],"worldChanges":{"regionOwners":{},"regionColors":{}},"targetDate":"${completionTargetDate}"}

${autoJump
  ? 'In auto-jump targetDate DEVE essere identica alla data dell’unico evento emesso. Se nessun evento importante è causalmente giustificato entro l’orizzonte, NON inventarne uno: non emettere righe event e completa con "targetDate":null.'
  : 'Non aspettare di avere pianificato tutti gli eventi: completa e pubblica il primo, poi passa al seguente.'}`;
}

/**
 * Costruisce il prompt per il turno di simulazione
 * @param opts.autoJump — modalità «al prossimo evento importante»: il modello
 *   sceglie da solo la data effettiva di arrivo e la restituisce in targetDate.
 */
export function buildSimulationPrompt(vars: PromptVariables, opts?: { autoJump?: boolean }): string {
  const autoJumpInstruction = opts?.autoJump ? buildAutoJumpInstruction(vars) : '';
  return `Simuli un gioco strategico a turni. Il giocatore controlla la politia-stato ${vars.PLAYER_POLITY}; tutte le altre politie del mondo sono gestite da te.

Il giocatore può tentare qualsiasi cosa, ma il successo delle sue azioni dipende dal realismo. NON eseguire MAI azioni PER conto del giocatore: un evento compiuto dalla politia ${vars.PLAYER_POLITY} avviene SOLO se il giocatore ne ha dato ordine esplicito in questo turno. Persino le azioni storiche di questa nazione simulale solo se il giocatore le ha realmente intraprese. Se il giocatore non ha compiuto azioni, la sua politia non prende iniziative.

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

Nella PRIMA frase della descrizione dichiara sempre il grilletto concreto (per esempio: “In seguito alla mobilitazione ordinata da…”, “Poiché il trattato del turno 4…”, “Dopo la perdita di…”). Le frasi successive spiegano una conseguenza proporzionata. Un titolo o una descrizione senza un grilletto riconoscibile è invalido.

- Un ordine del giocatore non dà automaticamente successo: verifica risorse, confini, diplomazia e tempi. Se è impossibile, usa "voided"; se richiede tempo, mostra una misura preparatoria e rinvia l'esito.
- Le altre politie possono reagire a un incentivo visibile (minaccia al confine, commercio, guerra, trattato, crisi già avviata) oppure prendere un'iniziativa propria SOLO se deriva da un obiettivo già dichiarato, risorse disponibili, un impegno diplomatico o una crisi documentata nello stato strategico. Non far nascere colpi di Stato, invasioni, alleanze o crisi economiche dal nulla.
- Mantieni proporzione temporale: in 30 giorni predominano decreti, mobilitazioni, negoziati e primi effetti; conquiste, regimi rovesciati e svolte economiche richiedono cause e preparazione nei turni precedenti.
- Le conseguenze non maturano tutte all'istante: semina nell'evento i presupposti del turno successivo e riprendili nella cronaca.
- Preferisci pochi eventi collegati in una stessa catena a molti eventi indipendenti. Se nel periodo non segue altro in modo credibile, fermati prima del limite.

[CICLO MONDIALE OBBLIGATORIO]
Ogni avanzamento temporale simula l'intero mondo, non soltanto la politia del giocatore. Valuta per tutte le altre politie le conseguenze nel periodo: reazioni a ordini, sviluppo di trattative, mobilitazioni, commercio, crisi o impegni già presenti nella cronaca e nello stato strategico.
- Se un ordine del giocatore coinvolge o influenza un'altra politia, mostra nello stesso periodo una risposta concreta della controparte oppure registra un processo aperto datato che ne spieghi il ritardo. Non lasciare l'ordine isolato.
- Anche senza ordini del giocatore, fai progredire almeno un filone già documentato di una politia non giocante quando esiste una causa verificabile; il giocatore può osservare il mondo ma la sua politia non agisce senza ordine.
- Dai priorità a 1-3 reazioni o iniziative internazionali collegate, invece di elencare notizie scollegate. Se nessuna causa è documentata, non inventare un fatto: avanza comunque tempo ed economia in modo coerente.

*Qualità dei dispacci.* Ogni evento è un breve articolo verificabile, non un titolo generico.
- Titolo: soggetto + verbo d’azione + luogo/oggetto concreto (massimo 12 parole). Per un ordine del giocatore, usa il nome della sua politia o della controparte coinvolta. Mai “Tensioni crescono”, “Nuova crisi”, “Bollettino”, “Evento”, una cifra di bilancio o formule vaghe.
- Corpo: 3 frasi dense. (1) data, attore e grilletto causale; (2) decisione/reazione e luogo; (3) conseguenza misurabile o impegno ancora aperto per il turno seguente.
- Usa cifre solo se presenti nello stato o proporzionate e necessarie; non inventare presidenti, ministri o dati statistici non forniti. Distingui chiaramente proposta, misura avviata e risultato ottenuto.
- Tono da cronaca storica: sobrio, concreto, senza linguaggio da videogame né aggettivi promozionali. Preferisci la precisione di un dispaccio d’agenzia o di un articolo di prima pagina.

[Struttura di gioco]

Nel gioco esiste una mappa dinamica. Curalo con attenzione i trasferimenti di regioni.

*Comprensione delle regioni.* Nel gioco esistono esattamente ${vars.GRAND_MAP_DESCRIPTION_NO_CITY.split('\n\n').length} regioni. Le regioni non sono solo terraferma: includono mari e stretti.

*Battaglioni.* Appaiono sulla mappa e possono muoversi. Usa sempre il tag "battalion".

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
- Trasferire una regione — semplice cambio di proprietario
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

[Processi in corso]

${vars.ONGOING_PROCESSES || '(Nessun processo in corso)'}

Se la sezione non è vuota, questi impegni sono già avviati e NON risolti:
- se il completamento previsto di un processo cade nel periodo simulato, un evento del periodo deve portarlo avanti o concluderlo in modo causale (risorse, tempo, opposizione), senza ripetere il testo dell'ordine originale;
- per concludere un processo, l'ordine del giocatore che lo porta a termine (anche riformulato) dichiara in actionOutcomes "completesProcess": "titolo del processo";
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
      "description": "3 frasi: causa datata, decisione/reazione, conseguenza verificabile o nodo aperto",
      "date": "YYYY-MM-DD",
      "mapChanges": [
        {
          "type": "transfer|create|update|delete|spawn_battalion|move_battalion|create_polity",
          "regionName": "NOME della regione dalla descrizione della mappa",
          "newOwner": "NOME della politia dalla descrizione della mappa (se transfer/create)",
          "newColor": "#hex (se update o nuova politia)"
        }
      ]
    }
  ],
  "narration": "Narrativa complessiva del periodo (3-5 frasi)",
  "actionOutcomes": [
    { "action": "testo esatto di ciascun ordine ricevuto", "status": "accepted|partial|rejected", "summary": "esito specifico dell'ordine", "expectedDate": "YYYY-MM-DD solo se partial", "completesProcess": "titolo del processo in corso che questo ordine conclude (solo se pertinente)", "eventHeadlines": ["titolo evento pertinente"] }
  ],
  "voided": [
    { "action": "testo dell'azione del giocatore", "reason": "perché è irrealistica" }
  ],
  "startChat": [
    { "polityName": "NOME della politia", "topic": "cosa vuole discutere" }
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
- "type": "transfer" (trasferire una regione), "create"/"update"/"delete" (politie),
  "spawn_battalion" (un battaglione appare in una regione),
  "move_battalion" (con targetRegionName), "create_polity" (nuova politia).
- "regionName" e "newOwner" — SOLO nomi presenti nell'[Descrizione della mappa]
  (oppure il nome di una politia che stai creando). NON usare id o coordinate.
- Se i confini non sono cambiati, lascia "mapChanges" come array vuoto.
- "worldChanges.regionOwners" duplica i passaggi di proprietà finali per nome.

Regole actionOutcomes e voided:
- Restituisci ESATTAMENTE un actionOutcomes per ogni ordine ricevuto, usando il suo testo esatto. accepted = effetto avviato/conseguito, partial = preparazione o risultato incompleto, rejected = non attuabile; summary descrive solo quell'ordine. expectedDate è ammessa solo per partial, deve essere una data YYYY-MM-DD futura e causalmente stimabile; omettila se non conosci una data realistica. completesProcess va usato solo quando l'ordine conclude un processo elencato in [Processi in corso], citandone il titolo esatto (anche se l'ordine è riformulato).
- Se un'azione del giocatore è irrealistica per questo mondo e questo periodo
  (es. "conquistare il mondo in una settimana", tecnologie del futuro) — NON
  eseguirla e inseriscila in "voided" con una spiegazione chiara per il
  giocatore. Le altre azioni eseguile normalmente. Se tutto è realistico,
  usa "voided": [].
- "startChat": se in seguito agli eventi una politia vuole avviare trattative
  con il giocatore, indicata qui. Se nessuna, usa "startChat": [].
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
      try { records.push(JSON.parse(text.slice(start, i + 1))); } catch { /* record incompleto/non valido */ }
      start = -1;
    }
  }
  return records;
}

/** Normalizza un record dello stream usando lo stesso validatore del formato batch. */
export function parseIncrementalSimulationRecord(raw: any): IncrementalSimulationRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'event') {
    const candidate = raw.event && typeof raw.event === 'object' ? raw.event : raw;
    const event = parseSimulationResponse(JSON.stringify({ events: [candidate] })).events[0];
    return event ? { type: 'event', event } : null;
  }
  if (raw.type === 'complete') {
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

export function parseSimulationResponse(text: string): SimulationResult {
  const emptyWorldChanges = { regionOwners: {}, regionColors: {}, newFeatures: [], deletedFeatures: [] };
  try {
    const parsed = parseJsonLoose<any>(text);

    // Normalizzazione severa degli eventi: gli elementi corrotti vengono
    // scartati invece di far fallire il parse
    const events: SimulationEvent[] = [];
    for (const raw of Array.isArray(parsed.events) ? parsed.events : []) {
      if (!raw || typeof raw.headline !== 'string' || raw.headline.trim() === '') continue;
      events.push({
        headline: String(raw.headline),
        description: typeof raw.description === 'string' ? raw.description : '',
        date: typeof raw.date === 'string' ? raw.date : '',
        mapChanges: (Array.isArray(raw.mapChanges) ? raw.mapChanges : []).filter(
          (mc: any) => mc && typeof mc === 'object' && typeof mc.type === 'string'
        ),
      });
    }

    const actionOutcomes: ActionOutcome[] = [];
    for (const raw of Array.isArray(parsed.actionOutcomes) ? parsed.actionOutcomes : []) {
      if (!raw || typeof raw.action !== 'string' || typeof raw.summary !== 'string') continue;
      if (!['accepted', 'partial', 'rejected'].includes(raw.status)) continue;
      actionOutcomes.push({
        action: raw.action,
        status: raw.status,
        summary: raw.summary,
        expectedDate: typeof raw.expectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.expectedDate)
          ? raw.expectedDate
          : undefined,
        eventHeadlines: Array.isArray(raw.eventHeadlines)
          ? raw.eventHeadlines.filter((headline: unknown) => typeof headline === 'string')
          : [],
        completesProcess: typeof raw.completesProcess === 'string' && raw.completesProcess.trim()
          ? raw.completesProcess.trim().substring(0, 300)
          : undefined,
      });
    }

    const voided: VoidedAction[] = [];
    for (const raw of Array.isArray(parsed.voided) ? parsed.voided : []) {
      if (!raw || typeof raw.action !== 'string') continue;
      voided.push({ action: raw.action, reason: typeof raw.reason === 'string' ? raw.reason : '' });
    }

    const startChat = (Array.isArray(parsed.startChat) ? parsed.startChat : [])
      .filter((c: any) => c && typeof c.polityName === 'string')
      .map((c: any) => ({ polityName: String(c.polityName), topic: String(c.topic ?? '') }));
    const relationshipChanges = (Array.isArray(parsed.relationshipChanges) ? parsed.relationshipChanges : [])
      .filter((c: any) => c && typeof c.from === 'string' && typeof c.to === 'string'
        && ['ally', 'neutral', 'hostile'].includes(c.relationship))
      .map((c: any) => ({
        from: String(c.from),
        to: String(c.to),
        relationship: c.relationship as 'ally' | 'neutral' | 'hostile',
        reason: typeof c.reason === 'string' ? c.reason : undefined,
      }));

    return {
      events,
      narration: typeof parsed.narration === 'string' ? parsed.narration : 'Il mondo è cambiato...',
      diplomacy: Array.isArray(parsed.diplomacy) ? parsed.diplomacy : [],
      worldChanges: { ...emptyWorldChanges, ...(parsed.worldChanges ?? {}) },
      actionOutcomes,
      voided,
      startChat,
      relationshipChanges,
      targetDate: typeof parsed.targetDate === 'string' ? parsed.targetDate : undefined,
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