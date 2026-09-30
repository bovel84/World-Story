/**
 * World Story — WS-GOVOFFICE-07: il diagramma a cascata di un piano strategico
 * ==========================================================================
 * Presentazione pura del `StrategicPlan` (Parte C2): corsie per profondità
 * (nodo iniziale → rami paralleli → ricongiungimento verso l'esito), nodi
 * **datati** con titolo breve e descrizione in una riga, e un'icona per vedere
 * il piano a **schermo pieno**.
 *
 * Nessun calcolo qui: la geometria (profondità, rami, ricongiungimenti) arriva
 * già risolta da `cascadeLayout` — questo componente la mette in pagina. Il
 * diagramma è accessibile come lista ordinata: senza CSS resta leggibile.
 */
import { useMemo, useState } from 'react';
import { cascadeLayout, type StrategicPlan } from './strategicPlan';

export interface StrategicPlanDiagramProps {
  plan: StrategicPlan;
  /** Apre già a schermo pieno (per il render statico nei test). */
  defaultExpanded?: boolean;
}

export function StrategicPlanDiagram({ plan, defaultExpanded = false }: StrategicPlanDiagramProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const layout = useMemo(() => cascadeLayout(plan), [plan]);
  const branches = new Set(layout.branches);
  const merges = new Set(layout.merges);

  return (
    <div className={`plan-diagram${expanded ? ' plan-diagram-expanded' : ''}`} data-plan={plan.id}>
      <header className="plan-diagram-head">
        <div>
          <div className="plan-diagram-kicker">Piano strategico</div>
          <h4 className="plan-diagram-title">{plan.title}</h4>
        </div>
        <button
          type="button"
          className="plan-diagram-expand"
          aria-pressed={expanded}
          onClick={() => setExpanded(value => !value)}
          title={expanded ? 'Riduci il piano' : 'Vedi il piano a schermo pieno'}
          aria-label={expanded ? 'Riduci il piano strategico' : 'Espandi il piano strategico a schermo pieno'}
        >
          {expanded ? '⤡' : '⤢'}
        </button>
      </header>

      <ol className="plan-lanes" aria-label={`Cascata del piano ${plan.title}`}>
        {layout.lanes.map(lane => (
          <li key={lane.level} className="plan-lane" data-level={lane.level}>
            <div className="plan-lane-nodes">
              {lane.nodes.map(node => (
                <article key={node.id} className="plan-node" data-node={node.id}>
                  <span className="plan-node-date">{node.date}</span>
                  <span className="plan-node-title">{node.title}</span>
                  <span className="plan-node-desc">{node.description}</span>
                  {branches.has(node.id) && <span className="plan-node-tag plan-node-tag-branch">si apre in rami</span>}
                  {merges.has(node.id) && <span className="plan-node-tag plan-node-tag-merge">i rami si ricongiungono</span>}
                </article>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {plan.outcome && (
        <footer className="plan-outcome">
          <span className="plan-outcome-label">Esito</span>
          <span className="plan-outcome-text">{plan.outcome}</span>
        </footer>
      )}
    </div>
  );
}

export default StrategicPlanDiagram;
