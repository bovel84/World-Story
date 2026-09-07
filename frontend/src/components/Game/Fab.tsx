/**
 * Open-Pax — FAB Component
 * =========================
* Fase 6: gruppo di pulsanti tondi flottanti in basso a sinistra, come in
* docs/ref/pax_action_sent.png dell'originale Pax Historia (chat, fulmine, ricerca).
* Pulsanti 44px, sfondo scuro, hover con gradiente, eventuale badge rosso
* badge dei non letti.
 *
* Uso:
 *   <Fab items={[
 *     { icon: '💬', title: 'Chat', badge: unread, onClick: openChats },
 *     { icon: '⚡', title: 'Azioni', onClick: openActions },
 *     { icon: '🔍', title: 'Cerca', onClick: openSearch },
 *   ]} />
 */

import React from 'react';

export interface FabItem {
  /** Emoji o simbolo icona */
  icon: string;
/** Etichetta nel tooltip (title/aria-label) */
  title: string;
  /** Contatore non letti; 0/undefined — badge nascosto */
  badge?: number;
  /** Sezione attiva: bordo/tinta brand */
  active?: boolean;
  onClick: () => void;
}

export interface FabProps {
  items: FabItem[];
}

export const Fab: React.FC<FabProps> = ({ items }) => {
  if (!items || items.length === 0) return null;

  return (
    <div className="fab-group">
      {items.map((item, i) => (
        <button
          key={`${item.title}-${i}`}
          type="button"
          className={`fab-btn${item.active ? ' active' : ''}`}
          title={item.title}
          aria-label={item.title}
          onClick={item.onClick}
        >
          <span className="fab-icon" aria-hidden="true">
            {item.icon}
          </span>
          {typeof item.badge === 'number' && item.badge > 0 && (
            <span className="fab-badge">
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export default Fab;
