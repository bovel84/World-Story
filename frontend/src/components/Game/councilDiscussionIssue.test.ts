import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CouncilIssue } from '../../services/api';
import { councilDiscussionIssue, councilContext, councilDraft, createCouncilRoom } from './councilRoom';

const issue: CouncilIssue = {
  id: 'logistica-issue', title: 'Un esercito senza autonomia logistica',
  question: 'Come affrontiamo le scorte insufficienti?',
  options: [
    { title: 'Opzione Advisor A', content: 'Soluzione prefabbricata A: finanziare convogli.' },
    { title: 'Opzione Advisor B', content: 'Soluzione prefabbricata B: negoziare forniture.' },
  ],
  signalKeys: ['military-logistics'], anchorKeys: ['fuel-stock'], situationId: 'logistica',
  verifiedFacts: [{ key: 'fuel-stock', label: 'Carburante', value: 'Insufficiente', source: 'military', sourceRef: 'stock:fuel' }],
  suggestedMinisters: ['guerra', 'tesoro', 'esteri'], sourceRefs: ['stock:fuel'],
  origin: 'advisor', createdDate: '1951-01-01',
};

function discussionRoom() {
  const discussionIssue = councilDiscussionIssue(issue);
  return createCouncilRoom({ id: 'room', scopeKey: 'game:branch', initiatorMinister: discussionIssue.suggestedMinisters[0], sourceIssue: discussionIssue });
}

const office = fs.readFileSync(path.resolve(__dirname, 'GovernmentOffice.tsx'), 'utf8');
const start = office.indexOf('const openIssue =');
const opening = office.slice(start, office.indexOf('\n  };', start));
const roomStart = office.indexOf('const startRoom =');
const startRoom = office.slice(roomStart, office.indexOf('\n  };', roomStart));

describe('Confine Consulente → Consiglio: solo la questione', () => {
  it('rimuove options senza mutare la issue Advisor originale', () => {
    const original = structuredClone(issue);
    const discussionIssue = councilDiscussionIssue(Object.freeze(issue));
    expect(discussionIssue).not.toBe(issue);
    expect(discussionIssue.options).toBeUndefined();
    expect(discussionIssue).not.toHaveProperty('options');
    expect(issue).toEqual(original);
  });

  it('preserva tutti i campi canonici, inclusi ministri e fonti', () => {
    const discussionIssue = councilDiscussionIssue(issue);
    const { options: _options, ...expected } = issue;
    expect(discussionIssue).toEqual(expected);
    for (const key of ['signalKeys', 'anchorKeys', 'verifiedFacts', 'suggestedMinisters', 'sourceRefs'] as const) {
      expect(discussionIssue[key]).toBe(issue[key]);
    }
    expect(discussionIssue.situationId).toBe(issue.situationId);
    expect(discussionIssue.origin).toBe(issue.origin);
    expect(discussionIssue.createdDate).toBe(issue.createdDate);
  });

  it('accetta anche le issue legacy prive di options', () => {
    const { options: _options, ...legacy } = issue;
    expect(councilDiscussionIssue(legacy)).toEqual(legacy);
  });

  it('openIssue sanitizza prima di scegliere il relatore, aprire la room e costruire la bozza', () => {
    const normalization = opening.indexOf('const discussionIssue = councilDiscussionIssue(issue)');
    const roomCreation = opening.indexOf('startRoom(rapporteur, discussionIssue)');
    expect(normalization).toBeGreaterThan(-1);
    expect(roomCreation).toBeGreaterThan(normalization);
    expect(opening).toContain('discussionIssue.suggestedMinisters.find');
    expect(opening).not.toContain('startRoom(rapporteur, issue)');
    expect(opening.indexOf('councilDraft(room, currentTurn ?? 0)')).toBeGreaterThan(roomCreation);
    // startRoom deve inoltrare quella stessa issue a createCouncilRoom.
    expect(startRoom).toContain('sourceIssue?: CouncilIssue');
    expect(startRoom).toMatch(/createCouncilRoom\([\s\S]*sourceIssue/);
  });

  it('la stanza riceve una issue senza options e una Tavola vuota', () => {
    const room = discussionRoom();
    expect(room.sourceIssue?.options).toBeUndefined();
    expect(room.sourceIssue?.suggestedMinisters).toEqual(['guerra', 'tesoro', 'esteri']);
    expect(room.initiatorMinister).toBe('guerra');
    expect(room.sharedBoard.proposals).toEqual([]);
    expect(room.sharedBoard.activeProposalId).toBeNull();
  });

  it('la bozza contiene titolo e domanda ma nessuna soluzione Advisor', () => {
    const draft = councilDraft(discussionRoom(), 3);
    expect(draft.text).toContain(issue.title);
    expect(draft.text).toContain(issue.question.replace(/[.!?]+$/, ''));
    for (const option of issue.options!) {
      expect(draft.text).not.toContain(option.title);
      expect(draft.text).not.toContain(option.content);
    }
  });

  it('il contesto inviato ai ministri conserva la questione canonica senza options', () => {
    const context = councilContext(discussionRoom());
    expect(context.sourceIssue).toEqual(councilDiscussionIssue(issue));
    expect(context.sourceIssue).not.toHaveProperty('options');
    const payload = JSON.stringify(context);
    expect(payload).toContain(issue.title);
    expect(payload).toContain(issue.question);
    for (const option of issue.options!) {
      expect(payload).not.toContain(option.title);
      expect(payload).not.toContain(option.content);
    }
  });

  it('non elimina options dal modello né dagli altri ingressi nella room', () => {
    const otherRoom = createCouncilRoom({ id: 'other', scopeKey: 'game', initiatorMinister: 'guerra', sourceIssue: issue });
    expect(otherRoom.sourceIssue?.options).toBe(issue.options);
  });
});
