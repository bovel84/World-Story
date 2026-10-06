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
  // Nessun tetto a 3: tutte le proposte validate dal server restano portabili.
  const issues = raw.flatMap((item): CouncilIssue[] => {
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
    // WS-COUNCIL-SIGNALKEYS — Una issue senza fatti resta valida se ha almeno
    // una signalKey sintatticamente valida. I sourceRefs da soli NON provano nulla.
    const signalKeys = Array.isArray(issue.signalKeys)
      ? [...new Set(issue.signalKeys.filter((key): key is string => typeof key === 'string' && key.trim().length > 0).map(key => key.trim()))]
      : [];
    if (!verifiedFacts.length && !signalKeys.length) return [];
    return [{
      id, title, question, verifiedFacts,
      ...(signalKeys.length ? { signalKeys } : {}),
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
 * WS-GOV-ADVISOR-RESIDUAL-FIXES-2 §2 — I messaggi dei turni DIVERSI dal corrente,
 * dello stesso gioco e ramo: ricostruisce `archivedTurns()` dopo il reload senza
 * mescolare rami né riportare in chat un altro scope dello stesso turno.
 */
export function loadAdvisorArchive(gameId: string, branchId: string | null, currentTurn: number): AdvisorMessage[] {
  const storage = storageOrNull();
  if (!storage) return [];
  const prefix = advisorBranchPrefix(gameId, branchId);
  const archived: AdvisorMessage[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      // §2 — Solo i turni DIVERSI dal corrente: un altro `scopeKey` dello stesso
      // gioco/ramo e dello STESSO turno non è archivio (e non torna in chat).
      archived.push(...readBucket(storage, key).filter(message => message.turn !== undefined && message.turn !== currentTurn));
    }
  } catch {
    return archived;
  }
  return archived;
}

/**
 * WS-GOV-ADVISOR-HISTORICAL-BASELINE — La prima apertura del Governo è una
 * generazione LLM (storia del paese + presente + direzioni): la si conserva per
 * bucket, così riaprire il Governo non ripaga una nuova chiamata al provider.
 */
export interface AdvisorOpening {
  reply: string;
  issues: CouncilIssue[];
  date: string | null;
}

// Previous cached openings used the initial-mandate request even on later turns,
// and v2/v3 could predate the CouncilIssue signalKeys protocol. Invalidate them
// once; the server, not this cache, selects the briefing kind.
const OPENING_PREFIX = 'ws.advisor.opening.v4';

/** Bucket dedicato: non entra nella scansione dell'archivio conversazione. */
export function advisorOpeningKey(gameId: string, branchId: string | null, scopeKey: string): string {
  return `${OPENING_PREFIX}::${gameId || 'no-game'}::${branchId || 'no-branch'}::${scopeKey || 'no-scope'}`;
}

/** Apertura persistita; `null` se assente o illeggibile. */
export function loadAdvisorOpening(key: string): AdvisorOpening | null {
  const storage = storageOrNull();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { reply?: unknown; issues?: unknown; date?: unknown } | null;
    const reply = text(parsed?.reply);
    if (!reply) return null;
    return {
      reply,
      issues: sanitizeIssues(parsed?.issues) ?? [],
      date: typeof parsed?.date === 'string' && parsed.date ? parsed.date : null,
    };
  } catch {
    return null;
  }
}

export function saveAdvisorOpening(key: string, opening: AdvisorOpening): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({
      reply: opening.reply,
      ...(opening.issues.length ? { issues: opening.issues } : {}),
      date: opening.date,
    }));
  } catch {
    /* storage pieno o non disponibile: l'apertura si rigenera */
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
        // §4 — Le questioni del Consulente restano portabili dopo il reload.
        ...(message.issues?.length ? { issues: message.issues } : {}),
      }));
    if (!payload.length) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(payload));
  } catch {
    /* storage pieno o non disponibile: la conversazione resta in memoria */
  }
}
