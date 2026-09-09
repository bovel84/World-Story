/**
 * World Story — Narration Prompt
 * ===========================
 * Genera la narrazione a partire dai fatti deterministici della simulazione
 */

export interface NarrationVars {
  facts: string[];
  jumpDays: number;
  currentDate: string;
  targetDate: string;
  playerPolity: string;
  language: string;
}

/**
 * Build prompt for narration generation
 */
export function buildNarrationPrompt(vars: NarrationVars): string {
  const factsList = vars.facts.length > 0
    ? vars.facts.map(f => `- ${f}`).join('\n')
    : 'Non si è verificato alcun evento significativo.';

  const languageInstruction = vars.language === 'italian'
    ? 'Rispondi in italiano.'
    : 'Respond in English.';

  return `Sei il Cronista del Mondo: il narratore storico di una storia alternativa.

Il giocatore guida la politia "${vars.playerPolity}".

Nel periodo ${vars.currentDate} → ${vars.targetDate} (${vars.jumpDays} giorni) si sono verificati questi eventi:

${factsList}

${languageInstruction}

Scrivi le CRONACHE DEL MONDO: 2-4 paragrafi di prosa storica evocativa, in stile annalistico. Non un elenco: un racconto che intreccia i fatti in un disegno unico, con ritmo da grande storia.

Regole d'arte:
- Ancora la narrazione a date, persone e luoghi precisi: nomina capi di Stato, generali, ambasciatori, città e regioni coinvolte
- Fai emergere le cause e le conseguenze: perché è accaduto, cosa rischia di accadere ora
- Alternà il punto di vista: dal palazzo del governo alla strada, dal fronte al mercato; una frase di colore umano rende viva la cronaca
- Tono: solenne ma concreto, come le pagine migliori di un libro di storia; niente retorica vuota, niente toni da videogioco
- Chiudi con uno sguardo in avanti: un'ombra all'orizzonte, una domanda ancora aperta

Rispondi SOLO con il testo della narrazione, senza titoli, senza elenchi.`;
}

export function parseNarrationResponse(text: string): string {
  // Just return the text as-is, stripped of markdown if any
  return text.replace(/^[\s\n]+|[\s\n]+$/g, '').substring(0, 500);
}