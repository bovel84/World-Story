/**
 * World Story — Military Doctrine: epoca, uomini, dotazioni, prontezza
 * ===================================================================
 * Fonte unica e autorevole delle **regole militari strutturali** che prima
 * vivevano (diverse e incomplete) nel frontend o non esistevano affatto:
 *
 *  1. **Epoca militare** dello scenario (pre-industriale · grande guerra ·
 *     seconda guerra · guerra fredda · moderno), derivata dalla data d'inizio
 *     del mondo. Non cambia mentre la partita avanza: la dottrina di una
 *     nazione non si riscrive in un anno.
 *  2. **Manpower aggregato**: quanti *uomini* stanno in armi. Il motore conosce
 *     i **reparti** (`forces`, `mobilized`); qui i reparti diventano personale
 *     con un rapporto dichiarato (`menPerFormation`) e si aggiunge il dato che
 *     mancava davvero: la **riserva** mobilitabile, derivata dalla popolazione
 *     in età utile. Nessuna simulazione cittadino per cittadino, nessun numero
 *     casuale, nessun LLM.
 *  3. **Establishment**: la dotazione di riferimento per reparto, per categoria
 *     di equipaggiamento e per epoca. È la stessa tabella usata dal **seed
 *     dell'arsenale**, dalla **copertura** e dalla **prontezza**: una sola
 *     formula, non una per il motore e una per la UI.
 *  4. **Copertura** per categoria: possesso reale sull'armamento richiesto dal
 *     personale effettivo. Solo categorie pertinenti all'epoca: in 1815 non si
 *     chiedono carri, aerei o missili.
 *  5. **Prontezza operativa**: media pesata della copertura, modulata da
 *     carburante, scorte di armamenti, qualità dell'arsenale e pressione della
 *     mobilitazione. I driver escono da qui: la UI li mostra, non li calcola.
 *
 * Tutto è puro e deterministico: stessi ingressi ⇒ stessi numeri.
 */

import { equipmentById, type Domain } from './MilitaryIndustry';

// ── 1. Epoca ────────────────────────────────────────────────────────────────

export type MilitaryEpoch =
  | 'pre_industriale'
  | 'grande_guerra'
  | 'seconda_guerra'
  | 'guerra_fredda'
  | 'moderno';

export const MILITARY_EPOCH_LABEL: Record<MilitaryEpoch, string> = {
  pre_industriale: 'Eserciti pre-industriali',
  grande_guerra: 'Grande guerra',
  seconda_guerra: 'Seconda guerra mondiale',
  guerra_fredda: 'Guerra fredda',
  moderno: 'Era moderna',
};

/** Soglie di epoca sulle date di scenario (coerenza sistemica, non enciclopedia). */
const EPOCH_BOUNDARIES: Array<{ from: number; epoch: MilitaryEpoch }> = [
  { from: 1861, epoch: 'grande_guerra' },
  { from: 1919, epoch: 'seconda_guerra' },
  { from: 1946, epoch: 'guerra_fredda' },
  { from: 1990, epoch: 'moderno' },
];

/** Epoca della data d'inizio dello scenario; `guerra_fredda` se illeggibile
 *  (è la data di partenza predefinita del gioco, 1951). */
export function epochForDate(startDate?: string | null): MilitaryEpoch {
  const year = Number(String(startDate || '').slice(0, 4));
  if (!Number.isFinite(year) || year <= 0) return 'guerra_fredda';
  let epoch: MilitaryEpoch = 'pre_industriale';
  for (const boundary of EPOCH_BOUNDARIES) {
    if (year >= boundary.from) epoch = boundary.epoch;
  }
  return epoch;
}

// ── 2. Manpower ─────────────────────────────────────────────────────────────

/**
 * Profilo demografico-militare di un'epoca. `eligibleShare` = quota della
 * popolazione in età utile; `menPerFormation` = uomini di un reparto;
 * `reserveRatio` = riservisti addestrati per ogni soldato in servizio;
 * `maxMobilizedShare` = quota massima di riserva richiamabile in una volta.
 */
export interface ManpowerProfile {
  eligibleShare: number;
  menPerFormation: number;
  reserveRatio: number;
  maxMobilizedShare: number;
}

export const MANPOWER_PROFILES: Record<MilitaryEpoch, ManpowerProfile> = {
  pre_industriale: { eligibleShare: 0.16, menPerFormation: 800, reserveRatio: 0.6, maxMobilizedShare: 0.35 },
  grande_guerra: { eligibleShare: 0.19, menPerFormation: 8000, reserveRatio: 1.2, maxMobilizedShare: 0.6 },
  seconda_guerra: { eligibleShare: 0.21, menPerFormation: 10000, reserveRatio: 1.5, maxMobilizedShare: 0.8 },
  guerra_fredda: { eligibleShare: 0.17, menPerFormation: 11000, reserveRatio: 1.2, maxMobilizedShare: 0.7 },
  moderno: { eligibleShare: 0.14, menPerFormation: 12000, reserveRatio: 0.9, maxMobilizedShare: 0.5 },
};

export interface MilitaryManpower {
  population: number;
  /** Popolazione in età utile: il bacino teorico. */
  eligiblePopulation: number;
  /** Massimo mobilitabile in extremis (= popolazione in età utile). */
  totalMilitaryPool: number;
  /** Uomini in servizio permanente (reparti × uomini per reparto). */
  activePersonnel: number;
  /** Riservisti addestrati, **compresi** quelli già richiamati. */
  reservePersonnel: number;
  /** Riservisti già richiamati alle armi (sottoinsieme della riserva). */
  mobilizedPersonnel: number;
  /** Riservisti non ancora richiamati: quello che resta da chiamare. */
  availableReserve: number;
  /** Reparti in servizio (dato del motore, non ricalcolato). */
  formations: number;
  /** Reparti di riserva richiamati (dato del motore). */
  mobilizedFormations: number;
  /** Uomini per reparto usati dal profilo d'epoca. */
  menPerFormation: number;
}

export interface ManpowerInput {
  population: number;
  /** Reparti in servizio permanente (`account.forces`). */
  formations: number;
  /** Reparti di riserva richiamati (`account.mobilized`). */
  mobilizedFormations: number;
  epoch: MilitaryEpoch;
}

const nonNegative = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/**
 * Manpower aggregato. Invarianti garantite per costruzione: la **riserva** è
 * sempre contenuta nel bacino che resta dopo gli attivi (`active + reserve <=
 * max(active, pool)`), non è mai inferiore ai richiamati e `availableReserve =
 * reserve − mobilized >= 0`.
 *
 * I reparti in servizio sono un fatto del motore e **non** vengono ridotti da
 * una popolazione piccola: se una nazione ha sei reparti, li ha. È il bacino a
 * limitare quello che si può ancora chiamare, non ciò che è già in armi.
 */
export function militaryManpower(input: ManpowerInput): MilitaryManpower {
  const profile = MANPOWER_PROFILES[input.epoch];
  const population = nonNegative(input.population);
  const formations = nonNegative(input.formations);
  const mobilizedFormations = nonNegative(input.mobilizedFormations);

  const eligiblePopulation = Math.round(population * profile.eligibleShare);
  const totalMilitaryPool = eligiblePopulation;
  const activePersonnel = Math.round(formations * profile.menPerFormation);
  // I richiamati non possono superare ciò che il bacino può dare oltre agli attivi.
  const mobilizedPersonnel = Math.min(
    Math.round(mobilizedFormations * profile.menPerFormation),
    Math.max(0, totalMilitaryPool - activePersonnel),
  );
  // Riserva addestrata: mai meno dei richiamati, mai più di quanto il bacino
  // possa sostenere insieme agli attivi.
  const reservePersonnel = Math.min(
    Math.max(0, totalMilitaryPool - activePersonnel),
    Math.max(mobilizedPersonnel, Math.round(activePersonnel * profile.reserveRatio)),
  );
  return {
    population,
    eligiblePopulation,
    totalMilitaryPool,
    activePersonnel,
    reservePersonnel,
    mobilizedPersonnel,
    availableReserve: Math.max(0, reservePersonnel - mobilizedPersonnel),
    formations,
    mobilizedFormations,
    menPerFormation: profile.menPerFormation,
  };
}

/** Bacino mobilitabile non ancora organizzato (né attivi né riserva addestrata). */
export function untrainedPool(manpower: MilitaryManpower): number {
  return Math.max(0, manpower.totalMilitaryPool - manpower.activePersonnel - manpower.reservePersonnel);
}

// ── 3. Establishment ────────────────────────────────────────────────────────

export type EquipmentCategoryId =
  | 'individualWeapons' | 'supportWeapons' | 'armoredMobility' | 'artillery'
  | 'airSupport' | 'navalSupport' | 'missiles' | 'drones';

export const EQUIPMENT_CATEGORY_LABEL: Record<EquipmentCategoryId, string> = {
  individualWeapons: 'Armi individuali',
  supportWeapons: 'Armi di supporto',
  armoredMobility: 'Mobilità corazzata',
  artillery: 'Artiglieria',
  airSupport: 'Supporto aereo',
  navalSupport: 'Supporto navale',
  missiles: 'Missili',
  drones: 'Droni',
};

export interface EstablishmentCategory {
  id: EquipmentCategoryId;
  label: string;
  /** Pezzi richiesti per reparto in servizio permanente. */
  perFormation: number;
  /** Pezzi richiesti per reparto di riserva richiamato (default: perFormation). */
  perMobilized?: number;
  /** Peso nella prontezza operativa (i pesi di un'epoca sommano a 1). */
  weight: number;
  /** Voci del catalogo che contano per questa categoria. */
  match: { categories?: string[]; domains?: Domain[] };
  /** Richiede sbocco al mare: senza porti la categoria non entra nel fabbisogno. */
  requiresPorts?: boolean;
  /** Da dove viene la regola: seed del motore o dottrina d'epoca. */
  source: 'engine_seed' | 'doctrine';
  /** Perché esiste questa categoria in questa epoca (leggibile nel Dossier). */
  basis: string;
}

/**
 * Ancoraggio al motore: il seed dell'arsenale assegna **40 armi individuali per
 * reparto** e **50 per ogni reparto di riserva richiamato**
 * (`MilitaryService.arsenalUnits`). Questi due numeri sono l'unico requisito
 * preso dal seed; tutti gli altri sono dottrina dichiarata qui.
 */
export const RIFLES_PER_FORMATION = 40;
export const RIFLES_PER_MOBILIZED_FORMATION = 50;

/** Voce di catalogo che rappresenta la mobilità terrestre in ogni epoca. */
export const MOBILITY_EQUIPMENT_ID = 'apc';

const individualWeapons = (weight: number, basis: string): EstablishmentCategory => ({
  id: 'individualWeapons',
  label: EQUIPMENT_CATEGORY_LABEL.individualWeapons,
  perFormation: RIFLES_PER_FORMATION,
  perMobilized: RIFLES_PER_MOBILIZED_FORMATION,
  weight,
  match: { categories: ['Fanteria'] },
  source: 'engine_seed',
  basis,
});

/**
 * Dotazioni di riferimento per epoca. Le categorie assenti non vengono
 * semplicemente pesate zero: **non esistono** per quell'epoca, quindi non
 * compaiono fra i requisiti e non penalizzano la prontezza.
 */
export const ESTABLISHMENT_BY_EPOCH: Record<MilitaryEpoch, EstablishmentCategory[]> = {
  pre_industriale: [
    individualWeapons(1, 'Un esercito pre-industriale si misura sulle armi individuali: il catalogo dell’epoca non ha mezzi corazzati, aerei o missili.'),
  ],
  grande_guerra: [
    individualWeapons(0.62, 'La fanteria di massa resta la base dell’esercito.'),
    {
      id: 'artillery', label: EQUIPMENT_CATEGORY_LABEL.artillery,
      perFormation: 2, weight: 0.23,
      match: { categories: ['Artiglieria'] }, source: 'doctrine',
      basis: 'L’artiglieria è l’arma decisiva del fronte: più pezzi che mezzi.',
    },
    {
      id: 'navalSupport', label: EQUIPMENT_CATEGORY_LABEL.navalSupport,
      perFormation: 0.5, weight: 0.15,
      match: { domains: ['mare'] }, requiresPorts: true, source: 'doctrine',
      basis: 'Le marine contano sulle rotte e sul blocco: solo per paesi con cantieri.',
    },
  ],
  seconda_guerra: [
    individualWeapons(0.45, 'La fanteria resta il nerbo, ma non basta più da sola.'),
    {
      id: 'armoredMobility', label: EQUIPMENT_CATEGORY_LABEL.armoredMobility,
      perFormation: 1.5, weight: 0.2,
      match: { categories: ['Corazzati'] }, source: 'doctrine',
      basis: 'La manovra corazzata decide le offensive: è la dotazione del seed del motore.',
    },
    {
      id: 'artillery', label: EQUIPMENT_CATEGORY_LABEL.artillery,
      perFormation: 2, weight: 0.2,
      match: { categories: ['Artiglieria'] }, source: 'doctrine',
      basis: 'Il fuoco indiretto prepara ogni attacco.',
    },
    {
      id: 'airSupport', label: EQUIPMENT_CATEGORY_LABEL.airSupport,
      perFormation: 0.2, weight: 0.15,
      match: { domains: ['aria'] }, source: 'doctrine',
      basis: 'L’aviazione è ormai parte della battaglia, non un esperimento.',
    },
  ],
  guerra_fredda: [
    individualWeapons(0.35, 'Fanteria numerosa, con armi automatiche di ordinanza.'),
    {
      id: 'armoredMobility', label: EQUIPMENT_CATEGORY_LABEL.armoredMobility,
      perFormation: 2, weight: 0.2,
      match: { categories: ['Corazzati'] }, source: 'doctrine',
      basis: 'Meccanizzazione di massa: la fanteria si muove protetta.',
    },
    {
      id: 'artillery', label: EQUIPMENT_CATEGORY_LABEL.artillery,
      perFormation: 1.5, weight: 0.15,
      match: { categories: ['Artiglieria'] }, source: 'doctrine',
      basis: 'Artiglieria e lanciarazzi coprono il fronte europeo.',
    },
    {
      id: 'supportWeapons', label: EQUIPMENT_CATEGORY_LABEL.supportWeapons,
      perFormation: 0.6, weight: 0.1,
      match: { categories: ['Difesa aerea'], domains: ['missili'] }, source: 'doctrine',
      basis: 'La difesa aerea di punto protegge le colonne dai velivoli a bassa quota.',
    },
    {
      id: 'airSupport', label: EQUIPMENT_CATEGORY_LABEL.airSupport,
      perFormation: 0.3, weight: 0.1,
      match: { domains: ['aria'] }, source: 'doctrine',
      basis: 'Il caccia da superiorità aerea è la misura del potere aereo.',
    },
    {
      id: 'navalSupport', label: EQUIPMENT_CATEGORY_LABEL.navalSupport,
      perFormation: 0.3, weight: 0.1,
      match: { domains: ['mare'] }, requiresPorts: true, source: 'doctrine',
      basis: 'Flotte di scorta per le rotte atlantiche: solo per paesi con cantieri.',
    },
  ],
  moderno: [
    // Le prime sei sono le categorie di COUNTRY-CLARITY, con gli stessi
    // requisiti già validati: ora però pesi e soglie vivono qui, non nella UI.
    individualWeapons(0.3, 'Il singolo soldato è la base di ogni reparto appiedato.'),
    {
      id: 'armoredMobility', label: EQUIPMENT_CATEGORY_LABEL.armoredMobility,
      perFormation: 1.5, weight: 0.2,
      match: { categories: ['Corazzati'] }, source: 'doctrine',
      basis: 'Trasporto protetto e manovra: la dotazione del seed del motore.',
    },
    {
      id: 'supportWeapons', label: EQUIPMENT_CATEGORY_LABEL.supportWeapons,
      perFormation: 0.8, weight: 0.1,
      match: { categories: ['Difesa aerea'], domains: ['missili'] }, source: 'doctrine',
      basis: 'Difesa aerea di punto e armi di supporto del reparto.',
    },
    {
      id: 'artillery', label: EQUIPMENT_CATEGORY_LABEL.artillery,
      perFormation: 0.5, weight: 0.05,
      match: { categories: ['Artiglieria'] }, source: 'doctrine',
      basis: 'Fuoco indiretto, oggi meno numeroso ma più preciso.',
    },
    {
      id: 'airSupport', label: EQUIPMENT_CATEGORY_LABEL.airSupport,
      perFormation: 0.2, weight: 0.1,
      match: { domains: ['aria', 'droni'] }, source: 'doctrine',
      basis: 'Senza copertura aerea un reparto non sopravvive sul campo.',
    },
    {
      id: 'navalSupport', label: EQUIPMENT_CATEGORY_LABEL.navalSupport,
      perFormation: 0.06, weight: 0.1,
      match: { domains: ['mare'] }, requiresPorts: true, source: 'doctrine',
      basis: 'Proiezione e difesa delle rotte: solo per paesi con cantieri.',
    },
    {
      id: 'missiles', label: EQUIPMENT_CATEGORY_LABEL.missiles,
      perFormation: 0.1, weight: 0.1,
      match: { domains: ['missili'] }, source: 'doctrine',
      basis: 'Colpire a distanza senza rischio per gli equipaggi.',
    },
    {
      id: 'drones', label: EQUIPMENT_CATEGORY_LABEL.drones,
      perFormation: 0.15, weight: 0.05,
      match: { domains: ['droni'] }, source: 'doctrine',
      basis: 'Ricognizione e attacco persistenti a costo contenuto.',
    },
  ],
};

export function establishmentFor(epoch: MilitaryEpoch): EstablishmentCategory[] {
  return ESTABLISHMENT_BY_EPOCH[epoch];
}

// ── 4. Copertura ────────────────────────────────────────────────────────────

export interface EquipmentCoverage {
  category: EquipmentCategoryId;
  label: string;
  /** Pezzi richiesti dal personale effettivo. */
  required: number;
  /** Pezzi realmente in servizio. */
  available: number;
  coveragePct: number;
  /** Pezzi mancanti (`required - available`, mai negativo). */
  missing: number;
  /** Voci di catalogo che contribuiscono. */
  items: string[];
  weight: number;
}

export interface CoverageInput {
  units: Record<string, number>;
  manpower: MilitaryManpower;
  epoch: MilitaryEpoch;
  /** Porti della nazione: `0` ⇒ nessun requisito navale (dato assente ≠ zero). */
  ports?: number | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Copertura per categoria dagli **uomini effettivi**: il fabbisogno nasce da
 * `activePersonnel`/`mobilizedPersonnel`, non dal numero di reparti letto
 * direttamente. Le categorie non pertinenti all'epoca non compaiono; quelle
 * che richiedono il mare spariscono per i paesi senza porti.
 */
export function equipmentCoverage(input: CoverageInput): EquipmentCoverage[] {
  const { units, manpower, epoch } = input;
  const menPerFormation = manpower.menPerFormation || 1;
  const activeFormations = manpower.activePersonnel / menPerFormation;
  const mobilizedFormations = manpower.mobilizedPersonnel / menPerFormation;
  const landlocked = finiteOrNull(input.ports) === 0;

  const entries = establishmentFor(epoch).filter(entry => !(entry.requiresPorts && landlocked));
  return entries.map(entry => {
    const required = Math.ceil(
      activeFormations * entry.perFormation
      + mobilizedFormations * (entry.perMobilized ?? entry.perFormation),
    );
    const matched: string[] = [];
    let available = 0;
    for (const [id, quantity] of Object.entries(units || {})) {
      const equipment = equipmentById(id);
      if (!equipment || !Number.isFinite(quantity) || quantity <= 0) continue;
      // Le due liste sono alternative: una voce conta se rientra nella
      // categoria **o** nel dominio (es. difesa aerea oppure missili).
      const matchesCategory = entry.match.categories?.includes(equipment.category) ?? false;
      const matchesDomain = entry.match.domains?.includes(equipment.domain) ?? false;
      if (!matchesCategory && !matchesDomain) continue;
      available += quantity;
      matched.push(`${equipment.name} ×${quantity}`);
    }
    const coveragePct = required > 0
      ? Math.min(100, round1(available / required * 100))
      : (available > 0 ? 100 : 0);
    return {
      category: entry.id,
      label: entry.label,
      required,
      available,
      coveragePct,
      missing: Math.max(0, required - available),
      items: matched,
      weight: entry.weight,
    };
  });
}

// ── 5. Prontezza ────────────────────────────────────────────────────────────

export type ReadinessTone = 'positive' | 'warning' | 'critical' | 'neutral';
export type ReadinessStatus = 'healthy' | 'stable' | 'pressure' | 'fragile' | 'critical';

export interface ReadinessDriver {
  tone: ReadinessTone;
  label: string;
  detail?: string;
}

export interface MilitaryReadiness {
  readinessPct: number;
  status: ReadinessStatus;
  drivers: ReadinessDriver[];
}

export interface ReadinessInput {
  coverage: EquipmentCoverage[];
  /** Scorte e fabbisogni mensili pubblicati dal motore. */
  fuel?: { stock: number | null; need: number | null };
  weapons?: { stock: number | null; need: number | null };
  qualityIndex?: number | null;
  manpower: MilitaryManpower;
}

/** Mesi di fabbisogno che valgono disponibilità piena: soglia dichiarata. */
export const OPERATION_MONTHS = 3;

export function readinessStatusFor(pct: number): ReadinessStatus {
  if (pct >= 80) return 'healthy';
  if (pct >= 65) return 'stable';
  if (pct >= 50) return 'pressure';
  if (pct >= 35) return 'fragile';
  return 'critical';
}

const finiteOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const number = (value: number | null, decimals = 0) =>
  value === null ? '—' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimals }).format(value);
const percent = (value: number, decimals = 0) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimals }).format(value)}%`;

/**
 * Prontezza operativa: media pesata della copertura (pesi dell'epoca,
 * normalizzati sulle categorie presenti) modulata da carburante, scorte di
 * armamenti, qualità media dell'arsenale e pressione dei richiamati. Un fattore
 * mancante vale 1: un dato assente non punisce.
 */
export function militaryReadiness(input: ReadinessInput): MilitaryReadiness {
  const { coverage, manpower } = input;
  const weightTotal = coverage.reduce((total, row) => total + row.weight, 0);
  const weighted = coverage.reduce((total, row) => total + row.coveragePct * row.weight, 0) / (weightTotal || 1);

  const fuelStock = finiteOrNull(input.fuel?.stock);
  const fuelNeed = finiteOrNull(input.fuel?.need);
  const weaponsStock = finiteOrNull(input.weapons?.stock);
  const weaponsNeed = finiteOrNull(input.weapons?.need);
  const factor = (stock: number | null, need: number | null): number => (
    stock === null || need === null || need <= 0
      ? 1
      : Math.max(0, Math.min(1, stock / (need * OPERATION_MONTHS)))
  );
  const fuelFactor = factor(fuelStock, fuelNeed);
  const weaponsFactor = factor(weaponsStock, weaponsNeed);
  const qualityIndex = finiteOrNull(input.qualityIndex) ?? 0;
  const qualityFactor = 0.75 + Math.min(0.25, qualityIndex / 400);
  const soldiers = manpower.activePersonnel + manpower.mobilizedPersonnel;
  const mobilizationFactor = soldiers > 0
    ? 1 - Math.min(0.15, manpower.mobilizedPersonnel / soldiers * 0.3)
    : 1;

  const readinessPct = Math.max(0, Math.min(100, Math.round(
    weighted * fuelFactor * weaponsFactor * qualityFactor * mobilizationFactor,
  )));

  const drivers: ReadinessDriver[] = [];
  for (const row of coverage.filter(item => item.coveragePct < 85)) {
    drivers.push({
      tone: row.coveragePct >= 60 ? 'warning' : 'critical',
      label: `Copertura ${row.label.toLowerCase()} ${percent(row.coveragePct)}`,
      detail: `${number(row.available)} in servizio su ${number(row.required)} della dotazione di riferimento.`,
    });
  }
  const fuelMonths = fuelStock !== null && fuelNeed !== null && fuelNeed > 0 ? round1(fuelStock / fuelNeed) : null;
  if (fuelMonths !== null) {
    const text = fuelStock === 0 ? 'esaurita' : fuelMonths > 12 ? '>12 mesi' : `${number(fuelMonths, 1)} mesi`;
    if (fuelMonths < OPERATION_MONTHS) {
      drivers.push({
        tone: fuelMonths < 1 ? 'critical' : 'warning',
        label: `Carburante: ${text} di operazioni`,
        detail: `Servono ${number(fuelNeed ?? 0, 1)}/mese: sotto i ${OPERATION_MONTHS} mesi la prontezza cala.`,
      });
    } else {
      drivers.push({
        tone: 'positive',
        label: `Carburante: ${text}`,
        detail: `Copertura piena delle operazioni (${number(fuelStock ?? 0, 1)} in magazzino).`,
      });
    }
  }
  if (weaponsFactor < 1 && weaponsStock !== null) {
    drivers.push({
      tone: weaponsFactor < 0.5 ? 'critical' : 'warning',
      label: `Scorte armamenti ${percent(weaponsFactor * 100)} del fabbisogno`,
      detail: `${number(weaponsStock, 1)} disponibili: il rimpiazzo dei pezzi consumati è limitato.`,
    });
  }
  if (qualityIndex > 0) {
    drivers.push({
      tone: qualityIndex >= 60 ? 'positive' : qualityIndex >= 30 ? 'warning' : 'critical',
      label: `Qualità media armi ${number(qualityIndex)}/100`,
      detail: 'Pesa sui combattimenti insieme alla copertura.',
    });
  }
  if (manpower.mobilizedPersonnel > 0) {
    drivers.push({
      tone: 'warning',
      label: `${number(manpower.mobilizedPersonnel)} riservisti richiamati`,
      detail: 'Le riserve consumano equipaggiamento per diventare operative: la prontezza ne risente finché non sono in linea.',
    });
  }

  return { readinessPct, status: readinessStatusFor(readinessPct), drivers };
}

// ── 6. Seed dell'arsenale ───────────────────────────────────────────────────

/**
 * Arsenale di partenza di una nazione, con le **stesse** costanti della
 * copertura: armi individuali per tutti i reparti (più il sovrappiù per i
 * richiamati) e mezzi di mobilità **solo se l'epoca li prevede** — così un
 * mondo del 1815 non nasce con veicoli corazzati che non esistono.
 */
export function arsenalSeedUnits(
  epoch: MilitaryEpoch,
  forces: number,
  mobilized: number,
): Record<string, number> {
  const formations = nonNegative(forces);
  const calledUp = nonNegative(mobilized);
  const units: Record<string, number> = {};
  const rifles = Math.round(formations * RIFLES_PER_FORMATION + calledUp * RIFLES_PER_MOBILIZED_FORMATION);
  if (rifles > 0) units.fucili = rifles;
  const mobility = establishmentFor(epoch).find(entry => entry.id === 'armoredMobility');
  if (mobility && formations > 0) {
    units[MOBILITY_EQUIPMENT_ID] = Math.round(formations * mobility.perFormation);
  }
  return units;
}
