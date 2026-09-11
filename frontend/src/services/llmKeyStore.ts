/**
 * World Story — Archivio chiavi API nel browser.
 * ==============================================
 * La chiave non viene mai scritta su disco lato server (persistApiKey: false):
 * qui la conserviamo nel localStorage del browser, indicizzata per
 * provider + base URL + modello. Se cambia soltanto il modello, riutilizziamo
 * come fallback una chiave dello stesso provider/base URL: le credenziali dei
 * provider sono normalmente indipendenti dal modello. La chiave viene così
 * ri-applicata automaticamente dopo un riavvio del backend, che per sicurezza
 * non conserva chiavi su file.
 */

const STORE_KEY = 'openpax_llm_apikeys';
const LEGACY_KEY = 'openpax_llm_apikey';

/** Identifica una coppia provider/base-url/modello in modo canonico. */
function comboId(provider: string, baseUrl: string, model: string): string {
  return [
    provider.trim().toLowerCase(),
    baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    model.trim(),
  ].join('|');
}

function readStore(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch { /* store corrotto o JSON non valido: ripartiamo da zero */ }
  return {};
}

function writeStore(store: Record<string, string>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* storage pieno/bloccato (es. modalità privata): ignoriamo */ }
}

/** Chiave esatta per il modello; in fallback, una dello stesso endpoint. */
export function getStoredKey(provider: string, baseUrl: string, model: string): string {
  const store = readStore();
  const exact = store[comboId(provider, baseUrl, model)];
  if (exact) return exact;

  const scope = comboId(provider, baseUrl, '');
  return Object.entries(store).find(([id, key]) => id.startsWith(scope) && Boolean(key))?.[1] || '';
}

/** Salva (o rimuove, se vuota) la chiave per un provider/baseUrl/modello. */
export function setStoredKey(provider: string, baseUrl: string, model: string, key: string): void {
  const store = readStore();
  const id = comboId(provider, baseUrl, model);
  const trimmed = key.trim();
  if (trimmed) store[id] = trimmed;
  else delete store[id];
  writeStore(store);
}

/** Numero di combinazioni con chiave salvata (per la UI). */
export function storedKeyCount(): number {
  return Object.keys(readStore()).length;
}

/**
 * Migrazione one-shot dalla chiave unica legacy (`openpax_llm_apikey`):
 * la assegna al combo attualmente attivo e rimuove il vecchio entry,
 * così le ricerche diventano strettamente per-modello.
 */
export function migrateLegacyKey(provider: string, baseUrl: string, model: string): void {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) return;
  const store = readStore();
  const id = comboId(provider, baseUrl, model);
  if (!store[id]) store[id] = legacy;
  writeStore(store);
  localStorage.removeItem(LEGACY_KEY);
}

/** Chiave legacy, se ancora presente (fallback prima della migrazione). */
export function getLegacyKey(): string {
  return localStorage.getItem(LEGACY_KEY) || '';
}