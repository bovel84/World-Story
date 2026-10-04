import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CouncilIssue } from '../../services/api';
import { CouncilIssueInline } from './CouncilIssueInline';

const issue: CouncilIssue = {
  id: 'issue-1', title: 'Scorte alimentari', question: 'Come garantiamo le scorte?',
  verifiedFacts: [{ key: 'foodCoverageMonths', label: 'Copertura alimentare', value: '0,8 mesi', source: 'national_economy', sourceRef: 'economy:food' }],
  suggestedMinisters: ['interno', 'tesoro'], origin: 'advisor', sourceRefs: ['economy:food'], createdDate: '1951-03-01',
};

describe('CouncilIssueInline', () => {
  it('shows the issue and an explicit CTA without opening anything during render', () => {
    const onOpenIssue = vi.fn();
    const html = renderToStaticMarkup(<CouncilIssueInline issue={issue} onOpenIssue={onOpenIssue} />);
    expect(html).toContain(issue.title);
    expect(html).toContain(issue.question);
    expect(html).toContain('Copertura alimentare');
    expect(html).toContain('0,8 mesi');
    expect(html).toContain('data-issue-id="issue-1"');
    expect(html).toContain('Porta al Consiglio');
    expect(onOpenIssue).not.toHaveBeenCalled();
  });

  it('does not offer an unavailable action and disables opening during council work', () => {
    expect(renderToStaticMarkup(<CouncilIssueInline issue={issue} />)).not.toContain('<button');
    const html = renderToStaticMarkup(<CouncilIssueInline issue={issue} onOpenIssue={() => {}} disabled />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Porta al Consiglio<\/button>/);
  });

  it('escapes issue copy instead of interpreting model content as markup', () => {
    const html = renderToStaticMarkup(<CouncilIssueInline issue={{ ...issue, title: '<script>alert(1)</script>' }} />);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
