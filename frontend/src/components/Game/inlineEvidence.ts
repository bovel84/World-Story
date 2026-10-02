/**
 * WS-GOVUX-P4 — L'evidenza in linea nel dialogo
 * ============================================
 * La tavola risponde al discorso (P3), ma il collegamento è a senso unico: il
 * messaggio del ministro che ha chiesto un'evidenza non lo dice. Questa fase
 * mette **sotto il messaggio** una card compatta che è un **riferimento**, non
 * un secondo grafico:
 *
 *  - stesso **id** del blocco sulla tavola (`blockId`), così la card e la tavola
 *    parlano della stessa cosa;
 *  - stessi **dati**: il titolo è quello del blocco risolto dal read model, non
 *    un'etichetta inventata a parte; la card non ridisegna nulla;
 *  - un click **mette a fuoco** l'evidenza reale (desktop) o apre la tab Tavola
 *    (mobile) — la decisione di come mostrarla sta al chiamante.
 *
 * Il modulo è **puro**: nessun DOM, nessuno stato, nessuna chiamata. La regola
 * del badge «novità» vive qui perché è una regola, non un effetto: il pallino si
 * spegne quando l'evidenza è **vista**, non quando arriva.
 */
import { evidenceLabel, type EvidenceKey, type PresentationDirective } from './presentation';

/** Dove vive, sulla tavola, l'evidenza di una chiave: id e titolo del blocco. */
export interface EvidenceCardTarget {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
}

/** Il catalogo delle evidenze davvero disponibili per la sedia aperta. */
export type EvidenceCardIndex = Partial<Record<EvidenceKey, EvidenceCardTarget>>;

export interface InlineEvidenceCard {
  /** Identità stabile della card (messaggio + evidenza). */
  readonly key: string;
  readonly messageId: string;
  readonly kind: 'evidence' | 'comparison';
  /** La chiave dell'evidenza; `null` per il confronto. */
  readonly evidence: EvidenceKey | null;
  readonly label: string;
  /** L'`id` del blocco reale sulla tavola (`comparison` per il confronto). */
  readonly blockId: string | null;
  /** Il titolo del blocco reale: gli stessi dati della tavola. */
  readonly title: string;
}

/**
 * Le card di un messaggio: **solo** le direttive che mostrano qualcosa
 * (`show`/`focus`) e il confronto. `annotate`/`dismiss` non portano una nuova
 * evidenza e non producono card. Una chiave senza blocco reale è scartata: niente
 * card fantasma che punterebbe a un'evidenza inesistente.
 */
export function inlineEvidenceCards(input: {
  directives: readonly PresentationDirective[];
  messageId: string;
  index: EvidenceCardIndex;
}): InlineEvidenceCard[] {
  const cards: InlineEvidenceCard[] = [];
  input.directives.forEach((directive, order) => {
    if (directive.op === 'compare') {
      cards.push({
        key: `${input.messageId}:compare:${order}`,
        messageId: input.messageId,
        kind: 'comparison',
        evidence: null,
        label: 'Confronto tra le proposte',
        blockId: 'comparison',
        title: 'Confronto tra le proposte',
      });
      return;
    }
    if (directive.op !== 'show' && directive.op !== 'focus') return;
    const evidence = directive.evidence;
    if (!evidence) return;
    const target = input.index[evidence];
    if (!target) return;
    cards.push({
      key: `${input.messageId}:${evidence}`,
      messageId: input.messageId,
      kind: 'evidence',
      evidence,
      label: evidenceLabel(evidence),
      blockId: target.id,
      title: target.title,
    });
  });

  // Una card per evidenza: due `show` sulla stessa chiave nello stesso lotto
  // sono la stessa evidenza (il lotto è già deduplicato, ma la difesa resta).
  const seen = new Set<string>();
  return cards.filter(card => {
    const id = `${card.kind}:${card.blockId ?? card.label}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Il pallino «nuova evidenza» è un fatto di **visione**, non di arrivo: una volta
 * vista la tela (`pane === 'tavola'`), tornare al dialogo non lo riaccende; solo
 * una **nuova** evidenza (versione della tela diversa da quella vista) lo accende.
 */
export function shouldShowEvidenceBadge(input: {
  hasEvidence: boolean;
  canvasVersion: number;
  seenVersion: number;
  pane: 'dialogo' | 'tavola';
}): boolean {
  return input.hasEvidence && input.pane !== 'tavola' && input.canvasVersion !== input.seenVersion;
}
