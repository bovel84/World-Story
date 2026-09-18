/**
 * World Story — Military Industry & Natural Resources
 * ==================================================
 *
 * Due caratteristiche nazionali deterministiche, ancorate a dati reali:
 *
 *  1. **Risorse naturali** (petrolio, gas, carbone, ferro, rame, bauxite,
 *     uranio, oro, diamanti, litio, terre rare, legname, terra fertile,
 *     pesca, acqua). Sono un tratto della nazione: abilitano produzioni e
 *     tecnologie e non vengono inventate dal modello.
 *
 *  2. **Catalogo militare** con *qualità* esplicita (obsoleto → nuova
 *     generazione) per terra, aria, mare, missili e droni. Una nazione può
 *     **costruire** solo se ha tecnologia, industria e risorse; altrimenti può
 *     **importare** pagando un sovrapprezzo. Nessun LLM crea armamenti.
 */

import { technologyById } from './MaterialEconomy';

export const NATURAL_RESOURCE_KINDS = [
  'oil', 'gas', 'coal', 'iron', 'copper', 'bauxite', 'uranium', 'gold', 'diamonds',
  'lithium', 'rare_earths', 'timber', 'fertile_land', 'fisheries', 'water',
] as const;
export type NaturalResourceKind = typeof NATURAL_RESOURCE_KINDS[number];
export type NaturalEndowment = Partial<Record<NaturalResourceKind, number>>;

export const NATURAL_RESOURCE_LABELS: Record<NaturalResourceKind, string> = {
  oil: 'Petrolio', gas: 'Gas naturale', coal: 'Carbone', iron: 'Ferro',
  copper: 'Rame', bauxite: 'Bauxite', uranium: 'Uranio', gold: 'Oro',
  diamonds: 'Diamanti', lithium: 'Litio', rare_earths: 'Terre rare',
  timber: 'Legname', fertile_land: 'Terra fertile', fisheries: 'Pesca', water: 'Acqua dolce',
};

/**
 * Dotazioni reali 0–5 per paese (sintesi delle riserve/produzioni note).
 * Le voci assenti valgono 0. È una fotografia qualitativa, non un inventario.
 */
const ENDOWMENTS: Record<string, string> = {
  USA: 'oil4 gas5 coal5 iron3 copper3 uranium3 gold3 lithium2 rare_earths2 timber4 fertile_land4 fisheries3 water4',
  CAN: 'oil5 gas4 coal3 iron4 copper3 uranium4 gold4 diamonds3 lithium2 rare_earths2 timber5 fertile_land4 fisheries4 water5',
  MEX: 'oil3 gas2 iron2 copper3 gold3 timber2 fertile_land3 fisheries3 water2',
  BRA: 'oil2 coal2 iron5 copper2 bauxite4 gold3 diamonds2 lithium2 rare_earths3 timber5 fertile_land5 fisheries3 water5',
  ARG: 'oil3 gas3 iron2 copper2 gold2 lithium4 timber2 fertile_land5 fisheries3 water3',
  CHL: 'coal2 iron2 copper5 gold2 lithium5 timber2 fisheries4 water2',
  PER: 'oil1 gas1 iron2 copper4 gold3 lithium2 timber3 fisheries4 water2',
  COL: 'oil4 gas2 coal4 iron2 copper1 gold3 timber3 fertile_land4 fisheries2 water3',
  VEN: 'oil5 gas5 coal2 iron4 bauxite3 gold3 timber3 fertile_land3 fisheries2 water4',
  BOL: 'gas3 iron3 copper2 gold2 lithium5 timber3 water2',
  ECU: 'oil4 copper2 gold2 timber3 fertile_land3 fisheries3 water3',
  RUS: 'oil5 gas5 coal5 iron5 copper4 bauxite3 uranium4 gold5 diamonds5 lithium2 rare_earths3 timber5 fertile_land4 fisheries4 water5',
  DEU: 'coal4 iron1 copper1 timber3 fertile_land4 fisheries2 water3',
  FRA: 'coal1 iron1 copper1 uranium2 gold1 timber3 fertile_land5 fisheries3 water4',
  GBR: 'oil4 gas3 coal3 iron1 copper1 timber2 fertile_land4 fisheries5 water3',
  NOR: 'oil5 gas5 iron1 copper1 timber4 fisheries5 water5',
  SWE: 'coal1 iron5 copper2 uranium2 gold2 timber5 fertile_land3 fisheries3 water5',
  FIN: 'iron1 copper2 uranium1 gold2 timber5 fertile_land3 fisheries3 water5',
  ISL: 'fisheries5 water5',
  POL: 'gas1 coal5 iron2 copper4 timber3 fertile_land4 fisheries2 water2',
  UKR: 'gas1 coal5 iron5 uranium2 gold1 timber2 fertile_land5 fisheries2 water3',
  ITA: 'oil1 gas1 bauxite2 timber2 fertile_land4 fisheries4 water3',
  ESP: 'coal2 iron1 copper2 uranium1 gold1 timber3 fertile_land4 fisheries5 water3',
  PRT: 'iron1 copper2 uranium1 gold1 lithium2 timber4 fertile_land3 fisheries5 water3',
  GRC: 'coal2 iron1 copper1 bauxite3 gold1 timber3 fertile_land3 fisheries5 water3',
  TUR: 'oil1 gas1 coal4 iron2 copper2 bauxite2 gold2 timber3 fertile_land4 fisheries3 water3',
  CHN: 'oil3 gas2 coal5 iron4 copper3 bauxite3 uranium2 gold3 rare_earths5 lithium3 timber3 fertile_land4 fisheries4 water3',
  IND: 'coal5 iron4 copper2 bauxite3 uranium1 gold2 rare_earths3 timber3 fertile_land5 fisheries4 water3',
  JPN: 'coal1 copper1 timber3 fisheries5 water4',
  KOR: 'coal1 iron1 copper1 timber2 fisheries4 water3',
  PRK: 'coal4 iron3 copper2 rare_earths3 timber3 fisheries3 water3',
  IDN: 'oil3 gas3 coal5 iron2 copper3 bauxite3 gold3 timber5 fertile_land5 fisheries5 water4',
  MYS: 'oil3 gas4 copper1 bauxite1 gold1 timber5 fertile_land4 fisheries4 water4',
  VNM: 'oil2 gas2 coal3 iron2 bauxite3 rare_earths3 timber3 fertile_land5 fisheries5 water4',
  THA: 'oil1 gas2 coal2 iron1 copper1 gold1 timber3 fertile_land5 fisheries4 water4',
  PHL: 'coal1 iron1 copper3 gold2 timber3 fertile_land4 fisheries5 water3',
  AUS: 'oil2 gas5 coal5 iron5 copper4 bauxite5 uranium5 gold4 diamonds4 lithium5 rare_earths3 timber3 fisheries4 water3',
  NZL: 'oil1 gas2 coal2 iron1 copper1 gold2 timber4 fertile_land4 fisheries5 water5',
  ZAF: 'coal5 iron4 copper2 uranium3 gold5 diamonds5 lithium2 rare_earths2 timber3 fertile_land4 fisheries3 water2',
  NGA: 'oil5 gas4 coal3 iron2 copper1 gold2 timber3 fertile_land4 fisheries3 water3',
  DZA: 'oil5 gas5 iron2 copper1 uranium2 gold1 fertile_land2 fisheries2 water1',
  LBY: 'oil5 gas3 iron1 water1 fisheries2',
  EGY: 'oil3 gas5 iron2 copper1 gold2 fertile_land4 fisheries3 water1',
  MAR: 'coal1 iron1 copper1 uranium1 gold1 lithium1 timber2 fertile_land4 fisheries5 water3',
  ETH: 'coal1 iron1 copper1 gold2 timber2 fertile_land4 water3',
  KEN: 'oil1 coal1 iron1 copper1 gold1 timber3 fertile_land4 water3 fisheries3',
  TZA: 'gas3 coal2 iron1 gold2 diamonds2 timber4 fertile_land4 water4 fisheries3',
  COD: 'oil1 coal1 iron2 copper5 uranium3 gold4 diamonds5 lithium2 rare_earths3 timber5 fertile_land5 water5 fisheries3',
  ZMB: 'copper5 uranium1 gold1 timber3 fertile_land4 water4 fisheries2',
  ZWE: 'coal3 iron2 gold3 diamonds2 lithium2 timber3 fertile_land4 water3',
  BWA: 'coal3 copper2 uranium2 gold1 diamonds5 timber2 water1',
  NAM: 'copper3 uranium5 gold2 diamonds4 lithium2 timber2 fisheries4 water1',
  AGO: 'oil5 gas2 iron2 copper2 gold2 diamonds4 timber3 fertile_land4 water3 fisheries3',
  MOZ: 'gas4 coal4 iron1 gold2 timber4 fertile_land4 water4 fisheries3',
  CMR: 'oil2 iron2 bauxite2 gold2 timber5 fertile_land4 water4 fisheries2',
  GAB: 'oil4 iron2 copper1 gold1 timber5 fertile_land3 water4 fisheries3',
  COG: 'oil4 iron1 copper1 gold1 timber5 fertile_land4 water4 fisheries3',
  SDN: 'oil3 gas1 gold3 iron2 fertile_land4 water3',
  SSD: 'oil4 gold1 timber4 fertile_land4 water4',
  TCD: 'oil3 gold1 uranium1 fertile_land3 water3 fisheries2',
  NER: 'oil1 coal1 uranium5 gold2 fertile_land2 water1',
  GIN: 'iron4 bauxite5 gold3 diamonds2 fertile_land4 water4 fisheries3',
  SLE: 'iron2 bauxite2 gold3 diamonds4 fertile_land4 water4 fisheries3',
  LBR: 'iron3 gold2 diamonds2 timber4 fertile_land4 water4 fisheries3',
  GHA: 'oil2 iron2 bauxite2 gold4 diamonds2 timber3 fertile_land4 water3 fisheries3',
  CIV: 'oil2 gas2 iron2 gold2 diamonds2 timber4 fertile_land5 water4 fisheries3',
  SEN: 'oil1 iron1 gold2 timber3 fertile_land4 water3 fisheries4',
  SAU: 'oil5 gas4 iron1 copper1 gold2 bauxite2 water1 fisheries2',
  ARE: 'oil5 gas4 gold1 water1 fisheries3',
  QAT: 'oil4 gas5 water1 fisheries2',
  KWT: 'oil5 gas4 water1 fisheries2',
  IRQ: 'oil5 gas3 iron1 copper1 fertile_land3 water2 fisheries2',
  IRN: 'oil5 gas5 coal2 iron3 copper3 bauxite2 gold2 fertile_land3 water2 fisheries3',
  ISR: 'gas3 copper1 fertile_land2 water1 fisheries3',
  JOR: 'iron1 copper1 uranium2 gold1 water1 fisheries1',
  LBN: 'gas1 iron1 fertile_land3 water2 fisheries3',
  SYR: 'oil2 gas2 iron1 copper1 fertile_land3 water2 fisheries2',
  YEM: 'oil2 gas2 gold1 fertile_land2 water1 fisheries3',
  OMN: 'oil5 gas4 copper2 gold1 water1 fisheries3',
  KAZ: 'oil4 gas3 coal4 iron4 copper3 uranium5 gold3 lithium2 rare_earths2 timber2 fertile_land3 fisheries2',
  UZB: 'gas5 coal2 iron2 copper3 uranium3 gold3 fertile_land3 water2 fisheries2',
  TKM: 'oil3 gas5 fertile_land2 water1 fisheries1',
  AZE: 'oil4 gas4 iron1 copper1 fertile_land3 water2 fisheries2',
  GEO: 'coal1 iron1 copper2 gold1 timber3 fertile_land3 water4 fisheries2',
  BLR: 'iron1 timber5 fertile_land4 water4 fisheries2',
  ROU: 'oil2 gas2 coal2 iron2 copper1 gold1 fertile_land5 water4 fisheries3',
  BGR: 'coal3 iron1 copper3 gold1 fertile_land4 water3 fisheries3',
  SRB: 'coal3 iron1 copper3 gold1 fertile_land4 water3 fisheries2',
  HRV: 'oil1 gas1 bauxite1 fertile_land4 water3 fisheries4',
  BIH: 'coal3 iron2 bauxite2 timber4 fertile_land3 water3',
  ALB: 'oil2 coal1 iron1 copper2 fertile_land3 water3 fisheries3',
  NLD: 'oil1 gas4 fertile_land4 water3 fisheries4',
  BEL: 'coal1 fertile_land4 water3 fisheries3',
  DNK: 'oil2 gas1 fertile_land4 water3 fisheries5',
  IRL: 'gas2 fertile_land4 water4 fisheries5',
  MNG: 'coal5 copper5 gold3 rare_earths3 fertile_land2 water2 fisheries1',
  AFG: 'coal2 copper3 iron2 gold1 lithium3 rare_earths2 fertile_land2 water2',
  PAK: 'oil1 gas3 coal4 iron2 copper2 gold1 fertile_land4 water2 fisheries3',
  BGD: 'gas3 coal1 fertile_land5 water4 fisheries4',
  NPL: 'timber3 fertile_land3 water4 fisheries2',
  LKA: 'timber3 fertile_land4 water3 fisheries4',
  MMR: 'oil1 gas3 copper2 gold1 timber5 rare_earths3 fertile_land5 water4 fisheries4',
  KHM: 'oil1 timber4 fertile_land5 water4 fisheries4',
  LAO: 'copper2 gold2 timber5 fertile_land3 water4 fisheries3',
  TWN: 'coal1 gold1 timber3 fertile_land3 water3 fisheries4',
  CUB: 'oil1 gas1 copper2 gold1 timber3 fertile_land4 water3 fisheries4',
  DOM: 'gold3 copper1 bauxite1 timber3 fertile_land4 water3 fisheries4',
  JAM: 'bauxite5 timber2 fertile_land3 water3 fisheries3',
  TTO: 'oil3 gas4 fisheries3',
  GUY: 'gold3 bauxite3 timber5 fertile_land3 water5 fisheries3',
  SUR: 'gold3 bauxite3 timber5 water4 fisheries3',
  PAN: 'copper2 gold1 timber3 fertile_land4 water4 fisheries4',
  CRI: 'timber3 fertile_land4 water4 fisheries4',
  PSE: 'fertile_land2 water1 fisheries2',
  // Bacini storici / risorse fossili note
  BRN: 'oil4 gas5 timber4 fisheries3',
  IRQ_OLD: '',
};

function parseEndowment(spec: string): NaturalEndowment {
  const endowment: NaturalEndowment = {};
  for (const token of spec.split(/\s+/).filter(Boolean)) {
    const match = /^([a-z_]+)(\d)$/.exec(token);
    if (!match) continue;
    const kind = match[1] as NaturalResourceKind;
    if (!NATURAL_RESOURCE_KINDS.includes(kind)) continue;
    const value = Math.max(0, Math.min(5, Number(match[2])));
    if (value > 0) endowment[kind] = value;
  }
  return endowment;
}

const ENDOWMENT_CACHE = new Map<string, NaturalEndowment>();

/** Risorse naturali reali della nazione; baseline minimo per i paesi non censiti. */
export function naturalResourcesFor(polityId: string): NaturalEndowment {
  const cached = ENDOWMENT_CACHE.get(polityId);
  if (cached) return cached;
  const parsed = ENDOWMENTS[polityId] ? parseEndowment(ENDOWMENTS[polityId]) : {};
  // Ogni paese abitato ha almeno terra e acqua dolce: baseline esplicito.
  const endowment: NaturalEndowment = { fertile_land: 1, water: 1, ...parsed };
  ENDOWMENT_CACHE.set(polityId, endowment);
  return endowment;
}

export function describeEndowment(endowment: NaturalEndowment): string {
  const entries = NATURAL_RESOURCE_KINDS
    .filter(kind => (endowment[kind] || 0) > 0)
    .map(kind => `${NATURAL_RESOURCE_LABELS[kind]} ${endowment[kind]}/5`);
  return entries.length ? entries.join(', ') : 'nessuna risorsa rilevante';
}

// ── Catalogo militare ────────────────────────────────────────────────────────

export type Domain = 'terra' | 'aria' | 'mare' | 'missili' | 'droni';
export type QualityTier = 'obsoleto' | 'datato' | 'moderno' | 'avanzato' | 'nuova_generazione';

export const QUALITY_TIER_LABELS: Record<QualityTier, string> = {
  obsoleto: 'Obsoleto', datato: 'Datato', moderno: 'Moderno',
  avanzato: 'Avanzato', nuova_generazione: 'Nuova generazione',
};

export function tierForQuality(quality: number): QualityTier {
  if (quality >= 86) return 'nuova_generazione';
  if (quality >= 66) return 'avanzato';
  if (quality >= 46) return 'moderno';
  if (quality >= 26) return 'datato';
  return 'obsoleto';
}

export interface EquipmentRequirement {
  /** Tecnologie necessarie (dal catalogo MaterialEconomy). */
  techs?: string[];
  factories?: number;
  ports?: number;
  universities?: number;
  /** Dotazione minima di risorse naturali (caratteristica nazionale). */
  resources?: NaturalEndowment;
}

/** Caratteristica tecnica leggibile: etichetta + valore, sola lettura. */
export interface EquipmentSpec {
  label: string;
  value: string;
}

/**
 * Che cos'è un equipaggiamento: ruolo operativo, descrizione estesa e
 * caratteristiche tecniche. È **dato statico di catalogo** (non calcolato e non
 * inventato a partita): serve a capire cosa significhi possedere 37 unità.
 */
export interface EquipmentDetail {
  /** A cosa serve, in una riga. */
  role: string;
  /** Che cos'è e perché conta, in due o tre frasi. */
  description: string;
  /** Caratteristiche tecniche statiche. */
  specs: EquipmentSpec[];
}

export interface Equipment extends EquipmentDetail {
  id: string;
  name: string;
  domain: Domain;
  category: string;
  quality: number;
  tier: QualityTier;
  /** Costo unitario di costruzione in milioni di USD (tesoreria in miliardi). */
  costMln: number;
  /**
   * Consumo di scorte di armamenti per unità costruita. Per le **armi
   * individuali** l'unità è il singolo pezzo, quindi il consumo è una frazione
   * di punto di scorta (un fucile non è un carro armato).
   */
  weaponsCost: number;
  requires: EquipmentRequirement;
}

const S = (label: string, value: string): EquipmentSpec => ({ label, value });

/**
 * Schede descrittive per ogni voce del catalogo. Il modulo **fallisce chiuso**
 * se una voce resta senza scheda: un equipaggiamento senza spiegazione è
 * inutile per il giocatore, quindi non deve esistere.
 */
const EQUIPMENT_DETAILS: Record<string, EquipmentDetail> = {
  // ── Terra ─────────────────────────────────────────────────────────────────
  fucili: {
    role: 'Arma individuale della fanteria di linea',
    description: 'Fucile automatico d’ordinanza: equipaggia il singolo soldato ed è la base di ogni reparto appiedato. È l’unico equipaggiamento che rende una fanteria capace di combattere a piedi.',
    specs: [S('Calibro', '5,56 / 7,62 mm'), S('Gittata utile', '300–400 m'), S('Cadenza', '600–750 colpi/min'), S('Serventi', '1 fante')],
  },
  apc: {
    role: 'Trasporto protetto della fanteria meccanizzata',
    description: 'Veicolo cingolato o ruotato che porta una squadra sotto protezione e la sbarca sul campo di battaglia. Dà alla fanteria mobilità e sopravvivenza sotto il fuoco.',
    specs: [S('Equipaggio', '3 + 8 fanti'), S('Armamento', 'mitragliera 12,7 mm'), S('Velocità', '60–100 km/h'), S('Autonomia', '500–800 km')],
  },
  carri_3: {
    role: 'Manovra corazzata di rottura',
    description: 'Carro armato di generazione precedente ma ancora efficace: è il mezzo che sfonda le linee e occupa il terreno. Piattaforme numerose e di manutenzione semplice.',
    specs: [S('Equipaggio', '4'), S('Cannone', '105–120 mm'), S('Protezione', 'acciaio composito'), S('Velocità', '55 km/h'), S('Peso', '40–50 t')],
  },
  carri_4: {
    role: 'Carro di punta con sensori in rete',
    description: 'Corazzato di ultima generazione: corazzatura composita, sensori termici e collegamento dati con gli altri reparti. Sopravvive dove i carri datati vengono distrutti.',
    specs: [S('Equipaggio', '4'), S('Cannone', '120–125 mm'), S('Protezione', 'composita + ERA'), S('Sensori', 'termici, in rete'), S('Velocità', '65 km/h')],
  },
  artiglieria: {
    role: 'Fuoco indiretto a sostegno della manovra',
    description: 'Obici semoventi che colpiscono oltre l’orizzonte, senza vedere il bersaglio. Preparano l’attacco e spezzano i contrattacchi nemici.',
    specs: [S('Calibro', '152–155 mm'), S('Gittata', '20–30 km'), S('Cadenza', '4–8 colpi/min'), S('Mobilità', 'semovente cingolato')],
  },
  mlrs: {
    role: 'Saturazione d’area a media gittata',
    description: 'Lanciarazzi multipli: coprono un’area intera con decine di razzi in pochi secondi. Utile contro concentrazioni di truppe, depositi e batterie nemiche.',
    specs: [S('Rampa', '12–16 razzi'), S('Gittata', '30–70 km'), S('Effetto', 'saturazione d’area'), S('Ricarica', '5–10 min')],
  },
  sam_corto: {
    role: 'Difesa aerea di punto',
    description: 'Batterie a corto raggio che proteggono truppe e installazioni da aerei e droni a bassa quota. Sono l’ultimo schermo contro gli attacchi di precisione.',
    specs: [S('Bersagli', 'aerei, droni, elicotteri'), S('Gittata', '5–15 km'), S('Quota', 'fino a 6 km'), S('Reazione', 'pochi secondi')],
  },
  sam_lungo: {
    role: 'Scudo strategico a lungo raggio',
    description: 'Sistema antiaereo e antimissile di area: chiude lo spazio aereo su centinaia di chilometri e intercetta anche missili balistici. È la difesa più costosa e più decisiva.',
    specs: [S('Gittata', '150–300 km'), S('Quota', 'fino a 30 km'), S('Bersagli', 'aerei, cruise, balistici'), S('Radar', 'schieramento in rete')],
  },

  // ── Aria ──────────────────────────────────────────────────────────────────
  caccia_3: {
    role: 'Intercettazione e superiorità aerea locale',
    description: 'Caccia di generazione precedente: veloce e affidabile, con radar doppler e missili a corto raggio. Tiene il cielo vicino al proprio territorio.',
    specs: [S('Velocità', 'Mach 2+'), S('Raggio d’azione', '500–900 km'), S('Armamento', 'cannone + missili corto raggio'), S('Avionica', 'radar doppler')],
  },
  caccia_4: {
    role: 'Multiruolo: aria-aria e aria-suolo',
    description: 'Caccia moderno con avionica digitale, radar AESA e armi guidate: combatte altri aerei e colpisce bersagli al suolo nella stessa missione.',
    specs: [S('Velocità', 'Mach 1,8–2,2'), S('Raggio d’azione', '1.000–1.500 km'), S('Armamento', 'missili guidati medio raggio'), S('Avionica', 'radar AESA, data-link')],
  },
  caccia_5: {
    role: 'Superiorità aerea e penetrazione',
    description: 'Caccia di ultima generazione con traccia radar ridotta e fusione dei sensori: entra nello spazio aereo difeso senza essere visto e domina lo scontro aereo.',
    specs: [S('Velocità', 'Mach 1,6–2'), S('Raggio d’azione', '1.100 km'), S('Battaglia', 'fusione sensori'), S('Traccia radar', 'ridotta (stealth)')],
  },
  bombardieri: {
    role: 'Proiezione strategica a lungo raggio',
    description: 'Grandi velivoli che portano tonnellate di bombe e missili a migliaia di chilometri. Minacciano il cuore industriale del nemico senza avvicinarsi al fronte.',
    specs: [S('Autonomia', '8.000–12.000 km'), S('Carico', '20–30 t'), S('Conduzione', 'attacco stand-off'), S('Equipaggio', '4–6')],
  },
  trasporto: {
    role: 'Schieramento rapido di uomini e materiali',
    description: 'Aerei da trasporto militare: spostano reparti, veicoli e rifornimenti dove servono, anche su piste corte e non preparate. Sono la logistica della proiezione.',
    specs: [S('Carico', '20–60 t'), S('Autonomia', '4.000–7.000 km'), S('Capacità', '120–300 soldati'), S('Pista', 'corta, non preparata')],
  },
  elicotteri: {
    role: 'Supporto ravvicinato e caccia ai carri',
    description: 'Elicotteri d’attacco che seguono le truppe di terra e colpiscono bersagli corazzati con missili controcarro. Volano bassi, dove l’artiglieria non arriva.',
    specs: [S('Velocità', '250–300 km/h'), S('Armamento', 'cannoni, razzi, controcarro'), S('Equipaggio', '2 + 8'), S('Autonomia', '2–3 h')],
  },
  aew: {
    role: 'Sorveglianza e comando aerotrasportato',
    description: 'Radar volante: vede aerei e navi a centinaia di chilometri e dirige le operazioni dall’alto. Moltiplica l’efficacia di tutti gli altri velivoli.',
    specs: [S('Avvistamento', '300–400 km'), S('Ruolo', 'comando e controllo'), S('Copertura', 'centinaia di km'), S('Autonomia', '8–12 h')],
  },

  // ── Mare ──────────────────────────────────────────────────────────────────
  pattugliatori: {
    role: 'Presidio costiero e controllo delle acque',
    description: 'Unità leggere ed economiche che sorvegliano le coste, fermano i traffici illeciti e mostrano la bandiera lungo le rotte nazionali.',
    specs: [S('Dislocamento', '300–1.000 t'), S('Velocità', '25–30 nodi'), S('Armamento', 'cannone, mitragliere'), S('Autonomia', '2.000–4.000 mn')],
  },
  corvette: {
    role: 'Unità missilistica in acque litoranee',
    description: 'Nave compatta armata con missili antinave: minaccia le flotte nemiche vicino alle proprie coste senza il costo di una nave maggiore.',
    specs: [S('Dislocamento', '1.000–2.500 t'), S('Missili', 'antinave, antiaerei corti'), S('Velocità', '28–32 nodi'), S('Equipaggio', '60–100')],
  },
  fregate: {
    role: 'Scorta di flotta e difesa d’area',
    description: 'Nave multiruolo che protegge un gruppo navale da aerei, navi e sommergibili. È il cavallo di battaglia delle marine che vogliono operare lontano da casa.',
    specs: [S('Dislocamento', '3.000–6.000 t'), S('Armi', 'antiaerea, antinave, antisom'), S('Elicottero', '1 organico'), S('Velocità', '27–30 nodi')],
  },
  cacciatorpediniere: {
    role: 'Difesa di flotta e proiezione missilistica',
    description: 'Grande unità di superficie con radar multifunzione e celle verticali per missili a lungo raggio: scorta la flotta e colpisce bersagli a terra lontano.',
    specs: [S('Dislocamento', '7.000–10.000 t'), S('VLS', 'missili a lungo raggio'), S('Radar', 'AESA multifunzione'), S('Velocità', '30 nodi')],
  },
  sottomarini: {
    role: 'Disuasione e attacco sotto la superficie',
    description: 'Sommergibili convenzionali difficili da individuare: minacciano le rotte e le flotte nemiche restando invisibili. La minaccia che costringe tutti a difendersi.',
    specs: [S('Dislocamento', '1.500–3.000 t immerso'), S('Propulsione', 'diesel-elettrica / AIP'), S('Armi', 'siluri e missili'), S('Profondità', '300 m')],
  },
  portaerei: {
    role: 'Proiezione aerea globale',
    description: 'Nave capitale che porta una forza aerea ovunque: sposta il potere aereo a migliaia di chilometri dalla madrepatria. Richiede una scorta navale dedicata.',
    specs: [S('Dislocamento', '40.000–100.000 t'), S('Gruppo aereo', '30–70 velivoli'), S('Scorta', 'gruppo navale dedicato'), S('Velocità', '30 nodi')],
  },

  // ── Missili ───────────────────────────────────────────────────────────────
  missili_corto: {
    role: 'Attacco tattico oltre la linea del fronte',
    description: 'Missili balistici a corto raggio: colpiscono comandi, depositi e aeroporti poco oltre il fronte. Veloci, difficili da intercettare, ma limitati in distanza.',
    specs: [S('Gittata', '150–500 km'), S('Velocità', 'Mach 4–6'), S('Testata', 'convenzionale'), S('Precisione', 'decine di metri')],
  },
  missili_medio: {
    role: 'Minaccia regionale su basi e città',
    description: 'Missili balistici a medio raggio: tengono sotto tiro un intero teatro regionale e obbligano il nemico a disperdere le forze.',
    specs: [S('Gittata', '1.000–3.000 km'), S('Velocità', 'Mach 5–8'), S('Testata', 'convenzionale o speciale'), S('Intercettazione', 'difficile')],
  },
  cruise: {
    role: 'Attacco di precisione a bassa quota',
    description: 'Missili da crociera che volano radenti al terreno per sfuggire ai radar e colpiscono un bersaglio puntuale con precisione metrica.',
    specs: [S('Gittata', '1.000–2.500 km'), S('Profilo', 'radente, 50–100 m'), S('Precisione', 'metri (GPS/INS)'), S('Velocità', 'Mach 0,7–0,9')],
  },
  antinave: {
    role: 'Negazione del mare',
    description: 'Missili antinave lanciati da navi, batterie costiere o aerei: rendono rischioso avvicinarsi alle coste e possono affondare grandi unità con pochi lanci.',
    specs: [S('Gittata', '100–500 km'), S('Profilo', 'attacco a volo radente'), S('Bersagli', 'fino a incrociatori'), S('Lancio', 'navi, coste, aerei')],
  },
  ipersonici: {
    role: 'Saturazione delle difese',
    description: 'Missili ipersonici manovrati: arrivano a velocità e traiettorie che le difese antiaeree non riescono a seguire. Pochi esemplari cambiano l’equilibrio.',
    specs: [S('Velocità', 'Mach 5+'), S('Traiettoria', 'manovrata'), S('Gittata', '500–2.000 km'), S('Intercettazione', 'molto difficile')],
  },

  // ── Droni ─────────────────────────────────────────────────────────────────
  droni_ricognizione: {
    role: 'Osservazione e designazione dei bersagli',
    description: 'Droni leggeri che osservano il campo di battaglia per ore e indicano dove colpire. Costano poco e tolgono il velo di fronte al nemico.',
    specs: [S('Quota', '3.000–6.000 m'), S('Autonomia', '10–20 h'), S('Sensori', 'ottico e infrarosso'), S('Raggio', '100–200 km')],
  },
  droni_attacco: {
    role: 'Attacco persistente senza rischio per l’equipaggio',
    description: 'Droni armati che restano in area per ore e colpiscono bersagli individuati al momento (UCAV). Nessun pilota a rischio, pressione continua sul nemico.',
    specs: [S('Autonomia', '12–24 h'), S('Armamento', 'missili e bombe guidate'), S('Quota', '5.000–8.000 m'), S('Controllo', 'satellitare')],
  },
  droni_kamikaze: {
    role: 'Saturazione economica delle difese',
    description: 'Munizioni vaganti che cercano il bersaglio e lo colpiscono distruggendosi: costano poco e si lanciano in gran numero contro blindati e radar.',
    specs: [S('Autonomia', '30–60 min'), S('Carica', '3–10 kg'), S('Bersagli', 'blindati, radar, fanteria'), S('Costo', 'basso per unità')],
  },
  droni_navali: {
    role: 'Guerra asimmetrica su superficie e sott’acqua',
    description: 'Imbarcazioni senza equipaggio che pattugliano, attaccano o posano contromisure. Si rischiano senza perdere uomini ed equipaggi addestrati.',
    specs: [S('Dislocamento', '1–50 t'), S('Autonomia', 'giorni'), S('Impiego', 'ricognizione, attacco, contromisure'), S('Equipaggio', 'nessuno')],
  },
  sciame: {
    role: 'Coordinamento autonomo di massa',
    description: 'Sciami di droni che decidono insieme in volo, senza un singolo centro di comando: saturano ogni difesa puntuale attaccando da molte direzioni.',
    specs: [S('Sciame', 'decine–migliaia di unità'), S('Decisione', 'locale, in volo'), S('Bersagli', 'difese aeree, formazioni'), S('Effetto', 'satura ogni difesa puntuale')],
  },
};

const E = (
  id: string, name: string, domain: Domain, category: string, quality: number,
  costMln: number, weaponsCost: number, requires: EquipmentRequirement,
): Equipment => {  const detail = EQUIPMENT_DETAILS[id];
  // Fail-closed: nessun equipaggiamento può esistere senza scheda descrittiva.
  if (!detail) throw new Error(`military_industry_missing_detail: ${id}`);
  return {
    id, name, domain, category, quality, tier: tierForQuality(quality),
    costMln, weaponsCost, requires, ...detail,
  };
};

export const EQUIPMENT_CATALOG: Equipment[] = [  // Terra
  // Armi individuali: **una per soldato** — il catalogo non vende più «lotti»
  // da 40. Il prezzo unitario scende di conseguenza (4 mln per fucile) così il
  // costo di un reparto armato resta quello di prima.
  E('fucili', 'Fucili d’assalto', 'terra', 'Fanteria', 35, 4, 0.02, { techs: ['industria_bellica'], factories: 1 }),
  E('apc', 'Veicoli corazzati da trasporto', 'terra', 'Corazzati', 52, 2_500, 10, { techs: ['industria_bellica', 'meccanica_avanzata'], factories: 2, resources: { iron: 2, coal: 2 } }),
  E('carri_3', 'Carri armati di 3ª generazione', 'terra', 'Corazzati', 62, 8_000, 26, { techs: ['meccanica_avanzata', 'corazzati'], factories: 3, universities: 1, resources: { iron: 3, coal: 3 } }),
  E('carri_4', 'Carri armati di 4ª generazione', 'terra', 'Corazzati', 84, 16_000, 45, { techs: ['corazzati_avanzati', 'elettronica'], factories: 4, universities: 2, resources: { iron: 4, rare_earths: 2 } }),
  E('artiglieria', 'Artiglieria semovente', 'terra', 'Artiglieria', 58, 6_000, 20, { techs: ['meccanica_avanzata'], factories: 3, resources: { iron: 3 } }),
  E('mlrs', 'Lanciarazzi multipli (MLRS)', 'terra', 'Artiglieria', 74, 9_000, 30, { techs: ['missilistica'], factories: 3, universities: 1, resources: { iron: 2, rare_earths: 1 } }),
  E('sam_corto', 'Difesa aerea a corto raggio', 'terra', 'Difesa aerea', 55, 3_500, 14, { techs: ['elettronica'], factories: 2, universities: 1, resources: { rare_earths: 1 } }),
  E('sam_lungo', 'Difesa aerea a lungo raggio', 'terra', 'Difesa aerea', 82, 120_000, 60, { techs: ['missilistica', 'elettronica_avanzata'], factories: 4, universities: 3, resources: { rare_earths: 3 } }),

  // Aria
  E('caccia_3', 'Caccia di 3ª generazione', 'aria', 'Aerei da combattimento', 58, 35_000, 30, { techs: ['aeronautica'], factories: 2, universities: 2, resources: { bauxite: 2, rare_earths: 1 } }),
  E('caccia_4', 'Caccia di 4ª generazione', 'aria', 'Aerei da combattimento', 76, 80_000, 50, { techs: ['aeronautica_avanzata', 'elettronica'], factories: 4, universities: 3, resources: { bauxite: 3, rare_earths: 2 } }),
  E('caccia_5', 'Caccia di 5ª generazione', 'aria', 'Aerei da combattimento', 94, 180_000, 80, { techs: ['aeronautica_avanzata', 'elettronica_avanzata'], factories: 5, universities: 4, resources: { bauxite: 4, rare_earths: 4, lithium: 2 } }),
  E('bombardieri', 'Bombardieri strategici', 'aria', 'Aerei strategici', 80, 250_000, 90, { techs: ['aeronautica_avanzata'], factories: 5, universities: 3, resources: { bauxite: 3, rare_earths: 2 } }),
  E('trasporto', 'Aerei da trasporto militare', 'aria', 'Logistica', 60, 60_000, 20, { techs: ['aeronautica'], factories: 3, universities: 2, resources: { bauxite: 3 } }),
  E('elicotteri', 'Elicotteri d’attacco', 'aria', 'Ala rotante', 72, 45_000, 34, { techs: ['aeronautica', 'elettronica'], factories: 3, universities: 2, resources: { bauxite: 2, rare_earths: 1 } }),
  E('aew', 'Aerei AEW&C (radar volante)', 'aria', 'ISR', 85, 300_000, 60, { techs: ['aeronautica_avanzata', 'elettronica_avanzata'], factories: 4, universities: 4, resources: { bauxite: 3, rare_earths: 3 } }),

  // Mare
  E('pattugliatori', 'Pattugliatori d’altura', 'mare', 'Navale leggera', 45, 25_000, 12, { techs: ['cantieristica'], ports: 2, resources: { iron: 2 } }),
  E('corvette', 'Corvette', 'mare', 'Navale leggera', 64, 90_000, 30, { techs: ['cantieristica', 'missilistica'], ports: 2, factories: 2, resources: { iron: 3 } }),
  E('fregate', 'Fregate multiruolo', 'mare', 'Navale di superficie', 78, 400_000, 60, { techs: ['cantieristica_avanzata', 'missilistica'], ports: 3, factories: 3, universities: 2, resources: { iron: 4, rare_earths: 2 } }),
  E('cacciatorpediniere', 'Cacciatorpediniere', 'mare', 'Navale di superficie', 86, 900_000, 80, { techs: ['cantieristica_avanzata', 'missilistica', 'elettronica_avanzata'], ports: 3, factories: 4, universities: 3, resources: { iron: 4, rare_earths: 3 } }),
  E('sottomarini', 'Sottomarini convenzionali', 'mare', 'Subacquea', 80, 500_000, 70, { techs: ['cantieristica_avanzata', 'elettronica'], ports: 3, factories: 3, universities: 3, resources: { iron: 3, rare_earths: 2 } }),
  E('portaerei', 'Portaerei', 'mare', 'Proiezione', 88, 6_000_000, 180, { techs: ['cantieristica_avanzata', 'aeronautica_avanzata', 'elettronica_avanzata'], ports: 5, factories: 5, universities: 4, resources: { iron: 5, rare_earths: 3 } }),

  // Missili
  E('missili_corto', 'Missili balistici a corto raggio', 'missili', 'Balistico', 66, 30_000, 40, { techs: ['missilistica'], factories: 2, universities: 2, resources: { rare_earths: 2 } }),
  E('missili_medio', 'Missili balistici a medio raggio', 'missili', 'Balistico', 82, 120_000, 70, { techs: ['missilistica_avanzata'], factories: 3, universities: 3, resources: { rare_earths: 3 } }),
  E('cruise', 'Missili da crociera', 'missili', 'Cruise', 84, 40_000, 45, { techs: ['missilistica_avanzata', 'elettronica_avanzata'], factories: 3, universities: 3, resources: { rare_earths: 2 } }),
  E('antinave', 'Missili antinave', 'missili', 'Antinave', 76, 35_000, 35, { techs: ['missilistica', 'elettronica'], factories: 3, universities: 2, resources: { rare_earths: 2 } }),
  E('ipersonici', 'Missili ipersonici', 'missili', 'Ipersonico', 96, 300_000, 90, { techs: ['missilistica_avanzata', 'elettronica_avanzata'], factories: 5, universities: 5, resources: { rare_earths: 5, lithium: 3 } }),

  // Droni
  E('droni_ricognizione', 'Droni da ricognizione', 'droni', 'ISR', 50, 3_000, 8, { techs: ['elettronica'], factories: 1, universities: 1, resources: { rare_earths: 1 } }),
  E('droni_attacco', 'Droni da attacco (UCAV)', 'droni', 'Combattimento', 74, 25_000, 28, { techs: ['elettronica_avanzata', 'aeronautica'], factories: 2, universities: 2, resources: { rare_earths: 2, bauxite: 2 } }),
  E('droni_kamikaze', 'Munizioni vaganti (kamikaze)', 'droni', 'Attacco di saturazione', 78, 8_000, 16, { techs: ['elettronica_avanzata', 'missilistica'], factories: 2, universities: 2, resources: { rare_earths: 2 } }),
  E('droni_navali', 'Droni navali e sottomarini', 'droni', 'Navale senza equipaggio', 82, 15_000, 22, { techs: ['elettronica_avanzata', 'cantieristica'], ports: 2, universities: 3, resources: { rare_earths: 2, iron: 2 } }),
  E('sciame', 'Sciami autonomi di droni', 'droni', 'Autonomia', 93, 40_000, 40, { techs: ['elettronica_avanzata', 'intelligenza_artificiale'], factories: 3, universities: 5, resources: { rare_earths: 4, lithium: 2 } }),
];

/**
 * Organici di catalogo delle unità navali: quanti uomini serve **una** unità.
 * È dato tecnico statico come le `specs` (dislocamento, velocità): senza di
 * esso una nave non ha equipaggio e la marina non ha personale. Le voci non
 * elencate valgono 0 (droni navali: nessun uomo a bordo).
 */
export const EQUIPMENT_CREW: Record<string, number> = {
  pattugliatori: 45,
  corvette: 80,
  fregate: 180,
  cacciatorpediniere: 320,
  sottomarini: 45,
  portaerei: 1_500,
  droni_navali: 0,
};

export function equipmentById(id: string): Equipment | undefined {
  return EQUIPMENT_CATALOG.find(item => item.id === id);
}

export interface NationCapacity {
  factories: number;
  ports: number;
  universities: number;
  technologies: string[];
  money: number;
  weapons: number;
  /** Credito residuo disponibile (mld USD) prima del tetto del debito. */
  credit?: number;
  endowment: NaturalEndowment;
}

export interface ProcurementOption {
  equipment: Equipment;
  canBuild: boolean;
  canBuy: boolean;
  buildCostMln: number;
  buyCostMln: number;
  /** Sconto/sovrapprezzo dovuto alle risorse naturali (0 = nessuno). */
  resourceFactor: number;
  reasons: string[];
}

function missingRequirements(equipment: Equipment, capacity: NationCapacity): string[] {
  const reasons: string[] = [];
  const need = equipment.requires;
  for (const tech of need.techs || []) {
    if (!capacity.technologies.includes(tech)) {
      // Nome leggibile della tecnologia, non l'identificatore interno.
      reasons.push(`manca la tecnologia ${technologyById(tech)?.name || tech}`);
    }
  }
  if ((need.factories || 0) > capacity.factories) reasons.push(`servono ${need.factories} fabbriche (ne hai ${capacity.factories})`);
  if ((need.ports || 0) > capacity.ports) reasons.push(`servono ${need.ports} cantieri o porti (ne hai ${capacity.ports})`);
  if ((need.universities || 0) > capacity.universities) reasons.push(`servono ${need.universities} università (ne hai ${capacity.universities})`);
  for (const [kind, required] of Object.entries(need.resources || {})) {
    const available = capacity.endowment[kind as NaturalResourceKind] || 0;
    if (available < (required || 0)) reasons.push(`risorsa insufficiente: ${NATURAL_RESOURCE_LABELS[kind as NaturalResourceKind]} (hai ${available}, servono ${required})`);
  }
  return reasons;
}

/** Fattore costo legato alle dotazioni: le risorse proprie riducono il prezzo. */
export function resourceCostFactor(equipment: Equipment, endowment: NaturalEndowment): number {
  const required = Object.entries(equipment.requires.resources || {});
  if (!required.length) return 1;
  let bonus = 0;
  for (const [kind, need] of required) {
    const available = endowment[kind as NaturalResourceKind] || 0;
    bonus += Math.min(1, available / Math.max(1, (need || 0) + 2));
  }
  // Fino a −15% con dotazioni abbondanti.
  return Math.round((1 - bonus / required.length * 0.15) * 1000) / 1000;
}

export const IMPORT_MARKUP = 1.6;

export function procurementOption(equipment: Equipment, capacity: NationCapacity): ProcurementOption {
  const reasons = missingRequirements(equipment, capacity);
  const factor = resourceCostFactor(equipment, capacity.endowment);
  const buildCostMln = Math.round(equipment.costMln * factor);
  const buyCostMln = Math.round(equipment.costMln * IMPORT_MARKUP);
  // Potere d'acquisto = cassa disponibile + credito residuo: si può andare a
  // debito. Una tesoreria negativa è debito già contato nel credito residuo,
  // quindi la cassa non può mai sottrarre potere d'acquisto.
  const purchasingPowerMln = Math.max(0, capacity.money) * 1000 + Math.max(0, (capacity.credit || 0) * 1000);
  const affordBuild = purchasingPowerMln >= buildCostMln && capacity.weapons >= equipment.weaponsCost;
  if (!affordBuild) {
    if (purchasingPowerMln < buildCostMln) reasons.push('cassa e credito insufficienti (debito al limite)');
    if (capacity.weapons < equipment.weaponsCost) reasons.push('scorte di armamenti insufficienti');
  }
  const canBuild = reasons.length === 0;
  const canBuy = purchasingPowerMln >= buyCostMln;
  return { equipment, canBuild, canBuy, buildCostMln, buyCostMln, resourceFactor: factor, reasons };
}

/** Valore militare dell'arsenale: somma quantità × qualità × peso di dominio. */
export const DOMAIN_WEIGHT: Record<Domain, number> = { terra: 1, aria: 2.2, mare: 2.4, missili: 3, droni: 1.6 };

/**
 * I cinque domini militari spiegati: cosa coprono e quanto pesano nella forza
 * dell'arsenale. Serve a rendere leggibile il numero `strength` (quantità ×
 * qualità × peso) e a capire cosa si sta comprando.
 */
export interface DomainInfo {
  label: string;
  weight: number;
  description: string;
}

export const DOMAIN_INFO: Record<Domain, DomainInfo> = {
  terra: { label: 'Forze di terra', weight: DOMAIN_WEIGHT.terra, description: 'Fanteria, corazzati, artiglieria e difesa aerea: tengono il terreno e lo conquistano.' },
  aria: { label: 'Aeronautica', weight: DOMAIN_WEIGHT.aria, description: 'Caccia, bombardieri, trasporti e radar volanti: conquistano il cielo e colpiscono in profondità.' },
  mare: { label: 'Marina', weight: DOMAIN_WEIGHT.mare, description: 'Pattugliatori, fregate, sommergibili e portaerei: controllano le rotte e proiettano forza oltremare.' },
  missili: { label: 'Missili', weight: DOMAIN_WEIGHT.missili, description: 'Balistici, da crociera, antinave e ipersonici: colpiscono a distanza senza rischio per gli equipaggi.' },
  droni: { label: 'Droni', weight: DOMAIN_WEIGHT.droni, description: 'Ricognizione, attacco, munizioni vaganti e sciami: pressione continua a costo contenuto.' },
};

/**
 * Contributo di una singola voce alla forza dell'arsenale:
 * `quantità × qualità × peso del dominio / 100`. È la stessa formula di
 * `arsenalStrength`, esposta per riga perché il numero sia interpretabile.
 */
export function equipmentStrength(id: string, quantity: number): number {
  const equipment = equipmentById(id);
  if (!equipment || !Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.round(quantity * equipment.quality * DOMAIN_WEIGHT[equipment.domain]) / 100;
}

export function arsenalStrength(units: Record<string, number>): number {
  let total = 0;
  for (const [id, quantity] of Object.entries(units || {})) {
    const equipment = equipmentById(id);
    if (!equipment || !Number.isFinite(quantity) || quantity <= 0) continue;
    total += quantity * equipment.quality * DOMAIN_WEIGHT[equipment.domain] / 100;
  }
  return Math.round(total * 10) / 10;
}

export interface ArsenalLine {
  equipment: Equipment;
  quantity: number;
}

export function describeArsenal(units: Record<string, number>): ArsenalLine[] {
  return Object.entries(units || {})
    .map(([id, quantity]) => ({ equipment: equipmentById(id), quantity: Number(quantity) }))
    .filter((line): line is ArsenalLine => Boolean(line.equipment) && line.quantity > 0)
    .sort((a, b) => b.quantity * b.equipment.quality - a.quantity * a.equipment.quality);
}

/** Qualità media dell'arsenale, pesata sulle quantità (0–100; 0 se vuoto). */
export function arsenalQualityIndex(units: Record<string, number>): number {
  let quantity = 0;
  let weighted = 0;
  for (const [id, count] of Object.entries(units || {})) {
    const equipment = equipmentById(id);
    if (!equipment || !Number.isFinite(count) || count <= 0) continue;
    quantity += count;
    weighted += equipment.quality * count;
  }
  return quantity > 0 ? Math.round(weighted / quantity) : 0;
}

/**
 * Moltiplicatore di combattimento della nazione in [0.6, 1.6]:
 * unisce la **qualità media** delle armi e la **copertura** rispetto alle forze.
 * Un esercito senza equipaggiamento registrato combatte sotto la sua potenza
 * nominale; un arsenale moderno e capiente la moltiplica.
 */
export function arsenalCombatFactor(units: Record<string, number>, forces: number): number {
  const quality = arsenalQualityIndex(units);
  const equipmentIndex = arsenalStrength(units);
  const expected = Math.max(1, forces) * 1.2;
  const coverage = Math.min(1.5, equipmentIndex / expected);
  const qualityFactor = 0.7 + (quality / 100) * 0.9;        // 0.70 … 1.60
  const coverageFactor = 0.7 + Math.min(1, coverage) * 0.6;  // 0.70 … 1.30
  return Math.round(Math.min(1.6, Math.max(0.6, qualityFactor * coverageFactor)) * 1000) / 1000;
}

/**
 * Perdite di equipaggiamento in battaglia: `intensity` in [0, 0.5] è la frazione
 * persa. Deterministica e quantizzata (mai valori frazionari).
 */
export function combatAttrition(
  units: Record<string, number>, intensity: number,
): { units: Record<string, number>; lost: number } {
  const ratio = Math.min(0.5, Math.max(0, intensity));
  const next: Record<string, number> = {};
  let lost = 0;
  for (const [id, count] of Object.entries(units || {})) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const keep = Math.floor(count * (1 - ratio));
    lost += count - keep;
    if (keep > 0) next[id] = keep;
  }
  return { units: next, lost };
}
