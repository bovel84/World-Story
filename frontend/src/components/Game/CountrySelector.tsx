/**
 * World Story — Country Selector Component
 * =====================================
 * Scelta del paese dopo la selezione del template.
* Fase 4: layout a due colonne — a sinistra la mappa del mondo (WorldSelectMap),
 * a destra l'elenco compatto dei paesi. Il clic seleziona il paese,
 * il pulsante «Gioca» conferma la scelta (onSelect).
* Se /api/geo/countries non è disponibile — fallback sulla vecchia griglia country-grid.
 */

import React, { useMemo, useState } from 'react';
import type { WorldTemplate, Country } from '../../types';
import { WorldSelectMap } from './WorldSelectMap';

interface CountrySelectorProps {
  template: WorldTemplate;
  onSelect: (countryCode: string) => void;
  onBack: () => void;
}

export const CountrySelector: React.FC<CountrySelectorProps> = ({ template, onSelect, onBack }) => {
  const countries: Country[] = useMemo(() => template.countries ?? [], [template]);
  // Paese selezionato (ma non ancora confermato)
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  // false → i dati geografici non sono caricati, mostriamo la griglia fallback senza mappa
  const [mapAvailable, setMapAvailable] = useState(true);

  // Codici paese del template — cliccabili sulla mappa
  const availableCodes = useMemo(() => countries.map((c) => c.code), [countries]);
  const selectedCountry = countries.find((c) => c.code === selectedCode) ?? null;

  /** Conferma della scelta — solo dopo il clic su «Gioca» */
  const confirmSelection = () => {
    if (selectedCode) onSelect(selectedCode);
  };

  return (
    <div className="country-selector">
      <div className="selector-header">
        <button className="btn-back" onClick={onBack}>← Indietro</button>
        <h2>Scegli il paese: {template.name}</h2>
      </div>

      <div className="template-info">
        <div className="start-date">Inizio simulazione · {template.start_date}</div>
        <details className="template-lore">
          <summary>Contesto dello scenario</summary>
          <p>{template.description}</p>
        </details>
      </div>

      {mapAvailable ? (
/* Modalità principale: mappa del mondo + elenco compatto */
        <div className="country-selector-layout">
          <div className="country-selector-map">
            <WorldSelectMap
              availableCodes={availableCodes}
              selectedCode={selectedCode}
              onSelect={setSelectedCode}
              onError={() => setMapAvailable(false)}
            />
          </div>
          <div className="country-list">
            {countries.map((country) => (
              <button
                key={country.code}
                type="button"
                className={`country-list-item${selectedCode === country.code ? ' selected' : ''}`}
                onClick={() => setSelectedCode(country.code)}
                aria-pressed={selectedCode === country.code}
              >
                <div
                  className="country-color"
                  style={{ backgroundColor: country.color }}
                />
                <div className="country-name">{country.name}</div>
                <div className="country-code">{country.code}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
/* Fallback: vecchia griglia di card senza mappa */
        <div className="country-grid">
          {countries.map((country) => (
            <button
              key={country.code}
              type="button"
              className={`country-card${selectedCode === country.code ? ' selected' : ''}`}
              onClick={() => setSelectedCode(country.code)}
              aria-pressed={selectedCode === country.code}
            >
              <div
                className="country-color"
                style={{ backgroundColor: country.color }}
              />
              <div className="country-name">{country.name}</div>
              <div className="country-code">{country.code}</div>
            </button>
          ))}
        </div>
      )}

      {/* Pannello di conferma della scelta */}
      <div className="country-confirm-bar">
        <span className="country-confirm-label">
          {selectedCountry
            ? `Selezionato: ${selectedCountry.name} (${selectedCountry.code})`
            : 'Scegli un paese sulla mappa o nell\'elenco'}
        </span>
        <button
          className="btn-play"
          disabled={!selectedCode}
          onClick={confirmSelection}
        >
          Gioca
        </button>
      </div>
    </div>
  );
};

export default CountrySelector;
