import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Region } from '../../types';
import type { CouncilIssue, WarFrontPayload } from '../../services/api';
import { buildMapContextIndex } from '../Map/mapContext';
import { GovernmentVisualCard } from './GovernmentVisualCard';
import { GovernmentMessageVisuals } from './GovernmentMessageVisuals';
import { CouncilRoomView, type CouncilRoomViewProps } from './CouncilRoomView';
import { appendCouncilMessage, createCouncilRoom, receiveCouncilReply } from './councilRoom';
import { CABINET_SEATS } from './seatDecisionBoards';
import { buildGovernmentVisualSnapshot, mapFocusFromVisual, resolveGovernmentVisuals } from './governmentVisual';
import { captureGovernmentMapRequest, isGovernmentMapRequest, safeGovernmentVisualText } from './governmentVisualRequest';

const regions = ['A', 'B', 'C'].map((owner, i) => ({ id: `r${i}`, name: `Territorio ${owner}`, polityName: `Paese ${owner}`, owner, color: '#315f87', svgPath: `M${i * 100} 0L${i * 100 + 100} 0L${i * 100 + 100} 100L${i * 100} 100Z`, objects: [], borders: [], metadata: {} })) as Region[];
const front = { id: 'f', name: 'Fronte attivo', status: 'active', regionIds: ['r0', 'r1'] } as WarFrontPayload;
const snapshot = { scopeKey: 'game|branch|revision', index: buildMapContextIndex({ regions, fronts: [front], units: [] }), playerPolityId: 'A', relationships: { A: { B: 'hostile', C: 'neutral' } } };
const issue = { id: 'issue', title: 'La questione diplomatica', signalKeys: ['hostile-relations'], suggestedMinisters: ['esteri'], sourceRefs: [], verifiedFacts: [] } as unknown as CouncilIssue;
const directive = (ids: string[]) => `\n\`\`\`tavola\n${JSON.stringify({ op: 'show', evidence: 'mappa', regionIds: ids })}\n\`\`\``;
function room(seat = CABINET_SEATS[0], withIssue = true) {
  return appendCouncilMessage(createCouncilRoom({ id: 'room', scopeKey: 'session', initiatorMinister: seat, ...(withIssue ? { sourceIssue: issue } : {}) }), { id: 'user', role: 'user', kind: 'speech', content: 'Fammi vedere la mappa.' });
}
function renderRoom(current: ReturnType<typeof room>, props: Partial<CouncilRoomViewProps> = {}) {
  return renderToStaticMarkup(<CouncilRoomView room={current} visualSnapshot={snapshot} onFocusMap={() => {}} evidenceIndex={{}} onFocusEvidence={() => {}} nationalName="Paese A" isMobile={false} busy={false} speaking={null} streamText="" input="" target="council" onInput={() => {}} onTarget={() => {}} onSend={() => {}} onInterrupt={() => {}} onConvene={() => {}} onBack={() => {}} onClose={() => {}} onConclude={() => {}} onSheetChange={() => {}} board={<p>Tavola esistente</p>} draftPrepared={false} {...props} />);
}

describe('Council inline verified maps, all seats', () => {
  it.each(CABINET_SEATS)('valid completed directive from %s attaches below its own speech, no measure changes', seat => {
    const before = room(seat, false);
    const current = receiveCouncilReply(before, seat, 'Risposta del ministro.' + directive(['r0', 'r1']), 'reply', snapshot.scopeKey);
    const html = renderRoom(current);
    expect(html).toContain('government-visual-card');
    expect(html.indexOf('Risposta del ministro.')).toBeLessThan(html.indexOf('Contesto territoriale'));
    expect(html).not.toContain('```tavola');
    expect(current.messages.at(-1)?.evidence?.[0].regionIds).toEqual(['r0', 'r1']);
    expect(current.sharedBoard).toEqual(before.sharedBoard);
    expect(current.selectedPressureOptions).toEqual(before.selectedPressureOptions);
  });

  it('explicit map request resolves the discussed verified diplomacy, without a model directive', () => {
    const current = receiveCouncilReply(room(), CABINET_SEATS[0], 'La relazione richiede prudenza.', 'reply', snapshot.scopeKey);
    expect(renderRoom(current)).toContain('Contesto diplomatico');
    expect(renderRoom(current)).toContain('Interlocutore diplomatico ostile');
    expect(resolveGovernmentVisuals(current.messages.at(-1)!, snapshot)[0].regionIds).toEqual(['r0', 'r1']);
  });

  it('multiple hostile relations require a canonical interlocutor; no naming guesses', () => {
    const multiple = { ...snapshot, relationships: { A: { B: 'hostile', C: 'hostile' } } };
    const message = receiveCouncilReply(room(), CABINET_SEATS[0], 'La questione riguarda il Paese B.', 'reply', snapshot.scopeKey).messages.at(-1)!;
    expect(resolveGovernmentVisuals(message, multiple)).toEqual([]);
    const exact = { ...message, visualRequest: { ...message.visualRequest!, signalKeys: ['hostile-relations:C'] } };
    expect(resolveGovernmentVisuals(exact, multiple)[0].regionIds).toEqual(['r0', 'r2']);
  });

  it('unknown IDs never fall back to unrelated context; text remains and unsupported visibility claims are removed', () => {
    const current = receiveCouncilReply(room(), CABINET_SEATS[0], 'La mappa conferma ciò che dico. Serve prudenza.' + directive(['r0', 'invented']), 'reply', snapshot.scopeKey);
    const html = renderRoom(current);
    expect(html).not.toContain('government-visual-card');
    expect(html).not.toContain('La mappa conferma');
    expect(html).toContain('Serve prudenza.');
    expect(html).toContain('Non dispongo di un riferimento geografico verificato per questa area.');
  });

  it('no directive and no map request leaves ordinary text and board unchanged', () => {
    const before = createCouncilRoom({ id: 'room', scopeKey: 'session', initiatorMinister: 'tesoro', sourceIssue: issue });
    const current = receiveCouncilReply(before, 'tesoro', 'La scelta richiede prudenza.', 'reply', snapshot.scopeKey);
    expect(renderRoom(current)).not.toContain('government-visual-card');
    expect(renderRoom(current)).toContain('La scelta richiede prudenza.');
    expect(current.sharedBoard).toEqual(before.sharedBoard);
    expect(safeGovernmentVisualText('La scelta richiede prudenza.', false)).toBe('La scelta richiede prudenza.');
  });

  it('intent is not triggered by provvedere/dimostra, and negated visibility claims remain normal prose', () => {
    expect(isGovernmentMapRequest('Dobbiamo provvedere al confine.')).toBe(false);
    expect(isGovernmentMapRequest('Questo dimostra il confine della nostra politica.')).toBe(false);
    expect(safeGovernmentVisualText('Non dico che la mappa mostra tutto.', false)).toBe('Non dico che la mappa mostra tutto.');
    expect(safeGovernmentVisualText('Presidente, come vede sulla mappa il confine è qui.', false)).not.toContain('come vede sulla mappa');
  });

  it('a later focus without IDs retains the prior show territory; malformed lists never render partial cards', () => {
    const first = 'Risposta.' + directive(['r0']);
    const later = '\n```tavola\n{"op":"focus","evidence":"mappa"}\n```';
    const current = receiveCouncilReply(room(), CABINET_SEATS[0], first + later, 'reply', snapshot.scopeKey);
    expect(resolveGovernmentVisuals(current.messages.at(-1)!, snapshot)[0].regionIds).toEqual(['r0']);
    for (const ids of [[], ['r0', 'unsafe id'], Array(21).fill('r0')]) {
      const invalid = receiveCouncilReply(room(), CABINET_SEATS[0], 'Risposta.' + directive(ids), 'reply', snapshot.scopeKey);
      expect(resolveGovernmentVisuals(invalid.messages.at(-1)!, snapshot)).toEqual([]);
    }
  });

  // M01 — Cambio di comportamento voluto (2026-10-09). Prima, una richiesta
  // esplicita senza geografia verificata non produceva nulla. Ora mostra il
  // **territorio posseduto** — l'esito che l'autore ha chiesto. La mappa non è
  // «fabbricata»: sono le regioni realmente possedute (`playerPolityId`), e il
  // testo lo dichiara. Vedi `governmentVisualOwnership.test.tsx`.
  it('explicit request with no verified geography shows the owned territory, declared', () => {
    const current = receiveCouncilReply(room(CABINET_SEATS[0], false), CABINET_SEATS[0], 'Una vecchia guerra nel Territorio A.', 'reply', snapshot.scopeKey);
    expect(renderRoom(current)).toContain('government-visual-card');
    expect(renderRoom(current)).toContain('Territori di riferimento; non indica operazioni o aree di conflitto.');
  });

  it('mere historical prose without an explicit request produces no card', () => {
    const noRequest = appendCouncilMessage(createCouncilRoom({ id: 'room2', scopeKey: 'session', initiatorMinister: CABINET_SEATS[0] }),
      { id: 'u', role: 'user', kind: 'speech', content: 'La vecchia guerra è finita da tempo.' });
    const current = receiveCouncilReply(noRequest, CABINET_SEATS[0], 'Una vecchia guerra nel Territorio A.', 'reply', snapshot.scopeKey);
    expect(renderRoom(current)).not.toContain('government-visual-card');
  });

  it('deduplicates equivalent directives and keeps #247 fronts military-snapshot guarded', () => {
    const before = room(); before.sourceIssue = { ...issue, signalKeys: ['conflict:f'] };
    const current = receiveCouncilReply(before, CABINET_SEATS[0], 'Risposta.' + directive(['r0', 'r1']) + directive(['r1', 'r0']), 'reply', snapshot.scopeKey);
    expect(resolveGovernmentVisuals(current.messages.at(-1)!, snapshot)).toHaveLength(1);
    expect(resolveGovernmentVisuals({ role: 'assistant', issues: [before.sourceIssue] }, snapshot)[0].title).toBe('Fronte attivo');
    expect(resolveGovernmentVisuals({ role: 'assistant', issues: [before.sourceIssue] }, { ...snapshot, militaryAvailable: false })).toEqual([]);
    expect(buildGovernmentVisualSnapshot({ scopeKey: snapshot.scopeKey, canonicalSnapshotKey: 'new', militarySnapshotKey: 'old', index: snapshot.index, unavailable: false })?.militaryAvailable).toBe(false);
  });

  it('cards/focus vanish across branch/game changes, while political maps do not require a military snapshot', () => {
    const current = receiveCouncilReply(room(CABINET_SEATS[0], false), CABINET_SEATS[0], 'Risposta.' + directive(['r0']), 'reply', snapshot.scopeKey);
    const message = current.messages.at(-1)!;
    const cards = resolveGovernmentVisuals(message, { ...snapshot, militaryAvailable: false });
    expect(cards).toHaveLength(1);
    expect(mapFocusFromVisual(cards[0], snapshot, 9)?.regionIds).toEqual(['r0']);
    expect(resolveGovernmentVisuals(message, { ...snapshot, scopeKey: 'different-game-or-branch' })).toEqual([]);
    expect(mapFocusFromVisual(cards[0], { ...snapshot, scopeKey: 'different-game-or-branch' }, 9)).toBeNull();
    expect(renderRoom(current, { visualSnapshot: { ...snapshot, scopeKey: 'new-branch' } })).not.toContain('government-visual-card');
  });

  it('the shared Advisor path and actual button use the same validated territory, read-only', () => {
    const visualRequest = captureGovernmentMapRequest({ presidentText: 'Mostrami il confine.', directives: [], signalKeys: ['hostile-relations'], scopeKey: snapshot.scopeKey });
    const message = { role: 'assistant' as const, content: 'Risposta del Consulente.', visualRequest };
    expect(renderToStaticMarkup(<GovernmentMessageVisuals message={message} snapshot={snapshot} />)).toContain('government-visual-card');
    const card = resolveGovernmentVisuals(message, snapshot)[0];
    const onFocusMap = vi.fn();
    const tree = GovernmentVisualCard({ card, snapshot, onFocusMap });
    tree!.props.children.at(-1).props.onClick();
    expect(onFocusMap).toHaveBeenCalledExactlyOnceWith(card);
  });

  it('streaming control JSON is hidden and never creates a partial card', () => {
    const html = renderRoom(createCouncilRoom({ id: 'r', scopeKey: 's', initiatorMinister: 'tesoro' }), { busy: true, speaking: 'tesoro', streamText: 'Risposta.\n```tavola\n{"op":"show","evidence":"mappa"' });
    expect(html).toContain('Risposta.');
    expect(html).not.toContain('government-visual-card');
    expect(html).not.toContain('```tavola');
  });
});
