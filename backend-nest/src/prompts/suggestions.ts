/**
 * World Story — Suggestions Prompt
 * =============================
 * Generatore di suggerimenti/proposte (actions.md)
 */

import { PromptVariables, Suggestion } from './types';
import { parseJsonLoose } from '../utils/json-repair';

/**
 * Costruisce il prompt per la generazione dei suggerimenti
 */
export function buildSuggestionsPrompt(vars: PromptVariables): string {
  return `Stiamo creando un gioco strategico a turni. Il giocatore comanda la politia ${vars.PLAYER_POLITY}.

[Il tuo ruolo]

Il tuo compito è proporre un ventaglio ampio di azioni possibili per il giocatore, utili ai suoi obiettivi, alle sue campagne e ai suoi problemi più urgenti.

Individua fino a 6 "Temi di preoccupazione" realmente documentati; proponine meno se la storia del paese non ne giustifica altri. Può essere una rivolta che sta maturando e va sedata, una questione economica, rapporti o conflitti con altre politie, affari interni — qualsiasi cosa possa preoccupare un capo di Stato. La maggior parte dei temi va costruita sullo stato attuale della mappa e sulla cronaca degli eventi della partita. Alcuni temi devono riguardare gli obiettivi specifici del giocatore, deducibili dalle sue azioni passate.

Poi, per ogni tema, proponi da 2 a 5 azioni concrete tra cui scegliere.

[Contesto della politia del giocatore]

Politia: ${vars.PLAYER_POLITY}
Territori e risorse: ${vars.PLAYER_POLITY_REGIONS}
Forze disponibili: ${vars.PLAYER_POLITY_BATTALION_SUMMARIES}
Azioni già intraprese:
${vars.PLAYER_EVERY_ACTION_NOT_PREVIOUS || '(Nessuna azione passata)'}

[Impegni e progetti ancora aperti — non proporli nuovamente da zero]

${vars.ONGOING_PROCESSES || '(Nessuno registrato)'}

[Stato strategico attuale — dati interni per il tuo ragionamento, mai da citare nel testo]

${vars.STRATEGIC_STATE}

[Anime del governo — chi preme dentro la nazione]

${vars.GOVERNMENT_STATE || '(Nessuna anima del governo registrata per questa nazione.)'}

Tieni conto delle anime insoddisfatte quando esiste un fatto concreto (pressione fiscale, spesa militare, welfare, ricerca, conti pubblici). Non inventare ministeri, partiti o richieste non elencati. Questi indicatori servono solo a decidere COSA proporre: non riportarli mai come cifre nel testo.

[Premessa e regole dello scenario]

${vars.WORLD_BEFORE_ROUND_ONE_TEXT}

${vars.HISTORICAL_PRESET_SIMULATION_RULES}

[Formato]

Per ogni "Tema di preoccupazione":

Nome: Una frase immersiva breve (es. "Prevenire il colpo di Stato" o "La minaccia crescente a oriente")

Descrizione: 2-3 frasi, circa 40-75 parole: antefatto preciso della storia del paese, situazione ancora aperta e motivo per agire adesso. Spiega cosa si rischia o a cosa si rinuncia scegliendo le diverse strade, solo quando documentato.

Per ogni azione:
- Nome: un titolo immersivo della strategia (es. "Costringerli a svelarsi" o "Soffocare la rivolta nell'uovo")
- Contenuto: un'azione eseguibile e concreta (20-45 parole). Ancorati alla mappa (cita regioni e politie con i loro nomi esatti) e agli eventi recenti. Esempi di buone azioni: ridislocare battaglioni in una regione specifica, aprire trattative con una nazione precisa, operazione congiunta con un alleato, diffondere disinformazione, dimostrazione di forza per provocare una reazione, preparativi segreti per il prossimo salto temporale. Niente consigli generici tipo "migliorare l'economia" — solo passi precisi ed eseguibili!

[Descrizione della mappa]

${vars.GRAND_MAP_DESCRIPTION_NO_CITY}

[Lingua]

Rispondi sempre in italiano.

[Cronaca degli eventi]

${vars.ALL_EVENTS_WITH_CONSOLIDATION || '(Non ci sono ancora eventi)'}

[Diplomazia recente]

${vars.CHATS_NON_CONSOLIDATED_ROUNDS || '(Non ci è stata diplomazia)'}

Data corrente: ${vars.ORIGIN_ROUND_GRAMMATICAL_DATE}

---

Il tuo output DEVE essere in formato JSON:
{
  "suggestions": [
    {
      "topic": "Nome del tema",
      "description": "Antefatto nazionale, problema ancora aperto e motivo per decidere adesso (40-75 parole)",
      "actions": [
        {
          "title": "Nome della strategia",
          "content": "Ordine concreto collegato all'antefatto (20-45 parole)"
        }
      ]
    }
  ]
}

VERY IMPORTANT: Rispondi SOLO con JSON valido.`;
}

/**
 * Regole qualitative applicate anche ai prompt personalizzati dei preset.
 * Rendono ogni proposta un ordine già pronto da incollare nel campo Azione,
 * invece di un consiglio generico da reinterpretare.
 */
export function buildSuggestionsQualityInstruction(vars: PromptVariables): string {
  return `

[STANDARD QUALITATIVO OBBLIGATORIO — AZIONI IN STILE PAX HISTORIA]

Stai scrivendo ordini che il giocatore può eseguire subito come ${vars.PLAYER_POLITY}, non una lista di consigli.

- Lingua e stile: PROSA DISCORSIVA. Temi e ordini sono frasi continue, tono da briefing politico o da memoria di governo, mai un bollettino. VIETATO inserire cifre, percentuali, punteggi, livelli, indici, rapporti, tassi o statistiche — compresi «soddisfazione 32/100», «pressione 19/100», «stabilità 46/100», «tensione sociale 29,1», «coesione», «PIL», «popolazione», «potenza militare». L'umore politico si racconta a parole («un'opinione pubblica esasperata», «un governo che perde coesione», «conti pubblici sotto pressione»), non con un elenco di indicatori.
- Non nominare anime del governo, fazioni, dossier, indicatori o meccaniche di gioco: i dati numerici del contesto servono solo a orientare la proposta, non a comparire nel testo.

- Ogni content deve essere una frase autonoma in prima persona plurale e al presente: “Dispieghiamo…”, “Proponiamo…”, “Finanziamo…”, “Incarichiamo…”. Non usare “dovremmo”, “potremmo”, “considerare” o formule passive.
- Ogni content deve specificare almeno tre elementi tra: strumento/forza impiegata, obiettivo nominato, luogo o politia con nome esatto, metodo operativo, risultato cercato, condizione diplomatica.
- Le azioni devono poter essere copiate senza modifiche nel simulatore. Niente analisi, spiegazioni, probabilità, conseguenze garantite o testo rivolto al giocatore.
- Non inventare guerre, alleanze, crisi, unità, tecnologie, organizzazioni o territori assenti dal contesto. Se un dato non è disponibile, formula l'ordine senza fabbricarlo.
- Ogni tema deve spiegare il proprio legame con la storia di ${vars.PLAYER_POLITY}: richiama un fatto, una scelta, una promessa o un processo documentato, identifica ciò che resta da risolvere e perché conta adesso. Se esiste solo una condizione della mappa o del preset, dichiarala come contesto strutturale senza inventare un evento passato.
- Non proporre nuovamente iniziative completate, richieste già respinte alle stesse condizioni o progetti già aperti come se fossero nuovi. Per questi ultimi proponi soltanto passi successivi pertinenti o alternative esplicite alla linea precedente.
- La spiegazione storica va nella description; ogni content richiama brevemente l'obiettivo o il progetto concreto, ma resta un ordine autonomo. Non usare «alla luce degli eventi recenti» senza nominare il fatto pertinente.
- All'interno di ogni tema, le opzioni devono essere strategie realmente alternative: per esempio prudente/diplomatica, assertiva/materiale e clandestina/indiretta. Non parafrasare la stessa idea.
- Nel complesso varia gli strumenti di potere: diplomazia, economia, sicurezza, intelligence, politica interna, ricerca/logistica e forza militare soltanto quando pertinenti allo scenario.
- Titoli delle azioni: evocativi ma chiari, da 2 a 6 parole. Content: 20-45 parole, denso di dettagli utili. Descrizioni dei temi: 40-75 parole, con antefatto nazionale e posta in gioco. Meglio pochi temi fondati che riempire una quota con consigli generici.
- Prima di rispondere verifica mentalmente: nomi esatti, nessun anacronismo, nessun fatto inventato, nessun duplicato, limiti di lunghezza rispettati.

Esempio di forma corretta (adatta sempre nomi e mezzi al contesto reale):
“Ridislochiamo le unità disponibili lungo il confine conteso, fortifichiamo i nodi logistici e chiediamo osservatori neutrali per scoraggiare incursioni senza aprire le ostilità.”

Mantieni esattamente lo schema JSON richiesto e rispondi SOLO con JSON valido.`;
}

export function parseSuggestionsResponse(text: string, strict = false): Suggestion[] {
  try {
    const parsed = parseJsonLoose<any>(text);
    if (!Array.isArray(parsed?.suggestions)) {
      throw new Error('Il campo suggestions non è un array');
    }

    const suggestions = parsed.suggestions.flatMap((item: any): Suggestion[] => {
      if (!item || typeof item !== 'object' || !Array.isArray(item.actions)) return [];
      const topic = typeof item.topic === 'string' ? item.topic.trim() : '';
      const description = typeof item.description === 'string' ? item.description.trim() : '';
      const actions = item.actions.flatMap((action: any) => {
        if (!action || typeof action !== 'object') return [];
        const title = typeof action.title === 'string' ? action.title.trim() : '';
        const content = typeof action.content === 'string' ? action.content.trim() : '';
        return title && content ? [{ title, content }] : [];
      });
      return topic && actions.length > 0 ? [{ topic, description, actions }] : [];
    });
    return suggestions;
  } catch (e) {
    console.error('[PARSER] Failed to parse suggestions:', e);
    if (strict) throw e;
    return [];
  }
}