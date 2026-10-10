/**
 * MAP01 — Di quali zone si sta parlando
 * =====================================
 * La scheda mappa del governo sa **disegnare**; non sa **scegliere**. Oggi
 * `resolveGovernmentVisuals` produce un solo insieme di id — tutto il paese allo
 * stesso modo — e non esiste il concetto di «la zona di cui si parla» contrapposto
 * al «contorno». Questo modulo è quel concetto, e nient'altro: dato l'insieme
 * canonico delle regioni e un testo, restituisce le zone con un **ruolo**.
 *
 * Il confine è quello di sempre, e vale la pena ripeterlo perché è la ragione per
 * cui questo file esiste:
 *
 *  - il **modello** non scrive mai un id di regione (invariante M-I1): il testo è
 *    l'unica cosa che porta, e il testo lo produce il gioco, non la geografia;
 *  - gli id li risolve il **motore** contro le fonti canoniche già in memoria: qui
 *    si confrontano i nomi canonici delle regioni con le parole del testo, e ogni
 *    id che non esiste fra le regioni candidate viene **scartato**;
 *  - un nome **ambiguo** non produce nulla (fail-closed): se due regioni si
 *    chiamano allo stesso modo, non si indovina quale.
 *
 * Modulo **puro**: nessun I/O, nessuno stato, nessuna chiamata al modello.
 *
 * ## Perché un confronto di nomi non contraddice «mai somiglianze di nomi»
 *
 * Le regole dei prompt vietano al modello di **indicare** una zona per somiglianza
 * di nome («il nord», «la zona di Sivas»): quella sarebbe una geografia inventata
 * dal modello. Qui è il contrario: il modello scrive prosa, e il motore legge
 * nella prosa i nomi **canonici** delle proprie regioni. L'id resta del motore.
 * Perché resti una lettura e non un indovinello, servono quattro guardie, tutte
 * difese da test:
 *
 *  1. **confine di parola**: un nome conta solo come sequenza di parole intere
 *     (`sakib` dentro `sakib` sì, dentro `sakibullah` no);
 *  2. **lunghezza minima**: sotto `MIN_NAME_CHARS` caratteri (spazi esclusi) il
 *     nome è troppo corto per essere un toponimo e viene ignorato — le mappe
 *     reali hanno province chiamate «Al», «Ba», «De»;
 *  3. **univocità**: se il nome normalizzato appartiene a più di una regione
 *     candidata, nessuna delle due entra;
 *  4. **l'insieme è chiuso**: le zone restituite sono sempre un sottoinsieme delle
 *     regioni candidate. Un vicino che non è nella scheda non entra.
 */

import type { Region } from '../../types';

/**
 * Quante zone **nominate** si accettano al massimo. È un tetto di lettura, non un
 * punteggio: la scheda disegna etichette dentro un riquadro di 640×260, e oltre
 * una manciata l'etichetta smette di essere leggibile. Le zone che superano il
 * tetto non spariscono: tornano nel **contesto**, dove erano prima di questo
 * modulo.
 */
export const MAX_NAMED_ZONES = 8;

/** Sotto questa lunghezza (spazi esclusi) una parola non è un toponimo: è rumore. */
export const MIN_NAME_CHARS = 4;

/**
 * Il ruolo di una zona nella scheda.
 *
 *  - `primary`  — il soggetto: le zone di cui si parla, o l'insieme che un
 *                 riferimento verificato ha già individuato (un fronte, una
 *                 coppia diplomatica). Sono quelle da inquadrare e da etichettare.
 *  - `context`  — l'insieme di riferimento: il resto del territorio candidato,
 *                 disegnato in tinta neutra. Serve a **collocare** le primarie.
 *  - `adjacent` — i vicini delle primarie, dall'adiacenza canonica (`borders`).
 *                 Mostrano **dove confina** la zona di cui si parla.
 */
export interface RegionZoneRoles {
  readonly primary: readonly string[];
  readonly context: readonly string[];
  readonly adjacent: readonly string[];
  /** MAP06 — Le primarie che toccano il territorio fuori dall'insieme. */
  readonly border?: readonly string[];
}

export interface RegionZoneInput {
  /** Le regioni candidate, già canoniche e nell'ordine di riferimento. */
  readonly regions: readonly Region[];
  /** La prosa da cui leggere i toponimi: la risposta del modello o la domanda del Presidente. */
  readonly text?: string;
  /** Gli id che un riferimento **verificato** ha già individuato (fronte, diplomazia). */
  readonly verified?: readonly string[];
  /** Tetto delle zone nominate (default `MAX_NAMED_ZONES`). */
  readonly maxNamed?: number;
}

/**
 * La piega di un nome: maiuscole, accenti e punteggiatura non devono decidere se
 * una provincia è nominata. Stessa disciplina di `tacticalModel` e `mapModel`:
 * ogni modulo che confronta nomi di luogo ha la sua, di tre righe, per non
 * dipendere da un modulo grande solo per questo.
 */
const fold = (value: string): string => value
  .normalize('NFD').replace(/\p{Diacritic}+/gu, '')
  .toLocaleLowerCase('it').trim();

/**
 * Le parole di un testo, ripiegate, **con ripetizioni e posizione**: servono per
 * riconoscere i nomi di più parole («Al Salt», «Aix-en-Provence») come sequenza
 * di parole intere, non come sottostringa.
 */
function tokensOf(text: string): string[] {
  return fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Il numero di parole del nome più lungo fra i candidati: il tetto della finestra. */
function maxTokenWindow(names: Iterable<string>): number {
  let max = 1;
  for (const name of names) max = Math.max(max, name.split(' ').length);
  return Math.min(max, 6);
}

/**
 * Le zone **nominate** nel testo, nell'ordine in cui compaiono. Un nome che
 * compare nel testo ma non fra le regioni candidate **non esiste**: il testo del
 * gioco non può nominare una provincia che il motore non conosce.
 *
 * La lettura scorre le parole del testo e, a ogni posizione, cerca il nome di
 * **più parole** che combacia: così «Al Salt» non viene letto come «Salt».
 */
export function namedRegionIds(regions: readonly Region[], text: string | undefined, max = MAX_NAMED_ZONES): string[] {
  if (!text || max <= 0) return [];

  // I nomi canonici, ripiegati. Conteggio per univocità, chiave = parole unite.
  const counts = new Map<string, number>();
  const byKey = new Map<string, string>();
  for (const region of regions) {
    const key = tokensOf(region.name ?? '').join(' ');
    if (key.replace(/ /g, '').length < MIN_NAME_CHARS) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!byKey.has(key)) byKey.set(key, region.id);
  }
  // Nome ambiguo: nessuno dei due. (`counts` è calcolato sull'insieme completo.)
  for (const [key, count] of counts) if (count > 1) byKey.delete(key);

  const tokens = tokensOf(text);
  const window = maxTokenWindow(byKey.keys());
  const out: string[] = [];
  for (let i = 0; i < tokens.length && out.length < max; i += 1) {
    // Dal nome più lungo al più corto: «Al Salt» vince su un ipotetico «Salt».
    for (let length = Math.min(window, tokens.length - i); length >= 1; length -= 1) {
      const id = byKey.get(tokens.slice(i, i + length).join(' '));
      if (!id) continue;
      if (!out.includes(id)) out.push(id);
      i += length - 1; // le parole consumate non si rileggono
      break;
    }
  }
  return out;
}

/**
 * Le zone con un ruolo. `verified` ha la precedenza nell'ordine (è il riferimento
 * più preciso); le zone **nominate** si aggiungono dopo, entro il tetto. Le
 * adiacenti si leggono dall'**adiacenza canonica** delle primarie, e non possono
 * mai comprendere una primaria. Tutto ciò che resta è contesto.
 *
 * Nessun id restituito è fuori dall'insieme candidato: le adiacenze che puntano a
 * una regione non inclusa (un paese vicino che non fa parte della scheda) vengono
 * semplicemente omesse — la scheda non cresce di nascosto.
 */
/**
 * MAP06 — La **frontiera** di un insieme: le regioni dell'insieme toccate da un
 * vicino che non ne fa parte. È il contorno che una mappa deve poter dire — «fin
 * qui arriva il soggetto» — e si legge dall'adiacenza canonica (`borders`), mai
 * da una somiglianza di nomi.
 *
 * Non è un insieme di disegno: è un attributo delle regioni che sono già nella
 * scheda, quindi non può far crescere nulla. Una regione il cui vicino non esiste
 * fra le candidate è di frontiera: il mondo fuori dalla scheda è, per definizione,
 * fuori dall'insieme.
 */
export function borderRegionIds(
  regions: readonly Region[],
  memberIds: readonly string[],
): string[] {
  const members = new Set(memberIds);
  const out: string[] = [];
  for (const region of regions) {
    if (!members.has(region.id) || out.includes(region.id)) continue;
    const touchesOutside = (region.borders ?? []).some(neighbour => !members.has(neighbour));
    if (touchesOutside) out.push(region.id);
  }
  return out;
}

export function resolveRegionZones(input: RegionZoneInput): RegionZoneRoles {
  const regions = input.regions ?? [];
  const available = new Set(regions.map(region => region.id));
  const unique = (ids: Iterable<string>): string[] => {
    const out: string[] = [];
    for (const id of ids) if (available.has(id) && !out.includes(id)) out.push(id);
    return out;
  };

  const primary = unique([
    ...(input.verified ?? []),
    ...namedRegionIds(regions, input.text, input.maxNamed ?? MAX_NAMED_ZONES),
  ]);
  const primarySet = new Set(primary);

  const byId = new Map(regions.map(region => [region.id, region]));
  const adjacent: string[] = [];
  for (const id of primary) {
    for (const neighbour of byId.get(id)?.borders ?? []) {
      // Solo vicini **presenti** nella scheda, e mai una primaria.
      if (!available.has(neighbour) || primarySet.has(neighbour) || adjacent.includes(neighbour)) continue;
      adjacent.push(neighbour);
    }
  }
  const adjacentSet = new Set(adjacent);

  const context = regions
    .map(region => region.id)
    .filter(id => !primarySet.has(id) && !adjacentSet.has(id));

  return { primary, context, adjacent, border: borderRegionIds(regions, primary) };
}
