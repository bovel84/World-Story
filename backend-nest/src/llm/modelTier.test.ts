/**
 * Test-contratto della fascia dei modelli
 * =======================================
 * Difende il riconoscimento dei modelli che devono ricevere il protocollo
 * compatto. La tabella qui sotto è fatta di **nomi reali**.
 *
 * **Prompt tier ≠ memory tier.** `classifyModel()` decide **solo** il protocollo
 * di simulazione: `glm-5.3-flash` e `deepseek-v4.1-flash` restano **compatti**.
 * I budget di memoria sono decisi da `narrativeMemoryTierFor()`, che li porta a
 * `full-tier` senza cambiare il protocollo.
 *
 * Guardia contro il falso verde: la prima asserzione è che la tabella sia
 * abbastanza numerosa, così un errore che rendesse vuoto l'elenco non farebbe
 * passare il test trovando zero casi.
 */
import { describe, it, expect } from 'vitest';
import { classifyModel, isSmallModel, narrativeMemoryTierFor, narrativeBudgetsFor, CONSTRAINED_NARRATIVE_BUDGETS, FULL_NARRATIVE_BUDGETS, CONSTRAINED_PARAM_LIMIT_B } from './modelTier';

/** Modelli che DEVONO ricevere il protocollo compatto. */
const PICCOLI: Array<[string, string]> = [
  ['glm-5.3-flash', 'modello usato da Andrea: protocollo compatto'],
  ['deepseek-v4.1-flash', 'modello usato da Andrea: protocollo compatto'],
  ['glm-5.3-flash:free', 'variante gratuita'],
  ['llama3.2:3b', 'locale 3B, cifra attaccata a un punto'],
  ['qwen3:1.7b', 'locale 1.7B'],
  ['phi4:3.8b', 'locale 3.8B'],
  ['gemma2:2b', 'locale 2B'],
  ['mistral-7b', '7B al limite'],
  ['gpt-4o-mini', 'etichetta mini'],
  ['some-org/small-model', 'etichetta small'],
];

/** Modelli che NON devono riceverlo: il percorso lungo ha più istruzioni. */
const GRANDI: Array<[string, string]> = [
  ['claude-sonnet-4-20250514', 'Anthropic predefinito'],
  ['openai/gpt-oss:20b', '20B'],
  ['qwen3:14b', '14B (predefinito di Ollama locale)'],
  ['meta/llama-3.3-70b-instruct', '70B'],
  ['deepseek-v4', 'versione 4, NON 4 miliardi'],
  ['glm-5.3', 'versione senza suffisso veloce'],
  ['anthropic/claude-sonnet-4', 'OpenRouter con namespace'],
];

describe('classifyModel — fascia dei modelli', () => {
  it('la tabella dei casi è abbastanza numerosa (guardia)', () => {
    expect(PICCOLI.length, 'senza casi il test non prova nulla').toBeGreaterThanOrEqual(8);
    expect(GRANDI.length).toBeGreaterThanOrEqual(6);
  });

  it('i modelli veloci, gratuiti e piccoli ricevono il protocollo compatto', () => {
    for (const [model, nota] of PICCOLI) {
      expect(isSmallModel(model), `${model} (${nota}) doveva essere compatto`).toBe(true);
    }
  });

  it('i modelli di prima fascia restano sul protocollo lungo', () => {
    for (const [model, nota] of GRANDI) {
      expect(isSmallModel(model), `${model} (${nota}) non doveva essere compatto`).toBe(false);
    }
  });

  it('il difetto misurato non si ripresenta: `flash` resta compatto nel protocollo', () => {
    // `classifyModel` governa SOLO il protocollo di simulazione: i modelli usati
    // da Andrea restano compatti anche dopo la separazione dei tier.
    expect(classifyModel('glm-5.3-flash')).toEqual({ constrained: true, reason: 'flash' });
    expect(classifyModel('deepseek-v4.1-flash')).toEqual({ constrained: true, reason: 'flash' });
    expect(classifyModel('llama3.2:3b')).toEqual({ constrained: true, reason: 'small-params' });
  });

  it('narrativeMemoryTierFor: famiglie forti piene, `:free` resta vincolato', () => {
    expect(narrativeMemoryTierFor('glm-5.3-flash')).toBe('full-tier');
    expect(narrativeMemoryTierFor('deepseek-v4.1-flash')).toBe('full-tier');
    expect(narrativeMemoryTierFor('glm-5.3-flash:free')).toBe('constrained');
    expect(narrativeMemoryTierFor('llama3.2:3b')).toBe('constrained');
    expect(narrativeMemoryTierFor('claude-sonnet-4-20250514')).toBe('full-tier');
  });

  it('narrativeBudgetsFor segue il memory tier, non il prompt tier', () => {
    // Prompt compatto, memoria piena: il punto della separazione.
    expect(isSmallModel('glm-5.3-flash')).toBe(true);
    expect(narrativeBudgetsFor('glm-5.3-flash')).toBe(FULL_NARRATIVE_BUDGETS);
    expect(narrativeBudgetsFor('deepseek-v4.1-flash')).toBe(FULL_NARRATIVE_BUDGETS);
    // `:free` e modelli piccoli restano sui budget storici.
    expect(narrativeBudgetsFor('glm-5.3-flash:free')).toBe(CONSTRAINED_NARRATIVE_BUDGETS);
    expect(narrativeBudgetsFor('llama3.2:3b')).toBe(CONSTRAINED_NARRATIVE_BUDGETS);
  });

  it('la soglia dei parametri è dichiarata, non implicita', () => {
    expect(CONSTRAINED_PARAM_LIMIT_B).toBe(7);
    expect(isSmallModel('model-7b')).toBe(true);
    expect(isSmallModel('model-8b')).toBe(false);
  });

  it('un nome vuoto o assente non inventa una fascia', () => {
    expect(isSmallModel('')).toBe(false);
    expect(isSmallModel(undefined)).toBe(false);
    expect(isSmallModel(null)).toBe(false);
  });
});
