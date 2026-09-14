/**
 * Costo di un ordine del giocatore — la cassa segue le scelte.
 * ===========================================================
 * Un ordine in testo libero ("costruire una ferrovia verso il confine") non
 * aveva **alcun** prezzo: la tesoreria si muoveva solo con il saldo mensile,
 * quindi le decisioni del giocatore non avevano conseguenze finanziarie. Qui
 * il motore stima un costo una tantum e un mantenimento mensile in modo
 * deterministico, dalla stessa categoria dell'ordine e dalla scala del paese.
 *
 * Il modello linguistico non propone mai cifre: la stima è calcolata qui, è
 * riproducibile (stesso testo + stesso conto ⇒ stessa cifra) ed è quella che
 * l'interfaccia mostra **prima** di registrare l'ordine.
 */

import type { NationalAccount } from './WorldStateEngine';

export type OrderCategory =
  | 'infrastruttura' | 'industria' | 'ricerca' | 'militare' | 'sociale'
  | 'commercio' | 'diplomazia' | 'amministrazione' | 'generale';

export interface OrderCostEstimate {
  /** Spesa una tantum in miliardi USD, addebitata quando l'ordine è eseguito. */
  amountMld: number;
  /** Giorni tipici prima del primo esito dichiarato. */
  timeDays: number;
  category: OrderCategory;
  /** Etichetta leggibile della categoria. */
  label: string;
  /** Come è stata calcolata (mostrata all'utente). */
  basis: string;
}

interface CategoryRule {
  label: string;
  keywords: string[];
  /** Moltiplicatore sulla spesa una tantum. */
  factor: number;
  timeDays: number;
}

/**
 * Famiglie di ordini riconosciute per parole chiave. L'ordine è deterministico:
 * le regole sono valutate nell'ordine dichiarato e la prima che combacia vince.
 */
const CATEGORY_RULES: Array<[OrderCategory, CategoryRule]> = [
  ['militare', {
    label: 'Difesa', factor: 1.6, timeDays: 120,
    keywords: ['militare', 'esercito', 'armi', 'arma', 'brigata', 'divisione', 'reclut', 'difesa',
      'missil', 'carri', 'corazzat', 'nave', 'caccia', 'flotta', 'soldat', 'artiglieria', 'droni'],
  }],
  ['infrastruttura', {
    label: 'Infrastrutture', factor: 1.4, timeDays: 180,
    keywords: ['ferrovia', 'strada', 'autostrada', 'ponte', 'porto', 'aeroporto', 'diga', 'acquedotto',
      'rete', 'elettrific', 'metropolitana', 'tunnel', 'canale', 'ferroviar', 'infrastruttur'],
  }],
  ['industria', {
    label: 'Industria', factor: 1.35, timeDays: 150,
    keywords: ['fabbrica', 'fabbriche', 'industria', 'impianto', 'acciaieria', 'raffineria', 'miniera',
      'stabilimento', 'filiera', 'produzione', 'cantiere', 'trasformazione'],
  }],
  ['ricerca', {
    label: 'Ricerca e istruzione superiore', factor: 1.1, timeDays: 210,
    keywords: ['università', 'universita', 'ricerca', 'laboratorio', 'istituto', 'ateneo', 'scienza',
      'tecnologia', 'innovazione'],
  }],
  ['sociale', {
    label: 'Welfare e servizi', factor: 1.0, timeDays: 120,
    keywords: ['sanità', 'sanita', 'ospedale', 'scuola', 'istruzione', 'pension', 'welfare', 'casa',
      'salute', 'assistenza', 'acqua', 'vaccin', 'aliment'],
  }],
  ['commercio', {
    label: 'Commercio', factor: 0.55, timeDays: 90,
    keywords: ['commercial', 'export', 'import', 'mercato', 'dazi', 'dogana', 'scambio', 'rotte',
      'vendita', 'acquisto all’estero', 'fornitura'],
  }],
  ['diplomazia', {
    label: 'Diplomazia', factor: 0.4, timeDays: 90,
    keywords: ['ambasciata', 'alleanza', 'diplomatic', 'trattato', 'vertice', 'negoziato', 'missione',
      'accordo', 'intesa'],
  }],
  ['amministrazione', {
    label: 'Amministrazione', factor: 0.4, timeDays: 60,
    keywords: ['riforma', 'legge', 'censimento', 'burocrazia', 'tassa', 'imposta', 'bilancio',
      'ministero', 'registro', 'codice'],
  }],
];

const GENERAL_RULE: CategoryRule = {
  label: 'Iniziativa generale', factor: 0.7, timeDays: 90,
  keywords: [],
};

/** Parole che allargano o riducono la portata dell'ordine. */
const SCALE_UP = ['nazionale', 'grande', 'massiccio', 'ampia', 'ampio', 'moderno', 'moderna', 'rete', 'integrale'];
const SCALE_DOWN = ['pilota', 'limitato', 'limitata', 'piccolo', 'piccola', 'locale', 'sperimentale', 'prima fase'];

/** Classifica deterministica di un ordine in testo libero. */
export function classifyOrder(text: string): { category: OrderCategory; rule: CategoryRule } {
  const normalized = String(text || '').toLowerCase();
  for (const [category, rule] of CATEGORY_RULES) {
    if (rule.keywords.some(keyword => normalized.includes(keyword))) return { category, rule };
  }
  return { category: 'generale', rule: GENERAL_RULE };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Stima il costo di un ordine sul conto nazionale del giocatore.
 * Base: una quota del **gettito annuo** (25%) — così un ordine pesa sempre in
 * proporzione a quanto il paese incassa davvero — corretta dalla categoria e
 * dalla portata dichiarata.
 */
export function estimateOrderCost(text: string, account?: NationalAccount | null): OrderCostEstimate {
  const { category, rule } = classifyOrder(text);
  // Un conto incompleto non deve produrre una cifra non finita: si ricade sul
  // minimo operativo, dichiarato nel campo `basis`.
  const declaredRevenue = Number(account?.monthlyRevenue);
  const revenue = Number.isFinite(declaredRevenue) ? Math.max(0, declaredRevenue) : 0;
  const annualRevenue = revenue * 12;
  const normalized = String(text || '').toLowerCase();
  const scale = SCALE_UP.some(word => normalized.includes(word)) ? 1.35
    : SCALE_DOWN.some(word => normalized.includes(word)) ? 0.7
      : 1;
  const amount = round2(Math.max(0.05, annualRevenue * 0.25 * rule.factor * scale));
  return {
    amountMld: amount,
    timeDays: rule.timeDays,
    category,
    label: rule.label,
    basis: `stima dal conto nazionale: 25% del gettito annuo (${round2(annualRevenue)} mld) × fattore ${rule.factor} «${rule.label}»${scale !== 1 ? ` × portata ${scale}` : ''}`,
  };
}

export interface ChargeDecision {
  /** Importo effettivamente addebitabile (cassa disponibile + credito residuo). */
  charge: number;
  /** Quota della spesa che resta non onorata. */
  shortfall: number;
}

/**
 * Quanto di una spesa è realmente pagabile: cassa non negativa più credito
 * residuo. Il tetto del debito non viene mai sfondato da un ordine.
 */
export function affordableCharge(amountMld: number, money: number, creditHeadroomMld: number): ChargeDecision {
  const amount = Number.isFinite(Number(amountMld)) ? Math.max(0, Number(amountMld)) : 0;
  const cash = Number.isFinite(Number(money)) ? Math.max(0, Number(money)) : 0;
  const headroom = Number.isFinite(Number(creditHeadroomMld)) ? Math.max(0, Number(creditHeadroomMld)) : 0;
  const charge = Math.round(Math.min(amount, cash + headroom) * 100) / 100;
  return { charge, shortfall: Math.round((amount - charge) * 100) / 100 };
}

/** Riga leggibile per il bollettino del periodo. */
export function describeOrderCost(estimate: OrderCostEstimate, text: string): string {  const title = String(text || '').replace(/\s+/g, ' ').trim();
  const short = title.length > 90 ? `${title.slice(0, 87)}…` : title;
  return `Spesa ordinata «${short}» (${estimate.label}): ${estimate.amountMld} mld dalla tesoreria.`;
}
