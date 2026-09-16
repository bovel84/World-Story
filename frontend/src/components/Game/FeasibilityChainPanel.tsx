/**
 * U02 passo 2 — catena della fattibilità (presentazione).
 * Rende la catena in due forme equivalenti dallo stesso modello puro:
 *  - un flusso ordinato (`<ol>`) leggibile su mobile;
 *  - una lista/tabella equivalente su desktop.
 * Il significato è nel testo (etichette «Richiesta/Costo/Deficit» e fonti):
 * leggibile anche senza distinguere i colori. Nessuna dipendenza da librerie grafiche.
 */
import type { ChainNode, ChainNodeKind, FeasibilityChainView } from './feasibilityChain';

export const CHAIN_KIND_LABEL: Record<ChainNodeKind, string> = {
  richiesta: 'Richiesta',
  costo: 'Costo',
  deficit: 'Deficit',
};

export interface FeasibilityChainProps {
  view: FeasibilityChainView;
}

export function FeasibilityChain({ view }: FeasibilityChainProps) {
  if (!view || view.nodes.length === 0) return null;

  return (
    <section className="feasibility-section feasibility-chain" aria-label="Catena della fattibilità">
      <h3 className="feasibility-section-title">Catena della fattibilità</h3>

      <ol className="feasibility-chain-flow">
        {view.nodes.map((node: ChainNode, index: number) => (
          <li key={`${node.kind}-${index}`} className={`feasibility-chain-step is-${node.kind}`}>
            <span className="feasibility-chain-kind">{CHAIN_KIND_LABEL[node.kind]}</span>{' '}
            <span className="feasibility-chain-label">{node.label}</span>
            <span className="feasibility-chain-detail"> — {node.detail}</span>
          </li>
        ))}
      </ol>

      <table className="feasibility-chain-table">
        <caption className="visually-hidden">
          Lista equivalente della catena: tipo, elemento, dettaglio e fonte del dato.
        </caption>
        <thead>
          <tr>
            <th scope="col">Tipo</th>
            <th scope="col">Elemento</th>
            <th scope="col">Dettaglio</th>
            <th scope="col">Fonte</th>
          </tr>
        </thead>
        <tbody>
          {view.nodes.map((node: ChainNode, index: number) => (
            <tr key={`t-${node.kind}-${index}`} className={`is-${node.kind}`}>
              <th scope="row">{CHAIN_KIND_LABEL[node.kind]}</th>
              <td>{node.label}</td>
              <td>{node.detail}</td>
              <td>{node.source}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="feasibility-chain-sources">
        Fonti dei dati: {view.sources.join('; ')}.
      </p>
    </section>
  );
}

export default FeasibilityChain;
