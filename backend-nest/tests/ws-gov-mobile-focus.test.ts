/**
 * WS-GOV-MOBILE-FOCUS (A6/A7) — La voce della riunione, read-only.
 *
 * Prova che il modulo puro ricostruisce il brief solo da dati validi, compone il
 * messaggio riusando la persona **autorevole** (`MinisterPersona`) e ripulisce
 * la risposta dalle direttive. La rotta che lo usa non persiste memoria: la
 * prova d'integrazione resta nella suite della rotta, qui si prova il contratto.
 */
import { describe, expect, it } from 'vitest';
import {
  composeMeetingNarrativeMessage,
  normalizeMinisterMeetingBrief,
  stripNarrativeDirectives,
} from '../src/core/government/MeetingNarrative';
import { MINISTER_PERSONAS } from '../src/core/government/MinisterPersona';

describe('normalizeMinisterMeetingBrief', () => {
  it('accetta un brief valido e conserva i fatti verificati', () => {
    const brief = normalizeMinisterMeetingBrief({
      seat: 'tesoro',
      facts: [{ label: 'Costo opera', value: '2,4 mld', status: 'ok', source: 'check-feasibility' }],
      blockers: ['Dove deve sorgere l’opera?'],
      politicalContext: [],
      meetingObjective: 'Fabbrica siderurgica',
      previousContributions: ['Ministro dei Lavori: la distinta è coperta.'],
    });
    expect(brief).not.toBeNull();
    expect(brief!.seat).toBe('tesoro');
    expect(brief!.facts).toHaveLength(1);
    expect(brief!.blockers).toEqual(['Dove deve sorgere l’opera?']);
  });

  it('rifiuta una sedia sconosciuta o un payload non strutturato', () => {
    expect(normalizeMinisterMeetingBrief({ seat: 're', facts: [] })).toBeNull();
    expect(normalizeMinisterMeetingBrief('nope')).toBeNull();
    expect(normalizeMinisterMeetingBrief(null)).toBeNull();
  });

  it('scarta i fatti senza etichetta o senza provenienza', () => {
    const brief = normalizeMinisterMeetingBrief({
      seat: 'lavori',
      facts: [{ label: 'Opera', value: 'x' }, { value: 'y', source: 'z' }, { label: 'Durata', source: 'check-feasibility' }],
    });
    expect(brief!.facts).toHaveLength(1);
    expect(brief!.facts[0].label).toBe('Durata');
  });
});

describe('composeMeetingNarrativeMessage', () => {
  it('riusa la persona autorevole della sedia e vieta le direttive', () => {
    const brief = normalizeMinisterMeetingBrief({
      seat: 'tesoro',
      facts: [{ label: 'Disponibile', value: '2,7 mld', source: 'check-feasibility' }],
      blockers: [], politicalContext: [], meetingObjective: 'Fabbrica', previousContributions: [],
    })!;
    const message = composeMeetingNarrativeMessage(brief);
    expect(message).toContain(MINISTER_PERSONAS.tesoro.mandate);
    expect(message).toContain('2,7 mld');
    expect(message).toContain('fonte: check-feasibility');
    expect(message).toContain('decision');
    expect(message).toContain('tavola');
  });

  it('dichiara l’assenza quando la sedia non ha dati in questa riunione', () => {
    const brief = normalizeMinisterMeetingBrief({ seat: 'sanita', facts: [], meetingObjective: 'x' })!;
    expect(composeMeetingNarrativeMessage(brief)).toContain('nessun dato di competenza');
  });
});

describe('stripNarrativeDirectives', () => {
  it('rimuove i blocchi tecnici e conserva la prosa', () => {
    const raw = 'La copertura c’è.\n```decision\n{"op":"accept-proposal"}\n```\nIl margine regge.\n```tavola\n{"x":1}\n```';
    const clean = stripNarrativeDirectives(raw);
    expect(clean).toContain('La copertura c’è.');
    expect(clean).toContain('Il margine regge.');
    expect(clean).not.toContain('accept-proposal');
    expect(clean).not.toContain('```');
  });

  it('non altera una risposta già pulita', () => {
    expect(stripNarrativeDirectives('Solo prosa.')).toBe('Solo prosa.');
  });
});
