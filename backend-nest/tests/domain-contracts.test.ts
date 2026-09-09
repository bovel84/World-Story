import { describe, expect, it } from 'vitest';
import {
  DomainContractError,
  parseActionOutcome,
  parseActionOutcomeBatch,
  parseEventProposal,
  parseOrderIntent,
  parseProjectReference,
} from '../src/domain/contracts';

describe('contratti runtime F01', () => {
  it('accetta un ordine, outcome e progetto canonici con ID esatti', () => {
    expect(parseOrderIntent({ id: 'action-1', text: 'Costruire il deposito' }))
      .toEqual({ id: 'action-1', text: 'Costruire il deposito' });
    expect(parseActionOutcome({ actionId: 'action-1', status: 'partial', summary: 'Manca acciaio' }))
      .toMatchObject({ actionId: 'action-1', status: 'partial', summary: 'Manca acciaio' });
    expect(parseProjectReference({
      id: 'project-1', sourceActionId: 'action-1', title: 'Deposito', summary: 'Fase iniziale', startedDate: '1951-01-01',
    })).toMatchObject({ id: 'project-1', sourceActionId: 'action-1' });
  });

  it('rifiuta ID/enum/date e proposte evento non validi', () => {
    expect(() => parseOrderIntent({ id: '', text: 'x' })).toThrow(DomainContractError);
    expect(() => parseActionOutcome({ actionId: 'action-1', status: 'free', summary: 'x' })).toThrow(DomainContractError);
    expect(() => parseProjectReference({ id: 'p', sourceActionId: 'a', title: 'x', summary: 'y', startedDate: '01/01/1951' }))
      .toThrow(DomainContractError);
    expect(() => parseEventProposal({ headline: 'x', description: 'y', date: '1951-02-30', mapChanges: [] }))
      .toThrow(DomainContractError);
  });

  it('rifiuta outcome duplicati o estranei al lotto', () => {
    expect(() => parseActionOutcomeBatch([
      { actionId: 'action-1', status: 'accepted', summary: 'ok' },
      { actionId: 'action-1', status: 'rejected', summary: 'duplicato' },
    ], ['action-1'])).toThrow(DomainContractError);
    expect(() => parseActionOutcomeBatch([
      { actionId: 'external', status: 'accepted', summary: 'no' },
    ], ['action-1'])).toThrow(DomainContractError);
  });

  it('ammette testo soltanto attraverso l’adapter legacy esplicito', () => {
    expect(() => parseActionOutcome({ action: 'testo legacy', status: 'accepted', summary: 'ok' }))
      .toThrow(DomainContractError);
    expect(parseActionOutcome(
      { action: 'testo legacy', status: 'accepted', summary: 'ok' },
      { allowLegacyText: true },
    )).toMatchObject({ action: 'testo legacy' });
  });
});
