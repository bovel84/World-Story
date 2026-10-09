import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const inline = read('CouncilIssueInline.tsx');
const office = read('GovernmentOffice.tsx');
const start = office.indexOf('const openIssue =');
const opening = office.slice(start, office.indexOf('\n  };', start));

describe('Advisor → Council: questione, non opzione', () => {
  it('la card non offre scelta o rendering delle options', () => {
    expect(inline).not.toContain('issue.options');
    expect(inline).not.toContain('aria-pressed');
    expect(inline).toContain('onOpenIssue(issue)');
  });

  it('la stanza viene aperta sulla issue e prepara la bozza dalla questione', () => {
    expect(opening).toContain('const room = startRoom(rapporteur, issue)');
    expect(opening).toContain('councilDraft(room, currentTurn ?? 0)');
    expect(opening).not.toContain('chosenOption');
    expect(opening).not.toContain('seedChosenRoad');
  });

  it('il relatore usa i ministri server-side, non un elenco inventato nel browser', () => {
    expect(opening).toContain('issue.suggestedMinisters.find(seat => CABINET_SEATS.includes(seat))');
    expect(read('AdvisorSituationsPanel.tsx')).not.toContain('suggestedMinisters: []');
  });

  it('il clic non firma e non accoda', () => {
    expect(opening).not.toContain('onQueueOrder');
    expect(opening).not.toContain('signDraft');
  });
});
