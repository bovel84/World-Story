/**
 * World Story — Registro strutturato degli impegni
 * ================================================
 * La cronaca racconta, il registro **ricorda**. Dopo trenta turni una partita ha
 * trattati, promesse, garanzie, ultimatum e accordi commerciali che la sintesi
 * narrativa (poche centinaia di parole) non può conservare: senza un registro
 * strutturato il mondo «dimentica» ciò che ha firmato.
 *
 * Qui vive la forma dell'impegno e il suo ciclo di vita; il motore è l'autorità
 * sullo stato (`active` → `fulfilled` | `broken` | `expired` | `superseded`),
 * mentre il modello può solo proporre nuovi impegni o aggiornarne lo stato, con
 * campi validati. Nessun impegno nasce da testo libero non verificabile.
 */

export type CommitmentType =
  | 'treaty'             // trattato
  | 'promise'            // promessa politica (anche interna)
  | 'guarantee'          // garanzia
  | 'ultimatum'          // ultimatum con scadenza
  | 'trade-agreement'    // accordo commerciale
  | 'territorial-access' // accesso territoriale
  | 'ceasefire'          // cessate il fuoco
  | 'military-commitment'// impegno militare
  | 'future-obligation'; // obbligo futuro generico

export type CommitmentStatus = 'active' | 'fulfilled' | 'broken' | 'expired' | 'superseded';

export interface Commitment {
  /** Identità stabile: sopravvive agli aggiornamenti di stato. */
  id: string;
  type: CommitmentType;
  /** Chi si è impegnato (polityId, o `PLAYER`). */
  actor: string;
  /** Verso chi (polityId, o `PLAYER`). `null` = impegno interno. */
  counterparty: string | null;
  description: string;
  createdDate: string;
  createdTurn: number;
  status: CommitmentStatus;
  /** Scadenza dichiarata (ultimatum, obblighi futuri): `null` = senza termine. */
  deadline: string | null;
  /** Evento o chat che l'ha generato: la catena causale resta leggibile. */
  sourceEventId: string | null;
  /** 1 = di contorno, 2 = rilevante, 3 = decisivo. */
  importance: number;
  /** Ultima variazione di stato registrata. */
  updatedDate: string;
  updatedTurn: number;
  /** Perché è cambiato (rotto, onorato, decaduto). */
  note: string;
}

export const COMMITMENT_TYPE_LABEL: Record<CommitmentType, string> = {
  treaty: 'Trattato',
  promise: 'Promessa',
  guarantee: 'Garanzia',
  ultimatum: 'Ultimatum',
  'trade-agreement': 'Accordo commerciale',
  'territorial-access': 'Accesso territoriale',
  ceasefire: 'Cessate il fuoco',
  'military-commitment': 'Impegno militare',
  'future-obligation': 'Obbligo futuro',
};

export const COMMITMENT_STATUS_LABEL: Record<CommitmentStatus, string> = {
  active: 'in vigore',
  fulfilled: 'onorato',
  broken: 'tradito',
  expired: 'decaduto',
  superseded: 'sostituito',
};

export const COMMITMENT_TYPES = Object.keys(COMMITMENT_TYPE_LABEL) as CommitmentType[];
export const COMMITMENT_STATUSES = Object.keys(COMMITMENT_STATUS_LABEL) as CommitmentStatus[];

/** Giorni oltre i quali un ultimatum senza risposta decade. */
export const ULTIMATUM_DEFAULT_DAYS = 30;
/** Un impegno senza scadenza non resta «in vigore» per sempre: dopo questo periodo è storia. */
export const COMMITMENT_MAX_IDLE_DAYS = 1_825; // ~5 anni

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round0 = (value: number): number => Math.round(value);

/** Giorni fra due date ISO: 0 se la seconda precede o non è leggibile. */
export function commitmentDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function commitmentAddDays(date: string, days: number): string {
  const base = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(base)) return String(date).slice(0, 10);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** Normalizza un tipo proposto dal modello o dal motore. */
export function normalizeCommitmentType(value: unknown): CommitmentType | null {
  const token = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!token) return null;
  if ((COMMITMENT_TYPES as string[]).includes(token)) return token as CommitmentType;
  const aliases: Record<string, CommitmentType> = {
    trattato: 'treaty', patto: 'treaty', alleanza: 'treaty',
    promessa: 'promise', impegno: 'promise', 'impegno-politico': 'promise',
    garanzia: 'guarantee', ultimatum: 'ultimatum',
    accordo: 'trade-agreement', 'accordo-commerciale': 'trade-agreement', commercio: 'trade-agreement',
    'accesso-territoriale': 'territorial-access', basi: 'territorial-access',
    'cessate-il-fuoco': 'ceasefire', tregua: 'ceasefire',
    'impegno-militare': 'military-commitment',
    obbligo: 'future-obligation', 'obbligo-futuro': 'future-obligation',
  };
  return aliases[token] ?? null;
}

export function normalizeCommitmentStatus(value: unknown): CommitmentStatus | null {
  const token = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!token) return null;
  if ((COMMITMENT_STATUSES as string[]).includes(token)) return token as CommitmentStatus;
  const aliases: Record<string, CommitmentStatus> = {
    'in-vigore': 'active', attivo: 'active', aperto: 'active',
    onorato: 'fulfilled', mantenuto: 'fulfilled', rispettato: 'fulfilled',
    tradito: 'broken', rotto: 'broken', violato: 'broken',
    decaduto: 'expired', scaduto: 'expired',
    sostituito: 'superseded', superato: 'superseded',
  };
  return aliases[token] ?? null;
}

/** Chiave stabile di un impegno: attore + controparte + tipo + oggetto. */
export function commitmentKey(input: {
  actor: string; counterparty?: string | null; type: CommitmentType; description: string;
}): string {
  const slug = String(input.description ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9àèéìòù]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${input.actor}|${input.counterparty ?? 'interno'}|${input.type}|${slug}`;
}

/** Proposta di impegno: dal motore (chat strutturate) o dal modello. */
export interface CommitmentProposal {
  type: CommitmentType;
  actor: string;
  counterparty?: string | null;
  description: string;
  deadline?: string | null;
  importance?: number;
  sourceEventId?: string | null;
  /** Per gli aggiornamenti proposti dal modello: l'impegno a cui si riferisce. */
  id?: string | null;
  status?: CommitmentStatus | null;
  note?: string;
}

/**
 * Un ultimatum nasce da una chat con `kind: 'ultimatum'`: il motore lo
 * registra con una scadenza esplicita. Nessun testo libero interpretato: il
 * tipo è già strutturato nel payload.
 */
export function ultimatumProposal(input: {
  issuer: string;
  counterparty: string | null;
  topic: string;
  date: string;
  importance?: number;
  sourceEventId?: string | null;
  days?: number;
}): CommitmentProposal {
  const days = Number.isFinite(Number(input.days)) ? Number(input.days) : ULTIMATUM_DEFAULT_DAYS;
  return {
    type: 'ultimatum',
    actor: input.issuer,
    counterparty: input.counterparty,
    description: input.topic?.trim() || 'Ultimatum senza oggetto dichiarato',
    deadline: commitmentAddDays(input.date, Math.max(1, days)),
    importance: input.importance ?? 3,
    sourceEventId: input.sourceEventId ?? null,
  };
}

/** Impegni ancora in vigore, dal più decisivo. */
export function activeCommitments(commitments: readonly Commitment[] | null | undefined): Commitment[] {
  return (commitments ?? []).filter(commitment => commitment.status === 'active');
}

/** Stato di un impegno attivo: quanto stringe la scadenza. */
export function commitmentUrgency(
  commitment: Pick<Commitment, 'status' | 'deadline' | 'createdDate'>,
  today: string,
): { expired: boolean; daysLeft: number | null; daysOpen: number; label: string } {
  const daysOpen = Math.max(0, commitmentDaysBetween(commitment.createdDate, today));
  if (!commitment.deadline) {
    return { expired: false, daysLeft: null, daysOpen, label: `in vigore da ${daysOpen} giorni` };
  }
  const daysLeft = commitmentDaysBetween(today, commitment.deadline);
  if (daysLeft < 0 || (commitment.status === 'active' && daysLeft === 0)) {
    return { expired: true, daysLeft: 0, daysOpen, label: 'scadenza raggiunta' };
  }
  return {
    expired: false, daysLeft, daysOpen,
    label: daysLeft === 0 ? 'scade oggi' : `scade fra ${daysLeft} ${daysLeft === 1 ? 'giorno' : 'giorni'}`,
  };
}

/**
 * Applica le proposte all'elenco corrente. Deterministico e conservativo:
 *  - le nuove proposte diventano `active` (dedupe per chiave: nessun doppione);
 *  - una proposta con `id` aggiorna quello stato, senza toccare la descrizione;
 *  - gli impegni senza scadenza diventano `expired` solo dopo anni di inerzia;
 *  - un nuovo impegno dello stesso tipo verso la stessa controparte sostituisce
 *    il precedente (non si accumulano promesse contraddittorie).
 */
export function applyCommitmentProposals(
  current: readonly Commitment[],
  proposals: readonly CommitmentProposal[],
  input: { date: string; turn: number; sourceEventId?: string | null },
): { commitments: Commitment[]; created: Commitment[]; updated: Commitment[] } {
  const byKey = new Map(current.map(commitment => [commitmentKey(commitment), commitment]));
  const byId = new Map(current.map(commitment => [commitment.id, commitment]));
  const created: Commitment[] = [];
  const updated: Commitment[] = [];
  const today = input.date;

  // 1. Aggiornamenti di stato espliciti.
  for (const proposal of proposals) {
    if (!proposal.id || !proposal.status) continue;
    const target = byId.get(proposal.id);
    if (!target || target.status === proposal.status) continue;
    const next: Commitment = {
      ...target,
      status: proposal.status,
      updatedDate: input.date,
      updatedTurn: input.turn,
      note: proposal.note || (proposal.status === 'fulfilled'
        ? 'Impegno onorato.'
        : proposal.status === 'broken' ? 'Impegno tradito.' : target.note),
    };
    byId.set(next.id, next);
    byKey.set(commitmentKey(next), next);
    updated.push(next);
  }

  // 2. Nuovi impegni.
  for (const proposal of proposals) {
    if (proposal.id && proposal.status) continue;
    if (!proposal.actor || !proposal.description) continue;
    const key = commitmentKey(proposal);
    const existing = byKey.get(key);
    if (existing) {
      // Già in vigore: si aggiorna solo l'urgenza, non si duplica.
      if (existing.status === 'active') continue;
      const revived: Commitment = {
        ...existing, status: 'active', updatedDate: input.date, updatedTurn: input.turn,
        note: 'Impegno riproposto.', deadline: proposal.deadline ?? existing.deadline,
      };
      byKey.set(key, revived);
      byId.set(revived.id, revived);
      updated.push(revived);
      continue;
    }
    // Un impegno dello stesso tipo verso la stessa controparte sostituisce il
    // precedente ancora aperto: due promesse contraddittorie non convivono.
    for (const other of [...byKey.values()]) {
      if (other.status !== 'active') continue;
      if (other.actor !== proposal.actor) continue;
      if (other.counterparty !== (proposal.counterparty ?? null)) continue;
      if (other.type !== proposal.type) continue;
      const superseded: Commitment = {
        ...other, status: 'superseded', updatedDate: input.date, updatedTurn: input.turn,
        note: `Sostituito da: ${proposal.description}`,
      };
      byKey.set(commitmentKey(superseded), superseded);
      byId.set(superseded.id, superseded);
      updated.push(superseded);
    }
    const id = `${key}|${input.turn}`;
    const commitment: Commitment = {
      id,
      type: proposal.type,
      actor: proposal.actor,
      counterparty: proposal.counterparty ?? null,
      description: proposal.description,
      createdDate: input.date,
      createdTurn: input.turn,
      status: 'active',
      deadline: proposal.deadline ?? null,
      sourceEventId: proposal.sourceEventId ?? input.sourceEventId ?? null,
      importance: clamp(round0(Number(proposal.importance) || 2), 1, 3),
      updatedDate: input.date,
      updatedTurn: input.turn,
      note: '',
    };
    byKey.set(key, commitment);
    byId.set(id, commitment);
    created.push(commitment);
  }

  // 3. Decadenza per inerzia: un impegno senza scadenza non è eterno.
  for (const commitment of [...byId.values()]) {
    if (commitment.status !== 'active' || commitment.deadline) continue;
    if (commitmentDaysBetween(commitment.createdDate, today) > COMMITMENT_MAX_IDLE_DAYS) {
      const expired: Commitment = {
        ...commitment, status: 'expired', updatedDate: today, updatedTurn: input.turn,
        note: `Nessun seguito registrato per ${COMMITMENT_MAX_IDLE_DAYS} giorni.`,
      };
      byKey.set(commitmentKey(expired), expired);
      byId.set(expired.id, expired);
      updated.push(expired);
    }
  }

  // 4. Scadenze raggiunte: l'ultimatum non resta aperto in eterno.
  for (const commitment of [...byId.values()]) {
    if (commitment.status !== 'active' || !commitment.deadline) continue;
    const urgency = commitmentUrgency(commitment, today);
    if (!urgency.expired) continue;
    const expired: Commitment = {
      ...commitment, status: 'expired', updatedDate: today, updatedTurn: input.turn,
      note: commitment.type === 'ultimatum' ? 'Ultimatum scaduto senza risposta.' : 'Obbligo futuro non onorato entro la scadenza.',
    };
    byKey.set(commitmentKey(expired), expired);
    byId.set(expired.id, expired);
    updated.push(expired);
  }

  const commitments = [...byId.values()].sort((a, b) =>
    b.importance - a.importance || b.createdTurn - a.createdTurn || a.id.localeCompare(b.id));
  return { commitments, created, updated };
}

/**
 * Blocco per il prompt: solo gli impegni in vigore, con scadenza e attore.
 * Chi legge deve poter dire «questo l'ho firmato io, quello l'ha firmato lui».
 */
export function describeCommitments(
  commitments: readonly Commitment[] | null | undefined,
  options: { today: string; polityId?: string | null; limit?: number } = { today: '' },
): string {
  const active = activeCommitments(commitments)
    .filter(commitment => !options.polityId
      || commitment.actor === options.polityId
      || commitment.counterparty === options.polityId)
    .slice(0, options.limit ?? 8);
  if (active.length === 0) return 'nessun impegno in vigore registrato: non inventarne uno';
  return active.map(commitment => {
    const urgency = commitmentUrgency(commitment, options.today);
    const towards = commitment.counterparty ? ` verso ${commitment.counterparty}` : ' (impegno interno)';
    return `${COMMITMENT_TYPE_LABEL[commitment.type]} ${commitment.actor}${towards}: ${commitment.description} [${commitment.id}] · ${urgency.label} · importanza ${commitment.importance}/3`;
  }).join(' | ');
}

/** Impegni che toccano una polity (come attore o controparte). */
export function commitmentsForPolity(
  commitments: readonly Commitment[] | null | undefined,
  polityId: string,
): Commitment[] {
  return (commitments ?? []).filter(commitment =>
    commitment.actor === polityId || commitment.counterparty === polityId);
}

/**
 * Gli impegni che meritano una riga nel briefing: in vigore e con scadenza
 * vicina o importanza decisiva. Nessun elenco infinito.
 */
export function commitmentsWorthAttention(
  commitments: readonly Commitment[] | null | undefined,
  options: { today: string; limit?: number } = { today: '' },
): Commitment[] {
  return activeCommitments(commitments)
    .filter(commitment => {
      if (commitment.importance >= 3) return true;
      if (!commitment.deadline) return false;
      const daysLeft = commitmentDaysBetween(options.today, commitment.deadline);
      return daysLeft <= 45;
    })
    .sort((a, b) => {
      const urgency = (commitment: Commitment): number => {
        if (!commitment.deadline) return 999;
        return commitmentDaysBetween(options.today, commitment.deadline);
      };
      return urgency(a) - urgency(b) || b.importance - a.importance || a.id.localeCompare(b.id);
    })
    .slice(0, options.limit ?? 3);
}
