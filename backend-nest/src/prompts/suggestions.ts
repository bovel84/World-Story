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

Prima individua 6-9 "Temi di preoccupazione" che il giocatore dovrebbe tenere d'occhio. Può essere una rivolta che sta maturando e va sedata, una questione economica, rapporti o conflitti con altre politie, affari interni — qualsiasi cosa possa preoccupare un capo di Stato. La maggior parte dei temi va costruita sullo stato attuale della mappa e sulla cronaca degli eventi della partita. Alcuni temi devono riguardare gli obiettivi specifici del giocatore, deducibili dalle sue azioni passate.

Poi, per ogni tema, proponi da 2 a 5 azioni concrete tra cui scegliere.

[Contesto della politia del giocatore]

Politia: ${vars.PLAYER_POLITY}
Territori e risorse: ${vars.PLAYER_POLITY_REGIONS}
Forze disponibili: ${vars.PLAYER_POLITY_BATTALION_SUMMARIES}
Azioni già intraprese:
${vars.PLAYER_EVERY_ACTION_NOT_PREVIOUS || '(Nessuna azione passata)'}

[Premessa e regole dello scenario]

${vars.WORLD_BEFORE_ROUND_ONE_TEXT}

${vars.HISTORICAL_PRESET_SIMULATION_RULES}

[Formato]

Per ogni "Tema di preoccupazione":

Nome: Una frase immersiva breve (es. "Prevenire il colpo di Stato" o "La minaccia crescente a oriente")

Descrizione: 2-3 frasi, NON più di 25 parole: la sostanza del problema, le sue cause e il contesto, perché è importante. Non scrivere il numero di parole nel testo.

Per ogni azione:
- Nome: un titolo immersivo della strategia (es. "Costringerli a svelarsi" o "Soffocare la rivolta nell'uovo")
- Contenuto: un'azione eseguibile e concreta (fino a 30 parole). Ancorati alla mappa (cita regioni e politie con i loro nomi esatti) e agli eventi recenti. Esempi di buone azioni: ridislocare battaglioni in una regione specifica, aprire trattative con una nazione precisa, operazione congiunta con un alleato, diffondere disinformazione, dimostrazione di forza per provocare una reazione, preparativi segreti per il prossimo salto temporale. Niente consigli generici tipo "migliorare l'economia" — solo passi precisi ed eseguibili!

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
      "description": "Descrizione del problema (15-25 parole)",
      "actions": [
        {
          "title": "Nome della strategia",
          "content": "Descrizione dell'azione (fino a 30 parole)"
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

- Ogni content deve essere una frase autonoma in prima persona plurale e al presente: “Dispieghiamo…”, “Proponiamo…”, “Finanziamo…”, “Incarichiamo…”. Non usare “dovremmo”, “potremmo”, “considerare” o formule passive.
- Ogni content deve specificare almeno tre elementi tra: strumento/forza impiegata, obiettivo nominato, luogo o politia con nome esatto, metodo operativo, risultato cercato, condizione diplomatica.
- Le azioni devono poter essere copiate senza modifiche nel simulatore. Niente analisi, spiegazioni, probabilità, conseguenze garantite o testo rivolto al giocatore.
- Non inventare guerre, alleanze, crisi, unità, tecnologie, organizzazioni o territori assenti dal contesto. Se un dato non è disponibile, formula l'ordine senza fabbricarlo.
- Collega la maggioranza dei temi a fatti precisi della cronaca, della diplomazia, della mappa o alle precedenti azioni del giocatore. Evita temi intercambiabili applicabili a qualunque paese.
- All'interno di ogni tema, le opzioni devono essere strategie realmente alternative: per esempio prudente/diplomatica, assertiva/materiale e clandestina/indiretta. Non parafrasare la stessa idea.
- Nel complesso varia gli strumenti di potere: diplomazia, economia, sicurezza, intelligence, politica interna, ricerca/logistica e forza militare soltanto quando pertinenti allo scenario.
- Titoli delle azioni: evocativi ma chiari, da 2 a 6 parole. Content: 18-30 parole, denso di dettagli utili. Descrizioni dei temi: 15-25 parole.
- Prima di rispondere verifica mentalmente: nomi esatti, nessun anacronismo, nessun fatto inventato, nessun duplicato, limiti di lunghezza rispettati.

Esempio di forma corretta (adatta sempre nomi e mezzi al contesto reale):
“Ridislochiamo le unità disponibili lungo il confine conteso, fortifichiamo i nodi logistici e chiediamo osservatori neutrali per scoraggiare incursioni senza aprire le ostilità.”

Mantieni esattamente lo schema JSON richiesto e rispondi SOLO con JSON valido.`;
}

export function parseSuggestionsResponse(text: string): Suggestion[] {
  try {
    const parsed = parseJsonLoose<any>(text);
    return parsed.suggestions || [];
  } catch (e) {
    console.error('[PARSER] Failed to parse suggestions:', e);
    return [];
  }
}