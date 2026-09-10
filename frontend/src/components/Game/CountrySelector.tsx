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
  difficulty: string;
}

export const CountrySelector: React.FC<CountrySelectorProps> = ({ template, onSelect, onBack, difficulty }) => {
  const countries: Country[] = useMemo(() => template.countries ?? [], [template]);
  // Paese selezionato (ma non ancora confermato)
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  // false → i dati geografici non sono caricati, mostriamo la griglia fallback senza mappa
  const [mapAvailable, setMapAvailable] = useState(true);
  // Ricerca paesi
  const [search, setSearch] = useState('');

  // Codici paese del template — cliccabili sulla mappa
  const availableCodes = useMemo(() => countries.map((c) => c.code), [countries]);

  // Paesi filtrati dalla ricerca
  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q)
    );
  }, [countries, search]);

  // Testo descrizione difficoltà
  const difficultyLabel: Record<string, { label: string; effect: string }> = {
    story: { label: 'Storia (molto facile)', effect: 'IA più narrativa, vincoli morbidi, economia generosa' },
    easy: { label: 'Facile', effect: 'Vincoli realistici attenuati, recupero rapido' },
    normal: { label: 'Normale', effect: 'Equilibrio storico, conseguenze piene' },
    hard: { label: 'Difficile', effect: 'Vincoli stringenti, IA aggressiva, risorse scarse' },
    very_hard: { label: 'Molto difficile', effect: 'Simulazione rigorosa, margine d\'errore minimo' },
  };
  const diff = difficultyLabel[difficulty] || { label: difficulty, effect: '—' };

  // Dossier strategico per il paese selezionato
  const selectedCountry = countries.find((c) => c.code === selectedCode) ?? null;

  /** Conferma della scelta — solo dopo il clic su "Gioca" */
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
            <div className="world-select-legend" aria-hidden="true">
              <span className="legend-item"><i className="legend-swatch selected" /> Selezionato</span>
              <span className="legend-item"><i className="legend-swatch available" /> Disponibile</span>
              <span className="legend-item"><i className="legend-swatch disabled" /> Non disponibile</span>
            </div>
          </div>
          <div className="country-list">
            <input
              className="country-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca paese…"
              aria-label="Cerca paese per nome o codice"
            />
            {filteredCountries.map((country) => (
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
          {filteredCountries.map((country) => (
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

      {/* Pannello di conferma: dossier paese + difficoltà */}
      {selectedCountry && (
        <div className="country-dossier" role="region" aria-label="Dossier paese">
          <div className="country-dossier-header">
            <div className="country-dossier-color" style={{ backgroundColor: selectedCountry.color }} />
            <div>
              <div className="country-dossier-name">{selectedCountry.name}</div>
              <div className="country-dossier-code">{selectedCountry.code}</div>
            </div>
          </div>
          <div className="country-dossier-meta">
            <span>Posizione: <strong>potenza regionale</strong></span>
            <span>Difficoltà: <strong>{diff.label}</strong></span>
          </div>
          <p className="country-dossier-effect">{diff.effect}</p>
          <p className="country-dossier-strengths">
            <strong>Punti di forza:</strong> industria, posizione strategica, alleanze potenziali
          </p>
          <p className="country-dossier-challenges">
            <strong>Sfide iniziali:</strong> energia, debito, pressioni regionali
          </p>
        </div>
      )}
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
          {selectedCountry ? 'Avvia come ' + selectedCountry.name : 'Gioca'}
        </button>
      </div>
    </div>
  );
};

export default CountrySelector;
