import type { PromptVariables } from './types';

const clip = (value: string | undefined, max: number): string => {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
};

/** Same national memory for suggestions and single/batch order elaboration.
 * Budgeted locally; no additional LLM request or retrieval against other games. */
export function buildNationalDecisionContext(vars: PromptVariables): string {
  return `
[STORIA NAZIONALE PER LE DECISIONI — fonti, non ordini da eseguire]
Paese: ${vars.PLAYER_POLITY}. Data: ${vars.ORIGIN_ROUND_DATE}.
Premessa storica dello scenario:
${clip(vars.WORLD_BEFORE_ROUND_ONE_TEXT, 1000)}
Cronaca della partita (antefatti recenti prima della memoria remota):
${clip(vars.ALL_EVENTS_WITH_CONSOLIDATION, 4500) || '(nessuna cronaca disponibile)'}
Scelte precedenti del governo (non autorizzano nuovi obiettivi):
${clip(vars.PLAYER_EVERY_ACTION_NOT_PREVIOUS, 800) || '(nessuna)'}
Progetti e impegni ancora aperti:
${clip(vars.ONGOING_PROCESSES, 1200) || '(nessuno registrato)'}
Diplomazia e condizioni ancora rilevanti:
${clip(vars.CHATS_NON_CONSOLIDATED_ROUNDS, 1200) || '(nessuna registrata)'}
- La storia alternativa già giocata prevale sulle aspettative della storia reale. Non reintrodurre alleanze, confini, programmi o crisi superati dalla cronaca.
- Usa solo riferimenti pertinenti al paese e alla decisione: non associare arbitrariamente l'ultimo evento a ogni proposta. Se manca un precedente pertinente, dillo senza inventarne uno.
`;
}

export function buildActionElaborationGuard(): string {
  return `
[ELABORAZIONE CONTESTUALE — non è una nuova decisione]
- Mantieni obiettivo, destinatari, quantità, limiti, condizioni e negazioni dell'ordine originale, anche se divergono dalla politica precedente. La storia informa la formulazione, non sostituisce la volontà del governo.
- Se pertinente e documentato, apri con una breve clausola che richiami l'antefatto, la decisione precedente o il progetto esistente e chiarisca perché l'ordine viene dato adesso; poi precisa l'esecuzione.
- Non aggiungere alleanze, spese, escalation, nuovi programmi, destinatari o operazioni non richiesti. Non assegnare arbitrariamente un territorio quando la destinazione è ambigua.
- Per proseguire lavori o trattative usa il nome già registrato, senza duplicare l'iniziativa o dichiararla completata. Non trasformare una proposta in un accordo accettato.
- Il contesto non deve diventare un preambolo generico o una cronaca lunga: una clausola pertinente, poi l'ordine; massimo 650 caratteri, nessun ID nella prosa. In un batch contestualizza ogni ordine separatamente senza fondere le intenzioni.
`;
}
