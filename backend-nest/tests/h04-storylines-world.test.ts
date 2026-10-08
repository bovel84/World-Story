/**
 * H04 — I filoni del preset diventano obiettivi del **mondo**, per partita.
 *
 * Difende le invarianti (docs/STANDARD_FILONI_PRESET.md, §4 del piano):
 *  - H-I9 una partita, una storia / il filone è indipendente dalla nazione scelta;
 *  - un filone è **scritto** dal mondo, non derivato: non si abbandona per
 *    mancanza di un seme dello stato;
 *  - si semina solo in una polity **presente** nel mondo;
 *  - `active_from`/`active_until` decidono quando il filone è dormiente;
 *  - `pressure` diventa la priorità; il progresso resta un dato del motore.
 *
 * Il livello puro (NpcAgenda + StorylineSeeding) è provato qui per intero. La
 * scrittura sul database (NpcAgendaService, che apre SQLite) si valida sulla
 * macchina dell'autore: stessa disciplina di `stage2.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  reviewAgenda, seedStorylineObjective, storylineObjectiveId,
  storylineObjectiveSuperseded, objectiveAchieved, isStorylineObjective,
  AGENDA_MAX_STORYLINES, AGENDA_MAX_OBJECTIVES, AGENDA_REVIEW_DAYS,
  type NpcObjective, type NpcAgendaContext,
} from '../src/core/simulation/NpcAgenda';
import { buildStorylineSeeds, seedFromStoryline } from '../src/game/StorylineSeeding';
import { STORYLINE_STANDARD_VERSION, type StorylinesFile, type Storyline } from '../src/scenario/storylines';

function storyline(over: Partial<Storyline> = {}): Storyline {
  return {
    id: 'levante-disarmo-hamas', title: 'Il disarmo di Hamas', domain: 'esteri',
    parties: ['ISR', 'PSE', 'USA'], region: 'Levante', state: 'aperto', pressure: 3,
    summary: 'Israele e gli USA premono per il disarmo.',
    trajectory: 'Se nessuno lo devia, il nodo scivola verso lo scontro.',
    triggers: ['attentato'],
    ...over,
  };
}
const file = (s: Storyline[]): StorylinesFile => ({ version: STORYLINE_STANDARD_VERSION, storylines: s });

const ctx: NpcAgendaContext = { hostileActors: 1, selfEvidence: 0 };

describe('H04 — semina: il filone entra in ogni polity presente (indipendente dal giocatore)', () => {
  it('semina una voce per OGNI polity protagonista presente nel mondo', () => {
    const seeds = buildStorylineSeeds({
      file: file([storyline()]),
      date: '2000-06-01',
      presentPolities: ['ISR', 'PSE', 'USA', 'ITA'],
    });
    expect(seeds.map(s => s.polityId).sort()).toEqual(['ISR', 'PSE', 'USA']);
    expect(seeds.every(s => s.storylineId === 'levante-disarmo-hamas')).toBe(true);
    // Il giocatore non compare in input: il filone esiste a prescindere da chi gioca.
    expect(seeds.some(s => s.polityId === 'ITA')).toBe(false);
  });

  it('non semina in una polity assente dal mondo', () => {
    const seeds = buildStorylineSeeds({ file: file([storyline()]), date: '2000-06-01', presentPolities: ['USA'] });
    expect(seeds.map(s => s.polityId)).toEqual(['USA']);
  });

  it('la priorità viene dalla `pressure` del filone', () => {
    const seeds = buildStorylineSeeds({ file: file([storyline({ pressure: 2 })]), date: '2000-06-01', presentPolities: ['USA'] });
    expect(seeds[0].priority).toBe(2);
  });

  it('il tetto per polity è applicato alla semina', () => {
    const many = Array.from({ length: AGENDA_MAX_STORYLINES + 4 }, (_, i) =>
      storyline({ id: `filone-${i}` }));
    const seeds = buildStorylineSeeds({ file: file(many), date: '2000-06-01', presentPolities: ['USA'] });
    expect(seeds.length).toBe(AGENDA_MAX_STORYLINES);
  });

  it('un filone dormiente (active_from futuro) non si semina ancora', () => {
    const seeds = buildStorylineSeeds({
      file: file([storyline({ active_from: '2003-01-01' })]), date: '2000-06-01', presentPolities: ['USA'],
    });
    expect(seeds).toEqual([]);
  });

  it('zero filoni → zero semi (H-I6)', () => {
    expect(buildStorylineSeeds({ file: file([]), date: '2000-06-01', presentPolities: ['USA'] })).toEqual([]);
    expect(buildStorylineSeeds({ file: undefined, date: '2000-06-01', presentPolities: ['USA'] })).toEqual([]);
  });
});

describe('H04 — l’obiettivo del filone è scritto, non derivato', () => {
  const seed = seedFromStoryline(storyline(), 'ISR', false);
  const objective = seedStorylineObjective(seed, null, { date: '2000-01-01', turn: 1 });

  it('esiste la chiave stabile `polity:storyline:id`', () => {
    expect(objective.id).toBe(storylineObjectiveId('ISR', 'levante-disarmo-hamas'));
    expect(objective.type).toBe('storyline');
    expect(isStorylineObjective(objective)).toBe(true);
  });

  it('NON viene abbandonato quando manca un seme dello stato, anche dopo la finestra', () => {
    const old: NpcObjective = { ...objective, createdDate: '1999-01-01' };
    const review = reviewAgenda([old], /* seeds derivati */ [], ctx, { polityId: 'ISR', date: '2001-01-01', turn: 5 });
    expect(review.active.map(o => o.id)).toContain(old.id);
    expect(review.closed).toEqual([]);
  });

  it('un obiettivo DERIVATO invece sì (la regola non è stata allargata a tutti)', () => {
    // Guardia contro il falso verde: la stessa revisione deve abbandonare un
    // obiettivo derivato senza supporto. Se la mia modifica avesse reso
    // immortali tutti gli obiettivi, questo test cadrebbe.
    const derivato: NpcObjective = {
      ...objective, id: 'ISR:contain-hostile:-:1', type: 'contain-hostile',
      createdDate: '1999-01-01',
    };
    const review = reviewAgenda([derivato], [], ctx, { polityId: 'ISR', date: '2001-01-01', turn: 5 });
    expect(review.closed.map(o => o.id)).toContain(derivato.id);
  });

  it('non si «raggiunge» mai con un indicatore (si chiude solo se superato)', () => {
    expect(objectiveAchieved(objective, { hostileActors: 0, monthlyBalance: 99, stability: 99 })).toBe(false);
  });

  it('è idempotente: riseminare conserva nascita e progresso', () => {
    const grown: NpcObjective = { ...objective, progress: 55, createdDate: '2000-01-01', createdTurn: 1 };
    const again = seedStorylineObjective(seed, grown, { date: '2000-09-01', turn: 3 });
    expect(again.id).toBe(grown.id);
    expect(again.createdDate).toBe('2000-01-01');
    expect(again.progress).toBe(55);
  });
});

describe('H04 — il filone si chiude solo quando lo stato lo supera', () => {
  it('dichiarato risolto → superato', () => {
    expect(storylineObjectiveSuperseded({ resolved: true }, { date: '2000-06-01' })).toBe(true);
  });
  it('non toccato da troppo tempo → superato', () => {
    expect(storylineObjectiveSuperseded({ lastTouchedDate: '2000-01-01' }, { date: '2000-06-01' })).toBe(true);
    expect(storylineObjectiveSuperseded({ lastTouchedDate: '2000-01-01' }, { date: '2000-02-01' })).toBe(false);
  });
  it('nessuna evidenza → non superato (non si chiude per ignoranza)', () => {
    expect(storylineObjectiveSuperseded(undefined, { date: '2005-01-01' })).toBe(false);
  });
});

describe('H04 — i filoni non competono con gli obiettivi derivati', () => {
  it('i filoni hanno un tetto proprio e indipendente', () => {
    // Nove filoni già attivi, NESSUN seme derivato: la revisione non deve
    // abbandonarli — sono scritti dal mondo, non derivati dallo stato.
    const many = Array.from({ length: AGENDA_MAX_STORYLINES + 3 }, (_, i) =>
      seedStorylineObjective(
        seedFromStoryline(storyline({ id: `filone-${i}` }), 'ISR', false), null, { date: '2000-01-01', turn: 1 },
      ));
    const review = reviewAgenda(many, [], ctx, { polityId: 'ISR', date: '2000-01-01', turn: 1 });
    expect(review.closed).toEqual([]);
    expect(review.active.length).toBe(AGENDA_MAX_STORYLINES + 3);
  });

  it('un obiettivo derivato urgente non può sostituire un filone', () => {
    // Tre derivati (tetto pieno) + un filone: un nuovo derivato urgente può
    // sostituire solo un derivato, mai il filone.
    const derivato = (i: number): NpcObjective => ({
      ...seedStorylineObjective(seedFromStoryline(storyline({ id: `x-${i}` }), 'ISR', false), null, { date: '1999-01-01', turn: 1 }),
      id: `ISR:stabilize-economy:-:${i}`, type: 'stabilize-economy', createdDate: '1999-01-01',
    });
    const filone = { ...seedStorylineObjective(seedFromStoryline(storyline(), 'ISR', false), null, { date: '1999-01-01', turn: 1 }), createdDate: '1999-01-01' };
    const attive = [derivato(1), derivato(2), derivato(3), filone];
    const seedsUrgenti = [{ type: 'contain-hostile' as const, priority: 3, description: 'x', measure: 'hostile-actors' as const, baseline: 1, reason: 'y' }];
    const review = reviewAgenda(attive, seedsUrgenti, { hostileActors: 1 }, { polityId: 'ISR', date: '2001-01-01', turn: 5 });
    expect(review.active.some(o => o.type === 'storyline')).toBe(true);
    expect(review.closed.every(o => o.type !== 'storyline')).toBe(true);
  });
});
