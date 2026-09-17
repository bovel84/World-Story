/**
 * World Story — Registro degli impegni (servizio)
 * ===============================================
 * Ciclo di vita degli impegni: legge il registro, applica le proposte
 * (ultimatum da chat strutturate, proposte del modello validate), scrive solo
 * i cambiamenti e lo espone a prompt, chat diplomatiche e dossier.
 *
 * La cronaca si consolida, il registro no: un trattato firmato venti turni fa
 * resta disponibile.
 */
import { commitmentRepository } from '../repositories';
import {
  applyCommitmentProposals, commitmentsForPolity, describeCommitments,
  normalizeCommitmentStatus, normalizeCommitmentType, ultimatumProposal,
  type Commitment, type CommitmentProposal,
} from '../core/simulation/Commitments';

export interface CommitmentResult {
  commitments: Commitment[];
  created: Commitment[];
  updated: Commitment[];
  written: number;
}

export class CommitmentService {
  constructor(private readonly ctx: {
    gameId: string;
    currentDate(): string;
    currentTurn(): number;
    isStrictGame(): boolean;
  }) {}

  /** Registro corrente (sola lettura). */
  all(): Commitment[] {
    if (this.ctx.isStrictGame()) return [];
    try {
      return commitmentRepository.list(this.ctx.gameId);
    } catch (error) {
      console.warn('[CommitmentService] Registro non leggibile:', error);
      return [];
    }
  }

  /** Blocco pronto per il prompt del turno. */
  describeForPrompt(polityId?: string | null): string {
    return describeCommitments(this.all(), { today: this.ctx.currentDate(), polityId: polityId ?? null });
  }

  /** Riga per le chat diplomatiche: gli impegni che legano quella controparte. */
  describeForPolity(polityId: string): string {
    const list = commitmentsForPolity(this.all(), polityId);
    return describeCommitments(list, { today: this.ctx.currentDate(), limit: 5 });
  }

  /**
   * Applica le proposte al registro. Idempotente e conservativa: le proposte
   * malformate vengono scartate, non interpretate.
   */
  apply(proposals: readonly CommitmentProposal[]): CommitmentResult {
    const empty: CommitmentResult = { commitments: [], created: [], updated: [], written: 0 };
    // Anche senza proposte il registro va rivisto: le scadenze scorrono e un
    // ultimatum non resta aperto in eterno perché nessuno ha parlato.
    if (this.ctx.isStrictGame()) return empty;
    try {
      const current = this.all();
      const result = applyCommitmentProposals(current, proposals, {
        date: this.ctx.currentDate(),
        turn: this.ctx.currentTurn(),
      });
      const changed = [...result.created, ...result.updated];
      const written = commitmentRepository.appendMany(this.ctx.gameId, changed);
      return { ...result, written };
    } catch (error) {
      console.warn('[CommitmentService] Registro non aggiornato:', error);
      return empty;
    }
  }

  /**
   * Propone impegni dal risultato della simulazione: ogni ultimatum aperto in
   * chat è un impegno con scadenza. Il tipo è **strutturato** nel payload, non
   * dedotto dal testo, e la scadenza la fissa il motore (30 giorni).
   */
  fromChatStarts(
    starts: readonly { participants?: string[]; polityName?: string; kind?: string; topic?: string; eventHeadline?: string }[],
    options: { date: string; issuer?: string | null; sourceEventIdByHeadline?: Map<string, string> },
  ): CommitmentProposal[] {
    const proposals: CommitmentProposal[] = [];
    for (const start of starts) {
      if (start?.kind !== 'ultimatum') continue;
      const headline = start.eventHeadline || '';
      proposals.push(ultimatumProposal({
        issuer: options.issuer ?? 'PLAYER',
        counterparty: (start.participants ?? []).filter(Boolean)[0] ?? null,
        topic: start.topic || '',
        date: options.date,
        importance: 3,
        sourceEventId: options.sourceEventIdByHeadline?.get(headline) ?? null,
      }));
    }
    return proposals;
  }

  /**
   * Interpreta le proposte grezze del modello (`commitments`,
   * `commitmentUpdates`): campi obbligatori verificati, il resto scartato.
   */
  parseModelProposals(raw: unknown, rawUpdates: unknown, actor: string): CommitmentProposal[] {
    const proposals: CommitmentProposal[] = [];
    const list = Array.isArray(raw) ? raw : [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const type = normalizeCommitmentType(record.type ?? record.tipo);
      const description = String(record.description ?? record.descrizione ?? '').trim();
      if (!type || !description) continue;
      const counterparty = String(record.counterparty ?? record.controparte ?? '').trim() || null;
      const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(record.deadline ?? '')) ? String(record.deadline) : null;
      proposals.push({
        type,
        actor: String(record.actor ?? actor),
        counterparty,
        description: description.slice(0, 500),
        deadline,
        importance: Number(record.importance ?? record.importanza) || 2,
        sourceEventId: typeof record.sourceEventId === 'string' ? record.sourceEventId : null,
      });
    }
    const updates = Array.isArray(rawUpdates) ? rawUpdates : [];
    for (const item of updates) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const id = String(record.id ?? '').trim();
      const status = normalizeCommitmentStatus(record.status ?? record.stato);
      if (!id || !status) continue;
      proposals.push({
        type: 'promise', actor, counterparty: null, description: '',
        id, status,
        note: String(record.note ?? record.motivo ?? '').slice(0, 300),
      });
    }
    return proposals;
  }

  /** Potatura del rewind: il registro torna a com'era nel turno ripristinato. */
  pruneAfterTurn(turn: number): number {
    try {
      return commitmentRepository.pruneAfterTurn(this.ctx.gameId, turn);
    } catch (error) {
      console.warn('[CommitmentService] Potatura del registro non riuscita:', error);
      return 0;
    }
  }
}
