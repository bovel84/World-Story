/**
 * P02-bis — Parlare con un ministro: il contesto della sua sedia
 * ============================================================
 * L'autore ha chiesto il concetto centrale: **il parlare**. «Io fare una parte
 * intermedia dove vedo tutti i ministri e magari la posso interrogarli o
 * parlarci… i ministri portano problemi, una chat come il consulente con idee e
 * soluzioni, con della grafica dentro e numeri reali. Poi alla fine la chat
 * termina con un ordine.»
 *
 * Questo modulo prepara ciò che serve perché quella chat sia **onesta**: il
 * contesto che si dà al modello quando parla un ministro. La regola è la stessa
 * del gabinetto, e non cambia perché c'è di mezzo un modello linguistico:
 *
 * **il ministro non è una fonte di dati.** Il modello può spiegare, proporre,
 * ordinare le priorità e rispondere alle domande del giocatore — ma i numeri che
 * usa sono **solo** quelli che il motore gli passa, e ogni cifra porta la sua
 * provenienza. Un ministro che inventasse una cifra sarebbe peggio di un
 * ministro muto: darebbe autorevolezza a un numero falso.
 *
 * Da cui tre vincoli nel testo del contesto:
 *
 *  - **le cifre sono date, non chieste**: il modello non deve dedurle né
 *    arrotondarle, e una cifra `unknown` va dichiarata come mancante;
 *  - **la sedia delimita la competenza**: il Tesoro non parla di cantieri, i
 *    Lavori non promettono prestiti. Se la domanda è fuori dalla sedia, il
 *    ministro lo dice e rimanda al collega;
 *  - **la conversazione non impegna nulla**: una chat non spende, non prenota e
 *    non costruisce. L'ordine nasce alla fine, dalla bozza, e passa per il
 *    preflight (invariante MG-I1).
 *
 * Modulo **puro**: compone il testo del contesto e la richiesta d'apertura.
 * Nessuna chiamata al modello qui.
 */

import { SEAT_LABEL, SEAT_READS, type CabinetAddress, type CabinetItem, type CabinetSeat } from './Cabinet';
import type { GovernmentAgenda } from './GovernmentAgenda';

/** Il contesto di una sedia, pronto per essere dato a un modello. */
export interface MinisterBriefing {
  readonly seat: CabinetSeat;
  readonly label: string;
  /** La competenza della sedia, in una riga. */
  readonly reads: string;
  /**
   * Il testo che il modello riceve: i fatti della sedia, le cifre con la loro
   * provenienza, e le regole che non può violare.
   */
  readonly context: string;
  /** I bisogni che la sedia porta, se ce ne sono. */
  readonly hasNeeds: boolean;
}

/** Come si scrive la provenienza di una cifra, per il modello. */
export function figureLine(figure: { label: string; value: string; unit: string; basis: unknown }): string {
  const basis = figure.basis as { kind?: string; source?: string; method?: string; missing?: string };
  const value = figure.value ? `${figure.value} ${figure.unit}`.trim() : 'non disponibile';
  if (basis?.kind === 'measured') return `- ${figure.label}: ${value} (misurato da: ${basis.source})`;
  if (basis?.kind === 'estimated') return `- ${figure.label}: ${value} (stimato con: ${basis.method})`;
  if (basis?.kind === 'unknown') return `- ${figure.label}: DATO MANCANTE (${basis.missing}) — dichiaralo, non inventarlo`;
  return `- ${figure.label}: ${value}`;
}

/**
 * Il contesto di un ministro, composto dai fatti della sua sedia.
 *
 * Il testo è deliberatamente esplicito sulle regole: un modello che non le
 * conosce inventa, e un ministro che inventa è peggio di uno che tace.
 */
export function briefingFor(address: CabinetAddress, agenda: GovernmentAgenda): MinisterBriefing {
  const lines: string[] = [
    `Sei il ${SEAT_LABEL[address.seat]} del governo.`,
    `La tua competenza: ${SEAT_READS[address.seat]}.`,
    '',
    'REGOLE CHE NON PUOI VIOLARE:',
    '1. Usi SOLO le cifre elencate qui sotto. Non ne deduci, non ne arrotondi, non ne inventi.',
    '2. Dove è scritto «DATO MANCANTE» lo dichiari: non lo sostituisci con una stima plausibile.',
    '3. Non impegni nulla: non spendi, non prenoti, non avvii opere. Proponi, e la decisione è del giocatore.',
    '4. Se la domanda è fuori dalla tua competenza, lo dici e rimandi al collega competente.',
    '',
  ];

  if (address.items.length === 0) {
    lines.push('Non hai nulla da portare al consiglio in questo momento.');
  } else {
    lines.push('QUELLO CHE PORTI AL CONSIGLIO:');
    for (const item of address.items) {
      lines.push('');
      lines.push(`## ${item.need}`);
      lines.push(`Perché adesso: ${item.because}`);
      if (item.work) lines.push(`Riguarda l'opera: ${item.work.name} (${item.work.workId})`);
      lines.push('Cifre:');
      for (const figure of item.figures) lines.push(figureLine(figure));
      lines.push('Strade percorribili:');
      for (const path of item.paths) {
        const prereq = path.prerequisites.length > 0 ? ` — serve: ${path.prerequisites.join(', ')}` : '';
        lines.push(`- ${path.title}: ${path.detail}${prereq} Esito atteso: ${path.expected}`);
      }
    }
  }

  lines.push('');
  lines.push(`Ci sono ${agenda.voices.length} questioni sul tavolo del consiglio in tutto.`);

  return {
    seat: address.seat,
    label: SEAT_LABEL[address.seat],
    reads: SEAT_READS[address.seat],
    context: lines.join('\n'),
    hasNeeds: address.items.length > 0,
  };
}

/**
 * La domanda d'apertura, quando il giocatore entra nella chat di un ministro.
 * Non è una risposta del modello: è ciò che il ministro direbbe per primo,
 * composto dai fatti — così la chat si apre su un fatto, non sul vuoto.
 */
export function openingMessage(briefing: MinisterBriefing, items: readonly CabinetItem[]): string {
  if (!briefing.hasNeeds) {
    return `Non ho nulla da portare al consiglio adesso: ${briefing.reads.split(',')[0]} non presenta problemi. Chiedimi quello che vuoi.`;
  }
  const first = items[0];
  const urgent = first.urgency === 'critica' ? 'È la cosa più urgente che ho.' : '';
  return `${first.need}. ${first.because} ${urgent}`.trim();
}

/** Le sedie che hanno qualcosa da dire: quelle con cui vale la pena parlare. */
export function seatsWithNeeds(agenda: GovernmentAgenda, cabinet: { addresses: readonly CabinetAddress[] }): readonly CabinetSeat[] {
  return cabinet.addresses.filter(address => address.items.length > 0).map(address => address.seat);
}
