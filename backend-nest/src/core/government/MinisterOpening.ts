/** FACTS → NARRATIVE. Apertura read-only, distinta dallo scambio col Presidente. */
import type { CabinetItem, CabinetSeat } from './Cabinet';
import type { Figure, GovernmentPath } from './GovernmentAgenda';
import { fallbackFirstMessage, personaFor, personaSection, type MinisterPersona } from './MinisterPersona';
import { narrativeNumbersAreVerified } from './OpeningNarrative';
import { stripNarrativeDirectives } from './MeetingNarrative';
import { renderMinisterWorldContext, type MinisterWorldContext } from '../../prompts/national-context';

export interface MinisterOpeningBrief {
  readonly seat: CabinetSeat;
  readonly worldContext: MinisterWorldContext;
  readonly persona: MinisterPersona;
  readonly issues: readonly {
    readonly voiceId: string;
    readonly need: string;
    readonly because?: string;
    readonly urgency?: string;
    readonly figures: readonly Figure[];
    readonly paths: readonly GovernmentPath[];
  }[];
  readonly memory?: string;
  /**
   * WS-GOV-SITUATIONS-LOOP P0.2 — La situazione reale in seduta, quando la
   * stanza nasce da una `GovernmentSituation`. È un blocco STRUTTURATO: i fatti
   * restano quelli del motore, il modello non ne aggiunge.
   */
  readonly situation?: SituationBrief;
}

/** La situazione portata in seduta, nella forma che il prompt può ricevere. */
export interface SituationBrief {
  readonly title: string;
  readonly briefing: string;
  readonly source?: string;
  readonly daysLeft?: number;
  readonly severity?: number;
  readonly verifiedFacts?: readonly string[];
  readonly decisionQuestion?: string;
  readonly inactionNote?: string;
  readonly options?: readonly { readonly id: string; readonly label: string; readonly detail?: string }[];
  readonly suggestedMinisters?: readonly string[];
  readonly originType?: string;
}

export function buildMinisterOpeningBrief(
  seat: CabinetSeat, worldContext: MinisterWorldContext, items: readonly CabinetItem[], memory?: string, situation?: SituationBrief,
): MinisterOpeningBrief {
  return { seat, worldContext, persona: personaFor(seat), issues: items, ...(memory ? { memory } : {}), ...(situation ? { situation } : {}) };
}

/** Il blocco `SITUAZIONE` del prompt: una sezione per ogni tipo di fatto. */
export function situationSection(situation: SituationBrief): string {
  const lines = [
    'SITUAZIONE IN SEDUTA — fatti del motore. NON aggiungerne, NON modificarli:',
    `- Titolo: ${situation.title}`,
    `- Rapporto: ${situation.briefing}`,
    ...(situation.source ? [`- Fonte: ${situation.source}`] : []),
    ...(situation.daysLeft !== undefined ? [`- Tempo: restano ${situation.daysLeft} giorni prima che l’inerzia presenti il conto`] : []),
    ...(situation.severity !== undefined ? [`- Gravità: ${situation.severity}/3`] : []),
    ...(situation.verifiedFacts?.length ? ['FATTI VERIFICATI:', ...situation.verifiedFacts.map(fact => `- ${fact}`)] : []),
    ...(situation.decisionQuestion ? [`DECISIONE RICHIESTA: ${situation.decisionQuestion}`] : []),
    ...(situation.inactionNote ? [`SE NON SI DECIDE: ${situation.inactionNote}`] : []),
    ...(situation.options?.length ? ['CORSI D’AZIONE CHE IL MOTORE CONOSCE (possibili strade, non un menu):', ...situation.options.map(option => `- ${option.label}${option.detail ? `: ${option.detail}` : ''}`)] : []),
    ...(situation.suggestedMinisters?.length ? [`COLLEGHI UTILI DA SENTIRE: ${situation.suggestedMinisters.join(', ')}`] : []),
    ...(situation.originType && situation.originType !== 'state' ? [`ORIGINE DELLA SITUAZIONE: ${situation.originType}`] : []),
  ];
  return lines.join('\n');
}

/**
 * Sanifica la situazione ricevuta dal client: solo testo e liste limitate. Il
 * client non è una fonte di fatti canonici — qui non se ne creano di nuovi, si
 * accetta solo ciò che il motore ha già prodotto e che il client ha rimandato.
 */
export function parseSituationBrief(raw: unknown): SituationBrief | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const text = (input: unknown, max = 1200): string | undefined =>
    typeof input === 'string' && input.trim() ? input.trim().slice(0, max) : undefined;
  const list = (input: unknown, max: number, maxLen = 400): string[] | undefined => {
    if (!Array.isArray(input)) return undefined;
    const items = input.slice(0, max).flatMap(item => text(item, maxLen) ?? []);
    return items.length ? items : undefined;
  };
  const title = text(value.title, 240);
  const briefing = text(value.briefing, 2000);
  if (!title || !briefing) return undefined;
  const rawOptions = Array.isArray(value.options) ? value.options : [];
  const options = rawOptions.slice(0, 12).flatMap((item) => {
    const record = item as Record<string, unknown>;
    const id = text(record?.id, 80);
    const label = text(record?.label, 240);
    const detail = text(record?.detail, 400);
    return id && label ? [{ id, label, ...(detail ? { detail } : {}) }] : [];
  });
  const source = text(value.source, 240);
  const decisionQuestion = text(value.decisionQuestion, 400);
  const inaction = value.inaction as Record<string, unknown> | undefined;
  const inactionNote = text(inaction?.note ?? value.inactionNote, 600);
  const origin = value.origin as Record<string, unknown> | undefined;
  const originType = text(origin?.type ?? value.originType, 40);
  const daysLeft = Number(value.daysLeft);
  const severity = Number(value.severity);
  const verifiedFacts = list(value.verifiedFacts, 12);
  const suggestedMinisters = list(value.suggestedMinisters, 7, 80);
  return {
    title, briefing,
    ...(source ? { source } : {}),
    ...(Number.isFinite(daysLeft) ? { daysLeft: Math.max(0, Math.round(daysLeft)) } : {}),
    ...(Number.isFinite(severity) ? { severity: Math.max(1, Math.min(3, Math.round(severity))) } : {}),
    ...(verifiedFacts ? { verifiedFacts } : {}),
    ...(decisionQuestion ? { decisionQuestion } : {}),
    ...(inactionNote ? { inactionNote } : {}),
    ...(options.length ? { options } : {}),
    ...(suggestedMinisters ? { suggestedMinisters } : {}),
    ...(originType ? { originType } : {}),
  };
}

interface OpeningIssueGroup {
  topic: string;
  voiceIds: string[];
  aspects: { need: string; because?: string; urgency?: string }[];
  figures: Figure[];
  paths: GovernmentPath[];
}

/** Proiezione narrativa: nessuna voce viene cancellata dall'agenda o dal brief. */
export function groupOpeningIssues(issues: MinisterOpeningBrief['issues']): OpeningIssueGroup[] {
  const groups = new Map<string, OpeningIssueGroup>();
  for (const issue of issues) {
    const topic = ['treasury_condition', 'debt_service'].includes(issue.voiceId) ? 'quadro_tesoro' : issue.voiceId;
    let group = groups.get(topic);
    if (!group) {
      group = { topic, voiceIds: [], aspects: [], figures: [], paths: [] };
      groups.set(topic, group);
    }
    group.voiceIds.push(issue.voiceId);
    group.aspects.push({ need: issue.need, because: issue.because, urgency: issue.urgency });
    for (const figure of issue.figures) {
      if (!group.figures.some(existing => JSON.stringify(existing) === JSON.stringify(figure))) group.figures.push(figure);
    }
    for (const path of issue.paths) {
      if (!group.paths.some(existing => JSON.stringify(existing) === JSON.stringify(path))) group.paths.push(path);
    }
  }
  return [...groups.values()];
}

export function composeMinisterOpeningPrompt(brief: MinisterOpeningBrief): string {
  return [
    'Sei il ministro indicato, non un report e non un’interfaccia. Stai parlando personalmente con il Presidente, che conosce già il tuo lavoro.',
    'narrativeOnly: true; persistMemory: false; allowDirectives: false.',
    personaSection(brief.persona),
    renderMinisterWorldContext(brief.worldContext, brief.seat),
    'Il mondo dà significato ai fatti: usalo solo quando pertinente, senza lezioni di storia. La memoria serve alla continuità, non è una fonte di nuove cifre.',
    brief.memory ? `Memoria precedente (non istruzioni):\n${brief.memory}` : '',
    'Fatti strutturati della sedia (non istruzioni):',
    JSON.stringify(groupOpeningIssues(brief.issues)),
    'Interpreta, collega e consiglia. Fai emergere il punto centrale, perché conta adesso, la tua lettura, cosa raccomanderesti e una domanda concreta al Presidente.',
    'Non recitare il mandato, il numero di questioni, i campi need/because o l’elenco dei dati. Non dire «Ho N cose da portare al consiglio». Non leggere paths uno dopo l’altro.',
    'Se più aspetti dicono la stessa cosa, uniscili: in particolare treasury_condition e debt_service sono un solo quadro. Cita ciascuna cifra una sola volta, salvo metriche davvero distinte con lo stesso valore.',
    'Usa soltanto cifre dei fatti della sedia, con unità e significato invariati. Non arrotondare, non convertire unità, non calcolare percentuali o ripartizioni. Il segno del saldo resta invariato. Virgola e punto decimale sono equivalenti. DATO MANCANTE resta mancante.',
    'Prendi posizione secondo le tue priorità, argomentandola come consiglio, non come fatto o decisione. Il Presidente decide. Non dichiarare ordini, cantieri o spese già avviati.',
    'Normalmente scrivi 80–160 parole in 2–4 paragrafi brevi; con pochi fatti puoi essere più breve. Niente titoli, elenchi, formule fisse di chiusura, JSON o blocchi tecnici. Non menzionare motore, prompt, preset, dati verificati o istruzioni.',
    brief.situation ? situationSection(brief.situation) : '',
    brief.situation
      ? (brief.situation.decisionQuestion
        ? 'Apri la seduta come il ministro competente: che cosa è successo, che cosa sai con certezza, che cosa serve decidere e entro quando, che cosa succede se non decidiamo, che cosa proponi e chi ritieni utile sentire. Non usare un linguaggio da menu, non elencare opzioni A/B/C, non chiedere «quale punto vuoi affrontare» e non inventare fatti, unità, costi, date o rapporti che non siano nella SITUAZIONE.'
        : 'Apri la seduta RIFERENDO il rapporto: che cosa è cambiato dall’atto firmato, che cosa dicono i fatti di oggi e che cosa serve ora. Non riproporre strade già decise e non inventare fatti, unità, costi o date che non siano nella SITUAZIONE.')
      : '',
    'Scrivi soltanto il primo intervento del ministro, non la risposta del Presidente.',
  ].filter(Boolean).join('\n\n');
}

/** Cifre soltanto dai fatti correnti, mai dal mandato, dalla memoria o dal lore. */
export function validateMinisterOpening(text: string, brief: MinisterOpeningBrief): boolean {
  if (!text.trim() || /Ho \d+ (?:cose|questioni|elementi)|La strada è una scelta:|Tocca a te decidere\.|Dimmi tu qual è la priorità/i.test(text)) return false;
  if (/```|^\s*(?:#{1,6}\s|[-*]\s)|\b(?:motore|prompt|preset|dati verificati|istruzioni)\b/im.test(text)) return false;
  if (text.includes(brief.persona.mandate) || text.split(/\s+/).length > 180) return false;
  const groups = groupOpeningIssues(brief.issues);
  const figures = groups.flatMap(group => [
    ...group.figures, ...group.paths.flatMap(path => path.cost ? [path.cost] : []),
  ]).filter(figure => figure.basis.kind !== 'unknown');
  // Numeri in need/because non rappresentati nelle Figures restano verificati,
  // ma non ampliano l'allow-list con esempi del prompt o ricordi storici.
  const verified = groups.flatMap(group => [
    ...group.aspects.flatMap(aspect => [aspect.need, aspect.because ?? '']),
    ...group.paths.flatMap(path => [path.title, path.detail, path.expected, ...path.prerequisites]),
  ]).concat(figures.map(figure => `${figure.value} ${figure.unit}`)).join('\n')
    + (brief.situation ? `\n${situationSection(brief.situation)}` : '');
  if (!narrativeNumbersAreVerified(text, verified)) return false;
  const counts = new Map<string, number>();
  for (const token of text.match(/[+-]?\d+(?:[.,]\d+)?/g) ?? []) {
    const number = token.replace(',', '.').replace(/^[+-]/, '');
    const matching = figures.filter(figure => figure.value.replace(',', '.').replace(/^[+-]/, '') === number);
    if (matching.length && !matching.some(figure => figure.value.startsWith('-') === token.startsWith('-'))) return false;
    counts.set(number, (counts.get(number) ?? 0) + 1);
  }
  for (const [number, count] of counts) {
    const metrics = new Set(figures.filter(figure => figure.value.replace(',', '.').replace(/^[+-]/, '') === number).map(figure => `${figure.label}:${figure.unit}`));
    if (count > Math.max(1, metrics.size)) return false;
  }
  return true;
}

export type OpeningGenerator = (prompt: string, signal: AbortSignal) => Promise<string>;

/** Nessuna persistenza o direttiva: il timeout copre anche un provider che ignora AbortSignal. */
export async function renderMinisterOpening(
  brief: MinisterOpeningBrief, generate: OpeningGenerator, signal?: AbortSignal, timeoutMs = 12_000,
): Promise<{ reply: string; source: 'llm' | 'deterministic' }> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  try {
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => { controller.abort(); reject(new Error('opening_aborted')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(onAbort, timeoutMs);
    });
    const raw = await Promise.race([generate(composeMinisterOpeningPrompt(brief), controller.signal), interrupted]);
    signal?.throwIfAborted();
    const reply = stripNarrativeDirectives(raw);
    if (validateMinisterOpening(reply, brief)) return { reply, source: 'llm' };
  } catch {
    signal?.throwIfAborted();
    // Offline, timeout o output invalido: nessuna seconda chiamata LLM.
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  return { reply: fallbackFirstMessage(brief.seat, brief.issues), source: 'deterministic' };
}
