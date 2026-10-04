/**
 * WS-GOV-ADVISOR-RESIDUAL-FIXES — Persistenza della conversazione del Consulente.
 *
 * Un bucket per `game + ramo + turno`: la chat attiva di un ramo non si mescola
 * con quella di un altro, e l'archivio dei turni precedenti si ripristina dallo
 * stesso ramo. Stesso pattern `localStorage` della memoria dei ministri: uno
 * storage rotto non rompe la conversazione.
 */
import type { AdvisorMessage } from '../../stores/chatStore';
import type { CouncilIssue } from '../../services/api';

const PREFIX = 'ws.advisor';
/** Tetto di sicurezza: la conversazione non cresce senza limite. */
const MAX_MESSAGES = 200;
const ISSUE_ORIGINS = ['advisor', 'president', 'minister', 'event', 'follow-up'];

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

/** WS-GOV-ADVISOR-RESIDUAL-FIXES §4 — Validazione minima degli `issues` salvati. */
function sanitizeIssues(raw: unknown): CouncilIssue[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const issues = raw.slice(0, 3).flatMap((item): CouncilIssue[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const issue = item as Record<string, unknown>;
    const id = text(issue.id); const title = text(issue.title); const question = text(issue.question);
    const createdDate = text(issue.createdDate);
    if (!id || !title || !question || !createdDate || !ISSUE_ORIGINS.includes(String(issue.origin))) return [];
    if (!Array.isArray(issue.suggestedMinisters) || !Array.isArray(issue.sourceRefs) || !Array.isArray(issue.verifiedFacts)) return [];
    const verifiedFacts = issue.verifiedFacts.flatMap((fact): CouncilIssue['verifiedFacts'] => {
      if (!fact || typeof fact !== 'object') return [];
      const entry = fact as Record<string, unknown>;
      const key = text(entry.key); const label = text(entry.label); const value = text(entry.value);
      const source = text(entry.source); const sourceRef = text(entry.sourceRef);
      return key && label && value && source && sourceRef ? [{ key, label, value, source, sourceRef }] : [];
    });
    if (!verifiedFacts.length) return [];
    return [{
      id, title, question, verifiedFacts,
      suggestedMinisters: issue.suggestedMinisters.filter(seat => typeof seat === 'string') as CouncilIssue['suggestedMinisters'],
      origin: issue.origin as CouncilIssue['origin'],
      sourceRefs: issue.sourceRefs.filter(ref => typeof ref === 'string') as string[],
      createdDate,
    }];
  });
  return issues.length ? issues : undefined;
}

export function advisorBucketKey(gameId: string, branchId: string | null, scopeKey: string): string {
  return `${PREFIX}::${gameId || 'no-game'}::${branchId || 'no-branch'}::${scopeKey || 'no-scope'}`;
}

/** Prefisso dei bucket dello STESSO gioco e ramo (l'archivio dei turni). */
function advisorBranchPrefix(gameId: string, branchId: string | null): string {
  return `${PREFIX}::${gameId || 'no-game'}::${branchId || 'no-branch'}::`;
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readBucket(storage: Storage, key: string): AdvisorMessage[] {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const message = item as { role?: unknown; content?: unknown; turn?: unknown; proactive?: unknown; issues?: unknown };
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string' || !message.content.trim()) return [];
      const issues = sanitizeIssues(message.issues);
      return [{
        role: message.role,
        content: message.content,
        ...(typeof message.turn === 'number' ? { turn: message.turn } : {}),
        ...(message.proactive === true ? { proactive: true } : {}),
        ...(issues ? { issues } : {}),
      }] as AdvisorMessage[];
    }).slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

/** Messaggi persistiti del turno; lista vuota se assenti o illeggibili. */
export function loadAdvisorMessages(key: string): AdvisorMessage[] {
  const storage = storageOrNull();
  return storage ? readBucket(storage, key) : [];
}

/**
 * WS-GOV-ADVISOR-RESIDUAL-FIXES §3 — Tutti i messaggi degli ALTRI turni dello
 * stesso gioco e ramo: serve a ricostruire `archivedTurns()` dopo un reload
 * senza mescolare i rami.
 */
export function loadAdvisorArchive(gameId: string, branchId: string | null, currentBucket: string): AdvisorMessage[] {
  const storage = storageOrNull();
  if (!storage) return [];
  const prefix = advisorBranchPrefix(gameId, branchId);
  const archived: AdvisorMessage[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || key === currentBucket || !key.startsWith(prefix)) continue;
      archived.push(...readBucket(storage, key));
    }
  } catch {
    return archived;
  }
  return archived;
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
        // §4 — Le questioni del Consulente restano portabili dopo il reload.
        ...(message.issues?.length ? { issues: message.issues } : {}),
      }));
    if (!payload.length) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(payload));
  } catch {
    /* storage pieno o non disponibile: la conversazione resta in memoria */
  }
}
