import { describe, expect, it } from 'vitest';
import { buildVerifiedWorldSnapshot } from '../src/core/government/VerifiedWorldSnapshot';
import { buildRealityAdvisorContext, buildRealityAdvisorPrompt, guardRealityAdvisorOutput, withAdvisorStrategicContext } from '../src/core/government/RealityAdvisor';
import type { TurnResultRecord } from '../src/game/TimelineService';

const country = (polityId: string, food: number, balance: number) => buildVerifiedWorldSnapshot({ gameData: {
  id: polityId, playerPolityId: polityId, playerPolityName: polityId === 'KHM' ? 'Cambogia' : 'Stati Uniti',
  currentDate: '2000-01-01', currentTurn: 0,
  world: { regions: { r: { id: 'r', name: 'Regione', owner: polityId, coastal: false, objects: [] } } },
  worldState: { resources: { stock: { money: 10, food }, needs: { food: 1 } }, accounts: { [polityId]: { monthlyBalance: balance, socialTension: 25 } } },
}, operationalRows: [], commitments: [] });
const record = (id: string, date: string, turn: number, headline: string): TurnResultRecord => ({
  id, date, turn, events: [headline], narration: '', countryResponse: '',
});

describe('advisor strategist voice', () => {
  it('interprets KHM shortages and USA room for initiative differently, without a state dump or false reassurance', () => {
    const khm = buildRealityAdvisorContext(country('KHM', 0.8, -2)).reply;
    const usa = buildRealityAdvisorContext(country('USA', 4, 2)).reply;
    expect(khm).not.toBe(usa);
    expect(khm).toMatch(/scorte|aliment/i);
    expect(khm).toMatch(/evit|rinvi|priorità/i);
    expect(khm).not.toMatch(/la situazione regge|FACT\s*[—:-]|saldo mensile/i);
    expect(usa).toMatch(/opportunità|margine|consolid/i);
    expect(usa).not.toMatch(/crisi|emergenze immediate|programmi in corso/i);
  });

  it('requires interpretation, alternatives and strategic judgment, not four visible fact labels or mandatory cards', () => {
    const prompt = buildRealityAdvisorPrompt(buildRealityAdvisorContext(country('KHM', 0.8, -2)).advisorContext, 'Come procediamo?');
    expect(prompt).toContain('storico e stratega');
    expect(prompt).toContain('2-4 azioni');
    expect(prompt).toContain('Non stampare');
    expect(prompt).toContain('non obbligatorie');
    expect(prompt).toContain('non inventare una crisi');
  });

  it('rejects a labeled state dump in favor of the state-derived briefing', () => {
    const context = buildRealityAdvisorContext(country('KHM', 0.8, -2)).advisorContext;
    const reply = guardRealityAdvisorOutput(context, 'FACT — Economia: saldo -2.\nFACT — Infrastrutture: nessuna.');
    expect(reply).toBe(context.governmentBrief);
    expect(reply).not.toMatch(/FACT|Infrastrutture:/);
  });

  it('anchors real history at the preset start, excluding future game events at turn zero', () => {
    const base = buildRealityAdvisorContext(country('KHM', 0.8, -2)).advisorContext;
    const context = withAdvisorStrategicContext(base, '2000-01-01', [record('future', '2001-01-01', 1, 'EVENTO_FUTURO')], '');
    const prompt = buildRealityAdvisorPrompt(context, 'Conosci il paese?');
    expect(prompt).toContain('2000-01-01');
    expect(prompt).toContain('storia reale solo fino alla data iniziale');
    expect(prompt).toContain('dopo quella data');
    expect(prompt).not.toContain('EVENTO_FUTURO');
  });

  it('keeps an older relevant reform beyond the recent tail and admits only dated, elapsed game records', () => {
    const world = country('KHM', 2, 1);
    world.date = '2002-01-01'; world.turn = 20;
    const records = [record('reform', '2000-02-01', 1, 'Riforma agraria approvata')];
    for (let i = 2; i <= 19; i++) records.push(record(`r${i}`, `2001-${String(Math.ceil(i / 2)).padStart(2, '0')}-01`, i, `Cronaca ${i}`));
    records.push(record('future', '2003-01-01', 21, 'EVENTO_FUTURO'));
    const context = withAdvisorStrategicContext(buildRealityAdvisorContext(world).advisorContext, '2000-01-01', records, 'riforma agraria');
    const prompt = buildRealityAdvisorPrompt(context, 'Come procede la riforma agraria?');
    expect(prompt).toContain('Riforma agraria approvata');
    expect(prompt).toContain('2000-02-01');
    expect(prompt).toContain('Cronaca 19');
    expect(prompt).not.toContain('EVENTO_FUTURO');
    expect(prompt).toContain('non provano causalità');
    expect(context.strategicHistory!.length).toBeLessThanOrEqual(16);
  });
});
