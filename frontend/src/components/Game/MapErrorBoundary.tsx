/**
 * World Story — confine d'errore della mappa
 * ===========================================
 * La mappa è una **superficie**, non il gioco: se fallisce, la partita deve
 * continuare. Senza questo confine un errore non gestito di MapLibre (per
 * esempio la creazione del contesto WebGL) risale fino alla radice React e
 * abbatte l'intera applicazione — è esattamente il crash osservato:
 *
 *   `Uncaught Error: ... Failed to initialize WebGL`
 *
 * Il confine cattura, dichiara cosa è successo e lascia giocare. Il ripiego lo
 * scegle il chiamante (`fallback`): normalmente la mappa statica.
 */
import React from 'react';

export interface MapErrorBoundaryProps {
  /** Contenuto da proteggere (la mappa interattiva). */
  children: React.ReactNode;
  /** Cosa mostrare quando la mappa fallisce: la mappa statica, di norma. */
  fallback: React.ReactNode;
  /** Notifica opzionale: permette di registrare il guasto senza propagarlo. */
  onError?: (error: Error) => void;
}

interface MapErrorBoundaryState {
  failed: boolean;
  message: string;
}

export class MapErrorBoundary extends React.Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { failed: false, message: '' };

  static getDerivedStateFromError(error: unknown): MapErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error ?? 'errore sconosciuto');
    return { failed: true, message };
  }

  componentDidCatch(error: Error): void {
    // Il confine **non** inghiotte il problema in silenzio: lo registra, così un
    // guasto ricorrente resta diagnosticabile senza abbattere la partita.
    console.error('[MapErrorBoundary] La mappa interattiva non è disponibile:', error);
    this.props.onError?.(error);
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="map-error-boundary">
        <p className="map-error-boundary-notice" role="status">
          La mappa interattiva non è disponibile{this.state.message ? ` (${this.state.message})` : ''}.
          La partita continua con la mappa statica.
        </p>
        {this.props.fallback}
      </div>
    );
  }
}

export default MapErrorBoundary;
