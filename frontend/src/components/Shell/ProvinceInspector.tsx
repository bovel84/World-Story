import { useMemo, type ReactNode } from 'react';
import type { Region, MapObject } from '../../types';

interface ProvinceInspectorProps {
  /** Provincia selezionata (null = nessuna) */
  region: Region | null;
  /** Tutti i paesi per risolvere nomi proprietari */
  allRegions: Region[];
  /** Callback chiusura */
  onClose: () => void;
  /** Contenuto addizionale (es. ordini, progetti, chat) */
  children?: ReactNode;
}

function formatNumber(n: number | undefined): string {
  return n ? n.toLocaleString() : '—';
}

function getOwnerName(region: Region, allRegions: Region[]): string {
  if (!region.owner || region.owner === 'neutral') return 'Neutrale';
  // Se owner è un codice paese, cerca la regione con quel codice
  const ownerRegion = allRegions.find(r => r.id === region.owner || r.polityName === region.owner);
  return ownerRegion?.polityName || ownerRegion?.name || region.owner;
}

export function ProvinceInspector({
  region,
  allRegions,
  onClose,
  children,
}: ProvinceInspectorProps) {
  if (!region) return null;

  const ownerName = getOwnerName(region, allRegions);
  const isPlayer = region.owner === 'player';
  const metadata = region.metadata || {};

  // Calcola asset dalla lista objects
  const assets = useMemo(() => {
    const counts = { factories: 0, ports: 0, cities: 0, capital: 0, units: 0, infrastructure: 0 };
    (region.objects || []).forEach(obj => {
      switch (obj.type) {
        case 'factory': counts.factories++; break;
        case 'port': counts.ports++; break;
        case 'city': counts.cities++; break;
        case 'capital': counts.capital++; break;
        case 'army':
        case 'battalion':
        case 'fleet':
        case 'missile':
        case 'radar': counts.units++; break;
      }
      if (obj.type === 'radar') counts.infrastructure++;
    });
    return counts;
  }, [region.objects]);

  const infrastructureLevel = metadata.infrastructure_level
    ? Number(metadata.infrastructure_level)
    : Math.min(5, 1 + assets.infrastructure + (assets.capital ? 2 : assets.cities > 0 ? 1 : 0));

  const surfaceType = metadata.surface_type || 'Terra';
  const tags = Array.isArray(metadata.tags) ? metadata.tags.slice(0, 5) : [];

  return (
    <div className="province-inspector" role="region" aria-label={`Dossier ${region.name}`}>
      <header className="province-inspector-header">
        <div className="province-inspector-color" style={{ backgroundColor: region.color }} />
        <div className="province-inspector-title-group">
          <h3 className="province-inspector-name">{region.name}</h3>
          <span className="province-inspector-id">{region.id}</span>
        </div>
        <button
          type="button"
          className="province-inspector-close"
          onClick={onClose}
          aria-label="Chiudi dossier provincia"
        >×</button>
      </header>

      <div className="province-inspector-body">
        <dl className="province-inspector-meta">
          <div><dt>Proprietario</dt><dd>{ownerName}{isPlayer && ' (Tu)'}</dd></div>
          <div><dt>Superficie</dt><dd>{surfaceType}</dd></div>
          <div><dt>Popolazione</dt><dd>{formatNumber(region.population)}</dd></div>
          <div><dt>PIL</dt><dd>{formatNumber(region.gdp)}</dd></div>
          <div><dt>Forze</dt><dd>{formatNumber(region.militaryPower)}</dd></div>
          <div><dt>Stato</dt><dd>{region.status}</dd></div>
          <div><dt>INFRA</dt><dd>L{infrastructureLevel}</dd></div>
        </dl>

        <div className="province-inspector-assets">
          <span title="Impianti industriali">⚙ <b>{assets.factories}</b></span>
          <span title="Porti">⚓ <b>{assets.ports}</b></span>
          <span title="Città">● <b>{assets.cities + assets.capital}</b></span>
          <span title="Unità militari">▲ <b>{assets.units}</b></span>
        </div>

        {tags.length > 0 && (
          <div className="province-inspector-tags">
            {tags.map((tag, i) => <span key={i}>{tag}</span>)}
          </div>
        )}

        <div className="province-inspector-borders">
          <dt>Confini ({region.borders?.length || 0})</dt>
          <dd>
            {region.borders?.map((b, i) => {
              const neighbor = allRegions.find(r => r.id === b);
              return neighbor ? (
                <span key={i} className="border-link" style={{ borderLeftColor: neighbor.color }}>
                  {neighbor.name}
                </span>
              ) : (
                <span key={i} className="border-link">{b}</span>
              );
            })}
          </dd>
        </div>

        {children}
      </div>
    </div>
  );
}

export default ProvinceInspector;