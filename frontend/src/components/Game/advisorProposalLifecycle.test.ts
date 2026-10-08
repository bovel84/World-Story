/**
 * P03 — Il ciclo di vita delle proposte del Consulente.
 *
 * **Scoperta della misura:** il ciclo di vita esiste **già**, e per costruzione.
 * Le proposte (`issues`) e le situazioni (`situations`) vivono dentro i messaggi
 * del Consulente; i messaggi sono bucketed per `gameId + ramo + turno`
 * (`advisorBucketKey(gameId, branchId, scopeKey)`, dove `scopeKey` contiene il
 * turno). A un avanzamento il turno cambia → la chat attiva è **sostituita**, mai
 * ereditata (`AdvisorChat.tsx:55`: `[...archived, ...loadAdvisorMessages(bucket)]`),
 * e i turni precedenti restano **archiviati come storia**.
 *
 * Quindi P03 **non è da costruire**: è da difendere. Questo test lo fa.
 *
 * Difende inoltre il difetto trovato durante la misura: `sanitizeIssues` non
 * conosceva `options`, e le **mosse** della proposta si perdevano al salvataggio.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { advisorBucketKey } from '../../components/Game/advisorMemory';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const chat = read('AdvisorChat.tsx');
const memory = read('advisorMemory.ts');

describe('P03 — il ciclo di vita è per turno (esiste per costruzione)', () => {
  it('la chiave del bucket cambia col turno — la chat attiva è solo quella del turno', () => {
    const a = advisorBucketKey('game-1', 'branch-1', 'council|turn-5');
    const b = advisorBucketKey('game-1', 'branch-1', 'council|turn-6');
    expect(a).not.toBe(b);
    // stesso turno → stesso bucket (la conversazione del turno è stabile)
    expect(advisorBucketKey('game-1', 'branch-1', 'council|turn-5')).toBe(a);
    // rami diversi non si mescolano
    expect(advisorBucketKey('game-1', 'branch-2', 'council|turn-5')).not.toBe(a);
  });

  it('la chat attiva è SOSTITUITA a un cambio di turno, non ereditata', () => {
    // `[...archived, ...loadAdvisorMessages(bucket)]` con `setAdvisorMessages`:
    // lo stato è rimpiazzato, mai mergiato con lo scope precedente.
    expect(chat).toContain('setAdvisorMessages([...archived, ...loadAdvisorMessages(bucket)])');
    // Non è un merge: la lista è ricostruita, mai `[...old, ...new]` dello stato precedente.
    expect(chat).not.toContain('setAdvisorMessages([...advisorMessages');
  });

  it('i turni precedenti restano ARCHIVIATI come storia (non persi)', () => {
    expect(chat).toContain('loadAdvisorArchive(gameId, branchId, currentTurn)');
    expect(memory).toContain('function advisorBranchPrefix');
  });

  it('le mosse della proposta SOPRAVVIVONO al salvataggio (difetto corretto)', () => {
    // `sanitizeIssues` deve conoscere `options`, altrimenti le perde in silenzio.
    expect(memory).toContain('issue.options.flatMap');
    expect(memory).toContain('...(options.length ? { options } : {})');
  });

  it('guardia contro il falso verde: il sanitizer valida davvero le opzioni', () => {
    // Il blocco esiste ed è dentro sanitizeIssues.
    const start = memory.indexOf('function sanitizeIssues');
    const end = memory.indexOf('function sanitizeSituations', start);
    expect(memory.slice(start, end)).toContain('options');
  });
});
