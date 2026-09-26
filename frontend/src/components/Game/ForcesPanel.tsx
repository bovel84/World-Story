/**
 * World Story — Pannello «Forze» (decisione D-1)
 * ==============================================
 * La **sala operativa** del paese — `ObjectsBoard` — esce dal Dossier nazionale
 * e ottiene un pannello proprio, raggiungibile dalla barra comandi.
 *
 * Il motivo è lo stesso che ha fatto uscire le sfide in V01: il Dossier è un
 * **documento di stato** (cifre, toni, andamento), mentre creare reparti,
 * comprare equipaggiamento e impartire ordini sono **azioni**. Nella lente di
 * Victoria 3 i pannelli si leggono, le azioni si fanno in una superficie
 * dedicata.
 *
 * Contratto dei dati (invariante V5 del piano V): questo pannello **non**
 * aggiunge nulla al motore. Monta le stesse props che il dossier riceveva —
 * `arsenal`, `snapshotKey`, `onPreviewFormation`, `onRaiseFormation`,
 * `onUnitAction`, `onUnitOrder` — e le stesse funzioni già testate.
 *
 * Le tre azioni che erano raggiungibili **solo** dal dossier — creare reparti
 * (`raise_formation`), comprare equipaggiamento (`procure`), commerciare
 * (`trade`) — restano raggiungibili: da qui. Le altre (azioni di reparto e
 * ordini) sono anche nel `ProvinceInspector` sulla mappa.
 */
import type { ArsenalResponse, FormationImpactPayload, UnitActionImpactPayload, UnitActionRequest, UnitOrderImpactPayload, UnitOrderRequest } from '../../services/api';
import { ObjectsBoard } from './ObjectsBoard';
import { EmptyState } from './NationDock/widgets';
import { countTroubledUnits } from './operationalObjects';

export interface ForcesPanelProps {
  arsenal?: ArsenalResponse | null;
  /** MAP P4.1 — identità dello snapshot canonico (invalida le preview PRIMA→DOPO). */
  snapshotKey?: string;
  onPreviewFormation?: (options: { formations?: number; armyId?: string | null; name?: string }) => Promise<FormationImpactPayload>;
  onRaiseFormation?: (options: { formations?: number; armyId?: string | null; name?: string }) => Promise<unknown>;
  onUnitAction?: (request: UnitActionRequest) => Promise<UnitActionImpactPayload>;
  onUnitOrder?: (request: UnitOrderRequest) => Promise<UnitOrderImpactPayload>;
}

export function ForcesPanel({
  arsenal,
  snapshotKey,
  onPreviewFormation,
  onRaiseFormation,
  onUnitAction,
  onUnitOrder,
}: ForcesPanelProps) {
  const objects = arsenal?.objects ?? null;
  const troubled = countTroubledUnits(objects);

  return (
    <div className="forces-panel">
      <header className="forces-panel-header">
        <div>
          <div className="forces-panel-kicker">Forze</div>
          <div className="forces-panel-title">
            {troubled === 0
              ? 'Nessun reparto segnalato'
              : `${troubled} ${troubled === 1 ? 'reparto richiede' : 'reparti richiedono'} attenzione`}
          </div>
        </div>
        <p className="forces-panel-note">
          La sala operativa del paese: crea reparti, compra equipaggiamento, impartisce ordini.
          Ogni cifra e ogni azione sono del motore; qui si legge e si decide.
        </p>
      </header>

      {objects && arsenal ? (
        <ObjectsBoard
          arsenal={arsenal}
          onPreviewFormation={onPreviewFormation}
          onRaiseFormation={onRaiseFormation}
          onUnitAction={onUnitAction}
          onUnitOrder={onUnitOrder}
          snapshotKey={snapshotKey}
          busy={false}
        />
      ) : (
        <EmptyState>Il motore non ha ancora pubblicato gli oggetti del paese.</EmptyState>
      )}
    </div>
  );
}

export default ForcesPanel;
