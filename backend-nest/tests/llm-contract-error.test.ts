/**
 * Fase 4 — LLMContractError
 * =========================
 * Verifica che le violazioni del contratto di output LLM siano tipizzate e
 * distinguibili da `LLMError` (trasporto/provider) e `DomainContractError`.
 */
import { describe, expect, it } from 'vitest';
import { LLMContractError, LLMError } from '../src/llm';
import { parseJsonLoose } from '../src/utils/json-repair';

describe('LLMContractError', () => {
  it('viene lanciato quando la risposta non contiene JSON', () => {
    expect(() => parseJsonLoose('nessun json qui')).toThrow(LLMContractError);
    try {
      parseJsonLoose('nessun json qui', { mechanic: 'jump' });
      throw new Error('atteso lancio');
    } catch (e) {
      expect(e).toBeInstanceOf(LLMContractError);
      const err = e as LLMContractError;
      expect(err.name).toBe('LLMContractError');
      expect(err.mechanic).toBe('jump');
      expect(err.message).toContain('llm_contract_error:');
      expect(err.message).toContain('JSON object not found');
    }
  });

  it('viene lanciato quando il JSON resta irrecuperabile', () => {
    expect(() => parseJsonLoose('{a: [}]')).toThrow(LLMContractError);
  });

  it('non è un errore di trasporto né di dominio', () => {
    const err = new LLMContractError('boom', { mechanic: 'jump' });
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LLMError);
    expect(err.name).toBe('LLMContractError');
  });

  it('tronca l’estratto e non richiede contesto', () => {
    const long = 'x'.repeat(1000);
    expect(() => parseJsonLoose(long)).toThrow(LLMContractError);
    try {
      parseJsonLoose(long);
    } catch (e) {
      expect((e as LLMContractError).excerpt?.length).toBe(200);
      expect((e as LLMContractError).mechanic).toBeUndefined();
    }
  });

  it('lascia passare i JSON riparabili (nessuna regressione)', () => {
    expect(parseJsonLoose('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('bla {"a": 1, "b": [2,]} bla')).toEqual({ a: 1, b: [2] });
  });
});
