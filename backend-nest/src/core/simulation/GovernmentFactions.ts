/**
 * World Story — Le anime del governo
 * ==================================
 * Il governo non è un blocco unico: dentro ci sono interessi che spingono in
 * direzioni diverse. Le forze armate vogliono il riarmo, l'industria vuole
 * meno tasse, i sindacati più welfare, l'accademia più ricerca, i creditori
 * conti in ordine, le province strade e presidi, l'opinione pubblica quiete.
 *
 * Qui ogni anima è calcolata **solo** dalle cifre già pubblicate dal conto
 * nazionale (spesa per funzione, aliquota effettiva, stabilità, tensione,
 * fabbriche, porti, atenei, riserve): nessun umore inventato. Ogni fazione ha
 * un'influenza, una soddisfazione verso l'assetto attuale, una posizione e una
 * richiesta concreta. La pressione è alta quando una fazione potente è
 * insoddisfatta: è quella che adesso spinge di più.
 *
 * SimCity-style: il giocatore vede chi preme, per cosa e con quanta forza,
 * e può trasformare la richiesta in un ordine reale.
 */

import type { NationalAccount } from './WorldStateEngine';
import { nationalBudgetDetail, type NationalBudgetDetail } from './NationalBudget';

export type FactionStance = 'alleato' | 'favorevole' | 'neutrale' | 'critico' | 'ostile';

export type FactionLever =
  | 'difesa' | 'tasse' | 'welfare' | 'istruzione' | 'infrastrutture' | 'debito' | 'ordine';

export interface FactionDemand {
  lever: FactionLever;
  title: string;
  detail: string;
  direction: 'alza' | 'abbassa' | 'mantieni';
  /** Urgenza per la fazione (0-100). */
  urgency: number;
}

export interface GovernmentFaction {
  id: string;
  name: string;
  /** Che cosa la muove, in una riga. */
  interest: string;
  /** Influenza sul governo (0-100, somma 100 su tutte le fazioni). */
  powerPct: number;
  /** Soddisfazione verso l'assetto attuale (0-100). */
  satisfaction: number;
  stance: FactionStance;
  /** Pressione esercitata adesso (0-100). */
  pressure: number;
  demand: FactionDemand;
  /** Segno sintetico del loro effetto sulla nazione, per la lettura. */
  footprint: string;
}

export interface GovernmentSnapshot {
  factions: GovernmentFaction[];
  /** Fazione con più influenza nel consiglio. */
  dominantId: string | null;
  /** Fazione che preme di più adesso. */
  angriestId: string | null;
  /** Soddisfazione media ponderata per influenza (0-100). */
  cohesion: number;
  /** Indice di pressione politica (0-100): quanto il governo è sotto assedio. */
  pressureIndex: number;
  /** Frase di sintesi in italiano. */
  headline: string;
  budget: NationalBudgetDetail;
  /** Debito pubblico: rapporto sul PIL e peso degli interessi sulle entrate. */
  debt: { ratioPct: number; servicePct: number };
}

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round1 = (value: number): number => Math.round(value * 10) / 10;
const round0 = (value: number): number => Math.round(value);

/** Posizione dichiarata in base alla soddisfazione. */
export function stanceFor(satisfaction: number): FactionStance {
  if (satisfaction >= 78) return 'alleato';
  if (satisfaction >= 62) return 'favorevole';
  if (satisfaction >= 45) return 'neutrale';
  if (satisfaction >= 28) return 'critico';
  return 'ostile';
}

const expenseShare = (budget: NationalBudgetDetail, id: string): number =>
  budget.expense.find((entry) => entry.id === id)?.sharePct ?? 0;

/**
 * Snapshot del governo a partire dal conto nazionale. Puro e deterministico.
 */
export function governmentSnapshot(account?: NationalAccount | null): GovernmentSnapshot {
  const budget = nationalBudgetDetail(account);
  const gdp = Math.max(0, Number(account?.nominalGdpUsdBillions) || 0);
  const stability = clamp(Number(account?.stability) || 0);
  const socialTension = clamp(Number(account?.socialTension) || 0);
  const defenceBurdenPct = Math.max(0, Number(account?.defenceBurdenPct) || 0);
  // Le fazioni guardano il debito EFFETTIVO (titoli + scoperto), non solo
  // quello ereditato: chi fa nuovo debito se ne assume il costo politico.
  const debtBurdenPct = Math.max(0, Number(account?.debtRatioPct ?? account?.debtBurdenPct) || 0);
  const forces = Math.max(0, Number(account?.forces) || 0);
  const mobilized = Math.max(0, Number(account?.mobilized) || 0);
  const factories = Math.max(0, Number(account?.factories) || 0);
  const ports = Math.max(0, Number(account?.ports) || 0);
  const universities = Math.max(0, Number(account?.universities) || 0);
  const provinces = Math.max(0, Number(account?.provinces) || 0);
  const population = Math.max(0, Number(account?.population) || 0);
  const populationM = population / 1_000_000;
  const balance = Number(account?.monthlyBalance) || 0;
  const balanceRatio = gdp > 0 ? balance / gdp : 0;
  const taxRatePct = budget.effectiveTaxRatePct;
  const infraShare = expenseShare(budget, 'infrastructure');
  const adminShare = expenseShare(budget, 'administration');
  const educationShare = expenseShare(budget, 'education');
  const welfareShare = expenseShare(budget, 'health') + expenseShare(budget, 'social');

  interface RawFaction {
    id: string;
    name: string;
    interest: string;
    power: number;
    satisfaction: number;
    demand: FactionDemand;
    footprint: string;
  }

  // --- Militari: più spesa e più riserve, più soddisfatti. -----------------
  const militarySatisfaction = clamp(52 + (defenceBurdenPct - 3) * 13 - socialTension * 0.05);
  const militaryDemand: FactionDemand = defenceBurdenPct < 2.6
    ? {
        lever: 'difesa', direction: 'alza',
        title: 'Riarmo: portare la spesa militare al 4% del PIL',
        detail: `Oggi la difesa vale il ${round1(defenceBurdenPct)}% del PIL. Lo Stato maggiore chiede più mezzi, riserve addestrate e scorte.`,
        urgency: clamp(round0((3.6 - defenceBurdenPct) * 28)),
      }
    : defenceBurdenPct > 8
      ? {
          lever: 'difesa', direction: 'mantieni',
          title: 'Difendere il bilancio militare',
          detail: `La difesa è già al ${round1(defenceBurdenPct)}% del PIL: i comandi temono tagli e chiedono continuità.`,
          urgency: 25,
        }
      : {
          lever: 'difesa', direction: 'alza',
          title: 'Più fondi ai comandi',
          detail: `La difesa vale il ${round1(defenceBurdenPct)}% del PIL: i comandi chiedono un rafforzamento moderato.`,
          urgency: 40,
        };

  // --- Industria: meno tasse, più infrastrutture. --------------------------
  const industrySatisfaction = clamp(58 - Math.max(0, taxRatePct - 10) * 5.5 + infraShare * 1.4);
  const industryDemand: FactionDemand = taxRatePct > 11.5
    ? {
        lever: 'tasse', direction: 'abbassa',
        title: 'Sgravi a imprese e produzione',
        detail: `Il prelievo effettivo è al ${round1(taxRatePct)}% del PIL: l'industria chiede aliquote più basse e meno oneri.`,
        urgency: clamp(round0((taxRatePct - 10.5) * 22)),
      }
    : {
        lever: 'infrastrutture', direction: 'alza',
        title: 'Più infrastrutture per l\'industria',
        detail: `Porti, ferrovie e energia assorbono il ${round1(infraShare)}% delle uscite: l'industria ne vuole di più.`,
        urgency: 45,
      };

  // --- Lavoro: welfare, sanità, sostegno. ----------------------------------
  const labourSatisfaction = clamp(44 + welfareShare * 1.5 - socialTension * 0.3 + (stability - 50) * 0.2);
  const labourDemand: FactionDemand = {
    lever: 'welfare', direction: 'alza',
    title: 'Welfare: più sanità e sostegno sociale',
    detail: `Sanità e sostegno valgono il ${round1(budget.socialBurdenPct)}% del PIL: i sindacati chiedono salari, tutele e servizi.`,
    urgency: clamp(round0(100 - labourSatisfaction)),
  };

  // --- Tecnocrati: istruzione e ricerca. -----------------------------------
  const techSatisfaction = clamp(46 + educationShare * 2.4);
  const techDemand: FactionDemand = {
    lever: 'istruzione', direction: 'alza',
    title: 'Istruzione e ricerca: più atenei e laboratori',
    detail: `Scuola e ricerca assorbono il ${round1(educationShare)}% delle uscite: gli atenei chiedono più fondi e personale.`,
    urgency: clamp(round0(100 - techSatisfaction)),
  };

  // --- Creditori: conti in ordine. -----------------------------------------
  const financeSatisfaction = clamp(
    (balance >= 0
      ? 50 + Math.min(30, balanceRatio * 5000)
      : 50 + Math.max(-48, balanceRatio * 8000))
      // Un debito ereditato molto alto pesa sui creditori anche con il pareggio.
      - Math.max(0, debtBurdenPct - 60) * 0.3,
  );
  const highDebt = debtBurdenPct >= 90;
  const financeDemand: FactionDemand = balance < 0 || highDebt
    ? {
        lever: 'debito', direction: 'abbassa',
        title: highDebt ? 'Ridurre il debito pubblico' : 'Risana i conti: ridurre il disavanzo',
        detail: highDebt
          ? `Il debito pubblico vale il ${round1(debtBurdenPct)}% del PIL: i creditori chiedono di ridurlo prima che gli interessi divorino il bilancio.`
          : `Il saldo mensile è ${round1(balance)} mld: la finanza teme nuovo debito e chiede di chiudere il disavanzo.`,
        urgency: clamp(round0(100 - financeSatisfaction)),
      }
    : {
        lever: 'debito', direction: 'mantieni',
        title: 'Mantenere il pareggio',
        detail: `Il bilancio è in attivo e il debito al ${round1(debtBurdenPct)}% del PIL: la finanza chiede prudenza e nessuna spesa fuori controllo.`,
        urgency: 30,
      };

  // --- Province: strade, ordine locale, amministrazione. -------------------
  const provinceSatisfaction = clamp(44 + (infraShare + adminShare) * 1.1 + (stability - 50) * 0.5);
  const provinceDemand: FactionDemand = {
    lever: 'infrastrutture', direction: 'alza',
    title: 'Strade, acquedotti e presidi locali',
    detail: `Le province governano ${round0(provinces)} territori: chiedono investimenti locali e prefetti con più mezzi.`,
    urgency: clamp(round0(100 - provinceSatisfaction)),
  };

  // --- Opinione pubblica: quiete, prezzi, consenso. ------------------------
  const publicSatisfaction = clamp(stability - socialTension * 0.5);
  const publicDemand: FactionDemand = socialTension >= 40
    ? {
        lever: 'ordine', direction: 'alza',
        title: 'Distensione: calmare la piazza',
        detail: `La tensione sociale è al ${round0(socialTension)}/100: l'opinione pubblica chiede risposte su prezzi, lavoro e sicurezza.`,
        urgency: clamp(round0(socialTension)),
      }
    : publicSatisfaction < 45
      ? {
          // Tensione ancora sotto la soglia ma consenso già sottile: dire che il
          // paese è «quieto» mentre la fazione è critica sarebbe incoerente.
          lever: 'ordine', direction: 'alza',
          title: 'Ricucire il consenso: stabilità e servizi',
          detail: `Il consenso è fragile (${round0(publicSatisfaction)}/100): l'opinione pubblica chiede risposte concrete su prezzi, lavoro e servizi prima che la piazza si accenda.`,
          urgency: clamp(round0(100 - publicSatisfaction)),
        }
      : {
          lever: 'ordine', direction: 'mantieni',
          title: 'Continuità e tranquillità',
          detail: 'Il paese è relativamente quieto: l\'opinione pubblica chiede stabilità, non avventure.',
          urgency: 25,
        };

  const raw: RawFaction[] = [
    {
      id: 'militari', name: 'Forze armate', interest: 'Difesa, ordine e prestigio',
      power: 10 + forces * 0.5 + mobilized * 2.2 + defenceBurdenPct * 0.9,
      satisfaction: militarySatisfaction, demand: militaryDemand,
      footprint: 'Spinge la spesa militare e le riserve richiamate.',
    },
    {
      id: 'industriali', name: 'Industria e padronato', interest: 'Meno tasse, più infrastrutture e mercati',
      power: 10 + factories * 1.0 + ports * 0.7,
      satisfaction: industrySatisfaction, demand: industryDemand,
      footprint: 'Vuole alleggerire il prelievo e costruire capacità produttiva.',
    },
    {
      id: 'lavoratori', name: 'Lavoro e sindacati', interest: 'Salari, welfare e diritti',
      power: 14 + Math.min(8, Math.sqrt(Math.max(0, populationM)) * 1.6),
      satisfaction: labourSatisfaction, demand: labourDemand,
      footprint: 'Premia sanità, sostegno sociale e tenuta dei salari.',
    },
    {
      id: 'tecnocrati', name: 'Università e tecnici', interest: 'Istruzione, ricerca e competenza',
      power: 6 + universities * 2.0,
      satisfaction: techSatisfaction, demand: techDemand,
      footprint: 'Collega la spesa per istruzione alla crescita futura.',
    },
    {
      id: 'finanza', name: 'Finanza e creditori', interest: 'Conti in ordine e moneta stabile',
      power: 9 + (balance < 0 ? 3 : 0),
      satisfaction: financeSatisfaction, demand: financeDemand,
      footprint: 'Vigila su disavanzo, debito e credito residuo.',
    },
    {
      id: 'province', name: 'Province e prefetti', interest: 'Strade, ordine locale e autonomia',
      power: 6 + provinces * 1.1,
      satisfaction: provinceSatisfaction, demand: provinceDemand,
      footprint: 'Porta sul tavolo del consiglio il territorio e i servizi locali.',
    },
    {
      id: 'opinione', name: 'Opinione pubblica', interest: 'Consenso, quiete e benessere diffuso',
      power: 8 + Math.max(0, 100 - stability) * 0.15,
      satisfaction: publicSatisfaction, demand: publicDemand,
      footprint: 'Misura il consenso e la pressione della piazza.',
    },
  ];

  const rawSum = raw.reduce((sum, faction) => sum + Math.max(0.01, faction.power), 0);
  const factions: GovernmentFaction[] = raw.map((faction) => {
    const powerPct = round1((Math.max(0.01, faction.power) / rawSum) * 100);
    const satisfaction = round1(faction.satisfaction);
    const pressure = clamp(round0((100 - satisfaction) * (powerPct / 100) * 1.7));
    return {
      id: faction.id,
      name: faction.name,
      interest: faction.interest,
      powerPct,
      satisfaction,
      stance: stanceFor(satisfaction),
      pressure,
      demand: faction.demand,
      footprint: faction.footprint,
    };
  });
  // Correzione del centesimo: la somma dell'influenza deve fare esattamente 100.
  const drift = round1(100 - factions.reduce((sum, faction) => sum + faction.powerPct, 0));
  if (Math.abs(drift) >= 0.1 && factions.length > 0) {
    const strongest = factions.reduce((best, faction) =>
      faction.powerPct > best.powerPct ? faction : best, factions[0]);
    strongest.powerPct = round1(strongest.powerPct + drift);
  }

  const dominantId = factions.reduce<GovernmentFaction | null>((best, faction) =>
    !best || faction.powerPct > best.powerPct ? faction : best, null)?.id ?? null;
  const angriestId = factions.reduce<GovernmentFaction | null>((best, faction) =>
    !best || faction.pressure > best.pressure ? faction : best, null)?.id ?? null;
  const cohesion = clamp(round0(
    factions.reduce((sum, faction) => sum + faction.satisfaction * faction.powerPct, 0) / 100));
  const pressureIndex = clamp(round0(
    factions.reduce((sum, faction) => sum + faction.pressure * faction.powerPct, 0) / 100));

  const dominant = factions.find((faction) => faction.id === dominantId) ?? null;
  const angriest = factions.find((faction) => faction.id === angriestId) ?? null;
  const headline = dominant && angriest && dominant.id !== angriest.id
    ? `${dominant.name} ha la maggiore influenza; ${angriest.name} preme di più: ${angriest.demand.title.toLowerCase()}.`
    : dominant
      ? `${dominant.name} domina il consiglio e chiede: ${dominant.demand.title.toLowerCase()}.`
      : 'Il governo non ha anime registrate per questo scenario.';

  return { factions, dominantId, angriestId, cohesion, pressureIndex, headline, budget,
    debt: { ratioPct: round1(debtBurdenPct), servicePct: round1(Math.max(0, Number(account?.debtServicePct) || 0)) } };
}
