import fs from 'node:fs';
import path from 'node:path';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdvisorSituation, CouncilIssue } from '../../services/api';
import { AdvisorSituationsPanel } from './AdvisorSituationsPanel';
import { AdvisorQuestionCards } from './AdvisorChat';
import { CouncilIssueInline } from './CouncilIssueInline';
import { councilContext, councilDraft, createCouncilRoom } from './councilRoom';
import { CouncilRoomView } from './CouncilRoomView';

const options = [
  { title: 'Convogli protetti', content: 'Organizziamo convogli protetti per rifornire le unità lungo il confine.' },
  { title: 'Accordo di fornitura', content: 'Negoziamo forniture con gli alleati senza impegnare nuove unità.' },
];
const situation: AdvisorSituation = {
  id: 'logistica', title: 'Un esercito senza autonomia logistica',
  summary: 'Le scorte di carburante e armamenti sono insufficienti.',
  importance: 3, signalKeys: ['military-supply'], options,
};
const issue: CouncilIssue = {
  id: 'issue-logistica', situationId: situation.id, title: situation.title,
  question: 'Come garantiamo l’autonomia logistica dell’esercito?', options,
  suggestedMinisters: ['guerra', 'tesoro', 'esteri'], signalKeys: ['military-supply'],
  anchorKeys: ['capacity-economy'],
  verifiedFacts: [{ key: 'fuel', label: 'Carburante', value: 'Scorte insufficienti', source: 'engine', sourceRef: 'stock:fuel' }],
  sourceRefs: ['stock:fuel'], origin: 'advisor', createdDate: '1951-01-01',
};

function buttons(node: ReactNode): ReactElement<{ children?: ReactNode; className?: string; disabled?: boolean; onClick: () => void }>[] {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    if (child.type === 'button') return [child as ReturnType<typeof buttons>[number]];
    return buttons(child.props.children);
  });
}

function cards(situations = [situation], issues = [issue]) {
  return renderToStaticMarkup(<AdvisorQuestionCards situations={situations} issues={issues} onDeepen={() => {}} onOpenIssue={() => {}} />);
}

describe('Consulente: questioni, non soluzioni', () => {
  it('mostra priorità, titolo, sintesi e CTA, mai le options', () => {
    const html = renderToStaticMarkup(<AdvisorSituationsPanel situations={[situation]} onDeepen={() => {}} onOpenIssue={() => {}} />);
    for (const text of ['Urgente', situation.title, situation.summary, 'Approfondisci', 'Porta al Consiglio']) expect(html).toContain(text);
    for (const option of options) { expect(html).not.toContain(option.title); expect(html).not.toContain(option.content); }
    expect(html).not.toContain('aria-pressed');
  });

  it('nasconde anche le options delle issue standalone', () => {
    const html = renderToStaticMarkup(<CouncilIssueInline issue={issue} onOpenIssue={() => {}} />);
    for (const option of options) { expect(html).not.toContain(option.title); expect(html).not.toContain(option.content); }
  });

  it('una issue collegata non compare una seconda volta sotto la situazione', () => {
    const html = cards();
    expect(html.match(/data-situation-id="logistica"/g)).toHaveLength(1);
    expect(html).not.toContain('data-issue-id="issue-logistica"');
    expect(html.match(/Porta al Consiglio/g)).toHaveLength(1);
  });

  it('mantiene issue non collegate e quelle con situationId non mostrato', () => {
    const html = cards([situation], [issue, { ...issue, id: 'standalone', situationId: undefined }, { ...issue, id: 'altra', situationId: 'non-mostrata' }]);
    expect(html).toContain('data-issue-id="standalone"');
    expect(html).toContain('data-issue-id="altra"');
    expect(cards([], [issue])).toContain('data-issue-id="issue-logistica"');
  });

  it('evita duplicati anche se la issue arriva in un messaggio successivo', () => {
    const html = renderToStaticMarkup(<>
      <AdvisorQuestionCards situations={[situation]} issues={[]} allSituations={[situation]} allIssues={[issue]} onDeepen={() => {}} onOpenIssue={() => {}} />
      <AdvisorQuestionCards situations={[]} issues={[issue]} allSituations={[situation]} allIssues={[issue]} onDeepen={() => {}} onOpenIssue={() => {}} />
    </>);
    expect(html.match(/data-situation-id="logistica"/g)).toHaveLength(1);
    expect(html).not.toContain('data-issue-id="issue-logistica"');
    expect(html.match(/Porta al Consiglio/g)).toHaveLength(1);
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it('una issue standalone compatta offre approfondimento e apertura senza mostrare fatti o options', () => {
    const onOpenIssue = vi.fn(); const onDeepen = vi.fn();
    const tree = CouncilIssueInline({ issue, compact: true, onOpenIssue, onDeepen });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain('council-issue-facts');
    expect(html).not.toContain('Convogli protetti');
    const controls = buttons(tree);
    controls.find(button => button.props.className === 'advisor-situation-deepen')!.props.onClick();
    expect(onDeepen).toHaveBeenCalledExactlyOnceWith(issue);
    controls.find(button => button.props.className === 'council-issue-open')!.props.onClick();
    expect(onOpenIssue).toHaveBeenCalledExactlyOnceWith(issue);
  });

  it('Porta al Consiglio passa la issue server-side integra, anche senza options', () => {
    const onOpenIssue = vi.fn(); const onDeepen = vi.fn();
    const canonical = { ...issue, options: undefined };
    const tree = AdvisorSituationsPanel({ situations: [{ ...situation, options: undefined }], issues: [canonical], onDeepen, onOpenIssue });
    const open = buttons(tree).find(button => button.props.className?.includes('advisor-situation-open'))!;
    expect(open.props.disabled).toBe(false);
    open.props.onClick();
    expect(onOpenIssue).toHaveBeenCalledExactlyOnceWith(canonical);
    expect(onOpenIssue.mock.calls[0][0]).toBe(canonical);
    expect(onDeepen).not.toHaveBeenCalled();
  });

  it('senza issue server-side non fabbrica fatti né ministri: apertura disabilitata, approfondimento disponibile', () => {
    const onOpenIssue = vi.fn(); const onDeepen = vi.fn();
    const tree = AdvisorSituationsPanel({ situations: [situation], issues: [], onDeepen, onOpenIssue });
    const controls = buttons(tree);
    expect(controls.find(button => button.props.className?.includes('advisor-situation-open'))?.props.disabled).toBe(true);
    const deepen = controls.find(button => button.props.className?.includes('advisor-situation-deepen'))!;
    deepen.props.onClick();
    expect(onDeepen).toHaveBeenCalledExactlyOnceWith(situation);
    expect(onOpenIssue).not.toHaveBeenCalled();
  });
});

describe('Consiglio: apertura sulla questione', () => {
  it('preserva i ministri competenti e le fonti, con Tavola vuota e bozza dalla domanda', () => {
    const room = createCouncilRoom({ id: 'room', scopeKey: 'g|b|1', initiatorMinister: issue.suggestedMinisters[0], sourceIssue: issue });
    expect(room.initiatorMinister).toBe('guerra');
    expect(room.sharedBoard.proposals).toEqual([]);
    expect(councilContext(room).sourceIssue).toBe(issue);
    const draft = councilDraft(room, 1);
    expect(draft.text).toContain(issue.title);
    expect(draft.text).toContain('Come garantiamo l’autonomia logistica dell’esercito');
    for (const option of options) expect(draft.text).not.toContain(option.content);
    const html = renderToStaticMarkup(<CouncilRoomView room={room} evidenceIndex={{}} onFocusEvidence={() => {}} nationalName="Italia" isMobile={false} busy={false} speaking={null} streamText="" input="" target="council" onInput={() => {}} onTarget={() => {}} onSend={() => {}} onInterrupt={() => {}} onConvene={() => {}} onBack={() => {}} onClose={() => {}} onConclude={() => {}} onSheetChange={() => {}} board={null} draftPrepared={false} />);
    expect(html).toContain('Ministro del Tesoro +');
    expect(html).toContain('Ministro degli Esteri +');
  });

  it('il gestore reale non chiama seedChosenRoad né precompila soluzioni', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'GovernmentOffice.tsx'), 'utf8');
    const start = source.indexOf('const openIssue =');
    const body = source.slice(start, source.indexOf('\n  };', start));
    expect(body).not.toContain('seedChosenRoad');
    expect(body).not.toContain('chosenOption');
    expect(body).toContain('issue.suggestedMinisters.find');
    expect(body).toContain('councilDraft(room, currentTurn ?? 0)');
    expect(body).not.toContain('onQueueOrder');
  });
});
