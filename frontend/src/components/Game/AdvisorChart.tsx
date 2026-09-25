/**
 * World Story — C01: la figura del Consulente
 * ==========================================
 * Disegna un `ChartFigure` in SVG nativo, come il resto del progetto (niente
 * librerie di grafici). Il componente è **presentazionale**: riceve una figura
 * già costruita sui dati del motore e non calcola cifre.
 *
 * Perché SVG e non una libreria: quattro figure non giustificano una dipendenza
 * nuova, e questo progetto ha già una sua disciplina (SVG a mano in `Landing`,
 * `CreateWorld`, `TacticalOverlay`). Una figura in più non deve cambiare il peso
 * del bundle.
 */
import React from 'react';
import type { ChartFigure } from './advisorCharts';
import { chartScale } from './advisorCharts';

const cssTone = (tone: ChartFigure['bars'][number]['tone']): string =>
  `tone-${tone === 'critical' ? 'negative' : tone}`;

/** Grafico a barre orizzontali: leggibile anche con etichette lunghe. */
function Bars({ figure }: { figure: ChartFigure }) {
  const scale = chartScale(figure);
  return (
    <ul className="advisor-chart-bars">
      {figure.bars.map((bar, i) => (
        <li key={`${bar.label}-${i}`} className={cssTone(bar.tone)}>
          <span className="advisor-chart-label" title={bar.label}>{bar.label}</span>
          <span className="advisor-chart-track">
            <span
              className="advisor-chart-fill"
              style={{ width: `${Math.max(2, Math.round(bar.value / scale * 100))}%` }}
            />
          </span>
          <b className="advisor-chart-value">{bar.display}</b>
        </li>
      ))}
    </ul>
  );
}

/** Serie storica: una linea, senza assi (i valori sono nel testo accanto). */
function Series({ figure }: { figure: ChartFigure }) {
  const series = figure.series;
  if (!series || series.points.length < 2) return null;
  const points = series.points;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = 100 / (points.length - 1);
  // Il percorso in un viewBox 100×28: la linea si adatta alla larghezza senza
  // misurare il DOM, che è ciò che rende il componente testabile e puro.
  const path = points
    .map((value, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${(28 - ((value - min) / span) * 26 - 1).toFixed(2)}`)
    .join(' ');
  return (
    <svg className={`advisor-chart-series ${cssTone(series.tone)}`} viewBox="0 0 100 28" preserveAspectRatio="none" role="img"
      aria-label={`${series.label}: ${series.deltaText} fra il primo e l'ultimo punto`}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function AdvisorChart({ figure }: { figure: ChartFigure }) {
  return (
    <figure className="advisor-chart" aria-label={figure.title}>
      <figcaption className="advisor-chart-head">
        <span className="advisor-chart-title">{figure.title}</span>
        {figure.unit && <span className="advisor-chart-unit">{figure.unit}</span>}
      </figcaption>
      {figure.series ? (
        <div className="advisor-chart-series-wrap">
          <Series figure={figure} />
          <span className={`advisor-chart-delta ${cssTone(figure.series.tone)}`}>{figure.series.deltaText}</span>
        </div>
      ) : (
        <Bars figure={figure} />
      )}
      <p className="advisor-chart-note">{figure.note}</p>
    </figure>
  );
}

export default AdvisorChart;
