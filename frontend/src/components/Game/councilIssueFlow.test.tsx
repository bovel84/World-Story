import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CouncilIssue, GovernmentSituationView } from '../../services/api';
import { councilContext, councilDraft, councilHistory, councilText, createCouncilRoom, receiveCouncilReply } from './councilRoom';
import { CouncilRoomBoard } from './CouncilRoomBoard';
import { CouncilRoomView, type CouncilRoomViewProps } from './CouncilRoomView';

const issue: CouncilIssue = {
  id: 'issue-food', title: 'Approvvigionamento alimentare', question: 'Come garantiamo le scorte nei prossimi mesi?',
  verifiedFacts: [
    { key: 'foodCoverageMonths', label: 'Copertura alimentare', value: '0,8 mesi', source: 'national_economy', sourceRef: 'economy:UGA:food' },
    { key: 'treasury', label: 'Cassa disponibile', value: '120 milioni', source: 'national_economy', sourceRef: 'economy:UGA:treasury' },
  ],
  suggestedMinisters: ['interno', 'tesoro', 'lavori'], origin: 'advisor',
  sourceRefs: ['economy:UGA:food', 'economy:UGA:treasury'], createdDate: '1951-03-01',
};
const create = () => createCouncilRoom({ id: 'room-food', scopeKey: 'g|b|3', initiatorMinister: 'interno', sourceIssue: issue });
const block = (value: unknown) => `\n\`\`\`council_issue\n${JSON.stringify(value)}\n\`\`\``;
const legacy: GovernmentSituationView = {
  id: 'legacy', pressureId: 'pressure-1', title: 'Vecchia situazione', briefing: 'Segnale interno', source: 'Registro', severity: 2, priority: 'rilevante',
  openedDate: '1951-03-01', deadline: null, daysLeft: 0, leadMinister: 'interno', suggestedMinisters: ['tesoro'], verifiedFacts: ['Scorte: 0,8 mesi'],
  decisionQuestion: 'Come rispondiamo?', options: [{ id: 'ration', label: 'Razionamento', detail: '', effectNote: '' }], inaction: { note: '' }, affectedDomains: [], origin: { type: 'state' },
};

function view(room = create(), extra: Partial<CouncilRoomViewProps> = {}) {
  return renderToStaticMarkup(<CouncilRoomView room={room} evidenceIndex={{}} onFocusEvidence={() => {}} nationalName="Uganda" isMobile={false} busy={false}
    speaking={null} streamText="" input="" target="council" onInput={() => {}} onTarget={() => {}} onSend={() => {}} onInterrupt={() => {}}
    onConvene={() => {}} onBack={() => {}} onClose={() => {}} onConclude={() => {}} onSheetChange={() => {}} board={null} draftPrepared={false} {...extra} />);
}

describe('Verified CouncilIssue → council → free-form act', () => {
  it('preserves the complete issue and starts with only its rapporteur, never automatic admission', () => {
    const room = create();
    expect(room.sourceIssue).toEqual(issue);
    expect(room.topic).toBe(issue.title);
    expect(room.participants).toEqual(['interno']);
    expect(room.invitations).toEqual([]);
    expect(room.sharedBoard.proposals).toEqual([]);
    expect(councilContext(room).sourceIssue).toEqual(issue);
  });

  it('keeps the verified issue title when a minister proposes a different objective', () => {
    const room = receiveCouncilReply(create(), 'interno', '```decision\n{"op":"update-proposal","objective":"Importare grano","changes":[{"label":"Importazioni","value":"90 giorni","source":"minister"}]}\n```', 'm1');
    expect(room.topic).toBe(issue.title);
    expect(room.sourceIssue).toEqual(issue);
    const draft = councilDraft(room, 3);
    expect(draft.text).toContain('Importazioni: 90 giorni');
    expect(draft.sourceIssueId).toBe(issue.id);
    expect(draft.capability).toBe('text-order');
    expect(draft).not.toHaveProperty('sourcePressureId');
    expect(draft).not.toHaveProperty('selectedPressureOptions');
  });

  it('does not pass Pressure options or legacy metadata into a sourceIssue context or draft', () => {
    const room = { ...create(), sourceSituation: legacy, selectedPressureOptions: ['ration'], proposedPressureOptions: [{ optionId: 'ration', proposedBy: 'interno' as const, messageId: 'old' }] };
    const next = receiveCouncilReply(room, 'interno', 'Parere.\n```consiglio\n{"pressureOptions":["ration"]}\n```', 'm1');
    const context = councilContext(next);
    expect(context.sourceIssue).toEqual(issue);
    expect(context).not.toHaveProperty('sourceSituation');
    expect(context).not.toHaveProperty('selectedPressureOptions');
    expect(context).not.toHaveProperty('proposedPressureOptions');
    expect(councilDraft(next)).not.toHaveProperty('selectedPressureOptions');
    expect(councilDraft(next)).not.toHaveProperty('sourcePressureId');
  });

  it('allows a president-origin railway proposal without any Pressure or predefined option', () => {
    const railway: CouncilIssue = { ...issue, id: 'issue-rail', title: 'Nuova ferrovia strategica', question: 'Come definiamo tracciato e copertura?', origin: 'president', suggestedMinisters: ['lavori', 'tesoro'] };
    const room = createCouncilRoom({ id: 'rail', scopeKey: 's', initiatorMinister: 'lavori', sourceIssue: railway });
    const proposed = receiveCouncilReply(room, 'lavori', '```decision\n{"op":"update-proposal","changes":[{"label":"Studio del tracciato","value":"verso nord","source":"minister"}],"constraints":["Verificare regioni, materiali e copertura"]}\n```', 'm1');
    expect(councilDraft(proposed).text).toContain('Studio del tracciato: verso nord');
    expect(councilDraft(proposed).text).toContain('Verificare regioni, materiali e copertura');
    expect(councilContext(proposed).sourceIssue?.origin).toBe('president');
  });
});

describe('Minister proposals are inline, canonical-shape issues, not new rooms', () => {
  it('stores completed canonical proposals on the speech and strips their protocol from history', () => {
    const proposed = { ...issue, id: 'minister-food', origin: 'minister' as const };
    const room = receiveCouncilReply(create(), 'interno', `Serve una decisione interministeriale.${block(proposed)}`, 'm1');
    expect(room.messages[0].proposedIssues).toEqual([proposed]);
    expect(room.messages[0].content).toBe('Serve una decisione interministeriale.');
    expect(room.sourceIssue).toEqual(issue);
    expect(room.participants).toEqual(['interno']);
    expect(room.sharedBoard.proposals).toEqual([]);
    expect(councilHistory(room, 'interno')[0].content).not.toMatch(/council_issue|foodCoverageMonths/);
  });

  it.each([
    { title: 'Model-only keys', question: 'What next?', factKeys: ['treasury'], suggestedMinisters: ['tesoro'] },
    { ...issue, suggestedMinisters: ['inventato'] },
    { ...issue, verifiedFacts: [{ key: 'treasury', value: 'inventato' }] },
    { ...issue, sourceRefs: [] },
    { ...issue, origin: 'inventato' },
    [],
  ])('ignores malformed or unhydrated proposals without claiming their facts are verified', value => {
    const room = receiveCouncilReply(create(), 'interno', `Parere.${block(value)}`, 'm1');
    expect(room.messages[0].proposedIssues ?? []).toEqual([]);
    expect(room.messages[0].content).toBe('Parere.');
  });

  it('hides unfinished and malformed issue blocks during streaming', () => {
    expect(councilText('Parere.\n```council_issue\n{"title":')).toBe('Parere.');
    expect(councilText('Parere.\n```council_issue\nnot-json\n```')).toBe('Parere.');
  });

  it('deduplicates server issue ids and bounds the number of inline proposals', () => {
    const text = [issue, issue, { ...issue, id: 'two' }, { ...issue, id: 'three' }, { ...issue, id: 'four' }].map(block).join('');
    const room = receiveCouncilReply(create(), 'interno', text, 'm1');
    expect(room.messages[0].proposedIssues?.map(candidate => candidate.id)).toEqual(['issue-food', 'two', 'three']);
  });
});

describe('Issue-aware council surfaces', () => {
  it('shows title, verified facts and their provenance, question, date, origin and suggested ministers on the board', () => {
    const onConvene = vi.fn();
    const html = renderToStaticMarkup(<CouncilRoomBoard room={create()} onConvene={onConvene} />);
    for (const text of [issue.title, issue.question, 'FATTI VERIFICATI', 'Copertura alimentare', '0,8 mesi', '120 milioni', 'national_economy', 'economy:UGA:food', '1951-03-01', 'Ministro del Tesoro', 'Ministro dei Lavori']) expect(html).toContain(text);
    expect(html).toContain('data-origin="advisor"');
    expect(html).not.toContain('Corsi d’azione conosciuti dal motore');
    expect(onConvene).not.toHaveBeenCalled();
  });

  it('shows suggested ministers immediately without admitting them', () => {
    const html = view();
    expect(html).toContain('Ministri da sentire');
    expect(html).toContain('Ministro del Tesoro +');
    expect(html).toContain('Ministro dei Lavori +');
    expect(html).not.toContain('Ministro dell’Interno +');
  });

  it('renders an inline Porta al Consiglio button only for completed proposals with a callback', () => {
    const room = receiveCouncilReply(create(), 'interno', `Parere.${block(issue)}`, 'm1');
    const onOpenIssue = vi.fn();
    const html = view(room, { onOpenIssue });
    expect(html).toContain('Porta al Consiglio');
    expect(html).toContain('data-issue-id="issue-food"');
    expect(html).not.toContain('```');
    expect(view(room)).not.toContain('Porta al Consiglio');
    expect(onOpenIssue).not.toHaveBeenCalled();
  });

  it('still renders facts and the question of older sourceSituation rooms', () => {
    const room = createCouncilRoom({ id: 'old', scopeKey: 's', initiatorMinister: 'interno', sourceSituation: legacy });
    const html = renderToStaticMarkup(<CouncilRoomBoard room={room} />);
    expect(html).toContain(legacy.title);
    expect(html).toContain('Scorte: 0,8 mesi');
    expect(html).toContain(legacy.decisionQuestion);
    expect(html).not.toContain('Corsi d’azione conosciuti dal motore');
    expect(html).not.toContain('Conferma Razionamento');
  });
});
