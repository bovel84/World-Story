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

Il giocatore guida la politia "${vars.playerPolity}" e ne incarna il governo: le sue decisioni sono atti ufficiali di ${vars.playerPolity}. Nella cronaca riferisciti sempre a ${vars.playerPolity} — al governo, al capo di Stato, ai ministri o al popolo — mai a «il giocatore» o «l'utente»: la nazione è protagonista della storia, non chi la controlla.

Nel periodo ${vars.currentDate} → ${vars.targetDate} (${vars.jumpDays} giorni) si sono verificati questi eventi:

${factsList}

${languageInstruction}

Scrivi le CRONACHE DEL MONDO: 2-3 paragrafi, circa 140-220 parole, proporzionati ai fatti disponibili. Non un elenco: intreccia gli sviluppi collegati senza introdurre nuovi eventi. Se non ci sono eventi significativi bastano 1-2 frasi: non inventare attività per riempire lo spazio.

Regole d'arte:
- I fatti forniti sono il solo canone: cita date, persone e luoghi soltanto se documentati; altrimenti usa ruoli istituzionali. Nessuna citazione, testimonianza, cifra o scena di folla inventata.
- Fai emergere cause, scelte e conseguenze materiali già attestate; distingui ciò che è accaduto da ciò che resta possibile o previsto.
- Dai rilievo umano attraverso gli effetti documentati su lavoro, rifornimenti, sicurezza e vita civile, senza simulare testimonianze. Una costruzione annunciata o avviata non è un'opera già operativa.
- Tono: solenne ma concreto, come le pagine migliori di un libro di storia; niente retorica vuota, niente toni da videogioco
- Chiudi sul problema o sull'impegno ancora aperto nei fatti, se esiste. Non aggiungere minacce o suspense artificiale; evita formule ripetitive come «il destino è incerto».

Rispondi SOLO con il testo della narrazione, senza titoli, senza elenchi.`;
}

export function parseNarrationResponse(text: string): string {
  const clean = text.trim().replace(/^```(?:markdown|text)?\s*\n?/i, '').replace(/\n?```$/, '')
    .replace(/^#{1,6}\s+.*(?:\r?\n|$)/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
  const limit = 2400;
  if (clean.length <= limit) return clean;
  const excerpt = clean.slice(0, limit);
  // Preserve complete sentences/paragraphs instead of cutting mid-word at 500.
  const boundary = [...excerpt.matchAll(/[.!?…](?=\s|$)/g)].at(-1)?.index;
  if (boundary !== undefined && boundary >= limit / 2) return excerpt.slice(0, boundary + 1).trim();
  const wordBoundary = excerpt.lastIndexOf(' ');
  return `${excerpt.slice(0, wordBoundary > 0 ? wordBoundary : limit - 1).trimEnd()}…`;
}