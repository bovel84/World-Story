/**
 * WS-CONSULENTE-SITUAZIONI — Le situazioni sono card cliccabili nel Consulente.
 *
 * Difende: nessun troncamento a 3, una situazione senza CouncilIssue resta
 * visibile, e «Approfondisci» non apre il Consiglio (nessun «Porta al Consiglio»
 * nella card; il click passa dal focus del Consulente).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdvisorSituationsPanel, buildSituationFocusMessage, importanceLabel } from './AdvisorSituationsPanel';
import type { AdvisorSituation } from '../../services/api';

const situation = (n: number, importance = 2): AdvisorSituation => ({
  id: `s${n}`, title: `Titolo ${n}`, summary: `Sintesi ${n}`, signalKeys: [`signal-${n}`], importance,
});

describe('AdvisorSituationsPanel', () => {
  it('mostra TUTTE le situazioni, senza troncamento a 3', () => {
    const list = [1, 2, 3, 4, 5].map(situation);
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={list} onDeepen={() => {}} />);
    for (const item of list) {
      expect(html).toContain(item.title);
      expect(html).toContain(item.summary);
    }
    expect((html.match(/advisor-situation-deepen/g) ?? [])).toHaveLength(5);
    expect(html).not.toContain('Porta al Consiglio');
  });

  it('una situazione senza CouncilIssue è comunque visibile', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[situation(7)]} onDeepen={() => {}} />);
    expect(html).toContain('Titolo 7');
    expect(html).toContain('Approfondisci');
    expect(html).not.toContain('Porta al Consiglio');
  });

  it('presenta la scrivania: header, badge testuali e nessun dato tecnico', () => {
    const list = [situation(1, 3), situation(2, 2), situation(3, 1)];
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={list} onDeepen={() => {}} activeId="s2" />);
    expect(html).toContain('Situazioni sul tavolo');
    expect(html).toContain('Questioni che richiedono attenzione');
    // L'importanza è testo, non solo colore.
    expect(html).toContain('Urgente');
    expect(html).toContain('Da seguire');
    expect(html).toContain('Opportunità');
    // Stato attivo della card selezionata.
    expect(html).toContain('advisor-situation-card active');
    expect(html).toContain('data-situation-id="s2"');
    // Niente JSON, signalKeys o importanza numerica in chiaro.
    expect(html).not.toContain('signal-1');
    expect(html).not.toContain('signalKeys');
    expect(html).not.toContain('"importance"');
  });

  it('importanceLabel mappa 3/2/1 su Urgente, Da seguire, Opportunità', () => {
    expect(importanceLabel(3)).toBe('Urgente');
    expect(importanceLabel(2)).toBe('Da seguire');
    expect(importanceLabel(1)).toBe('Opportunità');
    expect(importanceLabel(0)).toBe('Opportunità');
  });

  it('con molte situazioni attiva la lista scorrevole, senza nasconderle dietro «+N»', () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8].map(n => situation(n));
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={list} onDeepen={() => {}} />);
    expect(html).toContain('data-many="true"');
    for (const item of list) expect(html).toContain(item.title);
    expect(html).not.toMatch(/\+\s*\d+\s*altre/i);
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
