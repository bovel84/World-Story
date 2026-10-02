/**
 * WS-GOV-SEAT-BOARDS — Il Consiglio: la Tavola comune delle riunioni (B25/B26)
 * ==========================================================================
 * Il difetto osservato: una riunione multi-ministro non esisteva come stato.
 * Ogni sedia aveva la sua Tavola, ma non c'era il modo di **promuovere** la
 * proposta di un ministro al Consiglio e di vederla sommare alle contribuzioni
 * delle altre sedie.
 *
 * Due regole, le stesse del task:
 *  - **non si duplica la proposta**: promuovere significa tenere
 *    `originSeat` + `promotedProposalIds` e leggere le contribuzioni dal
 *    `DecisionWorkspace` **vivo** di ogni sedia. La stessa proposta che il
 *    ministro vede sulla sua Tavola è quella che il Consiglio vede (nessuna
 *    copia che può divergere);
 *  - **la Tavola del Tesoro non è la Tavola comune**: il Consiglio aggrega le
 *    competenze (`LAVORI`, `TESORO`, …), non riusa la plancia di una sola sedia.
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata al modello.
 */
import {
  activeProposal, isReadyForAct, measureSummary,
  type DecisionMeasure, type DecisionWorkspace,
} from './decisionWorkspace';
import { CABINET_SEATS, seatBoardConfig, type CabinetSeat } from './seatDecisionBoards';

/** Lo stato della riunione di Consiglio: solo riferimenti, nessuna copia. */
export interface CouncilWorkspace {
  readonly id: string;
  /** L'obiettivo comune promosso dal ministro (il piano della riunione). */
  readonly objective: string | null;
  /** La sedia che ha promosso la proposta. */
  readonly originSeat: CabinetSeat;
  /** Gli id delle proposte promosse: la promozione è un **riferimento**. */
  readonly promotedProposalIds: readonly string[];
  /** Le sedie che partecipano alla riunione, in ordine di convocazione. */
  readonly seats: readonly CabinetSeat[];
  /** La revisione della proposta al momento della promozione (lineage). */
  readonly revision: number;
}

/** La lettura del workspace vivo di una sedia: è il chiamante a possederlo. */
export type CouncilLookup = (seat: CabinetSeat) => DecisionWorkspace | null;

/** La contribuzione di una sedia alla Tavola comune, derivata dal suo workspace. */
export interface CouncilContribution {
  readonly seat: CabinetSeat;
  readonly label: string;
  readonly competence: string;
  readonly objective: string | null;
  readonly measures: readonly DecisionMeasure[];
  readonly unresolved: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly revision: number;
  readonly hasProposal: boolean;
  readonly ready: boolean;
}

/** Si può promuovere? Serve almeno un obiettivo o una proposta. */
export function canPromoteToCouncil(workspace: DecisionWorkspace | null): boolean {
  if (!workspace) return false;
  return Boolean(workspace.objective || activeProposal(workspace));
}

/** Promuove la proposta di una sedia al Consiglio (riferimento, non copia). */
export function promoteToCouncil(workspace: DecisionWorkspace, seat: CabinetSeat): CouncilWorkspace {
  const proposal = activeProposal(workspace);
  return {
    id: `consiglio-${seat}`,
    objective: workspace.objective,
    originSeat: seat,
    promotedProposalIds: proposal ? [proposal.id] : [],
    seats: [seat],
    revision: workspace.revision,
  };
}

/** Convoca una sedia nella riunione. Idempotente: convocare due volte non cambia. */
export function conveneSeat(council: CouncilWorkspace, seat: CabinetSeat): CouncilWorkspace {
  if (council.seats.includes(seat)) return council;
  return { ...council, seats: [...council.seats, seat] };
}

/** La contribuzione di una sedia: dal suo workspace, o vuota se non ne ha ancora uno. */
export function councilContribution(seat: CabinetSeat, workspace: DecisionWorkspace | null): CouncilContribution {
  const config = seatBoardConfig(seat);
  const proposal = workspace ? activeProposal(workspace) : null;
  const measures = proposal?.measures ?? [];
  const unresolved = [
    ...(proposal?.unresolvedQuestions ?? []),
    ...measures.filter(measure => measure.status === 'unresolved').map(measure => measure.label),
  ];
  return {
    seat,
    label: config.title,
    competence: config.competence,
    objective: workspace?.objective ?? null,
    measures,
    unresolved,
    evidenceIds: workspace?.evidenceIds ?? [],
    revision: workspace?.revision ?? 0,
    hasProposal: proposal !== null,
    ready: workspace ? isReadyForAct(workspace) : false,
  };
}

/** Le contribuzioni della riunione, nell'ordine di convocazione. */
export function councilContributions(council: CouncilWorkspace, lookup: CouncilLookup): CouncilContribution[] {
  return council.seats.map(seat => councilContribution(seat, lookup(seat)));
}

/** Le sedie del gabinetto non ancora convocate: serve ai pulsanti della Tavola comune. */
export function seatsNotConvened(council: CouncilWorkspace): CabinetSeat[] {
  return CABINET_SEATS.filter(seat => !council.seats.includes(seat));
}

/** Una riga della Tavola comune: la competenza e le sue misure. */
export interface CouncilLine {
  readonly seat: CabinetSeat;
  readonly label: string;
  readonly objective: string | null;
  readonly measures: readonly string[];
  readonly unresolved: readonly string[];
  readonly ready: boolean;
}

/** Le righe della Tavola comune: una per sedia convocata, dal workspace vivo. */
export function councilLines(council: CouncilWorkspace, lookup: CouncilLookup): CouncilLine[] {
  return councilContributions(council, lookup).map(contribution => ({
    seat: contribution.seat,
    label: contribution.label,
    objective: contribution.objective,
    measures: contribution.measures.map(measureSummary),
    unresolved: contribution.unresolved,
    ready: contribution.ready,
  }));
}

/**
 * Lo stato della riunione: è `ready-for-act` solo quando **ogni** sedia
 * convocata ha portato la sua parte (almeno una misura) e non resta nulla in
 * sospeso. Finché una sedia tace o una domanda è aperta, la riunione è aperta.
 */
export function councilStatus(council: CouncilWorkspace, lookup: CouncilLookup): 'open' | 'ready-for-act' {
  const contributions = councilContributions(council, lookup);
  if (contributions.length === 0) return 'open';
  const complete = contributions.every(contribution => contribution.hasProposal && contribution.measures.length > 0);
  const pending = contributions.some(contribution => contribution.unresolved.length > 0);
  if (!complete || pending) return 'open';
  return 'ready-for-act';
}

/**
 * La proposta del Consiglio è pronta per l'atto? Serve un obiettivo, ogni sedia
 * convocata con la sua parte, e nessuna domanda aperta.
 */
export function councilReadyForAct(council: CouncilWorkspace, lookup: CouncilLookup): boolean {
  return Boolean(council.objective) && councilStatus(council, lookup) === 'ready-for-act';
}
