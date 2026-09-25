/**
 * World Story — vista del testo ricco
 * ===================================
 * Rende in React ciò che `richTextModel.ts` interpreta. Elementi, non HTML: il testo
 * arriva da un modello linguistico e non passa mai per `dangerouslySetInnerHTML`.
 */
import React from 'react';
import { parseBlocks, type InlineNode } from './richTextModel';
import { chartFor, type ChartDataInput } from './advisorCharts';
import { AdvisorChart } from './AdvisorChart';

/** Rende i nodi in linea: grassetto, corsivo, codice, testo. */
function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.kind === 'strong') return <strong key={i}>{node.text}</strong>;
        if (node.kind === 'em') return <em key={i}>{node.text}</em>;
        if (node.kind === 'code') return <code key={i} className="rich-code">{node.text}</code>;
        return <React.Fragment key={i}>{node.text}</React.Fragment>;
      })}
    </>
  );
}

/**
 * Rende il testo del Consulente come documento leggibile.
 *
 * `chartData` è ciò che rende possibile il blocco grafico: se c'è, un
 * `[[chart: tipo]]` diventa una figura costruita sui **dati del motore**. Se
 * manca (o il tipo è ignoto, o non c'è nulla da mostrare), il blocco **non si
 * rende** — meglio il testo del Consulente che una figura vuota o inventata.
 */
export function RichText({ text, chartData }: { text: string; chartData?: ChartDataInput | null }) {
  const blocks = parseBlocks(text);
  return (
    <div className="rich-text">
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          // h3-h6: il testo del consulente è dentro un pannello, e un <h1> in una
          // chat falserebbe la gerarchia della pagina per chi usa lo screen reader.
          const Tag = (`h${Math.min(block.level + 2, 6)}`) as 'h3' | 'h4' | 'h5' | 'h6';
          return <Tag key={i} className={`rich-heading rich-heading-${block.level}`}><Inline nodes={block.inlines} /></Tag>;
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, j) => <li key={j}><Inline nodes={item} /></li>);
          return block.ordered
            ? <ol key={i} className="rich-list rich-list-ordered">{items}</ol>
            : <ul key={i} className="rich-list">{items}</ul>;
        }
        if (block.kind === 'quote') {
          return <blockquote key={i} className="rich-quote"><Inline nodes={block.inlines} /></blockquote>;
        }
        if (block.kind === 'rule') return <hr key={i} className="rich-rule" />;
        if (block.kind === 'chart') {
          const figure = chartData ? chartFor(block.chartKind, chartData) : null;
          // Nessun dato o tipo ignoto: il blocco non si rende. Non si disegna una
          // figura con numeri che non vengono dal motore.
          return figure ? <AdvisorChart key={i} figure={figure} /> : null;
        }
        return <p key={i} className="rich-paragraph"><Inline nodes={block.inlines} /></p>;
      })}
    </div>
  );
}

export default RichText;
