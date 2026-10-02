/**
 * WS-GOV-COUNCIL-HARDENING — La localizzazione canonica di un'opera
 * ==================================================================
 * Il difetto osservato: il Presidente dice «Voglio costruire una fabbrica
 * siderurgica a Sarajevo», ma Sarajevo resta **soltanto nella frase**. La
 * riunione legge l'opera dal motore, non conosce un luogo, e l'atto nasce senza
 * `regionId`: il cantiere finisce nel posto sbagliato (o in nessun posto).
 *
 * Qui la frase viene confrontata con la **geografia canonica già disponibile**
 * (le regioni della partita, `pictureSources.regions`). Il modulo **non inventa
 * un ID**: un `regionId` esiste solo se il nome di una regione reale compare nel
 * testo. Se più regioni corrispondono, non si sceglie a caso: la localizzazione
 * resta **ambigua** e la riunione non è pronta finché il Presidente non
 * chiarisce.
 *
 * Regole, le stesse del progetto:
 *  - nessun I/O, nessuno stato, nessuna chiamata al modello;
 *  - l'ID nasce solo dai dati canonici della partita (`Region.id`), mai dal
 *    testo libero;
 *  - l'ambiguità è un esito dichiarato, non un tie-break arbitrario.
 */

/** La geografia canonica: il minimo che serve, così il modulo è testabile senza `Region`. */
export interface CanonicalRegionRef {
  readonly id: string;
  readonly name: string;
}

/** Un luogo canonico risolto: id del motore e nome leggibile. */
export interface MeetingLocationCandidate {
  readonly regionId: string;
  readonly regionLabel: string;
}

export type MeetingLocationStatus = 'resolved' | 'ambiguous' | 'missing';

export interface MeetingLocation {
  readonly status: MeetingLocationStatus;
  /** Tutte le regioni nominate nel testo (0, 1 o più). */
  readonly candidates: readonly MeetingLocationCandidate[];
  /** La regione risolta solo quando ne esiste **una sola**. */
  readonly region: MeetingLocationCandidate | null;
}

/** Normalizza per il confronto: minuscole, senza accenti, spazi singoli. */
function normalize(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Le chiavi con cui un nome di regione può comparire nel discorso. Oltre al
 * nome intero, per i nomi composti si accetta il **toponimo** (l'ultima parola
 * significativa), come nella lingua reale: «Provincia di Sarajevo» → «Sarajevo».
 * Una parola troppo corta (< 4) è ignorata per non produrre falsi positivi.
 */
export function regionMatchKeys(name: string): string[] {
  const full = normalize(name);
  if (!full) return [];
  const keys = new Set<string>([full]);
  const words = full.split(' ').filter(word => word.length >= 4);
  for (const word of words) keys.add(word);
  return [...keys];
}

/**
 * Risolve la localizzazione di una richiesta sulla geografia canonica.
 *
 * Il confronto è per **parola intera**: «Alfa» non deve corrispondere a
 * «alfabeto». Le regioni corrispondenti si deduplicano per `id` e si ordinano
 * per specificità (la chiave più lunga vince), così l'esito è deterministico.
 */
export function resolveMeetingLocation(
  text: string,
  regions: readonly CanonicalRegionRef[],
  /** WS-GOV-MOBILE-FOCUS (A5) — la regione attuale, se canonicalmente risolvibile. */
  currentRegion: CanonicalRegionRef | null = null,
): MeetingLocation {
  const toCandidate = (region: CanonicalRegionRef): MeetingLocationCandidate => ({ regionId: region.id, regionLabel: region.name });
  const haystack = normalize(text);
  if (!haystack || regions.length === 0) {
    // Senza geografia non si risolve; ma «qui» resta una rinvia esplicita:
    // se la regione attuale è nota, il luogo è quello (A5).
    if (currentRegion && hasCurrentRegionAnaphora(haystack)) {
      const candidate = toCandidate(currentRegion);
      return { status: 'resolved', candidates: [candidate], region: candidate };
    }
    return { status: 'missing', candidates: [], region: null };
  }
  const words = new Set(haystack.split(' '));
  const found = new Map<string, { candidate: MeetingLocationCandidate; weight: number }>();

  for (const region of regions) {
    if (!region?.id || !region?.name) continue;
    let weight = 0;
    for (const key of regionMatchKeys(region.name)) {
      // Per le chiavi multi-parola serve la sottostringa esatta; per una sola
      // parola basta la presenza come parola intera.
      const hit = key.includes(' ') ? haystack.includes(key) : words.has(key);
      if (hit && key.length > weight) weight = key.length;
    }
    if (weight > 0 && !found.has(region.id)) {
      found.set(region.id, {
        candidate: { regionId: region.id, regionLabel: region.name },
        weight,
      });
    }
  }

  const candidates = [...found.values()]
    .sort((a, b) => (b.weight - a.weight) || a.candidate.regionId.localeCompare(b.candidate.regionId))
    .map(entry => entry.candidate);

  if (candidates.length === 0) {
    // «Qui» / «nella regione attuale»: la rinvia esplicita si risolve **solo**
    // con una regione canonica nota. Altrimenti resta mancante.
    if (currentRegion && hasCurrentRegionAnaphora(haystack)) {
      const candidate = toCandidate(currentRegion);
      return { status: 'resolved', candidates: [candidate], region: candidate };
    }
    return { status: 'missing', candidates: [], region: null };
  }
  if (candidates.length > 1) return { status: 'ambiguous', candidates, region: null };
  return { status: 'resolved', candidates, region: candidates[0] };
}

/**
 * WS-GOV-MOBILE-FOCUS (A5) — Il riferimento alla regione **attuale**: solo se
 * esiste una regione capitale marcata, oppure una sola regione posseduta. Con
 * più regioni e nessuna capitale non si sceglie: la risoluzione resta assente.
 * Stessa semantica di `nationalContext.nationalReference`, così la mappa e il
 * Governo non indicano due luoghi diversi.
 */
export function resolveCurrentRegionRef(
  regions: readonly (CanonicalRegionRef & { readonly owner?: string; readonly metadata?: Record<string, unknown> })[] ,
  polityId: string | null | undefined,
): CanonicalRegionRef | null {
  if (!polityId) return null;
  const owned = regions.filter(region => region.owner === polityId);
  const isCapital = (region: typeof owned[number]): boolean => {
    const metadata = (region.metadata ?? {}) as Record<string, unknown>;
    if (metadata.isCapitalProvince === true) return true;
    const tags = metadata.tags;
    return Array.isArray(tags) && tags.includes('capitale');
  };
  const capital = owned.find(isCapital);
  if (capital) return { id: capital.id, name: capital.name };
  if (owned.length === 1) return { id: owned[0].id, name: owned[0].name };
  return null;
}

/** I modi in cui il Presidente può riferirsi alla regione in cui si trova. */
const CURRENT_REGION_ANAPHORA: readonly string[] = [
  ' qui', ' qua', 'da queste parti', 'in questa regione', 'nella regione attuale',
  'nella nostra regione', 'nella provincia attuale', 'in questa provincia', 'sul posto',
];

/** Il testo rinvia esplicitamente alla regione attuale (non a una nominata)? */
export function hasCurrentRegionAnaphora(text: string): boolean {
  const padded = ` ${normalize(text)} `;
  return CURRENT_REGION_ANAPHORA.some(phrase => padded.includes(`${phrase} `));
}

/**
 * La domanda che il Presidente deve sciogliere quando la localizzazione è
 * ambigua: nomina i candidati invece di scegliere per lui (Regola: niente
 * tie-break arbitrario).
 */
export function ambiguousLocationQuestion(candidates: readonly MeetingLocationCandidate[]): string {
  const labels = candidates.map(candidate => candidate.regionLabel);
  return labels.length <= 1
    ? 'Quale regione?'
    : `Quale regione? La richiesta nomina ${labels.join(', ')}.`;
}
