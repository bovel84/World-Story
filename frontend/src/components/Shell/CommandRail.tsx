import { useMemo, type ReactNode } from 'react';
import type { ActiveModule } from '../../stores/moduleState';
import type { RailItem } from '../Game/nationalContext';

// V05 — `ActiveModule` e `RailItem` erano dichiarati **due volte**: qui e,
// rispettivamente, in `stores/moduleState.ts` e `components/Game/nationalContext.ts`.
// Due verità parallele sullo stesso elenco di moduli: aggiungerne uno richiedeva
// di ricordarsi di entrambe (V01 l'ha dovuto fare). Ora la barra importa le
// definizioni canoniche; qui resta solo il contratto del componente.

interface CommandRailProps {
  items: RailItem[];
  activeModule: ActiveModule;
  onModuleClick: (module: ActiveModule) => void;
  collapsed?: boolean;
}

export function CommandRail({
  items,
  activeModule,
  onModuleClick,
  collapsed = false,
}: CommandRailProps) {
  const railItems = useMemo(
    () =>
      items.map((item: RailItem) => ({
        ...item,
        active: item.id === activeModule,
      })),
    [items, activeModule],
  );

  return (
    <div className={`command-rail${collapsed ? ' collapsed' : ''}`} role="toolbar" aria-label="Comandi rapidi">
      <div className="rail-brand" aria-hidden="true">
        <span className="rail-logo">WS</span>
        {!collapsed && <span className="rail-title">World Story</span>}
      </div>
      <ul className="rail-list" role="list">
        {railItems.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`rail-btn${item.active ? ' active' : ''}`}
              onClick={() => onModuleClick(item.id)}
              aria-pressed={item.active}
              aria-label={item.label}
              title={item.label}
            >
              <span className="rail-icon" aria-hidden="true">{item.icon}</span>
              {!collapsed && <span className="rail-label">{item.label}</span>}
              {!!item.badge && item.badge > 0 && !item.active && (
                <span className="rail-badge" aria-label={`${item.badge} non letti`}>{item.badge > 99 ? '99+' : item.badge}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {!collapsed && <div className="rail-footer" aria-hidden="true" />}
    </div>
  );
}

export default CommandRail;