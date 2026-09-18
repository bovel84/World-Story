/**
 * World Story — Material Economy (legacy path)
 * ============================================
 *
 * Il livello `WorldStateEngine` calcola i *conti* nazionali (entrate, spese,
 * saldo) ma non conserva nulla: sono grandezze ricalcolate a ogni tick. Questa
 * estensione aggiunge il **magazzino materiale** che manca alla simulazione:
 *
 *   denaro (tesoreria), cibo, vestiario, armamenti, carburante
 *   + punti ricerca e tecnologie sbloccate.
 *
 * Le scorte sono persistenti (una riga per partita/polity), avanzano con gli
 * stessi giorni del tick mondiale e sono **deterministiche**: nessun LLM può
 * crearle o contraddirle. Da qui derivano i vincoli realistici del gioco:
 * un esercito consuma cibo e vestiario, gli armamenti equipaggiano le riserve,
 * il carburante muove i reparti motorizzati e la ricerca sblocca le tecnologie.
 */

import type { NationalAccount } from './WorldStateEngine';
import type { NaturalEndowment, NaturalResourceKind } from './MilitaryIndustry';
import {
  annualInterestMld, debtPrincipal, issueDebtTranche, maturedDebts, marketRatePct, rolloverTranche,
  type SovereignDebt,
} from './SovereignDebt';

export type ResourceKind = 'money' | 'food' | 'clothing' | 'weapons' | 'fuel' | 'research';

/** Tasso annuo dello scoperto di cassa (debito forzoso, più caro del mercato). */
export const OVERDRAFT_ANNUAL_RATE_PCT = 8;
/** Tasso d'interesse mensile dello scoperto di cassa (retrocompatibile). */
export const DEBT_MONTHLY_INTEREST = OVERDRAFT_ANNUAL_RATE_PCT / 1200;
/** Limite di debito rispetto al PIL nominale (60%) e minimo operativo (mld). */
export const DEBT_TO_GDP_LIMIT = 0.6;
export const MIN_CREDIT_LIMIT = 1;

export interface ResourceStock {
  /** Cassa/riserve in miliardi USD (può diventare negativa: scoperto di conto). */
  money: number;
  /** Portafoglio del debito pubblico: titoli con tasso e scadenza. */
  debts: SovereignDebt[];
  /** Scorte alimentari (indice in migliaia di razioni-giorno equivalenti). */
  food: number;
  /** Scorte di vestiario/equipaggiamento personale. */
  clothing: number;
  /** Armamenti ed equipaggiamento bellico disponibile. */
  weapons: number;
  /** Carburante (indice in migliaia di barili equivalenti). */
  fuel: number;
  /** Punti ricerca accumulati, non ancora spesi. */
  research: number;
  /** Tecnologie sbloccate (id del catalogo). */
  technologies: string[];
}

export interface Technology {
  id: string;
  name: string;
  cost: number;
  requires?: string[];
  effects: string;
}

/** Catalogo tecnologie: il progresso è materiale, non narrativo. */
export const TECHNOLOGIES: Technology[] = [
  { id: 'agricoltura_meccanizzata', name: 'Agricoltura meccanizzata', cost: 120,
    effects: 'produzione alimentare +35%' },
  { id: 'industria_tessile', name: 'Industria tessile', cost: 100,
    effects: 'produzione vestiario +30%' },
  { id: 'industria_bellica', name: 'Industria bellica', cost: 180, requires: ['industria_tessile'],
    effects: 'produzione armamenti +40%, equipaggiamento più rapido' },
  { id: 'motorizzazione', name: 'Motorizzazione', cost: 220, requires: ['industria_bellica'],
    effects: 'movimento meccanizzato: costo carburante −30%, marcia più rapida' },
  { id: 'logistica_avanzata', name: 'Logistica avanzata', cost: 280, requires: ['motorizzazione'],
    effects: 'consumi di movimento −25% su tutti i reparti' },
  // Filiera militare-industriale: sblocca la costruzione di armamenti dedicati.
  { id: 'elettronica', name: 'Elettronica', cost: 140, requires: ['industria_bellica'],
    effects: 'sensori, comunicazioni e guida di precisione' },
  { id: 'meccanica_avanzata', name: 'Meccanica avanzata', cost: 150, requires: ['industria_bellica'],
    effects: 'veicoli corazzati e artiglieria semovente' },
  { id: 'cantieristica', name: 'Cantieristica', cost: 160, requires: ['industria_bellica'],
    effects: 'costruzione di unità navali leggere' },
  { id: 'aeronautica', name: 'Aeronautica', cost: 170, requires: ['industria_bellica'],
    effects: 'aerei da combattimento e trasporto' },
  { id: 'corazzati', name: 'Corazzati', cost: 190, requires: ['meccanica_avanzata'],
    effects: 'carri armati di terza generazione' },
  { id: 'missilistica', name: 'Missilistica', cost: 200, requires: ['elettronica', 'industria_bellica'],
    effects: 'missili balistici, antinave e difesa aerea' },
  { id: 'cantieristica_avanzata', name: 'Cantieristica avanzata', cost: 230, requires: ['cantieristica', 'elettronica'],
    effects: 'fregate, cacciatorpediniere e sottomarini' },
  { id: 'aeronautica_avanzata', name: 'Aeronautica avanzata', cost: 240, requires: ['aeronautica', 'elettronica'],
    effects: 'caccia di quarta generazione e ISR' },
  { id: 'elettronica_avanzata', name: 'Elettronica avanzata', cost: 250, requires: ['elettronica'],
    effects: 'guerra elettronica, droni da combattimento e precisione' },
  { id: 'corazzati_avanzati', name: 'Corazzati avanzati', cost: 260, requires: ['corazzati', 'elettronica'],
    effects: 'carri di quarta generazione e reti dati' },
  { id: 'missilistica_avanzata', name: 'Missilistica avanzata', cost: 280, requires: ['missilistica', 'elettronica_avanzata'],
    effects: 'missili a medio raggio, da crociera e ipersonici' },
  { id: 'intelligenza_artificiale', name: 'Intelligenza artificiale', cost: 320, requires: ['elettronica_avanzata'],
    effects: 'autonomia e sciami di droni' },
];

export function technologyById(id: string): Technology | undefined {
  return TECHNOLOGIES.find(tech => tech.id === id);
}

/**
 * Debito pubblico totale = portafoglio titoli + scoperto di cassa. La tesoreria
 * può essere negativa: la parte negativa è debito forzoso, non un errore.
 */
export function debtOf(stock: ResourceStock): number {
  const overdraft = Math.max(0, -(Number(stock.money) || 0));
  return Math.round((debtPrincipal(stock.debts) + overdraft) * 1000) / 1000;
}

/** Scoperto di cassa puro (cassa negativa), distinto dai titoli emessi. */
export function overdraftOf(stock: ResourceStock): number {
  return Math.max(0, -(Number(stock.money) || 0));
}

/** Interessi passivi annui sull'intero debito (titoli + scoperto di cassa). */
export function annualDebtServiceMld(stock: ResourceStock): number {
  const bonds = annualInterestMld(stock.debts);
  const overdraft = overdraftOf(stock) * OVERDRAFT_ANNUAL_RATE_PCT / 100;
  return Math.round((bonds + overdraft) * 1000) / 1000;
}

/** Quota di PIL di margine garantita oltre il debito di partenza. */
export const DEBT_HEADROOM_RATIO = 0.15;

/**
 * Tetto di credito: il massimo fra il 60% del PIL, il debito ereditato più un
 * margine del 15% del PIL, e nove mesi di entrate. Così una nazione che parte
 * con un debito alto (es. Italia, Giappone) non nasce già senza spazio di
 * manovra, ma non può nemmeno indebitarsi senza limite.
 */
export function creditLimit(account?: NationalAccount): number {
  const gdp = Math.max(0, Number(account?.nominalGdpUsdBillions || 0));
  const annualRevenue = Math.abs(Number(account?.monthlyRevenue || 0)) * 12;
  const inheritedDebtRatio = Math.max(0, Number(account?.debtBurdenPct || 0)) / 100;
  const ceilingRatio = Math.max(DEBT_TO_GDP_LIMIT, inheritedDebtRatio + DEBT_HEADROOM_RATIO);
  const limit = Math.max(MIN_CREDIT_LIMIT, gdp * ceilingRatio, annualRevenue * 0.9);
  return Math.round(limit * 100) / 100;
}

/** Spazio di credito residuo prima di toccare il tetto del debito. */
export function creditHeadroom(stock: ResourceStock, account?: NationalAccount): number {
  return Math.max(0, creditLimit(account) - debtOf(stock));
}

export interface Financing {
  ok: boolean;
  /** Quota pagata con la cassa disponibile. */
  cashUsed: number;
  /** Quota coperta andando a debito. */
  debtUsed: number;
  error?: 'credit_exhausted';
}

/**
 * Verifica se una spesa è coperta da cassa + credito residuo. Non muta nulla:
 * il chiamante applica la spesa e la tesoreria può diventare negativa (debito).
 */
export function financePurchase(stock: ResourceStock, account: NationalAccount | undefined, cost: number): Financing {
  const spend = Math.max(0, Number(cost) || 0);
  const cashUsed = Math.min(Math.max(0, stock.money), spend);
  const debtUsed = Math.max(0, spend - cashUsed);
  if (debtUsed > creditHeadroom(stock, account) + 1e-9) {
    return { ok: false, cashUsed: 0, debtUsed: 0, error: 'credit_exhausted' };
  }
  return { ok: true, cashUsed: Math.round(cashUsed * 1000) / 1000, debtUsed: Math.round(debtUsed * 1000) / 1000 };
}

/** Somma algebrica di due stock, con clamp dei materiali a zero. */
export function applyFlow(stock: ResourceStock, flow: Partial<Record<ResourceKind, number>>): ResourceStock {
  return {
    money: stock.money + (flow.money || 0),
    // Il portafoglio del debito non è un flusso: cambia solo con emissioni,
    // rollover e rimborsi.
    debts: Array.isArray(stock.debts) ? stock.debts : [],
    food: Math.max(0, stock.food + (flow.food || 0)),
    clothing: Math.max(0, stock.clothing + (flow.clothing || 0)),
    weapons: Math.max(0, stock.weapons + (flow.weapons || 0)),
    fuel: Math.max(0, stock.fuel + (flow.fuel || 0)),
    research: Math.max(0, stock.research + (flow.research || 0)),
    technologies: [...stock.technologies],
  };
}

/**
 * Il debito ereditato dal registro 2024 è valido solo nei mondi moderni. In un
 * mondo storico le tranche seminate da `seedInheritedDebt` (id
 * `debt-inherited-*`) sono dati anacronistici e vanno eliminate anche dai
 * salvataggi creati prima di questa correzione. Il debito emesso dal giocatore
 * (id diversi) resta intatto.
 */
export function dropRegistryInheritedDebt(stock: ResourceStock): ResourceStock {
  const debts = Array.isArray(stock.debts) ? stock.debts : [];
  const kept = debts.filter(debt => !String(debt.id || '').startsWith('debt-inherited-'));
  return kept.length === debts.length ? stock : { ...stock, debts: kept };
}

/**
 * Riporta le scorte materiali entro la capacità di stoccaggio: il surplus oltre
 * il tetto si perde (deperimento/insufficienza di silos). Serve a rendere reale
 * il magazzino di una nazione fragile e a correggere i salvataggi più vecchi,
 * dove le scorte erano un multiplo fisso del consumo e non avevano limite.
 */
export function capStock(
  stock: ResourceStock, account?: NationalAccount, needs?: MaterialNeeds,
): { stock: ResourceStock; spoiled: Partial<Record<ResourceKind, number>> } {
  const capacity = storageCapacity(account, needs);
  const spoiled: Partial<Record<ResourceKind, number>> = {};
  const next: ResourceStock = { ...stock, technologies: [...stock.technologies] };
  for (const kind of ['food', 'clothing', 'weapons', 'fuel'] as const) {
    const cap = capacity[kind];
    if (next[kind] > cap + 1e-9) {
      spoiled[kind] = Math.round((next[kind] - cap) * 1000) / 1000;
      next[kind] = Math.round(cap * 1000) / 1000;
    }
  }
  return { stock: next, spoiled };
}

const EMPTY_STOCK: ResourceStock = {
  money: 0, debts: [], food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, technologies: [],
};

/**
 * Legge un portafoglio di titoli da dati persistiti. Retrocompatibile: una
 * vecchia riga con il solo campo scalare `debt` diventa un titolo senza
 * scadenza, così nessun salvataggio diventa invalido.
 */
function normalizeDebts(raw: unknown, legacyDebt: number): SovereignDebt[] {
  const list = Array.isArray(raw) ? raw : [];
  const debts: SovereignDebt[] = [];
  for (const item of list) {
    const value = (item || {}) as Partial<SovereignDebt>;
    const principal = Math.max(0, Number(value.principal) || 0);
    if (principal <= 0) continue;
    const termYears = Math.max(1, Math.round(Number(value.termYears) || 10));
    debts.push({
      id: typeof value.id === 'string' && value.id ? value.id : `debt-${debts.length + 1}`,
      label: typeof value.label === 'string' && value.label ? value.label : `Titolo ${termYears} anni`,
      principal: Math.round(principal * 1000) / 1000,
      annualRatePct: Math.max(0, Number(value.annualRatePct) || 0),
      issuedDate: typeof value.issuedDate === 'string' ? value.issuedDate.slice(0, 10) : '',
      maturityDate: typeof value.maturityDate === 'string' ? value.maturityDate.slice(0, 10) : '',
      termYears,
    });
  }
  if (debts.length === 0 && legacyDebt > 0) {
    debts.push({
      id: 'debt-legacy', label: 'Debito ereditato', principal: Math.round(legacyDebt * 1000) / 1000,
      annualRatePct: marketRatePct(0, 10), issuedDate: '', maturityDate: '', termYears: 10,
    });
  }
  return debts;
}

export function normalizeStock(raw: unknown): ResourceStock {
  const value = (raw || {}) as Partial<ResourceStock> & { debt?: unknown };
  const number = (input: unknown, fallback = 0) => Number.isFinite(Number(input)) ? Number(input) : fallback;
  return {
    money: number(value.money),
    debts: normalizeDebts(value.debts, Math.max(0, number(value.debt))),
    food: Math.max(0, number(value.food)),
    clothing: Math.max(0, number(value.clothing)),
    weapons: Math.max(0, number(value.weapons)),
    fuel: Math.max(0, number(value.fuel)),
    research: Math.max(0, number(value.research)),
    technologies: Array.isArray(value.technologies)
      ? [...new Set(value.technologies.filter((id): id is string => typeof id === 'string' && !!technologyById(id)))]
      : [],
  };
}

/**
 * Classe di sviluppo dell'economia. Il PIL pro capite è il dato reale che
 * distingue una nazione ricca (grandi riserve strategiche, filiere complete)
 * da una fragile (scorte sottili, dipendenza dagli aiuti e dalle importazioni).
 */
export type DevelopmentClass = 'low' | 'lower' | 'upper' | 'high';

export function developmentClass(account?: NationalAccount): DevelopmentClass {
  const perCapita = Math.max(0, Number(account?.gdpPerCapitaUsd) || 0);
  if (perCapita >= 28000) return 'high';
  if (perCapita >= 8000) return 'upper';
  if (perCapita >= 2500) return 'lower';
  return 'low';
}

/** Fabbisogno mensile di ciascun materiale: quanto la nazione consuma davvero. */
export interface MaterialNeeds { food: number; clothing: number; weapons: number; fuel: number }

/**
 * Fabbisogno **civile**: popolazione e impianti. È la parte che non dipende
 * dagli oggetti militari e che resta identica in ogni percorso.
 */
export function civilMaterialNeeds(account?: NationalAccount): MaterialNeeds {
  const popM = Math.max(0, Number(account?.population) || 0) / 1_000_000;
  const factories = Math.max(0, Number(account?.factories) || 0);
  return { food: popM * 0.02, clothing: popM * 0.008, weapons: 0, fuel: factories * 0.05 };
}

/**
 * Fabbisogno **militare** derivato dai reparti dell'account: è il percorso
 * legacy, usato solo quando gli oggetti persistenti non ci sono. Con le armate
 * reali il fabbisogno arriva dai loro `monthlyNeeds` (una sola contabilità).
 */
export function legacyMilitaryNeeds(account?: NationalAccount): MaterialNeeds {
  const troops = Math.max(0, Number(account?.forces) || 0) + Math.max(0, Number(account?.mobilized) || 0);
  return { food: troops * 0.06, clothing: troops * 0.01, weapons: Math.max(0.2, troops * 0.004), fuel: troops * 0.03 };
}

/** Civile + militare legacy: il fabbisogno di sempre (stessa aritmetica). */
export function materialNeeds(account?: NationalAccount): MaterialNeeds {
  const civil = civilMaterialNeeds(account);
  const military = legacyMilitaryNeeds(account);
  return {
    food: civil.food + military.food,
    clothing: civil.clothing + military.clothing,
    weapons: civil.weapons + military.weapons,
    fuel: civil.fuel + military.fuel,
  };
}

/**
 * Contributo degli **oggetti reali** al bilancio materiale del mese.
 *
 * È l'unico modo in cui OP-OBJECTS tocca le scorte: fornisce i numeri, il motore
 * li applica. Nessuno stock viene scritto qui.
 */
export interface MaterialFlowOverlay {
  /** Produzione mensile degli impianti (già allocata sugli input disponibili). */
  production: Partial<Record<ResourceKind, number>>;
  /** Consumo mensile degli oggetti dal magazzino (input degli impianti). */
  consumption: Partial<Record<ResourceKind, number>>;
  /**
   * Fabbisogno **militare** degli oggetti: sostituisce quello dei reparti
   * generici. Se assente si usa `legacyMilitaryNeeds`.
   */
  militaryNeeds?: MaterialNeeds;
  /** Materiali estratti presi dalla filiera (giacimenti, non scorte). */
  naturalInputs?: Partial<Record<NaturalResourceKind, number>>;
  /** Quota navale del carburante, per il dettaglio del flusso (esercito/marina). */
  navyFuel?: number;
  /**
   * Fattore materiale per impianto del **passaggio di allocazione** da cui
   * nasce questo overlay. Gli ordini di produzione lo riusano invece di
   * ricalcolarlo su scorte già decurtate: le schede e il motore devono leggere
   * lo stesso passaggio (OP-OBJECTS TIME-STEP).
   */
  facilityFactors?: Record<string, number>;
}

/** Fabbisogno efficace: civile + militare degli **oggetti** (o legacy). */
export function effectiveMaterialNeeds(
  account?: NationalAccount, overlay?: MaterialFlowOverlay | null,
): MaterialNeeds {
  const civil = civilMaterialNeeds(account);
  const military = overlay?.militaryNeeds ?? legacyMilitaryNeeds(account);
  return {
    food: civil.food + military.food,
    clothing: civil.clothing + military.clothing,
    weapons: civil.weapons + military.weapons,
    fuel: civil.fuel + military.fuel,
  };
}

/**
 * Mesi di scorta strategica che la nazione tiene per ciascun materiale.
 * Le economie fragili non hanno magazzini profondi: è la differenza fra una
 * dispensa di settimane e una riserva strategica di mesi.
 */
const RESERVE_MONTHS: Record<DevelopmentClass, MaterialNeeds> = {
  high:  { food: 6, clothing: 8, weapons: 16, fuel: 6 },
  upper: { food: 5, clothing: 7, weapons: 14, fuel: 5 },
  lower: { food: 3, clothing: 5, weapons: 11, fuel: 4 },
  low:   { food: 2, clothing: 3, weapons: 8,  fuel: 3 },
};

/**
 * Capacità di stoccaggio del magazzino materiale: mesi di riserva × fabbisogno.
 * È il tetto reale delle scorte: oltre quello il surplus si perde (deperimento)
 * e non può più essere accumulato. Una nazione povera ha magazzini piccoli.
 */
export function storageCapacity(account?: NationalAccount, needs?: MaterialNeeds): MaterialNeeds {
  const effective = needs ?? materialNeeds(account);
  const months = RESERVE_MONTHS[developmentClass(account)];
  const cap = (need: number, reserveMonths: number, floor: number) =>
    Math.round(Math.max(floor, need * reserveMonths) * 1000) / 1000;
  return {
    food: cap(effective.food, months.food, 2),
    clothing: cap(effective.clothing, months.clothing, 1.5),
    weapons: cap(effective.weapons, months.weapons, 4),
    fuel: cap(effective.fuel, months.fuel, 2),
  };
}

/** Quota di capacità con cui una nazione nasce: fragile → dispense quasi vuote. */
const INITIAL_FILL: Record<DevelopmentClass, number> = {
  high: 0.7, upper: 0.6, lower: 0.5, low: 0.4,
};

/**
 * Debito ereditato come scaletta di scadenze (3/8/15 anni): così una parte
 * torna a scadere periodicamente e va rifinanziata, invece di un blocco unico.
 */
function seedInheritedDebt(inheritedDebt: number, date: string, debtRatioPct: number): SovereignDebt[] {
  if (!(inheritedDebt > 0)) return [];
  const ladder: Array<{ termYears: number; share: number }> = [
    { termYears: 3, share: 0.3 }, { termYears: 8, share: 0.4 }, { termYears: 15, share: 0.3 },
  ];
  const debts: SovereignDebt[] = [];
  let index = 0;
  for (const step of ladder) {
    index += 1;
    const principal = Math.round(inheritedDebt * step.share * 1000) / 1000;
    if (principal <= 0) continue;
    const issued = date || '';
    const { debts: withTranche } = issueDebtTranche(debts, {
      amountMld: principal, termYears: step.termYears, date: issued, debtRatioPct,
      id: `debt-inherited-${index}`, label: `Debito ereditato ${step.termYears} anni`,
    });
    debts.push(withTranche[withTranche.length - 1]);
  }
  return debts;
}

/**
 * Scorte iniziali proporzionate all'economia e alle risorse naturali.
 * `asOfDate` (facoltativa) fa nascere il debito ereditato con vere scadenze.
 */
export function seedStock(account: NationalAccount, endowment: NaturalEndowment = {}, asOfDate = ''): ResourceStock {
  // Ogni campo è difeso: un conto con un valore mancante o non numerico non
  // deve mai produrre una tesoreria a zero (né un `NaN` che poi diventa zero).
  const n = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const universities = Math.max(0, n(account.universities));
  const oil = n(endowment.oil);
  const gas = n(endowment.gas);
  const coal = n(endowment.coal);
  const iron = n(endowment.iron);
  const fertile = n(endowment.fertile_land);
  const fisheries = n(endowment.fisheries);
  // La cassa di partenza è la riserva valutaria (~2% del PIL); il debito
  // pubblico ereditato resta distinto, come voce a sé: la nazione nasce con
  // entrambi, non con una tesoreria falsata dal debito.
  const gdp = n(account.nominalGdpUsdBillions);
  const money = Math.max(MIN_TREASURY, gdp * 0.02);
  const debtRatioPct = Math.max(0, n(account.debtBurdenPct));
  const inheritedDebt = debtRatioPct / 100 * gdp;
  // Le scorte di partenza sono una QUOTA della capacità di stoccaggio, non un
  // multiplo fisso del consumo: una nazione fragile nasce con dispense sottili,
  // una ricca con riserve strategiche. Terra fertile e risorse danno un margine.
  const capacity = storageCapacity(account);
  const fill = INITIAL_FILL[developmentClass(account)];
  const foodFill = Math.min(1, fill + fertile * 0.03 + fisheries * 0.02);
  const weaponFill = Math.min(1, fill + iron * 0.02 + coal * 0.01);
  const fuelFill = Math.min(1, fill + oil * 0.03 + gas * 0.02);
  const part = (value: number) => Math.round(value * 1000) / 1000;
  return {
    money,
    debts: seedInheritedDebt(inheritedDebt, asOfDate, debtRatioPct),
    food: part(capacity.food * foodFill),
    clothing: part(capacity.clothing * fill),
    weapons: part(capacity.weapons * weaponFill),
    fuel: part(capacity.fuel * fuelFill),
    research: universities * 20,
    technologies: [],
  };
}

/** Riserva valutaria minima con cui qualunque nazione inizia a giocare. */
export const MIN_TREASURY = 0.3;

export interface MaterialFlow extends Partial<Record<ResourceKind, number>> {
  /** Motivo leggibile delle eventuali carenze (vuoto se tutto coperto). */
  shortages: string[];
}

export interface MaterialTick {
  stock: ResourceStock;
  flow: MaterialFlow;
  /** Tecnologie sbloccate in questo tick spendendo i punti ricerca. */
  unlocked: Technology[];
  /** Titoli giunti a scadenza e rifinanziati in questo tick. */
  rolledDebts: SovereignDebt[];
  /** Interessi passivi maturati nel periodo (mld). */
  interestPaid: number;
  /** Materiale perso perché il magazzino era oltre la capacità. */
  spoiled: Partial<Record<ResourceKind, number>>;
}

const has = (stock: ResourceStock, id: string) => stock.technologies.includes(id);

/**
 * Avanza le scorte di un periodo. Le produzioni crescono con fabbriche, porti,
 * università e popolazione; i consumi con la popolazione e le forze armate.
 * Le riserve richiamate (`mobilized`) consumano equipaggiamento per diventare
 * operative. Il denaro segue il saldo mensile dei conti nazionali.
 *
 * Se `asOfDate` è nota, i titoli giunti a scadenza vengono **rifinanziati** al
 * tasso di mercato corrente: è il rollover, il momento in cui il debito torna.
 */
export function advanceStock(
  stock: ResourceStock, account: NationalAccount, days: number, endowment: NaturalEndowment = {},
  asOfDate?: string, overlay?: MaterialFlowOverlay | null,
  /**
   * Fabbisogno imposto dal chiamante: serve alle **scomposizioni per impianto**,
   * dove l'obiettivo è la produzione lorda di un singolo oggetto e non il
   * fabbisogno dell'intero paese.
   */
  needsOverride?: MaterialNeeds,
): MaterialTick {
  const period = Math.max(0, days) / 30; // mesi
  const popM = Math.max(0, account.population) / 1_000_000;
  const factories = Math.max(0, account.factories);
  const ports = Math.max(0, account.ports);
  const universities = Math.max(0, account.universities);

  const oil = endowment.oil || 0;
  const gas = endowment.gas || 0;
  const iron = endowment.iron || 0;
  const coal = endowment.coal || 0;
  const gold = endowment.gold || 0;
  const diamonds = endowment.diamonds || 0;
  const copper = endowment.copper || 0;
  const fertile = endowment.fertile_land || 0;
  const fisheries = endowment.fisheries || 0;

  const foodBonus = (has(stock, 'agricoltura_meccanizzata') ? 1.35 : 1) * (1 + fertile * 0.06 + fisheries * 0.03);
  const clothingBonus = has(stock, 'industria_tessile') ? 1.3 : 1;
  const weaponsBonus = has(stock, 'industria_bellica') ? 1.4 : 1;
  // Fabbisogno e capacità di stoccaggio reali: il magazzino ha un tetto.
  // Con gli oggetti persistenti il fabbisogno militare arriva da loro; senza,
  // resta quello derivato dai reparti (percorso legacy, numeri di sempre).
  const needs = needsOverride ?? effectiveMaterialNeeds(account, overlay);
  const capacity = storageCapacity(account, needs);
  // Agricoltura: contano terra fertile, pesca e lavoro rurale, non le fabbriche.
  // Una nazione povera e arida produce meno di quanto consuma e resta in deficit.
  const foodYield = (fertile * 0.55 + fisheries * 0.25 + popM * 0.004 * (1 + fertile * 0.08)) * foodBonus;
  // Estrazione ed export di risorse naturali: reddito anche senza industria.
  const resourceRevenue = (oil * 0.5 + gas * 0.4 + gold * 0.2 + diamonds * 0.2 + copper * 0.12 + iron * 0.1) * period;
  // Interessi sul debito pubblico: chi ha emesso titoli o è scoperto paga un
  // costo ricorrente, calcolato titolo per titolo al suo tasso.
  const interest = annualDebtServiceMld(stock) / 12 * period;

  // Produzione degli impianti reali, quando ci sono: **sostituisce** la quota
  // industriale della vecchia formula (fabbriche, porti, atenei × coefficiente),
  // che altrimenti verrebbe contata due volte. Agricoltura, giacimenti e
  // popolazione restano del motore: la Facility sostituisce solo ciò che
  // rappresenta davvero.
  const industry = <K extends ResourceKind>(kind: K, legacy: number): number =>
    overlay ? Number(overlay.production?.[kind] || 0) : legacy;
  const objectDraw = (kind: ResourceKind) => (overlay ? Number(overlay.consumption?.[kind] || 0) : 0);

  const flow: MaterialFlow = {
    money: ((account.monthlyBalance || 0) + resourceRevenue) * period - interest,
    food: (foodYield - needs.food) * period,
    clothing: (industry('clothing', factories * 0.7 * clothingBonus) + popM * 0.004 * clothingBonus
      - objectDraw('clothing') - needs.clothing) * period,
    weapons: (industry('weapons', factories * 0.5 * weaponsBonus + universities * 0.2)
      + iron * 0.12 * weaponsBonus + coal * 0.06 * weaponsBonus
      - objectDraw('weapons') - needs.weapons) * period,
    fuel: (industry('fuel', ports * 1.1 + factories * 0.4) + oil * 0.7 + gas * 0.35
      - objectDraw('fuel') - needs.fuel) * period,
    research: (industry('research', universities * 0.35) + popM * 0.002) * period,
    shortages: [],
  };

  // Il magazzino ha un tetto: oltre la capacità il surplus si perde (deperimento).
  const { stock: next, spoiled } = capStock(applyFlow(stock, flow), account, needs);
  // Diagnostica: la carenza si registra solo se il fabbisogno non era coperto.
  const check = (kind: ResourceKind, label: string, required: number) => {
    if (required > 0 && flow[kind]! < 0 && stock[kind] + flow[kind]! < 0) {
      flow.shortages.push(`${label}: deficit di ${Math.abs(Math.round((stock[kind] + flow[kind]!) * 10) / 10)}`);
    }
  };
  check('food', 'Cibo', needs.food);
  check('clothing', 'Vestiario', needs.clothing);
  check('weapons', 'Armamenti', needs.weapons);
  check('fuel', 'Carburante', needs.fuel);

  const { stock: spent, unlocked } = unlockTechnologies(next);

  // Scadenze: i titoli maturati si rifinanziano al tasso di mercato corrente.
  // Il capitale resta, cambiano tasso e nuova scadenza: è il rollover.
  const rolledDebts: SovereignDebt[] = [];
  let withRollover = spent;
  if (asOfDate) {
    const matured = maturedDebts(spent.debts, asOfDate);
    if (matured.length > 0) {
      const principal = debtPrincipal(spent.debts);
      const ratio = account.nominalGdpUsdBillions > 0 ? principal / account.nominalGdpUsdBillions * 100 : 0;
      const outstanding = spent.debts.filter(debt => !matured.some(due => due.id === debt.id));
      for (const due of matured) rolledDebts.push(rolloverTranche(due, asOfDate, ratio));
      withRollover = { ...spent, debts: [...outstanding, ...rolledDebts] };
    }
  }
  return { stock: withRollover, flow, unlocked, rolledDebts, interestPaid: Math.round(interest * 1000) / 1000, spoiled };
}

/** Sblocca in ordine di costo le tecnologie i cui prerequisiti sono soddisfatti. */
export function unlockTechnologies(stock: ResourceStock): { stock: ResourceStock; unlocked: Technology[] } {
  const technologies = [...stock.technologies];
  let research = stock.research;
  const unlocked: Technology[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const tech of TECHNOLOGIES) {
      if (technologies.includes(tech.id) || research < tech.cost) continue;
      if ((tech.requires || []).some(requirement => !technologies.includes(requirement))) continue;
      research -= tech.cost;
      technologies.push(tech.id);
      unlocked.push(tech);
      progress = true;
    }
  }
  return { stock: { ...stock, research, technologies }, unlocked };
}

export interface MovementCost {
  food: number;
  fuel: number;
  money: number;
  /** true se il reparto è meccanizzato (tecnologia Motorizzazione). */
  motorized: boolean;
}

/** Costo di un singolo spostamento. Senza motorizzazione si marcia a piedi. */
export function movementCost(stock: ResourceStock, distanceFactor = 1): MovementCost {
  const motorized = has(stock, 'motorizzazione');
  const logistics = has(stock, 'logistica_avanzata') ? 0.75 : 1;
  const fuelFactor = motorized ? (has(stock, 'logistica_avanzata') ? 0.525 : 0.7) : 0;
  const factor = Math.max(0.1, distanceFactor) * logistics;
  return {
    food: 0.15 * factor,
    fuel: 0.9 * fuelFactor * factor,
    money: 0.05 * factor,
    motorized,
  };
}

export interface MovementPayment {
  stock: ResourceStock;
  /** true se le scorte coprivano interamente il costo. */
  covered: boolean;
  shortages: string[];
}

/** Paga (o registra come insufficiente) il costo di movimento senza mai bloccare. */
export function payMovement(stock: ResourceStock, cost: MovementCost): MovementPayment {
  const shortages: string[] = [];
  if (stock.food < cost.food) shortages.push('cibo insufficiente per il movimento');
  if (stock.fuel < cost.fuel) shortages.push('carburante insufficiente per il movimento');
  if (stock.money < cost.money) shortages.push('denaro insufficiente per il movimento');
  return {
    stock: applyFlow(stock, { food: -cost.food, fuel: -cost.fuel, money: -cost.money }),
    covered: shortages.length === 0,
    shortages,
  };
}

/**
 * La nazione **fa debito**: emette un titolo, incassa cassa oggi e registra la
 * passività con tasso di mercato e scadenza. Rispetta il tetto di credito:
 * oltre quello il mercato non presta più.
 */
export function issueSovereignDebt(
  stock: ResourceStock,
  account: NationalAccount | undefined,
  options: { amountMld: number; termYears: number; date: string },
): { ok: boolean; stock: ResourceStock; tranche?: SovereignDebt; error?: 'credit_exhausted' | 'amount_invalid' } {
  const amount = Math.round((Number(options.amountMld) || 0) * 1000) / 1000;
  const termYears = Math.max(1, Math.round(Number(options.termYears) || 10));
  if (!(amount > 0)) return { ok: false, stock, error: 'amount_invalid' };
  if (amount > creditHeadroom(stock, account) + 1e-9) return { ok: false, stock, error: 'credit_exhausted' };
  const gdp = Math.max(0, Number(account?.nominalGdpUsdBillions) || 0);
  const ratio = gdp > 0 ? debtOf(stock) / gdp * 100 : 0;
  const { debts, tranche } = issueDebtTranche(stock.debts, {
    amountMld: amount, termYears, date: options.date, debtRatioPct: ratio,
  });
  return { ok: true, stock: { ...stock, money: Math.round((stock.money + amount) * 1000) / 1000, debts }, tranche };
}

/** Rendiconto leggibile per il bollettino e il prompt del modello. */
export function describeStock(stock: ResourceStock, account?: NationalAccount): string {
  const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
  const techs = stock.technologies.map(id => technologyById(id)?.name || id);
  const capacity = storageCapacity(account);
  const parts = [
    `Tesoreria ${round(stock.money)} mld`,
    `cibo ${round(stock.food)}/${round(capacity.food)}`,
    `vestiario ${round(stock.clothing)}/${round(capacity.clothing)}`,
    `armamenti ${round(stock.weapons)}/${round(capacity.weapons)}`,
    `carburante ${round(stock.fuel)}/${round(capacity.fuel)}`,
    `ricerca ${round(stock.research)}`,
  ];
  const tech = techs.length ? ` Tecnologie: ${techs.join(', ')}.` : ' Nessuna tecnologia sbloccata.';
  const burden = account ? ` Fabbisogno militare ${round(account.defenceBurdenPct)}% del PIL.` : '';
  const debt = debtOf(stock);
  const debtText = debt > 0
    ? ` Debito pubblico ${round(debt)} mld su ${stock.debts.length} titoli (interessi ${round(annualDebtServiceMld(stock))} mld/anno; tetto di credito ${round(creditLimit(account))} mld).`
    : ' Nessun debito pubblico.';
  return `Magazzino nazionale: ${parts.join(', ')}.${debtText}${tech}${burden}`;
}

export { EMPTY_STOCK };
