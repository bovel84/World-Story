import { useCallback, useMemo, type ReactNode } from 'react';

/**
 * GameShell — layout a griglia per la schermata di gioco.
 *
 * Aree (desktop ≥1024px):
 * ┌─────────────────────────────────────────────────────────────┐
 * │  HUD  │  HUD  │  HUD  │  HUD  │  HUD  │  HUD  │  HUD  │
 * ├──────┼───────┼───────┼───────┼───────┼───────┼──────┤
 * │ Rail │       MAPPA (dominante)        │ Desk   │
 * │240px │                                 │ 400px  │
 * └──────┴────────────────────────────────┴────────┘
 *
 * Tablet 768–1023px: rail compatto, desk come sheet laterale
 * Mobile <768px: rail nascosto (apribile), desk come bottom sheet
 */
export interface GameShellProps {
  /** Contenuto HUD (barra superiore) */
  hud: ReactNode;
  /** Contenuto del rail sinistro (icona moduli) */
  rail: ReactNode;
  /** Contenuto della mappa (centro dominante) */
  map: ReactNode;
  /** Contenuto del desk destro (pannello operativo) */
  desk: ReactNode;
  /** Se il desk è aperto (controlla visibilità/griglia) */
  deskOpen?: boolean;
  /** Se il desk è massimizzato (tablet: sheet pieno) */
  deskMaximized?: boolean;
  /** Classe aggiuntiva per il container */
  className?: string;
}

export function GameShell({
  hud,
  rail,
  map,
  desk,
  deskOpen = false,
  deskMaximized = false,
  className = '',
}: GameShellProps) {
  const containerClass = useMemo(
    () => [
      'game-shell',
      className,
      deskOpen ? 'desk-open' : '',
      deskMaximized ? 'desk-maximized' : '',
    ]
      .filter(Boolean)
      .join(' '),
    [className, deskOpen, deskMaximized],
  );

  return (
    <div className={containerClass}>
      <header className="game-shell-hud" role="banner">{hud}</header>
      <div className="game-shell-grid">
        <nav className="game-shell-rail" role="navigation" aria-label="Moduli di comando">{rail}</nav>
        <main className="game-shell-map" role="main">{map}</main>
        {deskOpen && (
          <aside className="game-shell-desk" role="complementary" aria-label="Scrivania operativa">{desk}</aside>
        )}
      </div>
    </div>
  );
}

export default GameShell;