/**
 * World Story — WS-GOVOFFICE-07: il piano strategico come diagramma a cascata
 * ==========================================================================
 * La tela della sedia (Parte C2) deve poter mostrare un **piano strategico**:
 * nodi **datati** (es. GEN 2026), un titolo breve, una descrizione in una riga,
 * e un layout a **cascata** — nodo iniziale → rami paralleli → ricongiungimento
 * verso l'esito finale.
 *
 * Questo modulo è **puro** e separa tre cose che nel riferimento dell'autore
 * erano mescolate:
 *  1. **il testo** del piano (contenuto autorevole, curato): un formato di riga
 *     minimo che si può scrivere e rileggere (`parseStrategicPlan`);
 *  2. **la struttura** del grafo (nodi + dipendenze) e la sua **geometria**:
 *     la profondità di ogni nodo, i **rami** (nodi con più di un successore) e i
 *     **ricongiungimenti** (nodi con più di un predecessore) — `cascadeLayout`;
 *  3. la **derivazione** di un piano dalla proposta concreta in discussione
 *     (`planFromProposal`): i nodi sono le strade/prerequisiti della proposta e
 *     l'ancora temporale è la **data di gioco corrente**, mai una data fissa.
 *
 * WS-MINISTER-UX-08 — I piani dimostrativi con date fisse («GEN 2026») sono
 * stati rimossi dalla presentazione ordinaria: un piano o deriva dalla proposta
 * discussa, o non si mostra. Se manca la data di gioco, il piano resta
 * dichiarato mancante (`planFromProposal` restituisce `null`).
 */
import { formatDateOr } from '../../utils/format';

/** Un nodo del piano: quando, che cosa, perché, e da quali nodi dipende. */
export interface StrategicNode {
  id: string;
  /** Etichetta datata breve, come nel riferimento: «GEN 2026». */
  date: string;
  title: string;
  description: string;
  /** Gli id dei nodi che precedono questo (vuoto = nodo iniziale). */
  from: readonly string[];
}

/** Il piano: titolo, esito finale e i suoi nodi. */
export interface StrategicPlan {
  id: string;
  title: string;
  /** L'esito a cui la cascata ricongiunge. */
  outcome: string;
  nodes: readonly StrategicNode[];
}

/** Una «corsia» del diagramma: tutti i nodi alla stessa profondità. */
export interface CascadeLane {
  level: number;
  nodes: StrategicNode[];
}

export interface CascadeLayout {
  lanes: CascadeLane[];
  /** Nodi con più di un successore: dove la cascata si apre. */
  branches: string[];
  /** Nodi con più di un predecessore: dove i rami si ricongiungono. */
  merges: string[];
  /** Profondità di ogni nodo (0 = radice). */
  depth: Record<string, number>;
}

const slug = (value: string): string => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

/**
 * Legge un piano da un testo minimo. Formato (una riga per nodo):
 *
 * ```
 * PIANO: Stabilizzazione e Influenza Regionale
 * ESITO: La nazione è stabile e influenza la regione.
 * GEN 2026 | Riforma fiscale | Chiudere il disavanzo entro l'anno | -
 * GEN-FEB 2026 | Fondo infrastrutture | Aprire i cantieri | riforma-fiscale
 * GEN-FEB 2026 | Scuola e sanità | Ricucire il patto civile | riforma-fiscale
 * MAR 2026 | Vertice regionale | ... | fondo-infrastrutture, scuola-e-sanita
 * ```
 *
 * L'id del nodo è lo **slug** del titolo, salvo prefisso esplicito
 * `id :: DATA | Titolo | Descrizione | deps`. Le dipendenze si dichiarano per
 * id/slug; `-` o vuoto significa radice. Le dipendenze ignote non si inventano:
 * vengono **scartate** e il nodo resta radice.
 *
 * Il parser è deterministico: stesso testo ⇒ stesso piano. Non lancia sui dati
 * incompleti: una riga senza titolo si salta, un piano senza titolo prende un
 * titolo neutro — un diagramma vuoto è peggio di un diagramma onesto.
 */
export function parseStrategicPlan(text: string, fallbackId = 'piano'): StrategicPlan {
  let title = '';
  let outcome = '';
  const rawNodes: Array<{ id?: string; date: string; title: string; description: string; deps: string[] }> = [];

  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const titleMatch = /^PIANO:\s*(.+)$/i.exec(trimmed);
    if (titleMatch) { title = titleMatch[1].trim(); continue; }
    const outcomeMatch = /^ESITO:\s*(.+)$/i.exec(trimmed);
    if (outcomeMatch) { outcome = outcomeMatch[1].trim(); continue; }
    if (/^#/.test(trimmed)) continue;

    const parts = trimmed.split('|').map(part => part.trim());
    if (parts.length < 3) continue;
    // Prefisso opzionale `id ::`.
    let id: string | undefined;
    let date = parts[0];
    const idMatch = /^([a-z0-9-]+)\s*::\s*(.+)$/i.exec(date);
    if (idMatch) { id = idMatch[1]; date = idMatch[2].trim(); }
    const nodeTitle = parts[1];
    if (!nodeTitle) continue;
    const description = parts[2] ?? '';
    const deps = (parts[3] ?? '')
      .split(/[,\s]+/)
      .map(dep => dep.trim())
      .filter(dep => dep && dep !== '-');
    rawNodes.push({ id, date, title: nodeTitle, description, deps });
  }

  const known = new Set<string>();
  for (const node of rawNodes) known.add(node.id || slug(node.title));

  const nodes: StrategicNode[] = rawNodes.map(node => {
    const id = node.id || slug(node.title) || `nodo-${nodes.length + 1}`;
    const from = node.deps.map(dep => slug(dep)).filter(dep => known.has(dep));
    return { id, date: node.date, title: node.title, description: node.description, from };
  });

  return { id: slug(title) || fallbackId, title: title || 'Piano strategico', outcome, nodes };
}

/**
 * La geometria della cascata. Deterministica e senza cicli: la profondità di un
 * nodo è `1 + max(profondità dei predecessori)`, con i nodi senza predecessori a
 * livello 0. Un riferimento a un nodo non ancora visto non blocca il calcolo
 * (si usa la profondità corrente): un piano con dati sbagliati resta disegnabile
 * invece di andare in ricorsione infinita.
 */
export function cascadeLayout(plan: StrategicPlan): CascadeLayout {
  const byId = new Map(plan.nodes.map(node => [node.id, node]));
  const depth: Record<string, number> = {};
  const visiting = new Set<string>();

  const depthOf = (id: string): number => {
    if (depth[id] !== undefined) return depth[id];
    if (visiting.has(id)) return 0; // ciclo: non si ricorre all'infinito
    visiting.add(id);
    const node = byId.get(id);
    const parents = node ? node.from.filter(from => byId.has(from)) : [];
    const value = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(parent => depthOf(parent)));
    visiting.delete(id);
    depth[id] = value;
    return value;
  };

  for (const node of plan.nodes) depthOf(node.id);

  const maxLevel = plan.nodes.reduce((max, node) => Math.max(max, depth[node.id] ?? 0), 0);
  const lanes: CascadeLane[] = [];
  for (let level = 0; level <= maxLevel; level++) {
    lanes.push({ level, nodes: plan.nodes.filter(node => (depth[node.id] ?? 0) === level) });
  }

  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();
  for (const node of plan.nodes) {
    if ((node.from.filter(from => byId.has(from)).length) > 1) inDegree.set(node.id, node.from.length);
    for (const from of node.from) {
      if (!byId.has(from)) continue;
      outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
    }
  }

  return {
    lanes,
    branches: [...outDegree.entries()].filter(([, count]) => count > 1).map(([id]) => id),
    merges: plan.nodes.filter(node => node.from.length > 1).map(node => node.id),
    depth,
  };
}

/**
 * Un passo del piano derivato dalla proposta: una strada o un prerequisito.
 * `requires` elenca gli id dei passi che devono precederlo (i prerequisiti
 * dichiarati dalla proposta, quando ci sono).
 */
export interface PlanProposalStep {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly requires?: readonly string[];
}

/**
 * La proposta concreta da cui nasce il piano. `today` è la **data di gioco**:
 * senza, il piano non si costruisce (resta dichiarato mancante, non si inventa
 * una data).
 */
export interface PlanProposal {
  readonly id: string;
  readonly title: string;
  /** La questione che apre il piano (il bisogno della sedia). */
  readonly need: string;
  /** L'esito dichiarato dalla proposta, se c'è. */
  readonly outcome?: string;
  readonly today: string | null | undefined;
  readonly steps: readonly PlanProposalStep[];
}

/** L'etichetta datata breve del nodo, dalla data di gioco corrente. */
export function planDateLabel(today: string | null | undefined): string | null {
  if (!today) return null;
  const label = formatDateOr(today, '');
  return label.length > 0 ? label.toUpperCase() : null;
}

/**
 * Il piano della proposta discussa: dalla questione alle strade, ancorate alla
 * **data di gioco corrente**. `null` quando manca la data o non c'è nessuna
 * strada: la tela non mostra un piano dimostrativo con date fisse.
 */
export function planFromProposal(proposal: PlanProposal): StrategicPlan | null {
  const anchor = planDateLabel(proposal.today);
  if (!anchor || proposal.steps.length === 0) return null;

  const rootId = 'questione';
  const nodes: StrategicNode[] = [{
    id: rootId,
    date: anchor,
    title: proposal.title || 'La questione',
    description: proposal.need,
    from: [],
  }];

  const known = new Set(proposal.steps.map(step => step.id));
  for (const step of proposal.steps) {
    const requires = (step.requires ?? []).filter(id => known.has(id) && id !== step.id);
    nodes.push({
      id: step.id,
      date: anchor,
      title: step.title,
      description: step.detail,
      from: requires.length > 0 ? requires : [rootId],
    });
  }

  return {
    id: `proposta-${slug(proposal.id) || 'piano'}`,
    title: proposal.title || 'Piano della proposta',
    outcome: proposal.outcome ?? '',
    nodes,
  };
}
