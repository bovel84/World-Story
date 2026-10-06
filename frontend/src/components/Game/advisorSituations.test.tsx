/**
 * WS-CONSULENTE-SITUAZIONI — Le situazioni sono card cliccabili nel Consulente.
 *
 * Difende: nessun troncamento a 3, una situazione senza CouncilIssue resta
 * visibile, e «Approfondisci» non apre il Consiglio (nessun «Porta al Consiglio»
 * nella card; il click passa dal focus del Consulente).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdvisorSituationsPanel, buildSituationFocusMessage } from './AdvisorSituationsPanel';
import type { AdvisorSituation } from '../../services/api';

const situation = (n: number): AdvisorSituation => ({
  id: `s${n}`, title: `Titolo ${n}`, summary: `Sintesi ${n}`, signalKeys: [`signal-${n}`], importance: 2,
});

describe('AdvisorSituationsPanel', () => {
  it('mostra TUTTE le situazioni, senza troncamento a 3', () => {
    const list = [1, 2, 3, 4, 5].map(situation);
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={list} onDeepen={() => {}} />);
    for (const item of list) {
      expect(html).toContain(item.title);
      expect(html).toContain(item.summary);
    }
    expect((html.match(/Approfondisci/g) ?? [])).toHaveLength(5);
    expect(html).not.toContain('Porta al Consiglio');
  });

  it('una situazione senza CouncilIssue è comunque visibile', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[situation(7)]} onDeepen={() => {}} />);
    expect(html).toContain('Titolo 7');
    expect(html).toContain('Approfondisci');
    expect(html).not.toContain('Porta al Consiglio');
  });

  it('senza situazioni non rende nulla', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[]} onDeepen={() => {}} />);
    expect(html).toBe('');
  });

  it('«Approfondisci» prepara il focus del Consulente, non una proposta', () => {
    const onDeepen = vi.fn();
    const situationSeven = situation(7);
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[situationSeven]} onDeepen={onDeepen} />);
    expect(html).toContain('advisor-situation-deepen');
    // Il messaggio di focus cita la situazione; nessuna apertura del Consiglio.
    const message = buildSituationFocusMessage(situationSeven);
    expect(message).toContain('Titolo 7');
    expect(message).toContain('Sintesi 7');
    expect(message).not.toContain('Consiglio');
  });
});
