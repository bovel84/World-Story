import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdvisorSituationsPanel, situationAsPortableIssue } from './AdvisorSituationsPanel';
import type { AdvisorSituation, CouncilIssue } from '../../services/api';

const situation: AdvisorSituation = {
  id: 'sudan', title: 'Tensioni con il Sudan', summary: 'Rapporto ostile al confine.',
  importance: 3, signalKeys: ['hostile-relations:SDN'],
  options: [{ title: 'Linea ferma', content: 'Dispieghiamo le unità lungo il confine.' }],
};
const issue: CouncilIssue = {
  id: 'issue-sudan', situationId: situation.id, title: situation.title,
  question: 'Come rispondiamo alle tensioni?', suggestedMinisters: ['esteri', 'guerra'],
  verifiedFacts: [], signalKeys: situation.signalKeys, sourceRefs: ['diplomacy:SDN'],
  origin: 'advisor', createdDate: '1951-01-01',
};

describe('Situazione del Consulente → questione server-side', () => {
  it('mantiene le options nel modello ma non le rende nella card', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[situation]} issues={[issue]} onDeepen={() => {}} onOpenIssue={() => {}} />);
    expect(html).toContain(situation.title);
    expect(html).toContain(situation.summary);
    expect(html).not.toContain('Linea ferma');
    expect(html).not.toContain('Dispieghiamo');
    expect(html).not.toContain('aria-pressed');
  });

  it('apre una questione verificata senza richiedere options o una scelta', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[{ ...situation, options: undefined }]} issues={[issue]} onDeepen={() => {}} onOpenIssue={() => {}} />);
    expect(html).toContain('Porta al Consiglio');
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect(situationAsPortableIssue(situation, [issue])).toBe(issue);
  });

  it('non fabbrica una issue con ministri e fonti vuoti se manca il collegamento', () => {
    expect(situationAsPortableIssue(situation, [])).toBeUndefined();
    expect(situationAsPortableIssue(situation, [{ ...issue, situationId: 'altra' }])).toBeUndefined();
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[situation]} onDeepen={() => {}} onOpenIssue={() => {}} />);
    expect(html).toContain('Approfondisci');
    expect(html).toMatch(/<button[^>]*advisor-situation-open[^>]*disabled/);
  });
});
