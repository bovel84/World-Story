import { describe, expect, it } from 'vitest';
import { buildWorldReactionCauses } from '../src/game/worldReactionCauses';
import { buildWorldNarrativeContext } from '../src/prompts/simulation/initiative';

describe('fonti autonome del mondo: cronaca commessa e filoni attivi', () => {
  it('esclude fatti futuri, troppo remoti e duplicati, senza usare ordini come cause', () => {
    const event = { id: 'e1', date: '2000-05-01', headline: 'La Malaysia avvia il confronto', detail: 'Sul commercio regionale.' };
    const causes = buildWorldReactionCauses({ date: '2000-06-01', playerPolityId: 'KHM', storylines: [], results: [
      { timelineEvents: [event, event, { ...event, id: 'future', date: '2001-01-01' }, { ...event, id: 'old', date: '1990-01-01' }] },
    ] });
    expect(causes).toEqual([{ kind: 'prior_event', sourceRef: 'timeline:e1', summary: `${event.date}: ${event.headline}. ${event.detail}` }]);
    expect(buildWorldReactionCauses({ date: 'bad', playerPolityId: 'KHM', results: [], storylines: [] })).toEqual([]);
  });

  it('mantiene un tetto e dà precedenza al contesto nazionale senza escludere il mondo', () => {
    const thread = (id: string, parties: string[]) => ({ id, title: id, summary: 'S'.repeat(1000), parties });
    const causes = buildWorldReactionCauses({ date: '2000-06-01', playerPolityId: 'KHM', results: [],
      storylines: [thread('distant', ['MYS']), thread('other', ['USA']), thread('national', ['KHM', 'THA'])] });
    expect(causes.map(cause => cause.sourceRef)).toEqual(['storyline:national', 'storyline:distant', 'storyline:other']);
    expect(causes.every(cause => cause.summary.length <= 500)).toBe(true);
  });

  it('il narratore riceve solo contesti del periodo e degli attori ammessi', () => {
    const record = (polityId: string, startDate = '2000-01-01') => ({ polityId, startDate, countryName: polityId,
      situation: `Contesto ${polityId}`, generatedAt: '2000-01-01', version: 1 });
    const text = buildWorldNarrativeContext({ date: '2000-06-01', startDate: '2000-01-01', playerPolityId: 'KHM', actorIds: ['MYS'],
      situations: [record('MYS'), record('USA'), record('KHM', '1900-01-01')],
      storylines: [{ id: 'future', title: 'FILONE FUTURO', summary: '', parties: ['MYS'], active_from: '2001-01-01' },
        { id: 'now', title: 'Commercio regionale', summary: 'Negoziato aperto', parties: ['MYS'] }] });
    expect(text).toContain('Contesto MYS');
    expect(text).toContain('Commercio regionale');
    expect(text).not.toContain('FILONE FUTURO');
    expect(text).not.toContain('Contesto USA');
    expect(text).not.toContain('Contesto KHM');
  });
});
