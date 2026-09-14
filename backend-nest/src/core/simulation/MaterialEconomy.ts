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

export type ResourceKind = 'money' | 'food' | 'clothing' | 'weapons' | 'fuel' | 'research';

export interface ResourceStock {
  /** Tesoreria in miliardi USD (può diventare negativa: debito pubblico). */
  money: number;
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

/** Somma algebrica di due stock, con clamp dei materiali a zero. */
export function applyFlow(stock: ResourceStock, flow: Partial<Record<ResourceKind, number>>): ResourceStock {
  return {
    money: stock.money + (flow.money || 0),
    food: Math.max(0, stock.food + (flow.food || 0)),
    clothing: Math.max(0, stock.clothing + (flow.clothing || 0)),
    weapons: Math.max(0, stock.weapons + (flow.weapons || 0)),
    fuel: Math.max(0, stock.fuel + (flow.fuel || 0)),
    research: Math.max(0, stock.research + (flow.research || 0)),
    technologies: [...stock.technologies],
  };
}

const EMPTY_STOCK: ResourceStock = {
  money: 0, food: 0, clothing: 0, weapons: 0, fuel: 0, research: 0, technologies: [],
};

export function normalizeStock(raw: unknown): ResourceStock {
  const value = (raw || {}) as Partial<ResourceStock>;
  const number = (input: unknown, fallback = 0) => Number.isFinite(Number(input)) ? Number(input) : fallback;
  return {
    money: number(value.money),
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

/** Scorte iniziali proporzionate all'economia e alle risorse naturali. */
export function seedStock(account: NationalAccount, endowment: NaturalEndowment = {}): ResourceStock {
  const popM = Math.max(0, account.population) / 1_000_000;
  const troops = Math.max(0, account.forces) + Math.max(0, account.mobilized);
  const factories = Math.max(0, account.factories);
  const ports = Math.max(0, account.ports);
  const universities = Math.max(0, account.universities);
  const oil = endowment.oil || 0;
  const iron = endowment.iron || 0;
  const fertile = endowment.fertile_land || 0;
  return {
    // Riserva valutaria: ~2% del PIL nominale, minimo operativo di 5 mld.
    money: Math.max(5, account.nominalGdpUsdBillions * 0.02),
    // ~4 mesi di consumo alimentare e 5 di vestiario, più la terra fertile.
    food: (popM * 0.02 + troops * 0.06) * 120 + factories * 30 + fertile * 40,
    clothing: (popM * 0.008 + troops * 0.01) * 150 + factories * 20,
    weapons: troops * 0.6 + factories * 25 + iron * 30 + 20,
    fuel: (troops * 0.03 + factories * 0.05 + ports * 0.02) * 150 + oil * 90 + 40,
    research: universities * 20,
    technologies: [],
  };
}

export interface MaterialFlow extends Partial<Record<ResourceKind, number>> {
  /** Motivo leggibile delle eventuali carenze (vuoto se tutto coperto). */
  shortages: string[];
}

export interface MaterialTick {
  stock: ResourceStock;
  flow: MaterialFlow;
  /** Tecnologie sbloccate in questo tick spendendo i punti ricerca. */
  unlocked: Technology[];
}

const has = (stock: ResourceStock, id: string) => stock.technologies.includes(id);

/**
 * Avanza le scorte di un periodo. Le produzioni crescono con fabbriche, porti,
 * università e popolazione; i consumi con la popolazione e le forze armate.
 * Le riserve richiamate (`mobilized`) consumano equipaggiamento per diventare
 * operative. Il denaro segue il saldo mensile dei conti nazionali.
 */
export function advanceStock(
  stock: ResourceStock, account: NationalAccount, days: number, endowment: NaturalEndowment = {},
): MaterialTick {
  const period = Math.max(0, days) / 30; // mesi
  const popM = Math.max(0, account.population) / 1_000_000;
  const troops = Math.max(0, account.forces);
  const mobilized = Math.max(0, account.mobilized);
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
  // Estrazione ed export di risorse naturali: reddito anche senza industria.
  const resourceRevenue = (oil * 0.5 + gas * 0.4 + gold * 0.2 + diamonds * 0.2 + copper * 0.12 + iron * 0.1) * period;

  const flow: MaterialFlow = {
    money: ((account.monthlyBalance || 0) + resourceRevenue) * period,
    food: ((popM * 0.012 + factories * 0.9 + fertile * 0.25) * foodBonus - (popM * 0.02 + (troops + mobilized) * 0.06)) * period,
    clothing: ((factories * 0.7 + popM * 0.004) * clothingBonus - (popM * 0.008 + (troops + mobilized) * 0.01)) * period,
    weapons: ((factories * 0.5 + iron * 0.12 + coal * 0.06) * weaponsBonus + universities * 0.2 - (troops + mobilized) * 0.004) * period,
    fuel: (ports * 1.1 + factories * 0.4 + oil * 0.7 + gas * 0.35 - troops * 0.03 - factories * 0.05) * period,
    research: (universities * 0.35 + popM * 0.002) * period,
    shortages: [],
  };

  const next = applyFlow(stock, flow);
  // Diagnostica: la carenza si registra solo se il fabbisogno non era coperto.
  const check = (kind: ResourceKind, label: string, required: number) => {
    if (required > 0 && flow[kind]! < 0 && stock[kind] + flow[kind]! < 0) {
      flow.shortages.push(`${label}: deficit di ${Math.abs(Math.round((stock[kind] + flow[kind]!) * 10) / 10)}`);
    }
  };
  check('food', 'Cibo', popM * 0.02 + (troops + mobilized) * 0.06);
  check('clothing', 'Vestiario', popM * 0.008 + (troops + mobilized) * 0.01);
  check('weapons', 'Armamenti', (troops + mobilized) * 0.004);
  check('fuel', 'Carburante', troops * 0.03 + factories * 0.05);

  const { stock: spent, unlocked } = unlockTechnologies(next);
  return { stock: spent, flow, unlocked };
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

/** Rendiconto leggibile per il bollettino e il prompt del modello. */
export function describeStock(stock: ResourceStock, account?: NationalAccount): string {
  const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
  const techs = stock.technologies.map(id => technologyById(id)?.name || id);
  const parts = [
    `Tesoreria ${round(stock.money)} mld`,
    `cibo ${round(stock.food)}`,
    `vestiario ${round(stock.clothing)}`,
    `armamenti ${round(stock.weapons)}`,
    `carburante ${round(stock.fuel)}`,
    `ricerca ${round(stock.research)}`,
  ];
  const tech = techs.length ? ` Tecnologie: ${techs.join(', ')}.` : ' Nessuna tecnologia sbloccata.';
  const burden = account ? ` Fabbisogno militare ${round(account.defenceBurdenPct)}% del PIL.` : '';
  return `Magazzino nazionale: ${parts.join(', ')}.${tech}${burden}`;
}

export { EMPTY_STOCK };
