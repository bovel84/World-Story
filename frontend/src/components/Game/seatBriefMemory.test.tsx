/**
 * WS-MINISTER-UX-05 — La memoria visibile nel fascicolo della sedia
 * ================================================================
 * Il fascicolo mostra i ricordi della sedia e, per una proposta respinta, il
 * motivo: è la differenza fra «discussa», «respinta» e «accodata» che la
 * roadmap chiede di non confondere.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeatBrief } from './SeatBrief';
import { recordMemory, discussedProposal, queuedDecision } from './ministerMemory';
import type { CabinetAddressView } from '../../services/api';

const address: CabinetAddressView = {
  seat: 'tesoro',
  label: 'Ministro del Tesoro',
  reads: 'bilancio, debito, cassa',
  opening: 'Apertura.',
  items: [{
    voiceId: 'debt_service',
    need: 'Coprire il disavanzo',
    because: 'Le uscite superano le entrate',
    urgency: 'critica',
    figures: [{ label: 'Fabbisogno', value: '12', unit: 'mld', basis: { kind: 'measured', source: 'conti' } }],
    paths: [],
  }],
};

describe('WS-MINISTER-UX-05 — memoria nel fascicolo', () => {
  it('senza ricordi non compare la sezione', () => {
    const html = renderToStaticMarkup(<SeatBrief address={address} />);
    expect(html).not.toContain('Cosa ricorda il ministro');
  });

  it('una proposta respinta mostra stato e motivo', () => {
    const memory = recordMemory(recordMemory([], discussedProposal('tesoro', { id: 'a', title: 'Ospedale' }, { gameDate: '1951-03-01' })), {
      id: 'tesoro:proposta:a', kind: 'proposal-rejected', summary: 'Proposta discussa: Ospedale',
      reason: 'la distinta non è coperta', state: 'rejected', refs: { messageId: 'tesoro#2', gameDate: '1951-03-01' },
    });
    const html = renderToStaticMarkup(<SeatBrief address={address} memory={memory} />);
    expect(html).toContain('Cosa ricorda il ministro');
    expect(html).toContain('respinta · respinta');
    expect(html).toContain('motivo: la distinta non è coperta');
    expect(html).toContain('messaggio tesoro#2');
  });

  it('un atto accodato è distinto da una proposta discussa', () => {
    const memory = recordMemory([], queuedDecision('tesoro', 'Rimborsa i titoli', { gameDate: '1951-04-01' }));
    const html = renderToStaticMarkup(<SeatBrief address={address} memory={memory} />);
    expect(html).toContain('accodata · accodata');
    expect(html).toContain('Atto accodato: Rimborsa i titoli');
  });
});
