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
import { gameApi, ReadableJobError, readableApiError, worldApi } from '../../services/api';
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
  onProgress: (ratio: number, phase?: string) => void;
  /** La partita è pronta: `App` pubblica game, mondo e regione selezionata. */
  onGenerated: (game: Game, regionId: string) => void;
  onFailure: (message?: string) => void;
  setLoading: (loading: boolean) => void;
}

const BOOTSTRAP_POLL_MS = 1_500;
const BOOTSTRAP_TIMEOUT_MS = 120_000;

/**
 * ASYNC BOOTSTRAP — `POST /games` risponde subito; il Dossier LLM del paese
 * viene preparato in background. Qui si aspetta `ready` con polling, oppure si
 * propaga l'errore sanitizzato se lo stato diventa `failed`.
 */
async function waitForBootstrap(gameId: string, onPhase: (phase: string) => void): Promise<void> {
  const deadline = Date.now() + BOOTSTRAP_TIMEOUT_MS;
  onPhase('Preparazione del Dossier nazionale…');
  while (Date.now() < deadline) {
    const status = await gameApi.bootstrapStatus(gameId);
    if (status.status === 'ready') return;
    if (status.status === 'failed') {
      throw new ReadableJobError(status.error || 'Impossibile completare il Dossier iniziale.');
    }
    await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_POLL_MS));
  }
  throw new ReadableJobError('Preparazione del Dossier iniziale troppo lunga. Riprova.');
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

            // ASYNC BOOTSTRAP — POST /games non attende più il Dossier LLM.
            // Si resta nel loader finché la partita non è `ready`.
            await waitForBootstrap(gameResponse.game_id, (phase) => onProgress(0.97, phase));
            const game = await gameApi.get(gameResponse.game_id);
            onGenerated(game, actualRegionId);
          } catch (e) {
            console.error('[Game] Failed to generate world:', e);
            // La creazione non è più hard-blocking: il bootstrap async può
            // fallire con un errore leggibile, che va mostrato all'utente.
            onFailure(readableApiError(e, 'Generazione del mondo fallita. Riprova.'));
          } finally {
            setLoading(false);
          }
        }}
        onBack={onBack}
      />
    </div>
  );
}
