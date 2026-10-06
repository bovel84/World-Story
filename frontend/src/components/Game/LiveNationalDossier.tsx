/**
 * World Story — Dossier Nazionale vivo: blocchi «attuale vs inizio»
 * =================================================================
 * Presentazione del read model `buildNationalDossierLive`. Nessuna cifra è
 * calcolata qui: il componente impagina solo `current`, `initial`, `delta` già
 * derivati dal motore e dalla baseline. Riusa i blocchi del Dossier esistente
 * (`DossierBlock`, `Metric`, `MetricGrid`) per non introdurre una seconda
 * grammatica visiva.
 */
import React from 'react';
import { formatNumber, formatPercent } from '../../utils/format';
import { money, index } from './NationDock/format';
import { DossierBlock, Footnote, Metric, MetricGrid } from './NationDock/widgets';
import {
  type DossierLive, type DossierLiveMetric, type DossierLiveResourceRow, technologyLabel,
} from './nationalDossierLive';

export type DossierLivePart = 'stato' | 'finanze' | 'militare' | 'risorse' | 'capacita' | 'tecnologia';

const MONEY_KEYS = new Set([
  'nominalGdpUsdBillions', 'money', 'monthlyRevenue', 'monthlyExpenses', 'monthlyBalance',
  'debt', 'annualInterest', 'creditHeadroom', 'treasuryUsdBillions',
]);

function formatMetric(key: string, value: number | null): string {
  if (value === null) return '—';
  if (key === 'gdpPerCapitaUsd') return `${formatNumber(value)} $`;
  if (MONEY_KEYS.has(key)) return money(value, 2);
  if (key.endsWith('Pct')) return formatPercent(value, 1);
  if (key === 'qualityIndex') return index(value, 1);
  return formatNumber(value);
}

/** Riga di confronto: valore attuale in evidenza, baseline e variazione sotto. */
function compareHint(metric: DossierLiveMetric, hasBaseline: boolean, format: (value: number | null) => string): string | undefined {
  if (!hasBaseline) return undefined;
  const initial = metric.initial === null ? '—' : format(metric.initial);
  if (metric.delta === null) return `Inizio partita: ${initial}`;
  const flat = Math.abs(metric.delta) < 1e-9;
  if (flat) return `Inizio partita: ${initial} · invariato`;
  const delta = format(metric.delta);
  const pct = metric.deltaPct === null ? '' : ` (${metric.deltaPct > 0 ? '+' : ''}${metric.deltaPct}%)`;
  return `Inizio partita: ${initial} · ${metric.delta > 0 ? '+' : ''}${delta}${pct}`;
}

function MetricRow({ metric, hasBaseline }: { metric: DossierLiveMetric; hasBaseline: boolean }) {
  const format = (value: number | null) => formatMetric(metric.key, value);
  // N4 — il PIL pro capite è una stima in dollari di oggi: si dichiara, non si
  // spaccia per la moneta del paese.
  const note = metric.key === 'gdpPerCapitaUsd' ? 'Tenore di vita medio in dollari di oggi (stima del motore)' : undefined;
  const hint = [note, compareHint(metric, hasBaseline, format)].filter(Boolean).join(' · ') || undefined;
  return (
    <Metric
      label={metric.label}
      value={format(metric.current)}
      hint={hint}
    />
  );
}

function MetricBlock({ title, description, metrics, hasBaseline }: {
  title: string;
  description: string;
  metrics: DossierLiveMetric[];
  hasBaseline: boolean;
}) {
  return (
    <DossierBlock title={title} description={description}>
      <MetricGrid>
        {metrics.map(metric => <MetricRow key={metric.key} metric={metric} hasBaseline={hasBaseline} />)}
      </MetricGrid>
    </DossierBlock>
  );
}

function baselineNote(live: DossierLive): React.ReactNode {
  if (live.hasBaseline) return null;
  return (
    <Footnote>
      Baseline iniziale non disponibile per questo salvataggio: sono mostrati solo i valori attuali.
    </Footnote>
  );
}

function ResourcesBlock({ live }: { live: DossierLive }) {
  return (
    <DossierBlock title="Risorse strategiche — attuale vs inizio" description="Scorte del magazzino materiale, con riempimento rispetto alla capacità.">
      <MetricGrid>
        {live.resources.map((row: DossierLiveResourceRow) => {
          const fill = row.fillPct === null ? undefined : `Riempimento: ${formatPercent(row.fillPct, 1)}${row.capacity !== null ? ` su ${formatNumber(row.capacity)}` : ''}`;
          const initial = live.hasBaseline
            ? (row.initial === null ? 'Inizio partita: —' : `Inizio partita: ${formatNumber(row.initial)}${row.delta !== null && Math.abs(row.delta) > 1e-9 ? ` · ${row.delta > 0 ? '+' : ''}${formatNumber(row.delta)}` : ''}`)
            : undefined;
          const hint = [initial, fill].filter(Boolean).join(' · ') || undefined;
          return <Metric key={row.id} label={row.label} value={formatNumber(row.current)} hint={hint} />;
        })}
        <MetricRow metric={live.research} hasBaseline={live.hasBaseline} />
      </MetricGrid>
    </DossierBlock>
  );
}

function EquipmentBlock({ live }: { live: DossierLive }) {
  if (!live.equipment.length) {
    return (
      <DossierBlock title="Equipaggiamento in servizio" description="Dotazione attuale del paese, raggruppata per dominio.">
        <Footnote>Il motore non pubblica equipaggiamento in servizio: nessuna capacità da mostrare.</Footnote>
      </DossierBlock>
    );
  }
  return (
    <DossierBlock title="Equipaggiamento in servizio" description="Dotazione attuale raggruppata per dominio: Terra, Aria, Mare, Missili, Droni.">
      {live.equipment.map(group => (
        <div key={group.domain} className="nation-equipment-group">
          <p className="nation-equipment-head">
            <b>{group.label}</b>{' '}
            <span>{formatNumber(group.current)} in servizio</span>
            {live.hasBaseline && (
              <em>
                {` · inizio: ${formatNumber(group.initial)}${Math.abs(group.delta) > 1e-9 ? ` (${group.delta > 0 ? '+' : ''}${formatNumber(group.delta)})` : ''}`}
              </em>
            )}
          </p>
          <ul className="nation-equipment-list">
            {group.rows.map(row => (
              <li key={row.id}>
                <span className="nation-equipment-name">{row.name}</span>
                <span className="nation-equipment-value">
                  {formatNumber(row.current)}
                  {live.hasBaseline && row.initial > 0 && Math.abs(row.delta) > 1e-9 && (
                    <em> ({row.delta > 0 ? '+' : ''}{formatNumber(row.delta)})</em>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </DossierBlock>
  );
}

function TechnologyBlock({ live }: { live: DossierLive }) {
  return (
    <DossierBlock title="Tecnologia" description="Tecnologie possedute e punti ricerca, dal magazzino del motore.">
      <MetricRow metric={live.research} hasBaseline={live.hasBaseline} />
      {live.technology.current.length > 0 ? (
        <p className="nation-technology-owned">
          <b>Tecnologie possedute:</b> {live.technology.current.map(technologyLabel).join(', ')}
        </p>
      ) : (
        <Footnote>Nessuna tecnologia sbloccata nel magazzino.</Footnote>
      )}
      {live.hasBaseline && live.technology.unlockedSinceStart.length > 0 && (
        <Footnote>Sbloccate dall’inizio partita: {live.technology.unlockedSinceStart.map(technologyLabel).join(', ')}.</Footnote>
      )}
      {live.hasBaseline && live.technology.lostSinceStart.length > 0 && (
        <Footnote>Tecnologie iniziali non più possedute: {live.technology.lostSinceStart.map(technologyLabel).join(', ')}.</Footnote>
      )}
    </DossierBlock>
  );
}

export function NationalDossierLive({ live, part }: { live: DossierLive; part: DossierLivePart }) {
  if (part === 'stato') {
    return (
      <>
        <MetricBlock
          title="Stato nazionale — attuale vs inizio"
          description="Popolazione, economia e tenuta sociale: il presente accanto al Turno 0."
          metrics={live.state}
          hasBaseline={live.hasBaseline}
        />
        {baselineNote(live)}
      </>
    );
  }
  if (part === 'finanze') {
    return (
      <>
        <MetricBlock
          title="Finanze pubbliche — attuale vs inizio"
          description="Tesoreria, flussi mensili e debito: quanto il paese può spendere oggi."
          metrics={live.finance}
          hasBaseline={live.hasBaseline}
        />
        {baselineNote(live)}
      </>
    );
  }
  if (part === 'militare') {
    return (
      <>
        <MetricBlock
          title="Forze armate — attuale vs inizio"
          description="Personale, formazioni e qualità operativa pubblicati dal motore."
          metrics={[...live.military, ...live.quality]}
          hasBaseline={live.hasBaseline}
        />
        <EquipmentBlock live={live} />
        {baselineNote(live)}
      </>
    );
  }
  if (part === 'risorse') return <ResourcesBlock live={live} />;
  if (part === 'capacita') {
    return (
      <>
        <MetricBlock
          title="Capacità nazionale — attuale vs inizio"
          description="Fabbriche, porti e università: capacità corrente a confronto con il Turno 0."
          metrics={live.capacity}
          hasBaseline={live.hasBaseline}
        />
        {baselineNote(live)}
      </>
    );
  }
  return <TechnologyBlock live={live} />;
}
