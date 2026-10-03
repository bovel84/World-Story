import { describe, expect, it } from 'vitest';
import { resolveCouncilExecution } from './councilExecution';
import type { ProposalActDraft } from './actDraft';
const draft: ProposalActDraft = { id: 'd1', seat: 'council', roadId: 'p1', title: 'Fabbrica', text: 'Costruire una fabbrica a Sarajevo', capability: 'text-order', note: '' };
const regions = [{ id: 'canonical-sarajevo', name: 'Sarajevo' }, { id: 'canonical-zagreb', name: 'Zagabria' }];
const feasibility = { feasible: true, costs: { inputs: [] }, workDeclaration: { workId: 'steelworks', payerActorId: 'state', materialActorId: 'state', funded: true, missingMaterials: [] } };
describe('Common act execution keeps the engine declaration and canonical geography', () => {
  it('retains the exact declaration and region through the signed payload', () => {
    const resolved = resolveCouncilExecution(draft, feasibility, regions);
    expect(resolved.capability).toBe('engine-order');
    expect(resolved.work).toEqual({ workId: 'steelworks', payerActorId: 'state', materialActorId: 'state', funded: true, regionId: 'canonical-sarajevo' });
    expect(resolved.text).toBe(draft.text);
  });
  it.each(['Costruire una fabbrica', 'Costruire a Sarajevo e Zagabria'])('does not create an unlocalized or ambiguous construction: %s', text => {
    const resolved = resolveCouncilExecution({ ...draft, text }, feasibility, regions);
    expect(resolved.capability).toBe('unsupported');
    expect(resolved.work).toBeUndefined();
  });
  it('cannot sign a construction missing funding or materials', () => {
    const resolved = resolveCouncilExecution(draft, { ...feasibility, workDeclaration: { ...feasibility.workDeclaration, funded: false } }, regions);
    expect(resolved.capability).toBe('unsupported');
    expect(resolved.work).toBeUndefined();
  });
  it('keeps genuine prose acts as prose', () => {
    expect(resolveCouncilExecution(draft, { feasible: true, costs: { inputs: [] } }, regions)).toBe(draft);
  });
});
