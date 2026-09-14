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

export interface Equipment {
  id: string;
  name: string;
  domain: Domain;
  category: string;
  quality: number;
  tier: QualityTier;
  /** Costo unitario in milioni di USD (la tesoreria è in miliardi). */
  costMln: number;
  /** Consumo di scorte di armamenti per unità costruita. */
  weaponsCost: number;
  requires: EquipmentRequirement;
  notes: string;
}

const E = (
  id: string, name: string, domain: Domain, category: string, quality: number,
  costMln: number, weaponsCost: number, requires: EquipmentRequirement, notes: string,
): Equipment => ({ id, name, domain, category, quality, tier: tierForQuality(quality), costMln, weaponsCost, requires, notes });

export const EQUIPMENT_CATALOG: Equipment[] = [
  // Terra
  E('fucili', 'Fucili d’assalto', 'terra', 'Fanteria', 35, 800, 4, { techs: ['industria_bellica'], factories: 1 }, 'Armi individuali per la fanteria di linea.'),
  E('apc', 'Veicoli corazzati da trasporto', 'terra', 'Corazzati', 52, 2_500, 10, { techs: ['industria_bellica', 'meccanica_avanzata'], factories: 2, resources: { iron: 2, coal: 2 } }, 'Protezione e mobilità per la fanteria meccanizzata.'),
  E('carri_3', 'Carri armati di 3ª generazione', 'terra', 'Corazzati', 62, 8_000, 26, { techs: ['meccanica_avanzata', 'corazzati'], factories: 3, universities: 1, resources: { iron: 3, coal: 3 } }, 'Piattaforma corazzata matura, manutenzione consolidata.'),
  E('carri_4', 'Carri armati di 4ª generazione', 'terra', 'Corazzati', 84, 16_000, 45, { techs: ['corazzati_avanzati', 'elettronica'], factories: 4, universities: 2, resources: { iron: 4, rare_earths: 2 } }, 'Corazzatura composita, sensori e rete dati integrata.'),
  E('artiglieria', 'Artiglieria semovente', 'terra', 'Artiglieria', 58, 6_000, 20, { techs: ['meccanica_avanzata'], factories: 3, resources: { iron: 3 } }, 'Fuoco indiretto mobile a supporto delle manovre.'),
  E('mlrs', 'Lanciarazzi multipli (MLRS)', 'terra', 'Artiglieria', 74, 9_000, 30, { techs: ['missilistica'], factories: 3, universities: 1, resources: { iron: 2, rare_earths: 1 } }, 'Saturazione d’area a media gittata.'),
  E('sam_corto', 'Difesa aerea a corto raggio', 'terra', 'Difesa aerea', 55, 3_500, 14, { techs: ['elettronica'], factories: 2, universities: 1, resources: { rare_earths: 1 } }, 'Contrasto a velivoli e droni a bassa quota.'),
  E('sam_lungo', 'Difesa aerea a lungo raggio', 'terra', 'Difesa aerea', 82, 120_000, 60, { techs: ['missilistica', 'elettronica_avanzata'], factories: 4, universities: 3, resources: { rare_earths: 3 } }, 'Scudo strategico contro aerei e missili balistici.'),

  // Aria
  E('caccia_3', 'Caccia di 3ª generazione', 'aria', 'Aerei da combattimento', 58, 35_000, 30, { techs: ['aeronautica'], factories: 2, universities: 2, resources: { bauxite: 2, rare_earths: 1 } }, 'Intercettore multiruolo di generazione precedente.'),
  E('caccia_4', 'Caccia di 4ª generazione', 'aria', 'Aerei da combattimento', 76, 80_000, 50, { techs: ['aeronautica_avanzata', 'elettronica'], factories: 4, universities: 3, resources: { bauxite: 3, rare_earths: 2 } }, 'Avionica digitale, armi guidate e supercrociera parziale.'),
  E('caccia_5', 'Caccia di 5ª generazione', 'aria', 'Aerei da combattimento', 94, 180_000, 80, { techs: ['aeronautica_avanzata', 'elettronica_avanzata'], factories: 5, universities: 4, resources: { bauxite: 4, rare_earths: 4, lithium: 2 } }, 'Stealth, fusione sensori e superiorità aerea.'),
  E('bombardieri', 'Bombardieri strategici', 'aria', 'Aerei strategici', 80, 250_000, 90, { techs: ['aeronautica_avanzata'], factories: 5, universities: 3, resources: { bauxite: 3, rare_earths: 2 } }, 'Proiezione di potenza a lungo raggio.'),
  E('trasporto', 'Aerei da trasporto militare', 'aria', 'Logistica', 60, 60_000, 20, { techs: ['aeronautica'], factories: 3, universities: 2, resources: { bauxite: 3 } }, 'Schieramento rapido di truppe e materiali.'),
  E('elicotteri', 'Elicotteri d’attacco', 'aria', 'Ala rotante', 72, 45_000, 34, { techs: ['aeronautica', 'elettronica'], factories: 3, universities: 2, resources: { bauxite: 2, rare_earths: 1 } }, 'Supporto ravvicinato e caccia ai carri.'),
  E('aew', 'Aerei AEW&C (radar volante)', 'aria', 'ISR', 85, 300_000, 60, { techs: ['aeronautica_avanzata', 'elettronica_avanzata'], factories: 4, universities: 4, resources: { bauxite: 3, rare_earths: 3 } }, 'Sorveglianza e comando aerotrasportato.'),

  // Mare
  E('pattugliatori', 'Pattugliatori d’altura', 'mare', 'Navale leggera', 45, 25_000, 12, { techs: ['cantieristica'], ports: 2, resources: { iron: 2 } }, 'Presidio costiero e controllo delle acque.'),
  E('corvette', 'Corvette', 'mare', 'Navale leggera', 64, 90_000, 30, { techs: ['cantieristica', 'missilistica'], ports: 2, factories: 2, resources: { iron: 3 } }, 'Unità missilistica compatta per acque litoranee.'),
  E('fregate', 'Fregate multiruolo', 'mare', 'Navale di superficie', 78, 400_000, 60, { techs: ['cantieristica_avanzata', 'missilistica'], ports: 3, factories: 3, universities: 2, resources: { iron: 4, rare_earths: 2 } }, 'Scorta, antiaerea e antisommergibile.'),
  E('cacciatorpediniere', 'Cacciatorpediniere', 'mare', 'Navale di superficie', 86, 900_000, 80, { techs: ['cantieristica_avanzata', 'missilistica', 'elettronica_avanzata'], ports: 3, factories: 4, universities: 3, resources: { iron: 4, rare_earths: 3 } }, 'Difesa di flotta e proiezione missilistica.'),
  E('sottomarini', 'Sottomarini convenzionali', 'mare', 'Subacquea', 80, 500_000, 70, { techs: ['cantieristica_avanzata', 'elettronica'], ports: 3, factories: 3, universities: 3, resources: { iron: 3, rare_earths: 2 } }, 'Disuasione e attacco sotto la superficie.'),
  E('portaerei', 'Portaerei', 'mare', 'Proiezione', 88, 6_000_000, 180, { techs: ['cantieristica_avanzata', 'aeronautica_avanzata', 'elettronica_avanzata'], ports: 5, factories: 5, universities: 4, resources: { iron: 5, rare_earths: 3 } }, 'Piattaforma di proiezione aerea globale.'),

  // Missili
  E('missili_corto', 'Missili balistici a corto raggio', 'missili', 'Balistico', 66, 30_000, 40, { techs: ['missilistica'], factories: 2, universities: 2, resources: { rare_earths: 2 } }, 'Attacco tattico oltre la linea del fronte.'),
  E('missili_medio', 'Missili balistici a medio raggio', 'missili', 'Balistico', 82, 120_000, 70, { techs: ['missilistica_avanzata'], factories: 3, universities: 3, resources: { rare_earths: 3 } }, 'Minaccia regionale contro basi e città.'),
  E('cruise', 'Missili da crociera', 'missili', 'Cruise', 84, 40_000, 45, { techs: ['missilistica_avanzata', 'elettronica_avanzata'], factories: 3, universities: 3, resources: { rare_earths: 2 } }, 'Attacco di precisione a bassa quota.'),
  E('antinave', 'Missili antinave', 'missili', 'Antinave', 76, 35_000, 35, { techs: ['missilistica', 'elettronica'], factories: 3, universities: 2, resources: { rare_earths: 2 } }, 'Negazione del mare contro flotte nemiche.'),
  E('ipersonici', 'Missili ipersonici', 'missili', 'Ipersonico', 96, 300_000, 90, { techs: ['missilistica_avanzata', 'elettronica_avanzata'], factories: 5, universities: 5, resources: { rare_earths: 5, lithium: 3 } }, 'Velocità e manovra che saturano le difese.'),

  // Droni
  E('droni_ricognizione', 'Droni da ricognizione', 'droni', 'ISR', 50, 3_000, 8, { techs: ['elettronica'], factories: 1, universities: 1, resources: { rare_earths: 1 } }, 'Osservazione e designazione di bersagli.'),
  E('droni_attacco', 'Droni da attacco (UCAV)', 'droni', 'Combattimento', 74, 25_000, 28, { techs: ['elettronica_avanzata', 'aeronautica'], factories: 2, universities: 2, resources: { rare_earths: 2, bauxite: 2 } }, 'Attacco persistente senza rischio per l’equipaggio.'),
  E('droni_kamikaze', 'Munizioni vaganti (kamikaze)', 'droni', 'Attacco di saturazione', 78, 8_000, 16, { techs: ['elettronica_avanzata', 'missilistica'], factories: 2, universities: 2, resources: { rare_earths: 2 } }, 'Saturazione economica di difese e blindati.'),
  E('droni_navali', 'Droni navali e sottomarini', 'droni', 'Navale senza equipaggio', 82, 15_000, 22, { techs: ['elettronica_avanzata', 'cantieristica'], ports: 2, universities: 3, resources: { rare_earths: 2, iron: 2 } }, 'Guerra asimmetrica su superficie e sott’acqua.'),
  E('sciame', 'Sciami autonomi di droni', 'droni', 'Autonomia', 93, 40_000, 40, { techs: ['elettronica_avanzata', 'intelligenza_artificiale'], factories: 3, universities: 5, resources: { rare_earths: 4, lithium: 2 } }, 'Coordinamento autonomo di massa in combattimento.'),
];

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
    if (!capacity.technologies.includes(tech)) reasons.push(`tecnologia mancante: ${tech}`);
  }
  if ((need.factories || 0) > capacity.factories) reasons.push(`fabbriche insufficienti (${capacity.factories}/${need.factories})`);
  if ((need.ports || 0) > capacity.ports) reasons.push(`cantieri/porti insufficienti (${capacity.ports}/${need.ports})`);
  if ((need.universities || 0) > capacity.universities) reasons.push(`università insufficienti (${capacity.universities}/${need.universities})`);
  for (const [kind, required] of Object.entries(need.resources || {})) {
    const available = capacity.endowment[kind as NaturalResourceKind] || 0;
    if (available < (required || 0)) reasons.push(`risorsa insufficiente: ${NATURAL_RESOURCE_LABELS[kind as NaturalResourceKind]} (${available}/${required})`);
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
  const affordBuild = capacity.money * 1000 >= buildCostMln && capacity.weapons >= equipment.weaponsCost;
  if (!affordBuild) {
    if (capacity.money * 1000 < buildCostMln) reasons.push('tesoreria insufficiente');
    if (capacity.weapons < equipment.weaponsCost) reasons.push('scorte di armamenti insufficienti');
  }
  const canBuild = reasons.length === 0;
  const canBuy = capacity.money * 1000 >= buyCostMln;
  return { equipment, canBuild, canBuy, buildCostMln, buyCostMln, resourceFactor: factor, reasons };
}

/** Valore militare dell'arsenale: somma quantità × qualità × peso di dominio. */
export const DOMAIN_WEIGHT: Record<Domain, number> = { terra: 1, aria: 2.2, mare: 2.4, missili: 3, droni: 1.6 };

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
