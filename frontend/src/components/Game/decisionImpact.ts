/**
 * World Story — DECISION-IMPACT: quanto ha inciso una decisione (read model puro)
 * =============================================================================
 * «La cassa sta perdendo ma io non so quanto le mie decisioni stanno incidendo
 * positivamente o negativamente.»
 *
 * Questo modulo risponde con numeri del motore, non con stime:
 *  - **effetto per decisione**: l'addebito che `OrderExecutionService` ha
 *    applicato all'ordine (`settlement`, calcolato quando il turno è stato
 *    eseguito: pagato / coperto solo in parte / annullato senza spesa);
 *  - **variazione del turno**: il delta registrato dallo storico conti
 *    (read model LW02 `deriveCheckpointImpact`).
 * La differenza fra i due è ciò che **non è attribuibile alle singole
 * decisioni** (gestione ordinaria del periodo, acquisti, manutenzione, debito,
 * eventi non dipesi dal giocatore): è un residuo aritmetico fra due numeri
 * registrati dal motore, non una causa dichiarata.
 *
 * Per gli indicatori che il motore registra solo per turno (stabilità,
 * tensione sociale, saldo, PIL…) non esiste alcun valore per singola decisione:
 * il modulo li restituisce come «variazione del turno», mai come effetto della
 * decisione. Se l'addebito per ordine non è disponibile (turni precedenti al
 * reload: il motore non lo conserva oltre il turno), lo dichiara invece di
 * inventare un importo.
 */

import { formatMoney } from '../../utils/format';
import type { CheckpointImpact, ImpactDelta, ImpactTone } from './checkpointImpact';

/** Addebito per singolo ordine, come prodotto dal motore. */
export interface SettlementLike {
  kind: 'charged' | 'partial' | 'unfunded';
  requestedMld: number;
  chargedMld: number;
  label: string;
}

/** Una decisione del giocatore con l'effetto che il motore le ha attribuito. */
export interface DecisionRecord {
  turn: number;
  action: string;
  settlement?: SettlementLike | null;
}

export interface DecisionEffect {
  action: string;
  /** Categoria dell'ordine secondo la stima del motore (es. «Infrastrutture»). */
  category: string;
  /** Importo davvero addebitato (mld). */
  amountMld: number;
  /** Importo richiesto dalla stima (mld). */
  requestedMld: number;
  kind: 'charged' | 'partial' | 'unfunded';
  /** Testo con segno: la spesa è sempre una variazione negativa della cassa. */
  effectText: string;
  detail: string;
  tone: ImpactTone;
}

export interface DecisionImpact {
  /** `true` quando almeno una decisione ha un effetto misurabile registrato. */
  available: boolean;
  effects: DecisionEffect[];
  /** Somma degli addebiti delle decisioni (mld, positivo = speso). */
  attributedMld: number;
  /** Variazione registrata della tesoreria nel turno (mld), se nota. */
  turnMoneyDelta: number | null;
  /** Quota della variazione non attribuibile alle singole decisioni (mld). */
  unattributedMld: number | null;
  /** Indicatori registrati solo per turno: nessun valore per decisione. */
  notAttributable: ImpactDelta[];
  attributedText: string;
  unattributedText: string | null;
  /** Spiegazione da mostrare accanto ai numeri (sempre presente). */
  note: string;
}

const ATTRIBUTION_NOTE =
  'Effetto per decisione: addebito applicato dal motore all\'ordine. Non un giudizio di causa sugli altri indicatori.';

const NOT_ATTRIBUTABLE_NOTE =
  'Il motore registra questi indicatori per turno, non per singola decisione: sono variazione del periodo, non effetto dell\'ordine.';

const NO_SETTLEMENT_NOTE =
  'Per questo turno il motore non registra l\'addebito dei singoli ordini: resta leggibile solo la variazione del periodo.';

/** Indicatori che il motore registra esclusivamente per turno. */
const TURN_ONLY_IDS = new Set(['money']);
const TURN_ONLY_LABELS = new Set(['Tesoreria']);

function describeEffect(settlement: SettlementLike): { text: string; detail: string; tone: ImpactTone } {
  const money = formatMoney(-Math.abs(settlement.chargedMld), { currency: 'mld', decimals: 2, sign: true });
  if (settlement.kind === 'unfunded') {
    return {
      text: '0,00 mld',
      detail: `ordine annullato: la cassa non copriva ${settlement.requestedMld} mld, nessuna spesa registrata`,
      tone: 'warning',
    };
  }
  if (settlement.kind === 'partial') {
    return {
      text: money,
      detail: `coperto solo in parte: addebitati ${settlement.chargedMld} mld dei ${settlement.requestedMld} mld stimati`,
      tone: 'warning',
    };
  }
  return { text: money, detail: `addebitati alla tesoreria (${settlement.label})`, tone: 'negative' };
}

/**
 * Attribuzione per decisione a partire dalle decisioni del turno e dal delta
 * registrato dal motore. Non ordina l'input: si aspetta le decisioni del turno.
 */
export function deriveDecisionImpact(
  decisions: readonly DecisionRecord[],
  turnImpact?: CheckpointImpact | null,
): DecisionImpact {
  const effects: DecisionEffect[] = [];
  for (const decision of decisions) {
    const settlement = decision.settlement;
    if (!settlement || settlement.kind === undefined) continue;
    if (!Number.isFinite(Number(settlement.chargedMld)) || !Number.isFinite(Number(settlement.requestedMld))) continue;
    const described = describeEffect(settlement);
    effects.push({
      action: decision.action,
      category: settlement.label,
      amountMld: Number(settlement.chargedMld),
      requestedMld: Number(settlement.requestedMld),
      kind: settlement.kind,
      effectText: described.text,
      detail: described.detail,
      tone: described.tone,
    });
  }

  const attributedMld = Math.round(effects.reduce((sum, effect) => sum + effect.amountMld, 0) * 1000) / 1000;
  const moneyDelta = turnImpact?.deltas.find(delta => delta.id === 'money' || delta.label === 'Tesoreria') ?? null;
  const turnMoneyDelta = moneyDelta ? moneyDelta.delta : null;
  const unattributedMld = turnMoneyDelta === null
    ? null
    : Math.round((turnMoneyDelta + attributedMld) * 100) / 100;

  const notAttributable = (turnImpact?.deltas ?? []).filter(
    delta => !TURN_ONLY_IDS.has(delta.id) && !TURN_ONLY_LABELS.has(delta.label),
  );

  const available = effects.length > 0;
  const unattributedText = unattributedMld === null
    ? null
    : formatMoney(unattributedMld, { currency: 'mld', decimals: 2, sign: true });

  return {
    available,
    effects,
    attributedMld,
    turnMoneyDelta,
    unattributedMld,
    notAttributable,
    attributedText: formatMoney(-attributedMld, { currency: 'mld', decimals: 2, sign: true }),
    unattributedText,
    note: available
      ? `${ATTRIBUTION_NOTE} ${notAttributable.length > 0 ? NOT_ATTRIBUTABLE_NOTE : ''}`.trim()
      : NO_SETTLEMENT_NOTE,
  };
}
