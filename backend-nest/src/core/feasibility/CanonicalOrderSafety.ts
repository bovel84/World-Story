/** Negative safety gate for free-form acts, NOT a text-to-effect interpreter.
 * Only canonical object types prove existence. Names/aggregates never seed assets.
 * Deliberately bounded IT/EN reference recognition; passing is not proof that an
 * unstructured act has a verified route, cost, material bill or execution effect.
 */
import type { Blocker } from './FeasibilityService';
import { CANONICAL_ASSET_LABEL, canonicalAssetKind, type CanonicalAssetKind } from '../simulation/CanonicalAssetTypes';
import { equipmentById } from '../simulation/MilitaryIndustry';

export interface CanonicalOrderRegion {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly objects: readonly unknown[];
}
export interface CanonicalOrderWorld {
  readonly regions: readonly CanonicalOrderRegion[];
  readonly operationalObjects: readonly { readonly id: string; readonly kind: string; readonly data: Readonly<Record<string, unknown>> }[];
  /** Vista read-only dell'arsenale canonico della polity (quantità possedute
   *  per equipment ID). `undefined` = fonte non letta/disponibile; presente
   *  (anche `{}`) = autoritativa: zero è zero, non "dato mancante". */
  readonly arsenalUnits?: Readonly<Record<string, number>>;
}
type AssetKind = CanonicalAssetKind;
interface Asset { readonly id: string; readonly name: string; readonly regionName?: string; }
type Inventory = Record<AssetKind, Asset[]>;
const record = (value: unknown): Readonly<Record<string, unknown>> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const normalize = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// WS-GOV-REALITY-ADVISOR-HARDENING — nessun alias duplicato: la stessa fonte
// unica (`canonicalAssetKind`) di `VerifiedWorldSnapshot`.
const TYPES = { get: (type: string): AssetKind | undefined => canonicalAssetKind(type) };
const unavailable = (data: Readonly<Record<string, unknown>>): boolean => {
  const metadata = record(data.metadata);
  return ['under_construction', 'planned', 'destroyed', 'decommissioned', 'cancelled'].includes(text(data.status || metadata.status));
};
const belongs = (data: Readonly<Record<string, unknown>>, polityId: string): boolean => {
  const metadata = record(data.metadata);
  const owner = text(data.polityId || data.owner || metadata.polityId || metadata.owner);
  return !owner || owner === polityId;
};

// WS-GOV-MILITARY-PREFLIGHT — un ordine ESPLICITO che usa una capacità militare
// richiede l'asset canonico di QUEL dominio sotto il nostro controllo. Solo
// forme direttive (imperativo/1ª persona, ordine esplicito); ipotesi, domande,
// negazioni e analisi restano discussione, non esecuzione. Nessun LLM.
const LAND_ATTACK = new RegExp(
  '\\b(?:attacchiamo|attaccate|attacca|invadiamo|invadete|invade|invado)\\b'
  + '|\\b(?:attack|attacks|invade|invades)\\b'
  + '|\\b(?:ordina|ordino|ordinate|ordiniamo|disponi|dispone|disponiamo)\\b[^.;!\\n]{0,40}\\b(?:attaccare|invadere)\\b'
  + '|\\b(?:lanciamo|lanciate|sferriamo|sferra|avviamo)\\b[^.;!\\n]{0,30}\\b(?:offensiv|attacc|invasion)\\w*\\b',
);
const ATTACK_HYPOTHESIS = /\b(?:se|qualora|caso|potremmo|potrei|potrebbe|dovremmo|valutiamo|valutare|valutazione|discutiamo|discutere|discussione|ipotesi|forse|conviene|consideriamo|considerare|pianifich\w*|strategia|analis\w*|analizz\w*|chied\w*)\b/;
const ATTACK_NEGATION = /\b(?:non|senza|evitare|evita|evitiamo|mai)\b/;
const QUESTION_START = /^\s*(?:come|quale|quali|quando|dove|perch[eè]|quanto|quanta|chi|cosa|che\s+cosa|how|what|when|where|why|which|who|whether)\b/;
// Un attacco che nomina una piattaforma navale/missilistica/aerea non implica
// forze terrestri: la guardia terrestre lo lascia al suo dominio.
const NON_LAND_PLATFORM = /\b(?:flott\w*|marin\w*|nav[ei]|navy|ships?|missil\w*|dron\w*|aer[ei]|avi\w+|air\s?force)\b/;
// Lessici di dominio e verbi direttivi. I sostantivi da soli non bastano:
// serve un verbo d'uso/ordine esplicito.
const NAVAL_LEWIS = /\b(?:flott\w*|marin\w*|nav[ei]|navy|ships?|warships?)\b/;
const MISSILE_LEWIS = /\b(?:missil\w*|missiles?)\b/;
const AIR_LEWIS = /\b(?:avi\w+|aeronautic\w*|aer[ei]|air\s?force|bombardier\w*|caccia|elicotter\w*)\b/;
const DRONE_LEWIS = /\b(?:dron\w*|ucav|uav|aeromobil\w*)\b/;
const DOMAIN_ACTION = /\b(?:usa|usare|usiamo|usate|use|using|utilizz\w*|impieg\w*|schier\w*|mand\w*|invi\w*|mobilit\w*|deploy|send|lanci\w*|sferr\w*|attacc\w*|invad\w*|ordin\w*|dispon\w*)\b/;
/** Stati che non provano un reparto utilizzabile (mai inventare quantita'). */
const NON_OPERATIONAL_LAND = new Set(['under_construction', 'planned', 'destroyed', 'decommissioned', 'cancelled', 'forming', 'mobilizing']);
const LAND_FORMATION_TYPES = new Set(['army', 'battalion']);

/** Una domanda non è un ordine: non deve mai produrre un blocker esecutivo. */
function isQuestion(original: string | undefined): boolean {
  return !!original && (original.includes('?') || QUESTION_START.test(normalize(original)));
}

/** Forma direttiva di attacco terrestre, distinta da ipotesi, negazione o discussione. */
function attackDirective(clause: string, question: boolean): boolean {
  if (question) return false;
  const match = LAND_ATTACK.exec(clause);
  if (!match) return false;
  const before = clause.slice(0, match.index);
  return !ATTACK_HYPOTHESIS.test(before) && !ATTACK_NEGATION.test(before) && !NON_LAND_PLATFORM.test(clause);
}

/** Ordine esplicito d'uso di un dominio militare: verbo direttivo + lessico. */
function domainDirective(clause: string, question: boolean, lexis: RegExp): boolean {
  if (question) return false;
  const action = DOMAIN_ACTION.exec(clause);
  if (!action) return false;
  const lex = lexis.exec(clause);
  if (!lex) return false;
  const before = clause.slice(0, Math.min(action.index, lex.index));
  return !ATTACK_HYPOTHESIS.test(before) && !ATTACK_NEGATION.test(before);
}

// ——— Arsenale canonico (unica fonte delle quantità possedute) ———
/** L'arsenale canonico è leggibile? Distingue zero da dato non disponibile. */
function arsenalRead(world: CanonicalOrderWorld): boolean {
  return world.arsenalUnits !== undefined;
}
/** Il dominio ha almeno un equipaggiamento con quantità > 0. Il `domain` viene
 *  dal catalogo reale (`equipmentById`), mai da liste hardcoded. */
function arsenalHasDomain(world: CanonicalOrderWorld, domain: string): boolean {
  const units = world.arsenalUnits;
  if (!units) return false;
  return Object.entries(units).some(([id, quantity]) => {
    const count = Number(quantity);
    return Number.isFinite(count) && count > 0 && equipmentById(id)?.domain === domain;
  });
}

/** Reparto terrestre operativo con uomini: un `unit` senza personale non conta. */
function usableLandUnits(world: CanonicalOrderWorld, polityId: string): boolean {
  return world.operationalObjects.some(row => {
    if (row.kind !== 'unit' || !belongs(row.data, polityId)
      || NON_OPERATIONAL_LAND.has(text(row.data.status))) return false;
    const personnel = Number(row.data.personnel);
    return Number.isFinite(personnel) && personnel > 0;
  });
}

/** Formazioni di mappa `army`/`battalion`: SOLO fallback pre-materializzazione. */
function mapFormation(world: CanonicalOrderWorld, polityId: string): boolean {
  for (const region of world.regions) {
    if (region.owner !== polityId) continue;
    for (const raw of region.objects) {
      const object = record(raw);
      if (!LAND_FORMATION_TYPES.has(text(object.type)) || !belongs(object, polityId)) continue;
      const metadata = record(object.metadata);
      if (unavailable(object) || NON_OPERATIONAL_LAND.has(text(object.status || metadata.status))) continue;
      return true;
    }
  }
  return false;
}

/** Il registro operativo dei reparti è materializzato per la polity? */
function landRegistryMaterialized(world: CanonicalOrderWorld, polityId: string): boolean {
  const personnel = world.operationalObjects.find(row => row.kind === 'personnel' && row.id === polityId);
  if (!personnel) return false;
  const registries = personnel.data.unitRegistryPolities;
  if (Array.isArray(registries)) return registries.some(id => String(id) === polityId);
  // Riga senza marcatore durevole: solo un reparto vivo prova la materializzazione.
  return usableLandUnits(world, polityId);
}

/** Il registro materializzato conserva almeno una traccia non distrutta di reparto? */
function registryHasLivingUnitRecord(world: CanonicalOrderWorld, polityId: string): boolean {
  return world.operationalObjects.some(row => row.kind === 'unit' && belongs(row.data, polityId)
    && text(row.data.status) !== 'destroyed');
}

/** Capacità terrestre: il registro materializzato VINCE sulla mappa quando
 *  prova che la forza non esiste più (nessun reparto o solo reparti distrutti).
 *  Se il registro è assente o conserva reparti (anche in formazione), i
 *  vecchi `army`/`battalion` di mappa restano un fallback canonico. */
function hasLandForce(world: CanonicalOrderWorld, polityId: string): boolean {
  if (usableLandUnits(world, polityId)) return true;
  if (landRegistryMaterialized(world, polityId) && !registryHasLivingUnitRecord(world, polityId)) return false;
  return mapFormation(world, polityId);
}

/** Capacità missilistica pre-materializzazione: oggetto di mappa `missile`. */
function mapMissilePresent(world: CanonicalOrderWorld, polityId: string): boolean {
  for (const region of world.regions) {
    if (region.owner !== polityId) continue;
    for (const raw of region.objects) {
      const object = record(raw);
      if (text(object.type) !== 'missile' || !belongs(object, polityId)) continue;
      const metadata = record(object.metadata);
      if (unavailable(object) || NON_OPERATIONAL_LAND.has(text(object.status || metadata.status))) continue;
      return true;
    }
  }
  return false;
}

function inventoryFor(world: CanonicalOrderWorld, polityId: string): Inventory {
  const inventory: Inventory = { port: [], railway: [], road: [], airfield: [], factory: [], fleet: [] };
  for (const region of world.regions) {
    if (region.owner !== polityId) continue;
    for (const raw of region.objects) {
      const object = record(raw);
      const kind = TYPES.get(text(object.type));
      if (!kind || !belongs(object, polityId) || unavailable(object)) continue;
      // Generic `infrastructure` and construction-site labels are NOT types.
      inventory[kind].push({ id: text(object.id), name: text(object.name), regionName: region.name });
    }
  }
  const ships = world.operationalObjects.filter(row => row.kind === 'ship' && belongs(row.data, polityId) && !unavailable(row.data));
  const shipIds = new Set(ships.map(row => row.id));
  for (const row of world.operationalObjects) {
    if (!belongs(row.data, polityId) || unavailable(row.data)) continue;
    const kind = row.kind === 'facility' ? TYPES.get(text(row.data.kind)) : TYPES.get(row.kind);
    if (!kind) continue;
    // A fleet container (or ships still being built) cannot prove a navy.
    if (row.kind === 'fleet' && !(Array.isArray(row.data.shipIds) && row.data.shipIds.some(id => shipIds.has(String(id))))) continue;
    const region = world.regions.find(item => item.id === row.data.regionId);
    if (row.kind === 'facility' && region && region.owner !== polityId) continue;
    inventory[kind].push({ id: row.id, name: text(row.data.name), regionName: region?.name });
  }
  return inventory;
}

const REFERENCES: Readonly<Record<AssetKind, RegExp>> = {
  port: /\b(?:port[oi]|ports?|scal[oi] portual[ei])\b/g,
  railway: /\b(?:ferrovi[ae]|ferroviar[ioae]+|railways?|railroads?|rail)\b/g,
  road: /\b(?:strad[ae]|roads?)\b/g,
  airfield: /\b(?:aeroport[oi]|aerodrom[oi]|airfields?|airports?|airbases?|bas[ei] aere[ae])\b/g,
  factory: /\b(?:fabbric[ah][e]?|stabiliment[oi]|factor(?:y|ies))\b/g,
  fleet: /\b(?:flott[ae]|marina|nav[ei]|fleets?|navy|ships?)\b/g,
};
const ACTIONS = /\b(?:costru\w*|realizz\w*|edific\w*|crea\w*|build|construct|establish|usa|usare|usiamo|usate|use|using|utilizz\w*|sfrutt\w*|impieg\w*|ampli\w*|espand\w*|potenzi\w*|rinnov\w*|expand|upgrade|operate|mand\w*|invi\w*|schier\w*|mobilit\w*|send|deploy|trasport\w*|trasfer\w*|transport|priorita|priority)\b/g;
const NEW_ACTION = /^(?:costru|realizz|edific|crea|build|construct|establish)/;
const EXISTING = /\b(?:esistent[ei]|esiste|existing|attual[ei]|gia operativ[oaie])\b/;
const LABELS = CANONICAL_ASSET_LABEL;

/** Extract only explicit `porto di X`/`port of X` references. No geographic
 * knowledge or fuzzy resolver: named references must match canonical names. */
function namedTarget(suffix: string): string | undefined {
  const match = /^\s+(?:di|of|at)\s+(.+)$/.exec(suffix);
  if (!match) return undefined;
  return match[1].split(/\s+(?:per|con|verso|e|for|with|to|and)\s+/)[0].replace(/["“”]/g, '').trim();
}
const CARDINALS = /\b(?:nord|sud|est|ovest|nord-?est|nord-?ovest|sud-?est|sud-?ovest)\b/i;
/** Sequenze di parole in maiuscolo nella clausola, senza il verbo iniziale e
 * senza le parole-tipo: sono nomi propri candidati, non prove di per sé. */
function properNouns(clause: string): string[] {
  const words = clause.trim().split(/\s+/);
  const names: string[] = [];
  let current: string[] = [];
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]!.replace(/[.,;:!?»«]/g, '');
    if (/^[A-ZÀ-Ý][\p{L}\p{N}'’-]*$/u.test(word) && !CARDINALS.test(word)
      && !/^(?:porto|ferrovia|flotta|aeroporto|fabbrica|ports?|railways?|fleets?|navy)$/i.test(word)) {
      current.push(word);
    } else {
      if (current.length) names.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) names.push(current.join(' '));
  return names;
}
function nameMatches(target: string, asset: Asset): boolean {
  const strip = (value: string) => normalize(value).replace(/\b(?:porto|port|ferrovia|railway|flotta|fleet|aeroporto|airport)\b/g, '').replace(/\s+/g, ' ').trim();
  return [asset.name, asset.id, asset.regionName ?? ''].some(value => strip(value) === strip(target));
}

export function canonicalOrderBlockers(textValue: string, polityId: string, world: CanonicalOrderWorld, constructionRegionId?: string): Blocker[] {
  const blockers: Blocker[] = [];
  if (constructionRegionId !== undefined) {
    const region = world.regions.find(item => item.id === constructionRegionId);
    if (!region) blockers.push({ code: 'UNKNOWN_ENTITY', targetId: constructionRegionId, field: 'work.regionId', detail: 'La regione dell’opera non esiste nella mappa canonica.' });
    else if (region.owner !== polityId) blockers.push({ code: 'UNAUTHORIZED_ACTOR', targetId: region.id, field: 'work.regionId', detail: 'La regione dell’opera non è sotto il controllo della nazione del giocatore.' });
  }
  const inventory = inventoryFor(world, polityId);
  const seen = new Set<AssetKind>();
  // La normalizzazione perde le maiuscole: i nomi propri si leggono dalla
  // clausola ORIGINALE alla stessa posizione.
  const originalClauses = textValue.split(/[.;!\n]/);
  const clauses = normalize(textValue).split(/[.;!\n]/);
  const questions = clauses.map((_, index) => isQuestion(originalClauses[index]));
  const landDirective = clauses.some((clause, index) => attackDirective(clause, questions[index]!));
  const navalDirective = clauses.some((clause, index) => domainDirective(clause, questions[index]!, NAVAL_LEWIS));
  const missileDirective = clauses.some((clause, index) => domainDirective(clause, questions[index]!, MISSILE_LEWIS));
  const airDirective = clauses.some((clause, index) => domainDirective(clause, questions[index]!, AIR_LEWIS));
  const droneDirective = clauses.some((clause, index) => domainDirective(clause, questions[index]!, DRONE_LEWIS));
  if (landDirective && !hasLandForce(world, polityId)) {
    blockers.push({ code: 'MILITARY_ASSET_MISSING', field: 'military.landForces', detail: 'L’atto ordina un attacco terrestre, ma nessun reparto terrestre canonico risulta disponibile sotto il nostro controllo.' });
  }
  // Mare: nave/flotta operativa autoritativa; l'arsenale integra gli asset
  // navali non ancora materializzati (domain `mare` dal catalogo reale).
  if (navalDirective && inventory.fleet.length === 0 && !arsenalHasDomain(world, 'mare')) {
    blockers.push({ code: 'MILITARY_ASSET_MISSING', field: 'military.navalAssets', detail: 'L’atto impiega una forza navale, ma nessuna nave o flotta canonica risulta disponibile sotto il nostro controllo.' });
  }
  if (missileDirective) {
    // L'arsenale canonico è la fonte primaria; l'oggetto di mappa `missile`
    // resta una fonte canonica concorrente. Distingue zero da fonte assente.
    const capability = arsenalHasDomain(world, 'missili') || mapMissilePresent(world, polityId);
    if (!capability) blockers.push(arsenalRead(world)
      ? { code: 'MILITARY_ASSET_MISSING', field: 'military.missileAssets', detail: 'L’atto impiega capacità missilistica, ma l’arsenale canonico non registra alcun equipaggiamento missilistico sotto il nostro controllo.' }
      : { code: 'DATA_UNAVAILABLE', field: 'military.missileAssets', detail: 'L’atto impiega capacità missilistica, ma la fonte canonica dell’arsenale non è leggibile: dato non disponibile.' });
  }
  if (airDirective) {
    if (!arsenalRead(world)) blockers.push({ code: 'DATA_UNAVAILABLE', field: 'military.airAssets', detail: 'L’atto impiega capacità aerea, ma la fonte canonica dell’arsenale non è leggibile: dato non disponibile.' });
    else if (!arsenalHasDomain(world, 'aria')) blockers.push({ code: 'MILITARY_ASSET_MISSING', field: 'military.airAssets', detail: 'L’atto impiega capacità aerea, ma l’arsenale canonico non registra alcun equipaggiamento aereo sotto il nostro controllo.' });
  }
  if (droneDirective) {
    if (!arsenalRead(world)) blockers.push({ code: 'DATA_UNAVAILABLE', field: 'military.droneAssets', detail: 'L’atto impiega droni, ma la fonte canonica dell’arsenale non è leggibile: dato non disponibile.' });
    else if (!arsenalHasDomain(world, 'droni')) blockers.push({ code: 'MILITARY_ASSET_MISSING', field: 'military.droneAssets', detail: 'L’atto impiega droni, ma l’arsenale canonico non registra alcun drone sotto il nostro controllo.' });
  }
  for (const [clauseIndex, clause] of clauses.entries()) {
    // Una domanda non esegue nulla: nessun blocker esecutivo da un'interrogativa.
    if (questions[clauseIndex]) continue;
    for (const kind of Object.keys(REFERENCES) as AssetKind[]) {
      for (const reference of clause.matchAll(REFERENCES[kind])) {
        const prefix = clause.slice(0, reference.index);
        const suffix = clause.slice(reference.index! + reference[0].length);
        const action = [...prefix.matchAll(ACTIONS)].at(-1);
        const localSuffix = suffix.split(/\b(?:e|and|poi|then)\b|,/)[0].slice(0, 40);
        const localPrefix = action ? prefix.slice(action.index! + action[0].length) : prefix.slice(-40);
        const existing = EXISTING.test(localSuffix) || EXISTING.test(localPrefix);
        if (!action && !existing) continue; // mere discussion is not asset use
        if (action && NEW_ACTION.test(action[0]) && !existing) continue;
        // A negative directive does not require the forbidden asset to exist.
        if (action && /\b(?:non|not|senza|without)\s*$/.test(prefix.slice(0, action.index))) continue;
        const target = namedTarget(suffix);
        const assets = inventory[kind];
        if (assets.length && (!target || assets.some(asset => nameMatches(target, asset)))) {
          // Un nome proprio accanto al riferimento deve comunque combaciare
          // con l'inventario: «Usa Kampala Port» non prende in prestito un
          // porto registrato con un altro nome.
          const candidates = properNouns(originalClauses[clauseIndex] ?? '').filter(name => !assets.some(asset => nameMatches(name, asset)));
          if (!candidates.length) continue;
        }
        if (seen.has(kind)) continue;
        seen.add(kind);
        blockers.push({
          code: kind === 'fleet' ? 'MILITARY_ASSET_MISSING' : 'INFRASTRUCTURE_MISSING',
          field: kind === 'fleet' ? 'military.navalAssets' : `infrastructure.${kind === 'factory' ? 'factories' : `${kind}s`}`,
          detail: target
            ? `Nessun ${reference[0]} «${target}» verificato sotto il nostro controllo nell’inventario canonico.`
            : assets.length && properNouns(originalClauses[clauseIndex] ?? '').length
              ? `Nessun ${reference[0]} «${properNouns(originalClauses[clauseIndex] ?? '').join(', ')}» verificato sotto il nostro controllo nell’inventario canonico.`
              : `L’atto richiede ${LABELS[kind]} esistenti, ma l’inventario canonico sotto il nostro controllo è vuoto.`,
        });
      }
    }
  }
  // Un solo blocker per campo: la guardia generica e quella di dominio possono
  // descrivere lo stesso asset mancante (es. flotta).
  const unique = new Map<string, Blocker>();
  for (const blocker of blockers) {
    const key = `${blocker.code}|${blocker.field ?? ''}|${blocker.targetId ?? ''}`;
    if (!unique.has(key)) unique.set(key, blocker);
  }
  return [...unique.values()];
}

export class OrderRealityBlockedError extends Error {
  readonly code = 'order_reality_blocked';
  constructor(readonly blockers: readonly Blocker[]) {
    super(`order_reality_blocked: ${blockers.map(blocker => blocker.detail).join(' ')}`);
    this.name = 'OrderRealityBlockedError';
  }
}
export function assertCanonicalOrder(textValue: string, polityId: string, world: CanonicalOrderWorld, constructionRegionId?: string): void {
  const blockers = canonicalOrderBlockers(textValue, polityId, world, constructionRegionId);
  if (blockers.length) throw new OrderRealityBlockedError(blockers);
}
