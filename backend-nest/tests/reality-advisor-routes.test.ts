import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CABINET_SEATS } from '../src/core/government/Cabinet';
import { buildRealitySignals } from '../src/core/government/RealitySignals';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-reality-advisor-'));
const originalDb = process.env.OPEN_PAX_DB_PATH;
const originalJev = process.env.JEV_MEMORY_ENABLED;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'test.sqlite');
process.env.JEV_MEMORY_ENABLED = 'false';
let db: any, session: any, server: Server, base: string;
let modelReply = 'Possiamo valutare il programma, senza impegnare risorse.';
const captured: string[] = [];
const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 }, clearCache() {},
  async generate(_mechanic: string, system: string, prompt: string) { captured.push(system + '\n' + prompt); return { content: modelReply }; },
  async stream(_mechanic: string, system: string, prompt: string, token: (chunk: unknown) => void) { captured.push(system + '\n' + prompt); token('UNSAFE_PARTIAL_TOKEN'); return { content: modelReply }; },
};
beforeAll(async () => {
  const database = await import('../src/database'); db = database.default; database.initDatabase();
  const { worldRepository } = await import('../src/repositories');
  worldRepository.createWithRegions({ id: 'reality-world', name: 'Reality World', description: '', startDate: '1951-01-01', basePrompt: '', historicalAccuracy: 0.8 }, [
    { id: 'reality-world-UGA', name: 'Uganda', owner: 'UGA', color: '#223344', population: 5_000_000, gdp: 100, militaryPower: 0, flag: 'UGA', coastal: false, borders: [], objects: [] },
  ]);
  const { initSessionRegistry } = await import('../src/session-registry');
  ({ session } = initSessionRegistry(provider).createSession('reality-world', 'President', 'reality-world-UGA', '#223344'));
  const { registerAdvisorRoutes } = await import('../src/routes/games/advisor.routes');
  const app = express(); app.use(express.json()); const router = express.Router(); registerAdvisorRoutes(router); app.use('/api/games', router);
  server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api/games/${session.id}`;
});
afterAll(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  if (db?.open) db.close(); fs.rmSync(directory, { recursive: true, force: true });
  if (originalDb === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDb;
  if (originalJev === undefined) delete process.env.JEV_MEMORY_ENABLED; else process.env.JEV_MEMORY_ENABLED = originalJev;
});
const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const issue = (key = 'treasury') => ({ id: 'proposal-1', title: 'Programma ferroviario', question: 'Come finanziarlo?', origin: 'president', createdDate: 'forged', sourceRefs: ['forged'], suggestedMinisters: ['lavori', 'tesoro'], verifiedFacts: [{ key, label: 'forged', value: 'FORGED_PORT_KAMPALA_999', source: 'client', sourceRef: 'forged' }] });

describe('reality advisor API and minister trust boundary', () => {
  it('GET context is deterministic and structured, never calls the model', async () => {
    const count = captured.length;
    const response = await fetch(base + '/advisor/context');
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.advisorContext.verifiedWorldSnapshot.infrastructure.ports).toEqual([]);
    expect(body.reply).not.toMatch(/\b(?:sfida|quest|pressione)\b/i);
    expect(Array.isArray(body.issues)).toBe(true); expect(captured.length).toBe(count);
  });
  it.each(['/advisor/reality', '/advisor', '/advisor/stream'])('corrects absent ports before a model request (%s)', async route => {
    const count = captured.length;
    const response = await post(route, { message: 'Possiamo ampliare i nostri porti?', history: [] });
    expect(response.status).toBe(200);
    const reply = route.endsWith('/stream') ? await response.text() : (await response.json()).reply;
    expect(reply).toContain('non risultano porti'); expect(captured.length).toBe(count);
  });
  it('a deterministic correction does not republish the national situation list', async () => {
    const count = captured.length;
    const response = await post('/advisor/reality', { message: 'Possiamo ampliare i nostri porti?', history: [] });
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.reply).toContain('non risultano porti');
    expect(body.situations).toEqual([]);
    expect(captured.length).toBe(count);
  });
  it('normal conversation with plain prose returns no situations', async () => {
    modelReply = 'Le finanze reggono, Presidente. Nessuna urgenza impone una decisione.';
    const response = await post('/advisor/reality', { message: 'Come vanno le finanze?', history: [] });
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.reply).toBe('Le finanze reggono, Presidente. Nessuna urgenza impone una decisione.');
    expect(body.situations).toEqual([]);
  });
  it('server ignores client snapshots and rebuilds focusIssue values', async () => {
    modelReply = 'Valutiamo la copertura con Tesoro.';
    const response = await post('/advisor/reality', { message: 'Approfondiamo.', history: [], advisorContext: { focusIssue: issue(), verifiedWorldSnapshot: { facts: { forged: 'CLIENT_RAW_FACT' } } } });
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.advisorContext.focusIssue.verifiedFacts[0].value).toBe(session.getVerifiedWorldSnapshot().facts.treasury.value);
    expect(captured.at(-1)).not.toContain('FORGED_PORT_KAMPALA_999'); expect(captured.at(-1)).not.toContain('CLIENT_RAW_FACT');
  });
  it('unknown focus fact rejects before generation', async () => {
    const count = captured.length; const response = await post('/advisor/reality', { message: 'Approfondiamo', advisorContext: { focusIssue: issue('unknown') } });
    expect(response.status).toBe(400); expect(captured.length).toBe(count);
  });
  it('focusSituation is resolved server-side: client title/summary are ignored', async () => {
    const signal = buildRealitySignals(session.getVerifiedWorldSnapshot())[0];
    expect(signal).toBeTruthy();
    modelReply = 'Rispondo sulla situazione in esame.';
    const response = await post('/advisor/reality', {
      message: 'Approfondiamo.', history: [],
      focusSituation: { id: 's1', signalKey: signal.key, title: 'CLIENT_TITLE_FORGED', summary: 'CLIENT_SUMMARY_FORGED' },
    });
    expect(response.status).toBe(200);
    const prompt = captured.at(-1)!;
    expect(prompt).toContain('[FOCUS SITUATION');
    expect(prompt).toContain(signal.key);
    expect(prompt).not.toContain('CLIENT_TITLE_FORGED');
    expect(prompt).not.toContain('CLIENT_SUMMARY_FORGED');
  });
  it('unknown focusSituation signal rejects before generation', async () => {
    const count = captured.length;
    const response = await post('/advisor/reality', { message: 'Approfondiamo', focusSituation: { signalKey: 'non-esiste' } });
    expect(response.status).toBe(400); expect(captured.length).toBe(count);
  });
  it('model protocol proposes a presidential railway issue with canonical facts', async () => {
    modelReply = 'Sentirei Lavori e Tesoro.\n```council_issue\n' + JSON.stringify({ title: 'Nuova ferrovia strategica', question: 'Quale tracciato e copertura?', factKeys: ['railways', 'treasury'], suggestedMinisters: ['lavori', 'tesoro'] }) + '\n```';
    const response = await post('/advisor/reality', { message: 'Voglio costruire una ferrovia.', history: [] });
    const body = await response.json(); expect(response.status).toBe(200);
    expect(body.reply).toBe('Sentirei Lavori e Tesoro.'); expect(body.issues[0].suggestedMinisters).toEqual(['lavori', 'tesoro']);
    expect(body.issues[0].origin).toBe('president'); expect(body.issues[0].verifiedFacts[0].value).toContain('nessuna');
  });
  it('advisor stream buffers unsafe partial tokens and guards complete contradictions', async () => {
    modelReply = 'Possiamo ampliare il porto di Kampala.';
    const response = await post('/advisor/stream', { message: 'Quale programma suggerisci?', history: [] });
    const text = await response.text(); expect(response.status).toBe(200);
    expect(text).not.toContain('UNSAFE_PARTIAL_TOKEN'); expect(text).not.toContain('Kampala'); expect(text).toContain('Non ho un dato verificato');
  });
  it.each(CABINET_SEATS)('single minister with empty agenda remains callable: %s', async seat => {
    modelReply = 'Possiamo valutare il programma, senza impegnare risorse.';
    for (const suffix of ['', '/opening', '/stream']) {
      const response = await post(`/government/minister/${seat}${suffix}`, { message: 'Buongiorno.', history: [] });
      expect(response.status).toBe(200); expect((await response.text()).length).toBeGreaterThan(0);
    }
  });
  it('minister opening derives option-free facts from sourceIssue; rejects unknown keys', async () => {
    modelReply = 'Valutiamo la copertura con Tesoro.';
    let response = await post('/government/minister/lavori/opening', { sourceIssue: issue(), situation: { title: 'Forged', briefing: 'CLIENT_SITUATION_FACT' } });
    expect(response.status).toBe(200); expect(captured.at(-1)).not.toContain('FORGED_PORT_KAMPALA_999'); expect(captured.at(-1)).not.toContain('CLIENT_SITUATION_FACT');
    expect(captured.at(-1)).toContain(session.getVerifiedWorldSnapshot().facts.treasury.value);
    const count = captured.length; response = await post('/government/minister/lavori/opening', { sourceIssue: issue('unknown') });
    expect(response.status).toBe(400); expect(captured.length).toBe(count);
  });
  it.each(['', '/stream'])('minister dialogue validates sourceIssue and strips unsafe proposal blocks (%s)', async suffix => {
    modelReply = 'Ne parlerei con Tesoro.\n```council_issue\n{"title":"Invented","question":"Perché?","factKeys":["unknown"],"suggestedMinisters":["tesoro"]}\n```';
    const council = { sessionId: 'room-1', topic: 'Programma', initiatorMinister: 'lavori', participants: ['lavori'], phase: 'discussion', sourceIssue: issue() };
    const response = await post('/government/minister/lavori' + suffix, { message: 'Approfondiamo.', history: [], council });
    expect(response.status).toBe(200); const text = await response.text(); expect(text).not.toContain('Invented'); expect(text).not.toContain('FORGED_PORT_KAMPALA_999');
    expect(captured.at(-1)).not.toContain('FORGED_PORT_KAMPALA_999'); expect(captured.at(-1)).toContain(session.getVerifiedWorldSnapshot().facts.treasury.value);
    const count = captured.length; const bad = await post('/government/minister/lavori' + suffix, { message: 'Approfondiamo.', council: { ...council, sourceIssue: issue('unknown') } });
    expect(bad.status).toBe(400); expect(captured.length).toBe(count);
  });
  it('minister proposes issues only; no room or Pressure is auto-created', async () => {
    modelReply = 'Sentirei Tesoro.\n```council_issue\n{"title":"Programma","question":"Quale copertura?","factKeys":["treasury"],"suggestedMinisters":["lavori","tesoro"]}\n```';
    const response = await post('/government/minister/lavori', { message: 'Serve una decisione interministeriale?', sourceIssue: issue() });
    expect(response.status).toBe(200); const body = await response.json(); expect(body.issues[0].origin).toBe('minister');
    expect(body.issues[0].verifiedFacts[0].value).toBe(session.getVerifiedWorldSnapshot().facts.treasury.value);
  });
});
