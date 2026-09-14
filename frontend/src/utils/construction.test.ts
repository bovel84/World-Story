import { describe, expect, it } from 'vitest';
import { constructionReport } from './construction';

describe('Construction dossier and popup', () => {
  it('shows saved phases, blockers and next steps without manufacturing progress', () => {
    const report = constructionReport({ id: '1', type: 'construction_site', name: 'Porto', metadata: {
      phase: 'testing', status: 'paused', expectedDate: '1951-04-01', blocker: 'Mancano i generatori', nextStep: 'Completare le prove', progress: 92,
    } });
    expect(report).toContainEqual({ label: 'Fase', value: 'Collaudo' });
    expect(report).toContainEqual({ label: 'Stato', value: 'Lavori sospesi' });
    expect(report).toContainEqual({ label: 'Impedimento', value: 'Mancano i generatori' });
    expect(report.some(row => row.label === 'Previsione (non garantita)')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('92');
  });
  it('tolerates old saves, invalid dates and completed facilities', () => {
    expect(constructionReport({ id: '1', name: 'Porto', type: 'construction_site' })).toEqual([{ label: 'Stato', value: 'Cantiere aperto' }]);
    expect(constructionReport({ id: '1', name: 'Porto', type: 'construction_site', metadata: { expectedDate: '1951-02-30', blocker: {}, phase: 'fake' } })).toHaveLength(1);
    expect(constructionReport({ id: '1', name: 'Porto', type: 'port', metadata: { blocker: 'Dato passato' } })).toEqual([]);
  });
});
