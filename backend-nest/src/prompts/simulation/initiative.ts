import type { PromptVariables } from '../types';
import type { NationSituationRecord } from '../../core/government/NationSituation';
import type { WorldReactionCause } from '../../core/simulation/ReactionContext';
import { selectWorldStorylines, type WorldStorylineSource } from '../../game/worldReactionCauses';

/** Prompt-only direction: no new model call, state, effects or event schema. */
export function buildNarrativeInitiative(): string {
  return `
[MONDO VIVO — sviluppi, non soltanto resoconti]
- Sei l'orchestratore del preset, non un cronista che aspetta ordini. Valuta in silenzio per ciascun attore ammesso: obiettivo proprio → occasione o ostacolo attuale → mossa sostenibile → risposta delle altre parti → questione ancora aperta. Non emettere piani intermedi o nuove chiamate. Il preset definisce epoca, istituzioni e interessi; stato e storia della partita aggiornano quel punto di partenza.
- Una causa deve essere già documentata; il suo prossimo sviluppo NON deve essere già scritto. Puoi simulare una nuova richiesta, una controproposta, un confronto istituzionale o un'opportunità coerente con quella causa, la data e gli attori disponibili. Non limitarti a riassumere il passato.
- Dopo gli esiti degli ordini, sviluppa i filoni documentati che maturano NELLA FINESTRA TEMPORALE corrente: pressioni interne, obiettivi NPC, accordi, processi e crisi del preset. Più filoni possono avanzare nello stesso periodo, con svolte distinte; nessuna quota di eventi. Un dato ordinario di bilancio o un esercito esistente non bastano a creare una crisi.
- Mostra chi vuole cosa, perché adesso e chi sostiene un interesse diverso. Gli attori sociali e istituzionali documentati possono presentare richieste al governo; NON possono decidere nuove politiche, spese o impieghi di forze al posto del giocatore. Per un fatto interno usa reactions: []; per uno esterno restano obbligatori gli attori e le opzioni del CONTESTO DI REAZIONE.
- Nella description lega antefatto, svolta e posta in gioco. Se resta una decisione aperta, chiudi con la richiesta concreta o due direzioni plausibili e il loro compromesso, senza eseguirle né garantire esiti. Se esiste una scadenza documentata, ricordala; non inventarne una. Non ogni notizia deve diventare un dilemma.
- Riprendi le conseguenze delle scelte e delle questioni rinviate, senza riproporre lo stesso evento con un titolo diverso. Alterna problemi e opportunità solo quando le fonti lo consentono. Non importare automaticamente eventi della storia reale successivi alla divergenza.
- Valuta anche il teatro indipendente selezionato: una vicenda fra NPC può progredire senza nominare il giocatore o chiedergli il permesso. Non trasformare ogni obiettivo in guerra: accordi, rivalità commerciali, mediazioni e aperture politiche devono servire interessi distinti. Una semplice ripetizione dell'agenda non è un evento.
- PRIORITÀ EVENTI: narra sempre prima i fatti del mondo, le decisioni e le loro conseguenze come righe event. Le reactions sono posizioni politiche nella cronaca, NON richieste di aprire una chat.
- Usa startChat SOLO se un NPC interpella direttamente la nazione del giocatore per una scelta diplomatica, una negoziazione o un messaggio indirizzato al suo governo. Il relativo event deve citare esplicitamente la nazione del giocatore e spiegare il contatto; in complete indica participants (solo NPC che parlano), topic breve, message come prima battuta reale in prima persona, kind ed eventHeadline ESATTO. Se la crisi riguarda soltanto altre nazioni, narrala come evento con startChat: []. Non aprire una chat per ogni paese citato, per gli osservatori o per le normali reactions.
- Se racconti una richiesta o un invito diretto al giocatore, DEVI renderlo giocabile: compila startChat con la prima battuta, oppure note nella reaction della controparte per una nota bilaterale. Non lasciare il contatto soltanto nella description. Ometti note per commenti pubblici o scambi fra terzi.
- Una conferenza con più interlocutori si apre come UNA chat di gruppo per lo stesso evento, non come messaggi separati. Non chiedere conferme per iniziative che un NPC può decidere da sé.
- Non creare risorse, leader, trattati, catastrofi o risultati materiali con la prosa: restano vincolanti dossier, risorse, mapChanges e validatori. Zero eventi è valido quando manca uno sviluppo plausibile; il budget è un tetto, non una quota.
`;
}

/**
 * Editorial contract for the existing single simulation call. The format and
 * validation stay in the canonical engine; these rules only improve coverage,
 * specificity and continuity of its dated historical dispatches.
 */
export function buildWorldChronicleGuide(): string {
  return `
[CRONACA STORICA MONDIALE — qualità dei dispacci]
- Produci una TIMELINE di fatti datati, non conversazioni: sviluppi nazionali e, quando documentati, teatri fra NPC indipendenti dal giocatore. Alterna temi politici, sociali, diplomatici, economici, militari e umanitari SOLO quando preset, stato o cronaca offrono cause concrete.
- Headline: chi fa cosa e dove, senza vaghezze. Description: 3–5 frasi fluide, con antefatto verificabile → svolta datata → protagonisti e luogo → conseguenza → questione aperta. Varia gli incipit, non ripetere il titolo in prosa. Distingui annuncio, avvio ed esito.
- Segui i filoni fino alle conseguenze, non ripetere notizie già concluse: ogni nuovo dispaccio sul tema deve mostrare una fase nuova (decisione, esecuzione, reazione o esito). Avanza solo entro TARGET_ROUND_DATE e non inserire sviluppi di mesi successivi. Dopo la data di divergenza la storia reale NON è un calendario obbligato; se il mondo ha deviato, prevalgono stato e scelte della partita. Non inventare leader, date esatte, vittime o cifre non supportate.
- Un fatto fra NPC non deve nominare il giocatore; un evento nazionale non è meno importante di uno mondiale. Luoghi solo se verificati sulla mappa. MapChanges solo per effetti materiali realmente ammessi dal motore, altrimenti mapChanges:[].
- La reaction narra la decisione nella cronaca. startChat soltanto se il dispaccio include una richiesta diretta al governo del giocatore. Conserva JSON/NDJSON, opzioni validate e budget del turno.
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
  date: string; startDate: string; turn?: number; playerPolityId: string; actorIds: readonly string[];
  storylines?: readonly WorldStorylineSource[];
  causes?: readonly WorldReactionCause[];
  situations?: readonly NationSituationRecord[];
}): string {
  const allowed = new Set([input.playerPolityId, ...input.actorIds]);
  // Use the same selection as the actor whitelist, not the first two threads
  // in the file. A different selection here starved independent theatres.
  const selectedIds = input.causes?.filter(c => c.sourceRef.startsWith('storyline:')).map(c => c.sourceRef.slice(10));
  const storylinesById = new Map((input.storylines ?? []).map(t => [t.id, t] as const));
  const selected = selectedIds ? selectedIds.flatMap(id => {
    const thread = storylinesById.get(id);
    return thread ? [thread] : [];
  }) : selectWorldStorylines(input.storylines ?? [], input.playerPolityId, input.date, input.turn);
  const threads = selected.filter(thread => thread.parties.some(id => allowed.has(id))
    && thread.state !== 'risolto' && thread.state !== 'congelato'
    && (!thread.active_from || thread.active_from <= input.date) && (!thread.active_until || thread.active_until >= input.date))
    .map(thread => `Filone ${thread.id}: ${thread.title}. ${thread.summary} ${thread.trajectory ?? ''}`.slice(0, 360));
  const agendas = (input.causes ?? []).filter(c => c.sourceRef.startsWith('agenda:') && c.polityIds?.some(id => allowed.has(id)))
    .map(c => `${c.sourceRef}: ${c.summary}`.slice(0, 500));
  // Put recent committed facts alongside the preset's directions, so that
  // the next dispatch develops a cause rather than replaying a headline.
  const priorEvents = (input.causes ?? []).filter(c => c.kind === 'prior_event')
    .slice(0, 2).map(c => `Cronaca già avvenuta, NON ripetere: ${c.summary}`.slice(0, 320));
  const records = (input.situations ?? [])
    .filter(record => allowed.has(record.polityId) && record.startDate === input.startDate && record.startDate <= input.date)
    .slice(0, 9);
  const perNation = Math.min(500, Math.floor(1500 / Math.max(1, records.length)));
  const nations = records.map(record => `${record.countryName} (${record.polityId}), al ${record.startDate}: ${record.situation.slice(0, perNation)}`);
  if (!threads.length && !nations.length && !agendas.length && !priorEvents.length) return '';
  return `\n[DIREZIONI DEL MONDO — scenario e interessi, non risultati già accaduti]\n${[...priorEvents, ...threads, ...agendas, ...nations].join('\n')}
STATO CORRENTE > CRONACA DELLA PARTITA > FILONI DEL PRESET > CONTESTO NAZIONALE. Alla data ${input.date} riprendi solo questioni ancora plausibili: una crisi risolta non riparte perché citata nel contesto iniziale. Le tendenze non sono profezie né effetti materiali. Una nazione può agire per i propri interessi, anche senza una nostra azione; reactions e opzioni restano quelle ammesse dal motore.\n`;
}
