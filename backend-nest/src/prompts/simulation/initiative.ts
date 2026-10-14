import type { PromptVariables } from '../types';
import type { NationSituationRecord } from '../../core/government/NationSituation';

/** Prompt-only direction: no new model call, state, effects or event schema. */
export function buildNarrativeInitiative(): string {
  return `
[MONDO VIVO — sviluppi, non soltanto resoconti]
- Una causa deve essere già documentata; il suo prossimo sviluppo NON deve essere già scritto. Puoi simulare una nuova richiesta, una controproposta, un confronto istituzionale o un'opportunità coerente con quella causa, la data e gli attori disponibili. Non limitarti a riassumere il passato.
- Dopo gli esiti degli ordini, usa lo spazio restante per far avanzare un filone aperto: pressione interna, impegno, processo, trattativa o problema specifico della premessa nazionale. Anche senza ordini, il mondo continua. Un dato ordinario di bilancio o un esercito esistente non bastano a creare una crisi.
- Mostra chi vuole cosa, perché adesso e chi sostiene un interesse diverso. Gli attori sociali e istituzionali documentati possono presentare richieste al governo; NON possono decidere nuove politiche, spese o impieghi di forze al posto del giocatore. Per un fatto interno usa reactions: []; per uno esterno restano obbligatori gli attori e le opzioni del CONTESTO DI REAZIONE.
- Nella description lega antefatto, svolta e posta in gioco. Se resta una decisione aperta, chiudi con la richiesta concreta o due direzioni plausibili e il loro compromesso, senza eseguirle né garantire esiti. Se esiste una scadenza documentata, ricordala; non inventarne una. Non ogni notizia deve diventare un dilemma.
- Riprendi le conseguenze delle scelte e delle questioni rinviate, senza riproporre lo stesso evento con un titolo diverso. Alterna problemi e opportunità solo quando le fonti lo consentono. Non importare automaticamente eventi della storia reale successivi alla divergenza.
- Non creare risorse, leader, trattati, catastrofi o risultati materiali con la prosa: restano vincolanti dossier, risorse, mapChanges e validatori. Zero eventi è valido quando manca uno sviluppo plausibile; il budget è un tetto, non una quota.
`;
}

/** Sources previously absent from the compact path and from some preset overrides.
 * Independent caps keep a long government brief from hiding crises/commitments. */
export function buildNarrativeSituationSources(vars: PromptVariables): string {
  const sections: Array<[string, string | undefined, number]> = [
    ['PRESSIONI APERTE', vars.PEACETIME_PRESSURES, 800],
    ['CRISI REGISTRATA', vars.NATION_CRISIS, 600],
    ['VOCI E INTERESSI INTERNI', vars.GOVERNMENT_STATE, 700],
    ['IMPEGNI IN VIGORE', vars.ACTIVE_COMMITMENTS, 700],
  ];
  return sections.filter(([, value]) => value?.trim()).map(([label, value, cap]) => {
    const body = value!.trim();
    return `[${label}]\n${body.length > cap ? `${body.slice(0, cap - 1).trimEnd()}…` : body}`;
  }).join('\n\n');
}

/** These sources were prepared by the turn pipeline but only worldPulse read
 * the storylines; the main narrator never received national directions. */
export function buildWorldNarrativeContext(input: {
  date: string; startDate: string; playerPolityId: string; actorIds: readonly string[];
  storylines?: readonly { id: string; title: string; summary: string; parties: readonly string[]; trajectory?: string; active_from?: string; active_until?: string }[];
  situations?: readonly NationSituationRecord[];
}): string {
  const allowed = new Set([input.playerPolityId, ...input.actorIds]);
  const threads = (input.storylines ?? [])
    .filter(thread => thread.parties.some(id => allowed.has(id))
      && (!thread.active_from || thread.active_from <= input.date)
      && (!thread.active_until || thread.active_until >= input.date))
    .sort((a, b) => Number(b.parties.includes(input.playerPolityId)) - Number(a.parties.includes(input.playerPolityId)))
    .slice(0, 2).map(thread => `Filone ${thread.id}: ${thread.title}. ${thread.summary} ${thread.trajectory ?? ''}`.slice(0, 450));
  const nations = (input.situations ?? [])
    .filter(record => allowed.has(record.polityId) && record.startDate === input.startDate && record.startDate <= input.date)
    .slice(0, 3).map(record => `${record.countryName} (${record.polityId}), al ${record.startDate}: ${record.situation.slice(0, 500)}`);
  if (!threads.length && !nations.length) return '';
  return `\n[DIREZIONI DEL MONDO — scenario e interessi, non risultati già accaduti]\n${[...threads, ...nations].join('\n')}
STATO CORRENTE > CRONACA DELLA PARTITA > FILONI DEL PRESET > CONTESTO NAZIONALE. Alla data ${input.date} riprendi solo questioni ancora plausibili: una crisi risolta non riparte perché citata nel contesto iniziale. Le tendenze non sono profezie né effetti materiali. Una nazione può agire per i propri interessi, anche senza una nostra azione; reactions e opzioni restano quelle ammesse dal motore.\n`;
}
