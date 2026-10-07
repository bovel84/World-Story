/**
 * WS-CONSULENTE-PROPOSTE — Riparazione mirata di un briefing incompleto.
 *
 * Quando `parseAdvisorResponse` in BRIEFING MODE produce situazioni senza una
 * `council_issue` corrispondente, il Consulente deve comunque prendere
 * iniziativa. Invece di rigenerare l'intero briefing, si esegue AL MASSIMO una
 * completion breve che chiede SOLO i blocchi mancanti, passandole:
 *   - le situazioni scoperte (id, titolo, sintesi, signalKeys/evidenceKeys);
 *   - gli anchor canonici pertinenti;
 *   - gli atti già firmati da non riproporre.
 *
 * La risposta viene riparsata con la validazione canonica esistente
 * (`parseCouncilIssues`) e collegata per `situationId`. Le `advisor_situation`
 * già generate non vengono mai toccate o duplicate. Se il repair fallisce o non
 * produce alcuna decisione verificabile, nessuna proposta viene fabbricata: ogni
 * situazione resta scoperta e viene loggata esplicitamente.
 */
import {
  isPreparatoryCouncilIssue, parseCouncilIssues, MAX_BRIEFING_COUNCIL_ISSUES, type CouncilIssue,
} from './CouncilIssue';
import { bestMatchingSituation, uncoveredAdvisorSituations, withAdvisorBriefingCoverage, type AdvisorResponse, type AdvisorSituation } from './AdvisorSituations';
import { buildCouncilProposalAnchors, MAX_COUNCIL_ANCHORS } from './CouncilProposalAnchors';
import type { VerifiedWorldSnapshot } from './VerifiedWorldSnapshot';

/**
 * Istruzioni del repair: una sola completion, nessuna prosa, nessuna nuova
 * situazione. Una proposta valida è una DECISIONE concreta con situazione
 * collegata; le attività istruttorie restano nella conversazione.
 */
export const ADVISOR_BRIEFING_REPAIR_SYSTEM = [
  'Sei il Primo Consulente. Ricevi SOLO le situazioni del briefing rimaste senza proposta.',
  'Rispondi ESCLUSIVAMENTE con blocchi fenced ```council_issue (uno per ogni situazione elencata), senza alcuna prosa e senza nuovi blocchi advisor_situation.',
  'Ogni blocco: {"title":"...","question":"...","situationId":"<id della situazione>","signalKeys":[...] oppure "anchorKeys":[...],"suggestedMinisters":[...]}.',
  'Includi SEMPRE "situationId" uguale all\'id della situazione che stai coprendo.',
  'Usa solo chiavi canoniche presenti nel payload (signalKeys della situazione o anchor disponibili). Niente fatti, costi, sourceRefs o numeri inventati.',
  'La questione deve essere una DECISIONE concreta: finanziare, autorizzare, avviare, sospendere, negoziare, mobilitare, modificare una politica o assegnare un mandato con risultato e scadenza.',
  'Valutare, verificare, approfondire, monitorare, studiare o sondare NON sono proposte valide.',
  'Non riproporre atti già firmati.',
].join('\n');

/** Payload compatto del repair: solo situazioni scoperte, anchor e atti firmati. */
export function buildAdvisorBriefingRepairPrompt(
  snapshot: VerifiedWorldSnapshot,
  uncovered: readonly AdvisorSituation[],
): string {
  const anchors = buildCouncilProposalAnchors(snapshot).slice(0, MAX_COUNCIL_ANCHORS);
  return JSON.stringify({
    task: 'Per ogni situazione elencata emetti ESATTAMENTE un blocco council_issue con lo stesso situationId.',
    situations: uncovered.map(situation => ({
      id: situation.id,
      title: situation.title,
      summary: situation.summary,
      signalKeys: situation.signalKeys,
      ...(situation.evidenceKeys?.length ? { evidenceKeys: situation.evidenceKeys } : {}),
    })),
    anchors: anchors.map(anchor => ({ key: anchor.key, domain: anchor.domain, reason: anchor.reason })),
    signedActs: snapshot.recent.signedActs.map(act => ({ id: act.id, text: act.text })),
  });
}

export interface AdvisorBriefingRepairDeps {
  /** La SINGOLA completion di repair richiesta; nessun retry applicativo qui. */
  complete: (prompt: string) => Promise<string>;
  /** Motivo dello scarto, per test/log: `situationId` assente = opportunità. */
  onDiscard?: (reason: string, situationId?: string) => void;
}

export interface AdvisorBriefingRepairOutcome {
  response: AdvisorResponse;
  repairedSituationIds: string[];
  discarded: Array<{ situationId?: string; reason: string }>;
}

/**
 * Ripara una sola volta il briefing se mancano proposte per le situazioni.
 * Non tocca `reply` né le `situations`; aggiunge solo le `council_issue` nuove e
 * ricalcola la copertura canonica. Idempotente se il briefing è già completo.
 */
export async function repairAdvisorBriefing(
  snapshot: VerifiedWorldSnapshot,
  result: AdvisorResponse,
  deps: AdvisorBriefingRepairDeps,
): Promise<AdvisorBriefingRepairOutcome> {
  const uncovered = uncoveredAdvisorSituations(result);
  // Il repair nasce SOLO quando esistono situazioni scoperte: senza situazioni
  // non c'è alcuna scheda da collegare e il briefing deterministico resta com'è.
  if (!result.briefingCoverage || result.briefingCoverage.complete || uncovered.length === 0) {
    return { response: result, repairedSituationIds: [], discarded: [] };
  }
  const discarded: Array<{ situationId?: string; reason: string }> = [];
  const discard = (reason: string, situationId?: string): void => {
    discarded.push({ ...(situationId ? { situationId } : {}), reason });
    if (deps.onDiscard) deps.onDiscard(reason, situationId);
    else console.warn(`[AdvisorBriefing] advisor briefing incomplete situation=${situationId ?? 'opportunity'} reason=${reason}`);
  };

  let text: string;
  try {
    text = await deps.complete(buildAdvisorBriefingRepairPrompt(snapshot, uncovered));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    for (const situation of uncovered) discard(reason, situation.id);
    return { response: result, repairedSituationIds: [], discarded };
  }

  // Validazione canonica esistente: atti firmati, chiavi ignote e duplicati
  // vengono scartati con motivo; qui non si aggiunge alcuna permissività.
  const parsed = parseCouncilIssues(snapshot, text, 'advisor', {
    maxIssues: MAX_BRIEFING_COUNCIL_ISSUES,
    onDiscard: reason => discard(reason),
  });
  const uncoveredById = new Map(uncovered.map(situation => [situation.id, situation]));
  const repaired: CouncilIssue[] = [];
  for (const issue of parsed.issues) {
    if (isPreparatoryCouncilIssue(issue)) { discard('Proposta istruttoria, non una decisione', issue.situationId); continue; }
    if (issue.situationId) {
      if (!uncoveredById.has(issue.situationId)) { discard(`situationId ignoto o già coperto: ${issue.situationId}`, issue.situationId); continue; }
      // Più proposte sulla stessa situazione sono alternative legittime: la
      // dedup del parser (domanda identica) resta l'unico filtro anti-copia.
      repaired.push(issue);
      continue;
    }
    // Nessun situationId: la proposta deve agganciarsi senza ambiguità a UNA
    // situazione scoperta, altrimenti viene scartata (nessuna assegnazione
    // arbitraria e nessuna proposta fabbricata).
    const match = bestMatchingSituation(issue, uncovered);
    if (!match) { discard('La proposta non corrisponde ad alcuna situazione scoperta'); continue; }
    repaired.push({ ...issue, situationId: match.id });
  }

  if (!repaired.length) {
    for (const situation of uncovered) discard('Nessuna decisione verificabile dal repair', situation.id);
    return { response: result, repairedSituationIds: [], discarded };
  }
  const merged = withAdvisorBriefingCoverage(snapshot, { ...result, issues: [...result.issues, ...repaired] });
  // Log esplicito delle situazioni che restano scoperte dopo il repair.
  for (const situation of uncoveredAdvisorSituations(merged)) discard('Nessuna decisione verificabile dal repair', situation.id);
  return { response: merged, repairedSituationIds: repaired.flatMap(issue => (issue.situationId ? [issue.situationId] : [])), discarded };
}
