import { describe, expect, it } from 'vitest';
import { explainFeasibility } from './feasibilityExplanation';

describe('U02 µ2 — explainFeasibility', () => {
  it('input non valido → vista vuota e status unknown', () => {
    for (const value of [undefined, null, 'x', 42, []]) {
      const view = explainFeasibility(value);
      expect(view.status).toBe('unknown');
      expect(view.needsData).toBe(false);
      expect(view.blockers).toEqual([]);
      expect(view.alternatives).toEqual([]);
    }
  });

  it('mappa i blocker con etichetta leggibile e ciò che manca', () => {
    const view = explainFeasibility({
      status: 'blocked',
      blockers: [
        { code: 'KNOWLEDGE_MISSING', detail: 'serve la tecnologia X', missing: ['tech.x'], targetId: 'fac-1' },
        { code: 'DEPENDENCY_BLOCKED', detail: 'attende il passo A' },
      ],
    });
    expect(view.blockers).toHaveLength(2);
    expect(view.blockers[0]).toMatchObject({
      code: 'KNOWLEDGE_MISSING', label: 'Conoscenza mancante', missing: ['tech.x'], targetId: 'fac-1',
    });
    expect(view.blockers[1].label).toBe('Dipende da un passo precedente');
    expect(view.needsData).toBe(false);
  });

  it('uno status needs_data segnala dati mancanti anche senza blocker DATA_UNAVAILABLE', () => {
    const view = explainFeasibility({ status: 'needs_data', blockers: [] });
    expect(view.status).toBe('needs_data');
    expect(view.needsData).toBe(true);
  });

  it('un blocker DATA_UNAVAILABLE segnala dati mancanti anche con status blocked', () => {
    const view = explainFeasibility({
      status: 'blocked',
      blockers: [{ code: 'DATA_UNAVAILABLE', detail: 'giacimento non censito' }],
    });
    expect(view.needsData).toBe(true);
    expect(view.dataNotes).toEqual(['giacimento non censito']);
  });

  it('le alternative restano proposte da confermare, mai azioni automatiche', () => {
    const view = explainFeasibility({
      status: 'blocked',
      alternatives: [
        { kind: 'research', missing: ['tech.x'] },
        { kind: 'alternative_path', missing: ['fornitore B'] },
        { kind: 'unknown_kind' },
      ],
    });
    expect(view.alternatives).toEqual([
      { kind: 'research', label: 'Pianifica la ricerca', missing: ['tech.x'], requiresConfirmation: true },
      { kind: 'alternative_path', label: 'Percorso alternativo', missing: ['fornitore B'], requiresConfirmation: true },
    ]);
    expect(view.alternatives.every(a => a.requiresConfirmation === true)).toBe(true);
  });

  it('ignora valori non-stringa in missing e codici non riconosciuti', () => {
    const view = explainFeasibility({
      status: 'blocked',
      blockers: [{ code: 'MADE_UP', detail: 'x', missing: ['ok', 1, null, ''] }],
    });
    expect(view.blockers[0].label).toBe('MADE_UP');
    expect(view.blockers[0].missing).toEqual(['ok']);
  });
});
