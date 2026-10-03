/**
 * P0 — Il Consiglio non trasforma un guasto tecnico in una posizione politica.
 * ===========================================================================
 * Il difetto osservato con provider reale: una risposta Council corretta di
 * 150–250 parole veniva bocciata dal validator 1:1 (`words <= 140`) e sostituita
 * da `fallbackMinisterDialogue()`, che recitava «Non riesco ora a valutare gli
 * interventi dei colleghi…». Un errore tecnico diventava così una dichiarazione
 * del Ministro della Guerra.
 *
 * Qui: validazione tipizzata e specifica per Council, errore esplicito al posto
 * del fallback, e catena di attribuzione verificata sul prompt del convocato.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http, { type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CouncilMinisterUnavailableError, councilDialogueLogLine, dialogueResponseIsNatural,
  fallbackMinisterDialogue, validateCouncilResponse, type MinisterDialogueBrief,
} from '../src/core/government/MinisterDialogue';

function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `parola${i + 1}`).join(' ');
}
function brief(council = true): MinisterDialogueBrief {
  return {
    seat: 'guerra',
    persona: { signature: 'Solo chi tiene la posizione vince' } as any,
    worldContext: {} as any,
    currentIssues: [],
    presidentMessage: 'preparate un atto che sostenga un battaglione al confine',
    recentHistory: [],
    redirect: null,
    ...(council ? { council: { sessionId: 'sessione-1', topic: 'battaglione al confine', initiatorMinister: 'tesoro', participants: ['tesoro', 'guerra'], phase: 'discussion' } } : {}),
  } as MinisterDialogueBrief;
}
const councilProse = (n: number): string => `Ministro del Tesoro, ${words(n)}.`;

describe('P0.1 — validator del Consiglio', () => {
  it('accetta una risposta Council di 180–220 parole (prima bocciata a 140)', () => {
    for (const n of [150, 180, 200, 220]) {
      const result = validateCouncilResponse(councilProse(n), brief());
      expect(result.ok, `${n} parole`).toBe(true);
      expect(dialogueResponseIsNatural(councilProse(n), brief())).toBe(true);
    }
  });

  it('accetta fino a 260 parole e boccia oltre 280', () => {
    expect(validateCouncilResponse(councilProse(260), brief()).ok).toBe(true);
    const tooLong = validateCouncilResponse(councilProse(300), brief());
    expect(tooLong).toEqual({ ok: false, reason: 'too_long', words: 303 });
  });

  it('accetta la sola prosa valida: il blocco ```consiglio è facoltativo', () => {
    const withBlock = `${councilProse(60)}\n\n\`\`\`consiglio\n{"position":{"status":"conditional","reason":"Serve il fabbisogno."}}\n\`\`\``;
    expect(validateCouncilResponse(withBlock, brief()).ok).toBe(true);
    expect(validateCouncilResponse(councilProse(60), brief()).ok).toBe(true);
  });

  it('mantiene i guardrail su vuoto e formule vietate', () => {
    expect(validateCouncilResponse('   ', brief())).toEqual({ ok: false, reason: 'empty', words: 0 });
    expect(validateCouncilResponse('Non è la mia materia, chiedete al Tesoro.', brief()).ok).toBe(false);
    expect(validateCouncilResponse('Ho 3 cose da dire.', brief()).ok).toBe(false);
  });

  it('il fallback come speech è vietato nel Consiglio (errore tipizzato)', () => {
    expect(() => fallbackMinisterDialogue(brief())).toThrow(CouncilMinisterUnavailableError);
    // La chat 1:1 legacy conserva il fallback deterministico.
    expect(typeof fallbackMinisterDialogue(brief(false))).toBe('string');
  });

  it('il log è conciso e non contiene prompt o history', () => {
    const line = councilDialogueLogLine(brief(), 'rejected', 'too_long', 301, 2400);
    expect(line).toBe('[CouncilDialogue] seat=guerra session=sessione-1 phase=discussion status=rejected reason=too_long words=301 chars=2400');
    expect(line).not.toContain('preparate');
    expect(councilDialogueLogLine(brief(false), 'accepted', undefined, 10, 80)).toBeNull();
  });
});

// ── Rotta HTTP: l'errore diventa 502, il successo resta 200 ─────────────────
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-council-failure-'));
const originalDbPath = process.env.OPEN_PAX_DB_PATH;
process.env.OPEN_PAX_DB_PATH = path.join(directory, 'test.sqlite');
const captured: string[] = [];
let mode: 'valid' | 'short-valid' | 'empty' | 'provider-error' = 'valid';
const validReply = `${councilProse(200)} Propongo quindi un primo battaglione per novanta giorni e la verifica delle scorte.`;
const provider: any = {
  consolidation: { startRound: 25, chunkSize: 5, keepRawTail: 10 },
  async generate(_mechanic: string, _system: string, prompt: string) {
    captured.push(prompt);
    if (mode === 'provider-error') throw new Error('provider offline');
    if (mode === 'empty') return { content: '   ' };
    if (mode === 'short-valid') return { content: councilProse(180) };
    return { content: validReply };
  },
  async stream(_mechanic: string, _system: string, prompt: string, onToken: (chars: number) => void) {
    captured.push(prompt);
    if (mode === 'provider-error') throw new Error('provider offline');
    const content = mode === 'empty' ? '   ' : mode === 'short-valid' ? councilProse(180) : validReply;
    onToken(content.length);
    return { content };
  },
  clearCache() {},
};
let db: any;
let session: any;
let server: Server;
let url: string;

beforeAll(async () => {
  db = (await import('../src/database')).default;
  (await import('../src/database')).initDatabase();
  const { worldRepository, gameRepository } = await import('../src/repositories');
  worldRepository.createWithRegions(
    { id: 'council-failure-world', name: 'Council Failure World', description: '', startDate: '1951-01-01', basePrompt: 'COUNCIL_FAILURE_AUTHORITY', historicalAccuracy: 0.8 },
    [{ id: 'council-failure-world-ITA', name: 'Italia', color: '#112233', owner: 'ITA', population: 47_000_000, gdp: 2400, militaryPower: 110, flag: 'ITA', coastal: true, borders: [], objects: [] }],
  );
  const { initSessionRegistry } = await import('../src/session-registry');
  ({ session } = initSessionRegistry(provider).createSession('council-failure-world', 'Player', 'council-failure-world-ITA', '#112233'));
  gameRepository.ensureMainBranch(session.id);
  const { registerAdvisorRoutes } = await import('../src/routes/games/advisor.routes');
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerAdvisorRoutes(router);
  app.use('/api/games', router);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}/api/games/${session.id}/government/minister/guerra`;
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  if (db?.open) db.close();
  if (originalDbPath === undefined) delete process.env.OPEN_PAX_DB_PATH; else process.env.OPEN_PAX_DB_PATH = originalDbPath;
  fs.rmSync(directory, { recursive: true, force: true });
});

const council = {
  sessionId: 'battaglione-1', topic: 'Battaglione al confine', initiatorMinister: 'tesoro',
  participants: ['tesoro', 'guerra'], phase: 'discussion',
};
const history = [
  { role: 'user', content: 'Presidente: preparate un atto che sostenga un battaglione al confine' },
  { role: 'user', content: 'Ministro del Tesoro: posso coprirlo, ma la Guerra mi indichi uomini e durata.' },
];

async function post(stream: boolean, body: unknown) {
  const response = await fetch(url + (stream ? '/stream' : ''), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

describe('P0.3 — la rotta traduce il guasto in errore operativo', () => {
  it.each([false, true])('provider error → 502 minister_unavailable (stream %s)', async stream => {
    mode = 'provider-error';
    const result = await post(stream, { message: 'Rispondi ai colleghi.', history, council });
    // Errore prima di qualunque token: nessuna risposta incompleta certificata.
    expect(result.status).toBe(502);
    expect(JSON.parse(result.text)).toEqual({ error: 'minister_unavailable', reason: 'provider_error', seat: 'guerra' });
  });

  it.each([false, true])('risposta vuota → 502 empty, nessun fallback speech (stream %s)', async stream => {
    mode = 'empty';
    const result = await post(stream, { message: 'Rispondi ai colleghi.', history, council });
    expect(JSON.parse(result.text).error ?? '').not.toContain('Non riesco ora a valutare');
    if (!stream) {
      expect(result.status).toBe(502);
      expect(JSON.parse(result.text).reason).toBe('empty');
    }
  });

  it('una risposta Council di 180 parole è accettata, non sostituita', async () => {
    mode = 'short-valid';
    const result = await post(false, { message: 'Rispondi ai colleghi.', history, council });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text).reply).toBe(councilProse(180));
  });

  it('una risposta Council di 200 parole è accettata e contiene l’intervento', async () => {
    mode = 'valid';
    const result = await post(true, { message: 'Rispondi ai colleghi.', history, council });
    expect(result.status).toBe(200);
    expect(result.text).toBe(validReply);
    expect(result.text).not.toContain('Non riesco ora a valutare');
  });

  it('P0.6 — Guerra riceve la history attribuita di Presidente e Tesoro; la risposta resta quella del modello', async () => {
    mode = 'valid';
    const before = captured.length;
    await post(false, { message: 'Rispondi ai colleghi.', history, council });
    const prompt = captured[before];
    expect(prompt).toContain('Presidente: preparate un atto che sostenga un battaglione al confine');
    expect(prompt).toContain('Ministro del Tesoro: posso coprirlo, ma la Guerra mi indichi uomini e durata.');
    expect(prompt).toContain('"sessionId":"battaglione-1"');
    expect(prompt).not.toContain('Non riesco ora a valutare gli interventi dei colleghi');
  });

  it('la chat 1:1 legacy non usa il percorso Council', async () => {
    mode = 'provider-error';
    const prompt = captured.length;
    // Senza alcun `council` il comportamento legacy resta (fallback deterministico).
    const legacyUrl = url.replace('/guerra', '/tesoro');
    const response = await fetch(legacyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Come stanno i conti?', history: [] }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.reply).toBe('string');
    expect(body.reply.length).toBeGreaterThan(0);
    expect(captured.length).toBeGreaterThan(prompt); // il provider è stato comunque tentato
  });
});
