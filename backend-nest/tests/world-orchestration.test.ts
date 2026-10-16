import { describe, expect, it } from 'vitest';
import { buildWorldReactionCauses, selectWorldStorylines } from '../src/game/worldReactionCauses';
import { buildReactionContext } from '../src/core/simulation/ReactionContext';
import { compactNpcDossiers, compactReactionContext } from '../src/prompts/simulation/orchestration';
import { buildWorldNarrativeContext } from '../src/prompts/simulation/initiative';
import { diplomaticEventContext } from '../src/prompts/chat';
import type { NpcObjective } from '../src/core/simulation/NpcAgenda';

const thread = (id: string, parties: string[]) => ({ id, title: id, summary: `Situazione ${id}`, parties });

describe('orchestrazione del mondo con budget limitato', () => {
  it('due filoni nazionali non escludono il mondo: il teatro indipendente ruota e resta coerente nel prompt', () => {
    const storylines = [thread('national-a', ['KHM']), thread('national-b', ['KHM']),
      thread('trade', ['MYS', 'THA']), thread('talks', ['USA', 'CAN']),
      { ...thread('resolved', ['FRA']), state: 'risolto' },
      { ...thread('future', ['ITA']), active_from: '2001-01-01' }];
    const base = { date: '2000-06-01', playerPolityId: 'KHM', results: [], storylines };
    expect(selectWorldStorylines(storylines, 'KHM', base.date, 1).map(t => t.id)).toEqual(['national-a', 'trade', 'talks']);
    const causes = buildWorldReactionCauses({ ...base, turn: 2 });
    expect(causes.map(c => c.sourceRef)).toEqual(['storyline:national-b', 'storyline:talks', 'storyline:trade']);
    const context = buildReactionContext({ playerPolityId: 'KHM', playerPolityName: 'Cambogia',
      focusTexts: [], currentActions: [], polityNames: { USA: 'Stati Uniti', CAN: 'Canada' },
      regions: { usa: { id: 'usa', name: 'Washington', owner: 'USA' }, can: { id: 'can', name: 'Ottawa', owner: 'CAN' } }, worldCauses: causes });
    expect(context.actors.map(a => a.id)).toEqual(['USA', 'CAN']);
    const prompt = buildWorldNarrativeContext({ ...base, startDate: '2000-01-01', turn: 2,
      actorIds: context.actors.map(a => a.id), causes });
    expect(prompt).toContain('Situazione talks');
    expect(prompt).not.toContain('Situazione trade');
    expect(prompt).not.toContain('Situazione resolved');
    expect(prompt).not.toContain('Situazione future');
  });

  it('un obiettivo canonico apre iniziative senza filoni, ma non quelli chiusi, futuri o del giocatore', () => {
    const objective = { id: 'market', polityId: 'MYS', type: 'trade', status: 'active', priority: 2,
      targetPolityId: 'THA', description: 'Negoziare accesso ai mercati', reason: 'Trattativa aperta',
      createdDate: '2000-01-01', reviewedDate: '2000-06-01' } as unknown as NpcObjective;
    const causes = buildWorldReactionCauses({ date: '2000-06-01', playerPolityId: 'KHM', storylines: [], results: [], objectives: [
      { ...objective, id: 'closed', status: 'achieved', priority: 3 },
      { ...objective, id: 'future', reviewedDate: '2001-01-01', priority: 3 },
      { ...objective, id: 'player', polityId: 'KHM', priority: 3 }, objective,
    ] });
    expect(causes).toHaveLength(1);
    expect(causes[0]).toMatchObject({ sourceRef: 'agenda:market', polityIds: ['MYS', 'THA'] });
  });

  it('conserva tutti gli attori e optionId anche oltre il vecchio taglio a 2500 caratteri', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `NPC${i}`);
    const context = buildReactionContext({ playerPolityId: 'KHM', playerPolityName: 'Cambogia', focusTexts: [],
      polityNames: Object.fromEntries(ids.map(id => [id, `Paese ${id}`])),
      regions: Object.fromEntries(ids.map(id => [id, { id, name: id, owner: id }])),
      worldCauses: [{ kind: 'world_process', sourceRef: 'storyline:regional', summary: 'S'.repeat(500), polityIds: ids }] });
    const compact = compactReactionContext(context, 2500);
    for (const id of context.allowedOptionIds) expect(compact).toContain(id);
    expect(compact.length).toBeLessThanOrEqual(2500);
    const dossiers = ids.map(id => `- Paese [${id}] — profilo persistente: prudente\n  Tratti: ${'X'.repeat(1500)}\n  Priorità correnti: interesse-${id}\n  Agenda strategica: obiettivo-${id} ${'A'.repeat(1000)}\n  Memoria strategica: precedente-${id}`).join('\n');
    const brief = compactNpcDossiers(dossiers, 6500);
    for (const id of ids) {
      expect(brief).toContain(`[${id}]`);
      expect(brief).toContain(`obiettivo-${id}`);
      expect(brief).toContain(`precedente-${id}`);
    }
    expect(brief.length).toBeLessThanOrEqual(6500);
  });

  it('la chat riceve la conseguenza dell’evento pertinente, senza fatti futuri o notizie estranee', () => {
    const event = { date: '2000-05-01', headline: 'Il Canada condiziona il negoziato', detail: 'Chiede garanzie prima di aprire il mercato.' };
    const events = diplomaticEventContext({ date: '2000-06-01', names: ['Canada'], results: [{ events: [], timelineEvents: [
      event, event, { ...event, date: '2001-01-01', detail: 'FUTURO' },
      { ...event, date: '1990-01-01', detail: 'REMOTO' }, { ...event, headline: 'Il Giappone propone una riforma', detail: 'ESTRANEO' },
    ] }] });
    expect(events).toEqual(['2000-05-01: Il Canada condiziona il negoziato — Chiede garanzie prima di aprire il mercato.']);
  });
});
