/**
 * WS-GOVUX-P1 — L'agenda viva del Consiglio: il selettore puro
 * ===========================================================
 * Difende le regole della fase P1, non l'aspetto:
 *  - i quattro stati hanno una **regola verificabile** e una precedenza;
 *  - **nessuna urgenza inventata**: `richiede attenzione` solo da una voce del
 *    motore con urgenza `critica`, mai dal testo o da una stima;
 *  - l'ordinamento è **stabile** (l'ordine dichiarato delle sedie);
 *  - la **sintesi** è contata sugli stessi record della lista;
 *  - aprire una sedia riprende il colloquio: i dati di ripresa sono nel record.
 */
import { describe, expect, it } from 'vitest';
import {
  COUNCIL_SEAT_ORDER, COUNCIL_STATE_LABEL, councilSeatState, deriveCouncilAgenda,
} from './councilAgenda';
import type { CabinetAddressView, CabinetSessionView } from '../../services/api';
import type { MinisterMemoryRecord } from './ministerMemory';
import type { AdvisorMessage } from '../../stores/chatStore';

function address(seat: CabinetAddressView['seat'], overrides: Partial<CabinetAddressView> = {}): CabinetAddressView {
  return {
    seat,
    label: `Ministro (${seat})`,
    reads: `competenze ${seat}`,
    opening: `Apertura del ministro ${seat}.`,
    items: [],
    ...overrides,
  };
}

function item(urgency: 'ordinaria' | 'urgente' | 'critica', need: string): CabinetAddressView['items'][number] {
  return { voiceId: `v-${need}`, need, because: `perché ${need}`, urgency, figures: [], paths: [] };
}

function session(addresses: CabinetAddressView[]): CabinetSessionView {
  return {
    addresses,
    president: { opening: 'Il consiglio è riunito.', closing: 'Seduta chiusa.' },
    summary: { total: 0, critical: 0 },
    canonicalMutation: false,
  };
}

function memory(kind: MinisterMemoryRecord['kind']): MinisterMemoryRecord {
  return {
    id: `${kind}-${Math.random()}`,
    kind,
    summary: `ricordo ${kind}`,
    state: 'open',
    refs: { gameDate: '1951-01-01' },
  };
}

const message = (content: string): AdvisorMessage => ({ role: 'user', content });

describe('P1 — lo stato di una sedia', () => {
  it('solo una voce CRITICA del motore produce «richiede attenzione»', () => {
    expect(councilSeatState({ criticalCount: 1, thread: [], memory: [] })).toBe('richiede-attenzione');
    // Urgente e ordinaria NON sono attenzione: il selettore non inventa urgenza.
    expect(councilSeatState({ criticalCount: 0, thread: [], memory: [] })).toBe('disponibile');
  });

  it('una proposta discussa non firmata mette la sedia «in attesa di decisione»', () => {
    expect(councilSeatState({ criticalCount: 0, thread: [], memory: [memory('proposal-discussed')] })).toBe('in-attesa-di-decisione');
  });

  it('una decisione accodata DOPO la proposta scioglie l’attesa', () => {
    const records = [memory('proposal-discussed'), memory('queued-decision')];
    expect(councilSeatState({ criticalCount: 0, thread: [], memory: records })).toBe('disponibile');
    // E una nuova proposta dopo la decisione riapre l’attesa.
    const reopened = [...records, memory('proposal-discussed')];
    expect(councilSeatState({ criticalCount: 0, thread: [], memory: reopened })).toBe('in-attesa-di-decisione');
  });

  it('un colloquio avviato o una questione aperta dicono «discussione aperta»', () => {
    expect(councilSeatState({ criticalCount: 0, thread: [message('Buongiorno')], memory: [] })).toBe('discussione-aperta');
    expect(councilSeatState({ criticalCount: 0, thread: [], memory: [memory('open-question')] })).toBe('discussione-aperta');
    // Una decisione accodata dopo la domanda aperta chiude la discussione.
    expect(councilSeatState({ criticalCount: 0, thread: [], memory: [memory('open-question'), memory('queued-decision')] })).toBe('disponibile');
  });

  it('l’attenzione critica vince su tutto', () => {
    expect(councilSeatState({ criticalCount: 2, thread: [message('x')], memory: [memory('proposal-discussed')] })).toBe('richiede-attenzione');
  });

  it('le quattro etichette sono in italiano e distinte', () => {
    expect(Object.values(COUNCIL_STATE_LABEL)).toEqual([
      'richiede attenzione', 'in attesa di decisione', 'discussione aperta', 'disponibile',
    ]);
  });
});

describe('P1 — l’agenda del Consiglio', () => {
  it('ordina le sedie con l’ordine dichiarato, anche se l’input è disordinato', () => {
    const agenda = deriveCouncilAgenda({
      session: session([address('guerra'), address('tesoro'), address('lavori')]),
      threads: {}, memory: {},
    });
    expect(agenda.entries.map(entry => entry.seat)).toEqual(['tesoro', 'lavori', 'guerra']);
    expect(COUNCIL_SEAT_ORDER.slice(0, 3)).toEqual(['tesoro', 'lavori', 'istruzione']);
  });

  it('la sintesi è contata sugli stessi record della lista', () => {
    const agenda = deriveCouncilAgenda({
      session: session([
        address('tesoro', { items: [item('critica', 'Manca acciaio')] }),
        address('lavori', { items: [item('ordinaria', 'Aprire il cantiere')] }),
        address('guerra', { items: [item('urgente', 'Riserve basse')] }),
      ]),
      threads: { lavori: [message('parliamo del cantiere')] },
      memory: { guerra: [memory('proposal-discussed')] },
    });
    const { entries, summary } = agenda;
    expect(summary).toEqual({
      total: 3,
      attention: entries.filter(e => e.state === 'richiede-attenzione').length,
      inDecision: entries.filter(e => e.state === 'in-attesa-di-decisione').length,
      discussing: entries.filter(e => e.state === 'discussione-aperta').length,
      available: entries.filter(e => e.state === 'disponibile').length,
      questions: 3,
    });
    expect(summary).toEqual({ total: 3, attention: 1, inDecision: 1, discussing: 1, available: 0, questions: 3 });
  });

  it('porta nome, ruolo, frase breve, argomento e questioni; niente numero inventato', () => {
    const agenda = deriveCouncilAgenda({
      session: session([address('tesoro', {
        label: 'Ministro del Tesoro',
        reads: 'bilancio, debito e cassa',
        opening: 'La cassa regge, ma il margine si assottiglia.',
        items: [item('urgente', 'Coprire il disavanzo'), item('ordinaria', 'Rifinanziare il debito')],
      })]),
      threads: {}, memory: {},
    });
    expect(agenda.entries[0]).toMatchObject({
      seat: 'tesoro',
      label: 'Ministro del Tesoro',
      role: 'bilancio, debito e cassa',
      brief: 'La cassa regge, ma il margine si assottiglia.',
      topic: 'Coprire il disavanzo',
      questions: ['Coprire il disavanzo', 'Rifinanziare il debito'],
      criticalCount: 0,
      state: 'disponibile',
    });
  });

  it('una sedia con un colloquio avviato porta il conteggio degli scambi (si riprende)', () => {
    const agenda = deriveCouncilAgenda({
      session: session([address('tesoro', { items: [item('ordinaria', 'Bilancio')] })]),
      threads: { tesoro: [message('Buongiorno'), { role: 'assistant', content: 'Presidente.' }] },
      memory: {},
    });
    expect(agenda.entries[0].messageCount).toBe(2);
    expect(agenda.entries[0].state).toBe('discussione-aperta');
  });

  it('una seduta senza ministri produce un’agenda vuota, non un errore', () => {
    expect(deriveCouncilAgenda({ session: null, threads: {}, memory: {} })).toEqual({
      entries: [],
      summary: { total: 0, attention: 0, inDecision: 0, discussing: 0, available: 0, questions: 0 },
    });
    expect(deriveCouncilAgenda({ session: session([]), threads: {}, memory: {} }).entries).toEqual([]);
  });
});
