/**
 * WS-GOV-COUNCIL-HARDENING — La voce del ministro e il fallback (punti 18/19)
 * ============================================================================
 * Difende la separazione: i FATTI restano nella Tavola e nel brief; la VOCE è
 * dell'LLM ma non può contraddire i fatti. Se il provider manca o inventa una
 * cifra, si ricade sul **contributo deterministico del motore** (il fallback
 * passato dal chiamante) e la riunione continua.
 *
 * La personalità NON è testata qui: il profilo autorevole vive lato server
 * (`MinisterPersona.ts`) e lo inietta `government/minister`. Qui si prova il
 * confine: il brief non è una fonte e la prosa non aggiunge cifre.
 */
import { describe, expect, it } from 'vitest';
import { applyEngineRead, openMeeting, seatSpeaker } from './councilMeeting';
import type { MeetingEngineRead } from './councilMeeting';
import {
  meetingBriefFor, narrativeContribution, narrativePrompt, narrativeRespectsFacts,
} from './meetingNarrative';

function read(): MeetingEngineRead {
  return {
    workLabel: 'Fabbrica siderurgica',
    regionLabel: 'Sarajevo',
    durationDays: 180,
    materials: [{ name: 'Acciaio', ok: true }],
    costLabel: '2,40 mld',
    costNote: null,
    coverage: 'covered',
    availableLabel: null,
    money: { required: '2,40', available: '2,70', missing: null, margin: '0,30', holder: 'POL', unit: 'mld', coverage: 'covered' },
    location: { status: 'resolved', candidates: [{ regionId: 'SARAJEVO', regionLabel: 'Sarajevo' }], region: { regionId: 'SARAJEVO', regionLabel: 'Sarajevo' } },
    risks: [],
    prerequisites: [],
    summary: 'Ordine fattibile',
    workId: 'work-fabbrica',
    regionId: 'SARAJEVO',
    workDeclaration: { workId: 'work-fabbrica', payerActorId: 'POL', materialActorId: 'POL', funded: true, missingMaterials: [] },
    source: 'check-feasibility',
  };
}

function meeting() {
  const opened = openMeeting({ gameId: 'g', branchId: null, turn: 10, subject: 'Voglio costruire una fabbrica siderurgica a Sarajevo.' })!;
  return applyEngineRead(opened, read());
}

/** Il fallback che il chiamante passa: il contributo deterministico del motore. */
function fallbackFor(seat: 'tesoro' | 'lavori'): string {
  return meeting().contributions.find(contribution => contribution.seat === seat)?.text ?? '';
}

describe('contratto narrativo (punto 18)', () => {
  it('il brief porta i fatti esatti e i blocchi, senza cifre nuove', () => {
    const brief = meetingBriefFor(meeting(), read(), 'tesoro');
    const costo = brief.facts.find(fact => fact.label === 'Costo opera');
    const disponibile = brief.facts.find(fact => fact.label === 'Disponibile');
    expect(costo?.value).toBe('2,40 mld');
    expect(disponibile?.value).toBe('2,70 mld');
    expect(brief.facts.every(fact => fact.source === 'check-feasibility')).toBe(true);
  });

  it('la Tavola mostra sempre i valori esatti, qualunque sia la voce', async () => {
    const current = meeting();
    const brief = meetingBriefFor(current, read(), 'tesoro');
    const narrated = await narrativeContribution(
      brief,
      fallbackFor('tesoro'),
      async () => 'La copertura c’è, ma il margine è ridotto.',
    );

    // La voce LLM è usata e attribuita al Tesoro.
    expect(narrated.source).toBe('llm');
    expect(seatSpeaker('tesoro')).toBe('Ministro del Tesoro');
    // La Tavola conserva i fatti: i valori esatti restano nella riunione.
    const tesoro = current.workspace.lines.filter(line => line.owner === 'tesoro');
    expect(tesoro.some(line => line.label === 'Costo opera' && line.value === '2,40 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Disponibile' && line.value === '2,70 mld')).toBe(true);
    expect(tesoro.some(line => line.label === 'Margine' && line.value === '0,30 mld')).toBe(true);
  });

  it('il prompt contiene i fatti e non chiede al modello di calcolare', () => {
    const prompt = narrativePrompt(meetingBriefFor(meeting(), read(), 'tesoro'));
    expect(prompt).toContain('2,40 mld');
    expect(prompt).toContain('2,70 mld');
    expect(prompt).toContain('materiale verificato');
    expect(prompt).not.toContain('calcola');
    // Le etichette interne della struttura del briefing non finiscono nel testo.
    expect(prompt).not.toContain('FATTI / LETTURA / PROPOSTA');
  });
});

describe('l’LLM non modifica i fatti (punto 7)', () => {
  it('una cifra non presente nei fatti invalida la prosa', () => {
    const brief = meetingBriefFor(meeting(), read(), 'tesoro');
    expect(narrativeRespectsFacts('La copertura c’è, ma il margine è ridotto.', brief)).toBe(true);
    expect(narrativeRespectsFacts('Abbiamo circa 4 miliardi.', brief)).toBe(false);
  });

  it('prosa con cifra inventata → fallback deterministico del motore', async () => {
    const brief = meetingBriefFor(meeting(), read(), 'tesoro');
    const fallback = fallbackFor('tesoro');
    const narrated = await narrativeContribution(brief, fallback, async () => 'Abbiamo circa 4 miliardi.');
    expect(narrated.source).toBe('deterministic');
    expect(narrated.text).toBe(fallback);
  });
});

describe('fallback: il provider assente non blocca la riunione (punto 19)', () => {
  it('provider in errore → contributo deterministico del motore, con i fatti', async () => {
    const brief = meetingBriefFor(meeting(), read(), 'lavori');
    const fallback = fallbackFor('lavori');
    const narrated = await narrativeContribution(brief, fallback, async () => { throw new Error('provider offline'); });
    expect(narrated.source).toBe('deterministic');
    // Il fallback è la formulazione del motore: nomina opera e materiali.
    expect(narrated.text).toContain('Fabbrica siderurgica');
    expect(narrated.text).toContain('distinta');
    expect(narrated.text).toBe(fallback);
  });

  it('senza renderer il fallback è sempre disponibile', async () => {
    const brief = meetingBriefFor(meeting(), read(), 'tesoro');
    const fallback = fallbackFor('tesoro');
    const narrated = await narrativeContribution(brief, fallback);
    expect(narrated.source).toBe('deterministic');
    expect(narrated.text).toContain('2,40 mld');
  });

  it('il brief di una sedia senza contributi reali non inventa fatti', () => {
    const brief = meetingBriefFor(meeting(), read(), 'guerra');
    expect(brief.facts).toEqual([]);
    expect(brief.blockers).toEqual([]);
  });
});
