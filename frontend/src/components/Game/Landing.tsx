/**
* Open-Pax — Fase 6: Landing (schermata iniziale)
 * =====================================================
* Riferimento: docs/ref/pax_home.png — cielo stellato, orizzonte del pianeta,
* grande titolo e pulsante CTA sfumato centrale.
 *
* Componente autosufficiente: carica da solo l'elenco dei salvataggi (savesApi.list),
* filtra da solo gli snapshot di rewind (`__rewind__`).
* Stili: fine di frontend/src/index.css, sezione «Fase 6: Landing».
 */

import { useEffect, useState } from 'react';
import { savesApi } from '../../services/api';

export interface LandingProps {
/** Passaggio alla creazione di una nuova partita */
  onNewGame: () => void;
  /** Apri il menu di scelta del modello IA */
  onOpenModelSettings?: () => void;
  // DISATTIVATO: editor mappe (temporaneo)
  // /** Apri l'editor di mappe */
  // onOpenEditor: () => void;
  // /** Scelta di una mappa salvata dalla sezione «Le mie mappe» */
  // onSelectMap: (map: any) => void;
  /** Continuare la partita da un salvataggio (oggetto da savesApi.list) */
  onResumeSave: (save: any) => void;
  // DISATTIVATO: editor mappe (temporaneo)
  // /** Mappe salvate dell'utente (regions: {id, path, color}[]) */
  // savedMaps: any[];
}

/** «1951-01-01» → «1 gennaio 1951» */
function formatGameDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Data/ora del salvataggio → «12 gennaio 2025, 14:32» */
function formatSavedAt(value?: string): string {
  if (!value) return '';
  // SQLite datetime('now') salva UTC senza suffisso — lo trattiamo come UTC
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Landing(props: LandingProps) {
  // DISATTIVATO: editor mappe (temporaneo) — onOpenEditor, onSelectMap, savedMaps
  const { onNewGame, onOpenModelSettings, onResumeSave } = props;

  const [saves, setSaves] = useState<any[]>([]);

  // Carica i salvataggi al mount; stato vuoto/errore — sezione nascosta
  useEffect(() => {
    let cancelled = false;
    savesApi
      .list()
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.saves) ? data.saves : [];
        // `__rewind__` è uno snapshot interno di rewind, non lo mostriamo come salvataggio
        setSaves(list.filter((s: any) => s && s.name !== '__rewind__'));
      })
      .catch((e) => {
        console.warn('[Landing] Impossibile caricare i salvataggi:', e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // DISATTIVATO: editor mappe (temporaneo) — elenco mappe per la sezione «Le mie mappe»
  // const maps = Array.isArray(savedMaps) ? savedMaps : [];

  return (
    <div className="landing">
      {/* ===== Hero: cielo stellato + orizzonte del pianeta (pax_home.png) ===== */}
      <div className="landing-hero">
        <div className="landing-stars" />
        <div className="landing-planet" />

        <div className="landing-hero-content">
          <h1 className="landing-title">Open-Pax</h1>
          <p className="landing-subtitle">Simulatore di storia alternativa</p>

          <div className="landing-cta-row">
            <button className="landing-cta" onClick={onNewGame}>
              Nuova partita <span className="landing-cta-arrow">→</span>
            </button>
            {onOpenModelSettings && (
              <button className="landing-cta-secondary" onClick={onOpenModelSettings}>
                🤖 Modello IA
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===== Sezioni sotto l'hero ===== */}
      {/* DISATTIVATO: editor mappe (temporaneo) — condizione originale (saves.length > 0 || maps.length > 0) */}
      {saves.length > 0 && (
        <div className="landing-sections">
          {saves.length > 0 && (
            <section className="landing-section">
              <h2 className="landing-section-title">📂 Continua partita</h2>
              <div className="landing-saves-grid">
                {saves.map((save: any) => (
                  <div key={save.id} className="landing-save-card">
                    <div className="landing-save-name">{save.name || 'Salvataggio'}</div>
                    <div className="landing-save-meta">
                      {typeof save.current_turn === 'number' && (
                        <span className="landing-save-turn">Mossa {save.current_turn}</span>
                      )}
                      {save.current_date && <span>{formatGameDate(save.current_date)}</span>}
                    </div>
                    {save.saved_at && (
                      <div className="landing-save-date">Salvato: {formatSavedAt(save.saved_at)}</div>
                    )}
                    <button className="landing-save-play" onClick={() => onResumeSave(save)}>
                      ▶ Gioca
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* DISATTIVATO: editor mappe (temporaneo) — sezione «Le mie mappe»
          {maps.length > 0 && (
            <section className="landing-section">
              <h2 className="landing-section-title">🗺 Le mie mappe</h2>
              <div className="landing-maps-grid">
                {maps.map((map: any) => {
                  const regions = Array.isArray(map?.regions) ? map.regions : [];
                  return (
                    <div
                      key={map.id ?? map.name}
                      className="landing-map-card"
                      onClick={() => onSelectMap(map)}
                    >
                      <div className="landing-map-preview">
                        <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">
                          {regions.map((r: any) => (
                            <path
                              key={r.id}
                              d={r.path}
                              fill={r.color}
                              opacity={0.7}
                              stroke="#0a0a0f"
                              strokeWidth={1.5}
                            />
                          ))}
                        </svg>
                      </div>
                      <div className="landing-map-info">
                        <h4>{map.name}</h4>
                        <span>{regions.length} regioni</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          */}
        </div>
      )}
    </div>
  );
}
