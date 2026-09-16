/**
 * World Story — Fase 2: `CountryStage`
 * ===================================
 * La schermata di scelta del paese dopo la scelta del template — inclusa la
 * generazione del mondo e la creazione della partita — era un blocco JSX con
 * una callback asincrona annidata dentro `App.tsx`. Questo componente la
 * possiede.
 *
 * Contratto invariato:
 *  - l'avanzamento reale della generazione arriva dal backend e viene tradotto
 *    in una fase coerente del loader;
 *  - l'ID regione usato per la partita è quello prefissato col worldId, non il
 *    codice paese nudo;
 *  - un errore di generazione riporta alla landing senza lasciare stati a metà.
 */
import { gameApi, worldApi } from '../../services/api';
import type { Game, WorldTemplate } from '../../types';
import { useGameStore } from '../../stores';
import { CountrySelector } from './CountrySelector';

const DIFFICULTY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'story', label: 'Storia (molto facile)' },
  { value: 'easy', label: 'Facile' },
  { value: 'normal', label: 'Normale' },
  { value: 'hard', label: 'Difficile' },
  { value: 'very_hard', label: 'Molto difficile' },
];

export interface CountryStageProps {
  template: WorldTemplate;
  difficulty: string;
  onDifficultyChange: (value: string) => void;
  onBack: () => void;
  /** Avanzamento reale (0..1) della generazione del mondo. */
  onProgress: (ratio: number) => void;
  /** La partita è pronta: `App` pubblica game, mondo e regione selezionata. */
  onGenerated: (game: Game, regionId: string) => void;
  onFailure: () => void;
  setLoading: (loading: boolean) => void;
}

export function CountryStage({
  template,
  difficulty,
  onDifficultyChange,
  onBack,
  onProgress,
  onGenerated,
  onFailure,
  setLoading,
}: CountryStageProps) {
  const setGeneratedWorld = useGameStore((s) => s.setGeneratedWorld);

  return (
    <div>
      <div className="difficulty-selector">
        <label htmlFor="difficulty-select">Difficoltà:</label>
        <select
          id="difficulty-select"
          value={difficulty}
          onChange={(e) => onDifficultyChange(e.target.value)}
        >
          {DIFFICULTY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <CountrySelector
        template={template}
        difficulty={difficulty}
        onSelect={async (countryCode) => {
          setLoading(true);
          try {
            const worldData = await worldApi.generateFromTemplate(
              template.id,
              countryCode,
              (p) => {
                // Avanzamento reale dal backend + fase coerente col progresso
                const ratio = p.total > 0 ? p.done / p.total : 0;
                onProgress(ratio);
              }
            );
            setGeneratedWorld(worldData);

            // Use correct region ID (prefixed with worldId)
            const actualRegionId = worldData.regionIds?.[countryCode] || countryCode;

            const gameResponse = await gameApi.create({
              world_id: worldData.worldId,
              player_name: countryCode,
              player_region_id: actualRegionId,
              difficulty,
            });

            const game = await gameApi.get(gameResponse.game_id);
            onGenerated(game, actualRegionId);
          } catch (e) {
            console.error('[Game] Failed to generate world:', e);
            onFailure();
          } finally {
            setLoading(false);
          }
        }}
        onBack={onBack}
      />
    </div>
  );
}
