/** Fatti nazionali di riferimento (stime nominali 2024, miliardi USD).
 * Servono a dare una scala leggibile alle statistiche provinciali: il motore
 * conserva e fa evolvere gli indici di produzione, questo registro evita che
 * il PIL mostrato dipenda dal numero arbitrario di province di una mappa. */

const GDP_BN: Record<string, number> = {
  USA: 27360, CHN: 18270, DEU: 4710, JPN: 4210, IND: 3890, GBR: 3590, FRA: 3170,
  ITA: 2380, BRA: 2190, CAN: 2140, RUS: 2060, KOR: 1710, MEX: 1790, AUS: 1720,
  ESP: 1650, IDN: 1370, NLD: 1140, TUR: 1110, SAU: 1080, CHE: 890, POL: 840,
  TWN: 790, BEL: 660, ARG: 640, SWE: 620, IRL: 600, AUT: 520, THA: 550,
  ARE: 530, ISR: 530, SGP: 500, NOR: 500, VNM: 470, PHL: 460, BGD: 460,
  MYS: 430, COL: 420, DNK: 400, ZAF: 380, ROU: 380, EGY: 400, NGA: 360,
  IRN: 400, PAK: 340, CHL: 330, FIN: 310, KAZ: 290, CZE: 340, PRT: 290,
  PER: 270, IRQ: 260, NZL: 260, GRC: 250, QAT: 220, DZA: 240, HUN: 210,
  UKR: 190, MAR: 150, ETH: 160, KEN: 120, PSE: 18,
};

const GOVERNMENTS: Record<string, string> = {
  PSE: 'Autorità nazionale palestinese', USA: 'Repubblica federale presidenziale',
  DEU: 'Repubblica federale parlamentare', AUT: 'Repubblica federale parlamentare',
  CHE: 'Repubblica federale direttoriale', RUS: 'Repubblica federale semipresidenziale',
  BRA: 'Repubblica federale presidenziale', IND: 'Repubblica federale parlamentare',
  PAK: 'Repubblica federale parlamentare', MEX: 'Repubblica federale presidenziale',
  CAN: 'Monarchia costituzionale federale', AUS: 'Monarchia costituzionale federale',
  BEL: 'Monarchia costituzionale federale', ARE: 'Federazione di monarchie ereditarie',
  GBR: 'Monarchia parlamentare', ESP: 'Monarchia parlamentare', JPN: 'Monarchia costituzionale parlamentare',
  NLD: 'Monarchia costituzionale parlamentare', DNK: 'Monarchia costituzionale parlamentare',
  NOR: 'Monarchia costituzionale parlamentare', SWE: 'Monarchia costituzionale parlamentare',
  THA: 'Monarchia costituzionale', MYS: 'Monarchia costituzionale federale', JOR: 'Monarchia costituzionale',
  MAR: 'Monarchia costituzionale', SAU: 'Monarchia assoluta', OMN: 'Monarchia assoluta',
  QAT: 'Monarchia assoluta', BHR: 'Monarchia costituzionale', BRN: 'Monarchia assoluta',
  CHN: 'Repubblica popolare a partito unico', VNM: 'Repubblica socialista a partito unico',
  LAO: 'Repubblica popolare a partito unico', PRK: 'Stato socialista a partito unico',
  CUB: 'Repubblica socialista a partito unico', FRA: 'Repubblica semipresidenziale',
  ITA: 'Repubblica parlamentare', KOR: 'Repubblica presidenziale', IDN: 'Repubblica presidenziale',
  TUR: 'Repubblica presidenziale', ISR: 'Repubblica parlamentare', IRL: 'Repubblica parlamentare',
  NZL: 'Monarchia costituzionale parlamentare', ZAF: 'Repubblica parlamentare',
};

const HIGH_INCOME = new Set([
  'AND','AUS','AUT','BEL','BHR','BRN','CAN','CHE','CHL','CYP','CZE','DEU','DNK','ESP','EST','FIN','FRA','GBR','GRC','HKG','HRV','IRL','ISL','ISR','ITA','JPN','KOR','KWT','LUX','LVA','MLT','NLD','NOR','NZL','OMN','POL','PRT','QAT','SAU','SGP','SVK','SVN','SWE','TWN','ARE','USA','URY',
]);
const LOWER_INCOME = new Set([
  'AFG','BDI','BEN','BFA','CAF','COD','ERI','ETH','GMB','GIN','GNB','HTI','LBR','MDG','MLI','MOZ','MWI','NER','PRK','RWA','SDN','SLE','SOM','SSD','SYR','TCD','TGO','UGA','YEM',
]);

const ITALIAN_POLITY_NAMES: Record<string, string> = {
  PSE: 'Palestina', USA: 'Stati Uniti', GBR: 'Regno Unito', DEU: 'Germania',
  FRA: 'Francia', ITA: 'Italia', RUS: 'Russia', CHN: 'Cina', JPN: 'Giappone',
  KOR: 'Corea del Sud', PRK: 'Corea del Nord', ARE: 'Emirati Arabi Uniti',
  SAU: 'Arabia Saudita', CHE: 'Svizzera', NLD: 'Paesi Bassi', CZE: 'Cechia',
};

export function governmentForPolity(polityId: string): string {
  return Object.prototype.hasOwnProperty.call(GOVERNMENTS, polityId) ? GOVERNMENTS[polityId] : 'Forma di governo non registrata';
}

export function polityDisplayNameIt(polityId: string, fallback?: string): string {
  return Object.prototype.hasOwnProperty.call(ITALIAN_POLITY_NAMES, polityId) ? ITALIAN_POLITY_NAMES[polityId] : fallback || polityId;
}

export function estimatedNominalGdpUsdBillions(polityId: string, population: number): number {
  if (Object.prototype.hasOwnProperty.call(GDP_BN, polityId)) return GDP_BN[polityId];
  const incomePerCapita = HIGH_INCOME.has(polityId) ? 32_000 : LOWER_INCOME.has(polityId) ? 2_000 : 9_500;
  return Math.max(1, Math.round((population * incomePerCapita / 1_000_000_000) * 10) / 10);
}
