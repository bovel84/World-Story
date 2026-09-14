/**
 * Storico dei conti nazionali: deduplica per data, isolamento per ramo e
 * potatura delle date più vecchie. È la fonte delle tendenze del Dossier
 * Nazione: nessun punto viene interpolato dal client.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';

const TEST_DB = path.join(os.tmpdir(), `world-story-accounts-${process.pid}-${Date.now()}.db`);
process.env.OPEN_PAX_DB_PATH = TEST_DB;

let repo: typeof import('../src/repositories/national-account.repository')['nationalAccountRepository'];
let db: any;

const GAME = 'acct_game';
const BRANCH = 'acct_branch';
const POLITY = 'BWA';

const account = (balance: number) => ({ polityId: POLITY, monthlyBalance: balance, stability: 50 });

beforeAll(async () => {
  const database = await import('../src/database');
  db = database.default;
  database.initDatabase();
  repo = (await import('../src/repositories/national-account.repository')).nationalAccountRepository;
  // La tabella è creata da database.ts all'import; nessuna FK richiesta.
  db.prepare('DELETE FROM national_account_history WHERE game_id = ?').run(GAME);
});

describe('nationalAccountRepository', () => {
  it('registra i punti in ordine cronologico e li restituisce dal più vecchio', () => {
    repo.append(GAME, BRANCH, POLITY, 1, '1951-01-01', account(-2));
    repo.append(GAME, BRANCH, POLITY, 2, '1951-02-01', account(-1));
    repo.append(GAME, BRANCH, POLITY, 3, '1951-03-01', account(1));
    const points = repo.list(GAME, BRANCH, POLITY);
    expect(points.map((p) => p.date)).toEqual(['1951-01-01', '1951-02-01', '1951-03-01']);
    expect(points.map((p) => p.account.monthlyBalance)).toEqual([-2, -1, 1]);
    expect(points[2].turn).toBe(3);
  });

  it('aggiorna lo stesso giorno invece di duplicarlo', () => {
    repo.append(GAME, BRANCH, POLITY, 3, '1951-03-01', account(5));
    const points = repo.list(GAME, BRANCH, POLITY);
    expect(points.filter((p) => p.date === '1951-03-01')).toHaveLength(1);
    expect(points[points.length - 1].account.monthlyBalance).toBe(5);
  });

  it('isola i punti per ramo', () => {
    repo.append(GAME, 'other_branch', POLITY, 1, '1951-01-01', account(99));
    const points = repo.list(GAME, BRANCH, POLITY);
    expect(points.every((p) => p.account.monthlyBalance !== 99)).toBe(true);
    expect(repo.list(GAME, 'other_branch', POLITY)).toHaveLength(1);
  });

  it('conserva solo le date più recenti', () => {
    for (let month = 1; month <= 70; month += 1) {
      const date = new Date(Date.UTC(1951, month - 1, 1)).toISOString().slice(0, 10);
      repo.append(GAME, BRANCH, POLITY, month, date, account(month));
    }
    const points = repo.list(GAME, BRANCH, POLITY, 999);
    expect(points.length).toBe(60);
    expect(points[0].account.monthlyBalance).toBe(11);
    expect(points[points.length - 1].account.monthlyBalance).toBe(70);
  });

  it('limita il numero di punti richiesti mantenendo i più recenti', () => {
    const points = repo.list(GAME, BRANCH, POLITY, 5);
    expect(points.length).toBe(5);
    expect(points[points.length - 1].account.monthlyBalance).toBe(70);
  });
});
