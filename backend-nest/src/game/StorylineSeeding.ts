/**
 * World Story — Semina dei filoni del preset nel mondo (H04).
 * ==========================================================
 * Trasforma i **filoni** dichiarati dal preset (standard H01, `storylines.json`)
 * in **semi di obiettivi** per le polity del mondo. Modulo **puro**: nessun IO,
 * nessuna dipendenza dal motore. La scrittura (repository) vive nel servizio.
 *
 * Regole:
 *  - il filone è indipendente dalla nazione scelta: si semina in **ogni polity
 *    protagonista presente nel mondo**, non solo nel giocatore (H-I9);
 *  - un filone **superato** dallo stato non si semina, e se esisteva si chiude;
 *  - `active_from`/`active_until` decidono quando il filone è dormiente;
 *  - `pressure` (1–3) diventa la priorità dell'obiettivo.
 */
import { activeStorylines, type StorylinesFile, type Storyline } from '../scenario/storylines';
import { AGENDA_MAX_STORYLINES, type NpcObjectiveMeasure } from '../core/simulation/NpcAgenda';

/** Un seme di obiettivo derivato da un filone. Stessa forma del servizio. */
export interface StorylineSeed {
  polityId: string;
  storylineId: string;
  title: string;
  summary: string;
  trajectory?: string;
  parties: readonly string[];
  priority: number;
  measure: NpcObjectiveMeasure;
  baseline: number | null;
  reason: string;
  superseded?: boolean;
}

/**
 * L'evidenza dello stato su un filone: serve a decidere se è **superato**. Chi
 * la fornisce (il game-session) legge la cronaca; qui è solo un dato.
 */
export interface StorylineStateEvidence {
  /** Il filone è dichiarato risolto nel preset (`state: 'risolto'`). */
  resolved?: boolean;
  /** Ultima data in cui la partita ha toccato uno dei protagonisti. */
  lastTouchedDate?: string | null;
}

/**
 * Costruisce i semi per **tutte** le polity del mondo protagoniste di un filone
 * attivo. `presentPolities` sono gli id delle polity esistenti nel mondo: un
 * partito assente (la mappa non ha quella polity) viene saltato — un filone non
 * si semina in un attore che non esiste.
 */
export function buildStorylineSeeds(input: {
  file: StorylinesFile | undefined | null;
  date: string;
  presentPolities: readonly string[];
  /** Tetto di filoni per polity: il motore non deve sostenere un elenco infinito. */
  maxPerPolity?: number;
  /** Evidenza per `storylineId` (opzionale). */
  evidence?: Record<string, StorylineStateEvidence>;
}): StorylineSeed[] {
  if (!input.file || !Array.isArray(input.file.storylines)) return [];
  const present = new Set(input.presentPolities.map(id => String(id).toUpperCase()));
  const max = Math.max(1, input.maxPerPolity ?? AGENDA_MAX_STORYLINES);
  const byPolity = new Map<string, StorylineSeed[]>();
  for (const storyline of activeStorylines(input.file, input.date)) {
    const evidence = input.evidence?.[storyline.id];
    const superseded = evidence ? Boolean(evidence.resolved) : false;
    for (const rawParty of storyline.parties) {
      const polityId = String(rawParty).toUpperCase();
      if (!present.has(polityId)) continue;
      const list = byPolity.get(polityId) ?? [];
      list.push(seedFromStoryline(storyline, polityId, superseded));
      byPolity.set(polityId, list);
    }
  }
  const seeds: StorylineSeed[] = [];
  for (const list of byPolity.values()) {
    // I filoni superati non occupano il tetto: servono a **chiudere** un
    // obiettivo esistente, e devono arrivare sempre.
    const live = list.filter(seed => !seed.superseded)
      .sort((a, b) => b.priority - a.priority || a.storylineId.localeCompare(b.storylineId))
      .slice(0, max);
    const closed = list.filter(seed => seed.superseded);
    seeds.push(...live, ...closed);
  }
  return seeds;
}

/** Un singolo seme: filone + polity, con priorità presa dalla `pressure`. */
export function seedFromStoryline(storyline: Storyline, polityId: string, superseded: boolean): StorylineSeed {
  const measure: NpcObjectiveMeasure = 'events';
  return {
    polityId,
    storylineId: storyline.id,
    title: storyline.title,
    summary: storyline.summary,
    ...(storyline.trajectory ? { trajectory: storyline.trajectory } : {}),
    parties: storyline.parties,
    priority: Math.max(1, Math.min(3, storyline.pressure)),
    measure,
    baseline: 0,
    reason: `filone del mondo dichiarato dal preset${storyline.region ? ` (${storyline.region})` : ''}; stato: ${storyline.state}.`,
    ...(superseded ? { superseded: true } : {}),
  };
}
