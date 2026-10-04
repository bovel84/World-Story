import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { CabinetSessionView } from '../../services/api';
import { CABINET_SEATS } from './seatDecisionBoards';
import { seatSpeaker } from './councilMeeting';

vi.mock('../ui/AccessibleDialog', () => ({ AccessibleDialog: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./AdvisorChat', () => ({ AdvisorChat: ({ scopeKey, onOpenIssue }: { scopeKey?: string; onOpenIssue?: unknown }) => <div className="advisor-chat" data-scope={scopeKey} data-can-open-issue={typeof onOpenIssue === 'function'} /> }));
import { GovernmentOffice, type GovernmentOfficeProps } from './GovernmentOffice';

const source = fs.readFileSync(path.resolve(__dirname, 'GovernmentOffice.tsx'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, 'councilRoom.css'), 'utf8');
const base: GovernmentOfficeProps = {
  open: true, onClose: () => {}, gameId: 'game-1', session: null, pendingActions: [], nationalName: 'Uganda', currentDate: '1951-03-01', currentTurn: 3,
  onWithdrawOrder: () => {}, pictureSources: { regions: [] },
};
const render = (extra: Partial<GovernmentOfficeProps> = {}) => renderToStaticMarkup(<GovernmentOffice {...base} {...extra} />);

describe('Government home: reality advisor and one complete roster', () => {
  it('shows all seven ministers and one compatible roster even without session or government brief', () => {
    const html = render();
    expect(html).toContain('IL PRIMO CONSULENTE');
    expect(html).toContain('MINISTRI');
    expect(html.match(/class="[^"]*government-roster-seat/g)).toHaveLength(7);
    expect(html.match(/class="[^"]*cabinet-pick\b/g)).toHaveLength(7);
    for (const seat of CABINET_SEATS) {
      expect(html).toContain(`data-seat="${seat}"`);
      expect(html).toContain(seatSpeaker(seat));
    }
    expect(html).toContain('data-can-open-issue="true"');
    expect(html).toMatch(/data-scope="[^"]+"/);
    expect(html).not.toContain('cabinet-session');
    expect(html).not.toContain('government-situations');
    expect(html).not.toContain('PROBLEMI CHE RICHIEDONO DECISIONE');
  });

  it('does not duplicate the roster when a session and a partial brief exist', () => {
    const session: CabinetSessionView = { addresses: [{ seat: 'tesoro', label: seatSpeaker('tesoro'), reads: 'Cassa', opening: 'Presidente.', items: [] }], president: { opening: '', closing: '' }, summary: { total: 1, critical: 0 }, canonicalMutation: false };
    const html = render({ session, pictureSources: { regions: [], brief: { date: '1951-03-01', cabinet: [{ seat: 'tesoro', label: 'Tesoro', state: 'engaged' }], situations: [], followUps: [], recentDecisions: [] } } });
    expect(html.match(/class="[^"]*government-roster-seat/g)).toHaveLength(7);
    expect(html.match(/class="[^"]*cabinet-pick\b/g)).toHaveLength(7);
    expect(html).toMatch(/data-seat="tesoro"[^>]*data-state="engaged"/);
    expect(html).not.toContain('cabinet-session');
  });

  it('retains follow-ups as report links, not quests or situations', () => {
    const html = render({ pictureSources: { regions: [], followUps: [{ id: 'report-1', pressureId: 'p1', owner: 'guerra', dueDate: '1951-03-01', daysLeft: 0, label: 'Schieramento al confine', checks: [], outcome: ['Verifica logistica completata'], origin: { type: 'previous-decision' }, situation: {} as never }] } });
    expect(html).toContain('Rapporti verificati');
    expect(html).toContain('Apri rapporto');
    expect(html).toContain('Schieramento al confine');
    expect(html).not.toContain('government-situations');
  });

  it('never directly resolves legacy Pressure on signing and sends the canonical issue to the opening endpoint', () => {
    expect(source).not.toContain('resolvePeacetimePressure');
    expect(source).not.toContain('resolvedPressureRef');
    expect(source).not.toContain('if (!initial) return');
    expect(source).toMatch(/ministerApi\.opening\(gameId,\s*[^,]+,\s*openingBrief,\s*controller.signal,\s*activeRoom.sourceIssue\)/);
    expect(source).not.toContain('focus={advisorFocus}');
  });

  it('uses one home scroll, auto-height advisor messages and reachable mobile close controls', () => {
    expect(css).not.toMatch(/\.government-advisor \.advisor-chat\s*\{[^}]*height:\s*\d+(?:d?vh)/);
    expect(css).toMatch(/\.government-advisor \.advisor-chat\s*\{[^}]*height:\s*auto/);
    expect(css).toMatch(/\.government-advisor \.advisor-messages\s*\{[^}]*overflow(?:-y)?:\s*visible/);
    expect(css).toMatch(/\.government-office-bar\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.government-office \.government-office-bar \.desk-close-x\s*\{[^}]*min-width:\s*46px[^}]*min-height:\s*46px/);
  });
});
