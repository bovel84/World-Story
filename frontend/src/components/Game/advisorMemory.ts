/**
 * WS-GOV-ADVISOR-CHIEF-OF-STAFF — Persistenza della conversazione del Consulente.
 *
 * Un bucket per turno (`gameId` + `scopeKey`, che contiene ramo e turno): così
 * la chat attiva e l'archivio per turno sopravvivono al reload senza mescolare
 * rami diversi. Stesso pattern `localStorage` della memoria dei ministri: uno
 * storage rotto non rompe la conversazione.
 */
import type { AdvisorMessage } from '../../stores/chatStore';

const PREFIX = 'ws.advisor';
/** Tetto di sicurezza: la conversazione non cresce senza limite. */
const MAX_MESSAGES = 200;

export function advisorBucketKey(gameId: string, scopeKey: string): string {
  return `${PREFIX}::${gameId || 'no-game'}::${scopeKey || 'no-scope'}`;
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Messaggi persistiti del turno; lista vuota se assenti o illeggibili. */
export function loadAdvisorMessages(key: string): AdvisorMessage[] {
  const storage = storageOrNull();
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const message = item as { role?: unknown; content?: unknown; turn?: unknown; proactive?: unknown };
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string' || !message.content.trim()) return [];
      return [{
        role: message.role,
        content: message.content,
        ...(typeof message.turn === 'number' ? { turn: message.turn } : {}),
        ...(message.proactive === true ? { proactive: true } : {}),
      }] as AdvisorMessage[];
    }).slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

/** Scrive il turno corrente; un errore di quota/storage non interrompe la chat. */
export function saveAdvisorMessages(key: string, messages: readonly AdvisorMessage[]): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    const payload = messages
      .filter(message => message.content.trim())
      .slice(-MAX_MESSAGES)
      .map(message => ({
        role: message.role, content: message.content,
        ...(message.turn === undefined ? {} : { turn: message.turn }),
        ...(message.proactive ? { proactive: true } : {}),
      }));
    if (!payload.length) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(payload));
  } catch {
    /* storage pieno o non disponibile: la conversazione resta in memoria */
  }
}

/** Unione senza duplicati: i messaggi ripristinati non si ripetono in chat. */
export function mergeAdvisorMessages(existing: readonly AdvisorMessage[], restored: readonly AdvisorMessage[]): AdvisorMessage[] {
  const seen = new Set(existing.map(message => `${message.role}:${message.turn ?? ''}:${message.content}`));
  const merged = [...existing];
  for (const message of restored) {
    const key = `${message.role}:${message.turn ?? ''}:${message.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  return merged;
}
