/**
 * F04 §9.4.1 — hash semantico dello snapshot di gioco.
 *
 * Copre tutti i sottosistemi canonici del SaveData ed esclude i metadati del
 * salvataggio (nome, istante, ramo/revisione del nuovo ramo). La
 * canonicalizzazione ordina le chiavi: la stessa semantica produce lo stesso
 * hash a prescindere dall'ordine di serializzazione.
 */
import { createHash } from 'node:crypto';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortKeys(source[key]);
    return out;
  }
  return value;
}

export function semanticStateHash(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortKeys(data ?? {}))).digest('hex');
}