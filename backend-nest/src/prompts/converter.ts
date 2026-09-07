/**
 * Open-Pax — Action Converter Prompt
 * ==================================
 * Convertitore delle azioni del giocatore (desript-to-action.md)
 */

import { PromptVariables, ConvertedAction } from './types';
import { parseJsonLoose } from '../utils/json-repair';

/**
 * Costruisce il prompt per la conversione dell'azione
 */
export function buildConverterPrompt(vars: PromptVariables): string {
  const actionText = vars.DESCRIPTION_ACTION_TEXT || '';

  return `Converti la decisione del giocatore in un'azione comprensibile per la simulazione.

Il giocatore comanda la politia ${vars.PLAYER_POLITY}.

Quasi ogni azione deve essere trasformata nel tipo "ACTION".
Il tipo "CHAT" (diplomazia) va usato SOLO se il giocatore menziona esplicitamente trattative diplomatiche.

Tipi di azione (SEMPRE action):
- Attacking (attacco)
- Constructing (costruzione)
- Researching (ricerca)
- Consolidating (consolidamento)
- Mobilizing (mobilitazione)
- Industrializing (industrializzazione)
- Rearming (riarmo)
- Militarizing (militarizzazione)
- Disarming (disarmo)
- Affirming (conferma)
- Negating (negazione)

Diplomazia SOLO se il giocatore vuole aprire una trattativa con un'altra politia.

[Contesto di gioco]

${vars.WORLD_BEFORE_ROUND_ONE_TEXT}

[Regole di simulazione]

${vars.HISTORICAL_PRESET_SIMULATION_RULES}

[Descrizione della mappa]

${vars.GRAND_MAP_DESCRIPTION_NO_CITY}

[Altre azioni del giocatore in questo turno]

${vars.PLAYER_ACTIONS_THIS_ROUND || '(Nessuna altra azione)'}

(Sono fornite solo per comprendere il disegno complessivo del giocatore. Il tono e la lunghezza vanno copiati dall'AZIONE SPECIFICA da convertire, non da queste.)

[Date di gioco]

${vars.ORIGIN_ROUND_DATE}

---

Azione del giocatore da convertire:

${actionText}

Il tuo compito:
1. Determinare il tipo: action o chat
2. Se action — riscrivi il testo del giocatore in modo più dettagliato: aggiungi dettagli concreti di esecuzione — riferimenti a meccanismi reali, ministeri, programmi, settori produttivi, regioni della descrizione della mappa — perché il simulatore capiscia COME eseguire l'ordine
3. NON togliere nulla dall'intenzione del giocatore — solo arricchisci. Persino un'azione già ben scritta va migliorata e precisata
4. Il tono dell'output ripete il tono di QUESTA azione: colloquiale in colloquiale, di ruolo in di ruolo, prima persona in prima persona
5. La lunghezza dell'output è circa il 50% superiore al testo del giocatore, ma non oltre 650 caratteri. Se il testo del giocatore è già lungo — non gonfiarlo: condensalo e precisalo
6. Se chat — formula il primo messaggio della trattativa in veste del giocatore: deve riassumere ciò che vuole ottenere dalla negoziazione, e ripete anch'esso il suo tono

Rispondi sempre in italiano.

---

Il tuo output DEVE essere in formato JSON:
{
  "type": "action|chat",
  "text": "Descrizione precisa dell'azione",
  "targetPolity": "nome della politia (solo per chat)",
  "chatMessage": "primo messaggio (solo per chat)"
}

VERY IMPORTANT: Rispondi SOLO con JSON valido.`;
}

export function parseConverterResponse(text: string): ConvertedAction {
  try {
    const parsed = parseJsonLoose<any>(text);

    return {
      type: parsed.type === 'chat' ? 'chat' : 'action',
      text: parsed.text || text,
      targetPolity: parsed.targetPolity,
      chatMessage: parsed.chatMessage,
    };
  } catch (e) {
    console.error('[PARSER] Failed to parse converter response:', e);

    // Fallback: restituisci come azione
    return {
      type: 'action',
      text: text.substring(0, 650),
    };
  }
}

/**
 * Build prompt for batch action conversion (multiple actions in one LLM call)
 */
export function buildBatchConverterPrompt(vars: PromptVariables, actions: string[]): string {
  const actionsList = actions.map((action, i) => `${i + 1}. ${action}`).join('\n');

  return `Converti le decisioni del giocatore in azioni comprensibili per la simulazione.

Il giocatore comanda la politia ${vars.PLAYER_POLITY}.

Quasi ogni azione deve essere trasformata nel tipo "ACTION".
Il tipo "CHAT" (diplomazia) va usato SOLO se il giocatore menziona esplicitamente trattative diplomatiche.

Tipi di azione (SEMPRE action):
- Attacking (attacco)
- Constructing (costruzione)
- Researching (ricerca)
- Consolidating (consolidamento)
- Mobilizing (mobilitazione)
- Industrializing (industrializzazione)
- Rearming (riarmo)
- Militarizing (militarizzazione)
- Disarming (disarmo)
- Affirming (conferma)
- Negating (negazione)

Diplomazia SOLO se il giocatore vuole aprire una trattativa con un'altra politia.

[Contesto di gioco]

${vars.WORLD_BEFORE_ROUND_ONE_TEXT}

[Regole di simulazione]

${vars.HISTORICAL_PRESET_SIMULATION_RULES}

[Descrizione della mappa]

${vars.GRAND_MAP_DESCRIPTION_NO_CITY}

[Date di gioco]

${vars.ORIGIN_ROUND_DATE}

---

Azioni del giocatore da convertire:

${actionsList}

Il tuo compito per OGNI azione:
1. Determinare il tipo: action o chat
2. Se action — riscrivi il testo del giocatore in modo più dettagliato: aggiungi dettagli concreti di esecuzione — riferimenti a meccanismi reali, ministeri, programmi, settori produttivi, regioni della descrizione della mappa — perché il simulatore capiscia COME eseguire l'ordine
3. NON togliere nulla dall'intenzione del giocatore — solo arricchisci. Persino un'azione già ben scritta va migliorata e precisata
4. Il tono dell'output ripete il tono di QUESTA azione: colloquiale in colloquiale, di ruolo in di ruolo, prima persona in prima persona
5. La lunghezza dell'output è circa il 50% superiore al testo del giocatore, ma non oltre 650 caratteri. Se il testo del giocatore è già lungo — non gonfiarlo: condensalo e precisalo
6. Se chat — formula il primo messaggio della trattativa in veste del giocatore: deve riassumere ciò che vuole ottenere dalla negoziazione, e ripete anch'esso il suo tono

Rispondi sempre in italiano.

---

Il tuo output DEVE essere in formato JSON di array:
[
  {
    "index": 1,
    "type": "action|chat",
    "text": "Descrizione precisa dell'azione",
    "targetPolity": "nome della politia (solo per chat)",
    "chatMessage": "primo messaggio (solo per chat)"
  },
  {
    "index": 2,
    ...
  }
]

VERY IMPORTANT: Rispondi SOLO con un array JSON valido. Nessun testo aggiuntivo.`;
}

/**
 * Parse batch converter response - returns array of converted actions
 */
export function parseBatchConverterResponse(text: string): ConvertedAction[] {
  try {
    const parsed = parseJsonLoose<any[]>(text);

    if (!Array.isArray(parsed)) {
      throw new Error('Response is not an array');
    }

    return parsed.map((item: any) => ({
      type: item.type === 'chat' ? 'chat' : 'action',
      text: item.text || '',
      targetPolity: item.targetPolity,
      chatMessage: item.chatMessage,
    }));
  } catch (e) {
    console.error('[PARSER] Failed to parse batch converter response:', e);

    // Fallback: ogni azione come action con il testo originale
    return [];
  }
}