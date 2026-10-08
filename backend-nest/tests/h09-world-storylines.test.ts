/**
 * H09 — Il mondo racconta i filoni.
 *
 * Difende le invarianti:
 *  - un filone del preset fa entrare in scena i suoi **protagonisti**: sono un
 *    trigger del mondo, come un impegno o un'agenda NPC;
 *  - vale per le **nazioni non giocate** (il respiro del mondo non racconta gli
 *    ordini del giocatore);
 *  - la direzione del filone resta una **tendenza** (H-I12), e il prompt vieta di
 *    narrarlo come **risolto**;
 *  - zero filoni → nessun effetto sulla selezione.
 */
import { describe, it, expect } from 'vitest';
import { selectWorldPulseCandidates, buildWorldPulsePrompt, type WorldPulseSelectionInput } from '../src/prompts/simulation/worldPulse';

function input(over: Partial<WorldPulseSelectionInput> = {}): WorldPulseSelectionInput {
  return {
    playerPolityId: 'ITA',
    polities: [
      { id: 'ITA', name: 'Italia' },
      { id: 'ISR', name: 'Israele' },
      { id: 'PSE', name: 'Palestina' },
      { id: 'USA', name: 'Stati Uniti' },
    ],
    relationships: [],
    commitments: '',
    recentEvents: [],
    npcDossiers: '',
    originDate: '2000-06-01',
    targetDate: '2000-12-01',
    ...over,
  };
}

const filone = {
  id: 'levante-disarmo-hamas', title: 'Il disarmo di Hamas',
  summary: 'Israele e gli USA premono per il disarmo.',
  parties: ['ISR', 'PSE', 'USA'],
  trajectory: 'Se nessuno lo devia, scivola verso lo scontro.',
};

describe('H09 — i filoni fanno entrare in scena i protagonisti', () => {
  it('un filone è un trigger: le sue parti diventano candidate', () => {
    const candidates = selectWorldPulseCandidates(input({ storylines: [filone] }));
    const ids = candidates.map(c => c.polityId).sort();
    expect(ids).toEqual(['ISR', 'PSE', 'USA']);
    for (const candidate of candidates) {
      expect(candidate.storylineTriggers.length).toBe(1);
      expect(candidate.triggers.join(' ')).toContain('filone del mondo');
    }
  });

  it('il GIOCATORE non entra dalle sue parti (il pulse non racconta i suoi ordini)', () => {
    const conItalia = { ...filone, parties: ['ITA', 'ISR'] };
    const candidates = selectWorldPulseCandidates(input({ storylines: [conItalia] }));
    expect(candidates.map(c => c.polityId)).not.toContain('ITA');
    expect(candidates.map(c => c.polityId)).toContain('ISR');
  });

  it('una parte assente dal mondo non è un candidato', () => {
    const candidates = selectWorldPulseCandidates(input({ storylines: [filone] }));
    expect(candidates.map(c => c.polityId)).not.toContain('EGY');
  });

  it('senza filoni nessun candidato nasce dal nulla', () => {
    const candidates = selectWorldPulseCandidates(input({ storylines: [] }));
    expect(candidates).toEqual([]);
  });

  it('un filone è contesto, non un doppione: i candidati restano quelli con trigger', () => {
    // Con un evento recente su Israele E un filone, Israele resta un candidato solo.
    const withEvent = input({
      storylines: [filone],
      recentEvents: [{ date: '2000-05-01', headline: 'Israele richiama i riservisti' }],
    });
    const candidates = selectWorldPulseCandidates(withEvent);
    expect(candidates.filter(c => c.polityId === 'ISR').length).toBe(1);
  });
});

describe('H09 — il prompt vieta la profezia e la risoluzione', () => {
  const candidates = selectWorldPulseCandidates(input({ storylines: [filone] }));
  const prompt = buildWorldPulsePrompt({
    originDate: '2000-06-01', targetDate: '2000-12-01', divergenceDate: '2000-01-01',
    playerPolity: 'Italia', candidates, mainEvents: [], relationshipChanges: [], recentChronicle: '',
  });

  it('dichiara il filone un trigger e vieta di narrarlo come risolto', () => {
    expect(prompt).toContain('filone del mondo');
    expect(prompt).toContain('non narrarlo come risolto');
  });

  it('la direzione è una tendenza, mai una profezia (H-I12)', () => {
    expect(prompt).toContain('mai una profezia');
  });

  it('il blocco narrativa-only resta in vigore (un filone non autorizza mutazioni)', () => {
    expect(prompt).toContain('CONTRATTO NARRATIVA-ONLY');
  });
});
