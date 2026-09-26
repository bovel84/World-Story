/**
 * World Story — Pannello «Questioni» (V01, stile Victoria 3)
 * ==========================================================
 * Le **sfide di pace** del motore — pressioni interne ed esterne con le loro
 * opzioni di risposta — smettono di vivere dentro il dossier nazionale e
 * ottengono un pannello proprio, raggiungibile dalla barra comandi.
 *
 * Il motivo è di prodotto, non estetico: il Dossier nazionale è un **documento
 * di stato** (cifre, toni, andamento), mentre una sfida è una **decisione da
 * prendere**. Nella lente di Victoria 3 le due cose stanno in posti diversi: i
 * pannelli si leggono, le questioni si risolvono.
 *
 * Contratto dei dati (V5/V01): questo pannello **non aggiunge nulla al motore**.
 * Monta le stesse props che il dossier riceveva — `nationalPressures`,
 * `recentPressures`, `onResolvePressure`, `pressureBusy` — e le stesse
 * funzioni di presentazione già testate (`PressuresBlock`, `countOpenQuestions`).
 * La divisione fra questioni in evidenza e questioni nel dossier resta quella
 * del motore (`splitPressuresByAttention`), nessuna seconda verità.
 */
import { PressuresBlock } from './NationDock/widgets';
import { countOpenQuestions } from './pressureWindow';
import type { PeacetimePressure } from '../../services/api';

export interface QuestionsPanelProps {
  pressures?: PeacetimePressure[];
  recentPressures?: PeacetimePressure[];
  onResolvePressure?: (pressureId: string, optionId: string) => Promise<void>;
  pressureBusy?: boolean;
  /** La cassa del giocatore: serve a disabilitare una risposta che non si può pagare. */
  money?: number;
}

export function QuestionsPanel({
  pressures = [],
  recentPressures = [],
  onResolvePressure,
  pressureBusy = false,
  money,
}: QuestionsPanelProps) {
  const open = countOpenQuestions(pressures);

  return (
    <div className="questions-panel">
      <header className="questions-panel-header">
        <div>
          <div className="questions-panel-kicker">Questioni</div>
          <div className="questions-panel-title">
            {open === 0
              ? 'Nessuna decisione attende'
              : `${open} ${open === 1 ? 'questione attende' : 'questioni attendono'} una risposta`}
          </div>
        </div>
        <p className="questions-panel-note">
          Le sfide le genera il motore; le opzioni e il loro costo sono i suoi. Scegliere è del
          governo. Ignorarne una ha un costo: la finestra temporale dice quanto tempo resta.
        </p>
      </header>

      <PressuresBlock
        pressures={pressures}
        recent={recentPressures}
        onResolve={onResolvePressure}
        busy={pressureBusy}
        money={money}
      />
    </div>
  );
}

export default QuestionsPanel;
