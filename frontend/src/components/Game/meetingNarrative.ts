/**
 * WS-GOV-COUNCIL-HARDENING — La voce del ministro, separata dai fatti
 * ====================================================================
 * Il difetto osservato: gli interventi della riunione erano corretti ma
 * meccanici — «L'opera è… Il piano dichiara… La distinta è coperta…» — cioè
 * **bollettini**, non ministri. La causa era architetturale: fatti e voce erano
 * la stessa cosa, composta in una sola funzione deterministica.
 *
 * Qui i due livelli si separano, come chiede la regola del progetto:
 *
 *   FATTI  →  sempre dal MOTORE  (la Tavola, `MeetingEngineRead`)
 *   VOCE   →  solo dall'LLM      (questo modulo costruisce il brief e riceve la prosa)
 *
 * **La personalità non è duplicata qui.** La voce autorevole è
 * `backend-nest/src/core/government/MinisterPersona.ts` (`personaFor()` /
 * `personaSection()`): la inietta il percorso esistente
 * `government/minister → briefingFor()` quando il renderer chiama l'LLM. Questo
 * modulo non contiene profili di sedia: costruisce soltanto il **brief
 * verificato** e valida la prosa. La formulazione deterministica di riserva è
 * il contributo del motore già composto da `councilMeeting.ts`
 * (`lavoriContribution` / `tesoroContribution`), passato come `fallback`.
 *
 * L'LLM non è mai una fonte: riceve il brief e produce **soltanto testo**. Prima
 * dell'uso, la prosa viene validata contro i fatti: se contiene una cifra che il
 * brief non porta, viene scartata e si ricade sul fallback deterministico. La
 * riunione non si blocca mai perché il modello manca o sbaglia.
 *
 * Modulo **puro** salvo il renderer iniettato: nessun I/O diretto, nessuna
 * chiamata al modello dentro le funzioni di composizione.
 */
import { seatSpeaker, type CouncilMeeting, type MeetingEngineRead } from './councilMeeting';
import type { CabinetSeat } from './seatDecisionBoards';

/** Il contratto narrativo: materiale verificato per una sedia, mai cifre nuove. */
export interface MinisterMeetingBrief {
  readonly seat: CabinetSeat;
  readonly facts: readonly { readonly label: string; readonly value?: string; readonly status?: string; readonly source: string }[];
  readonly blockers: readonly string[];
  readonly politicalContext: readonly string[];
  readonly meetingObjective: string;
  readonly previousContributions: readonly string[];
}

/** La funzione che produce la voce: riceve il brief e restituisce testo. */
export type MeetingNarrator = (seat: CabinetSeat, brief: MinisterMeetingBrief) => Promise<string>;

/** Il brief di una sedia: i fatti della Tavola più i blocchi e il contesto politico. */
export function meetingBriefFor(meeting: CouncilMeeting, read: MeetingEngineRead, seat: CabinetSeat): MinisterMeetingBrief {
  const facts = meeting.workspace.lines
    .filter(line => line.owner === seat)
    .map(line => ({
      label: line.label,
      ...(line.value ? { value: line.value } : {}),
      status: line.status,
      source: line.source,
    }));
  return {
    seat,
    facts,
    blockers: meeting.unresolved.filter(item => item.blocker).map(item => item.label),
    politicalContext: meeting.unresolved.filter(item => !item.blocker).map(item => item.label),
    meetingObjective: meeting.objective || meeting.subject,
    previousContributions: meeting.contributions
      .filter(contribution => contribution.seat !== seat)
      .map(contribution => `${seatSpeaker(contribution.seat)}: ${contribution.text}`),
  };
}

/**
 * Il testo che il renderer riceve come richiesta. Contiene **solo** il materiale
 * verificato e l'ordine di non aggiungere cifre: il modello non deve calcolare
 * nulla, e non deve ripetere i numeri se non serve. La personalità è iniettata
 * dal server (`personaSection`), non replicata qui.
 */
export function narrativePrompt(brief: MinisterMeetingBrief): string {
  const facts = brief.facts.length > 0
    ? brief.facts.map(fact => `- ${fact.label}: ${fact.value ?? fact.status ?? 'da verificare'} (fonte: ${fact.source})`).join('\n')
    : '- (nessun dato di competenza in questa riunione)';
  const blockers = brief.blockers.length > 0 ? brief.blockers.join('; ') : 'nessuno';
  const political = brief.politicalContext.length > 0 ? brief.politicalContext.join('; ') : 'nessuna';
  return [
    'RIUNIONE DI GOVERNO — materiale verificato. Interpretalo con la tua voce, non aggiungere né modificare cifre.',
    `Obiettivo: ${brief.meetingObjective}`,
    'Dati della tua competenza:',
    facts,
    `Blocchi tecnici: ${blockers}`,
    `Questioni politiche: ${political}`,
    'Scrivi un breve intervento in prima persona, come il titolare di questa sedia: commenta i dati, dichiara la tua lettura e la tua proposta. Non elencare, non usare titoli, non ripetere tutti i numeri se non serve. Non decidere al posto del Presidente.',
  ].join('\n');
}

/** Una cifra della prosa è nei fatti? Il confronto è per numero intero, conservativo. */
function numberIsCovered(token: string, haystack: readonly string[]): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^0-9.,])${escaped}([^0-9]|$)`);
  return haystack.some(value => pattern.test(value));
}

/**
 * La prosa rispetta i fatti? Se compare una cifra che il brief non porta, il
 * testo non è utilizzabile: la Tavola resterebbe l'unica verità e la chat
 * direbbe un numero falso. In quel caso si ricade sul fallback.
 */
export function narrativeRespectsFacts(text: string, brief: MinisterMeetingBrief): boolean {
  const prose = String(text ?? '');
  if (!prose.trim()) return false;
  const allowed = brief.facts.flatMap(fact => [fact.value ?? '', fact.label, fact.status ?? '']);
  const tokens = prose.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return tokens.every(token => numberIsCovered(token, allowed));
}

export interface NarratedContribution {
  readonly text: string;
  readonly source: 'llm' | 'deterministic';
}

/**
 * Prova la voce narrativa; se manca, fallisce o contraddice i fatti, ricade sul
 * **fallback deterministico già composto dal motore** (`fallback`, cioè il
 * contributo della sedia in `councilMeeting.ts`). Non lancia mai: la riunione
 * non si blocca, e la voce deterministica non è un secondo profilo di sedia.
 */
export async function narrativeContribution(
  brief: MinisterMeetingBrief,
  fallback: string,
  narrator?: MeetingNarrator,
): Promise<NarratedContribution> {
  if (narrator) {
    try {
      const text = await narrator(brief.seat, brief);
      if (narrativeRespectsFacts(text, brief)) return { text: text.trim(), source: 'llm' };
    } catch {
      /* provider assente o in errore: si ricade sul contributo del motore */
    }
  }
  return { text: fallback, source: 'deterministic' };
}
