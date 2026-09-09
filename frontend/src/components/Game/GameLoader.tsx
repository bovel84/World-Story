/**
 * World Story — Game Loader Component
 * =================================
 * Fase 6: loader a schermo intero sui riferimenti pax_game_ui.png / pax_ingame.png /
* pax_game_ui3.png dell'originale Pax Historia: «globo» centrato con
* anello pulsante, testo della fase sotto e sottile barra di avanzamento.
* Tema scuro mantenuto: sfondo #0a0a0f, accenti sfumati #667eea → #f093fb.
 *
* Uso:
*   <GameLoader title="Stiamo creando la tua partita…" phase={WORLD_GEN_PHASES[i]} />
*   <GameLoader title="Caricamento del mondo…" phase="Generazione della geografia…" progress={0.6} />
 */

import React from 'react';

export interface GameLoaderProps {
/** Riga grande sotto il globo (es. «Stiamo creando la tua partita…») */
  title?: string;
/** Riga piccola della fase sotto la barra di avanzamento */
  phase?: string;
/** Avanzamento 0..1; se assente — animazione indeterminata della barra */
  progress?: number;
}

/**
* Fasi plausibili di generazione del mondo — il coordinatore le scorre a timer,
* passati al prop `phase`.
 */
export const WORLD_GEN_PHASES: string[] = [
  'Connessione al modello…',
  'Generazione dei paesi del mondo…',
  'Bilanciamento delle potenze…',
  'Definizione della geografia…',
  'Scrittura delle cronache…',
  'Ritocchi finali…',
];

export const GameLoader: React.FC<GameLoaderProps> = ({
  title = 'Caricamento…',
  phase,
  progress,
}) => {
  const determinate = typeof progress === 'number' && Number.isFinite(progress);
  const pct = determinate ? Math.min(1, Math.max(0, progress as number)) : 0;

  return (
    <div className="gl-loader" role="status" aria-live="polite">
      {/* Sfondo stellare: due strati di punti con cicli di lampeggio diversi */}
      <div className="gl-stars gl-stars--a" />
      <div className="gl-stars gl-stars--b" />

      <div className="gl-content">
        {/* Globo: anello pulsante + sfera con meridiani */}
        <div className="gl-globe-wrap">
          <div className="gl-globe-halo" />
          <div className="gl-globe">
            <div className="gl-globe-meridian gl-globe-meridian--eq" />
            <div className="gl-globe-meridian gl-globe-meridian--n1" />
            <div className="gl-globe-meridian gl-globe-meridian--n2" />
            <div className="gl-globe-meridian gl-globe-meridian--v1" />
            <div className="gl-globe-meridian gl-globe-meridian--v2" />
          </div>
        </div>

        <div className="gl-title">{title}</div>

        <div
          className={
            'gl-progress' + (determinate ? '' : ' gl-progress--indeterminate')
          }
        >
          {determinate ? (
            <div
              className="gl-progress-fill"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          ) : (
            <div className="gl-progress-runner" />
          )}
        </div>

        {phase && <div className="gl-phase">{phase}</div>}
      </div>
    </div>
  );
};

export default GameLoader;
