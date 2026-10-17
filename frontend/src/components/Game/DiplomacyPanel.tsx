/**
 * World Story — Diplomacy Panel Component
 * =====================================
 * Shows diplomatic relationships (allies/hostile/neutral) for the selected country.
 */

import React, { useEffect, useState } from 'react';
import { chatsApi, gameApi } from '../../services/api';
import { useChatStore } from '../../stores';
import type { Region } from '../../types';
import { deriveDiplomacyPresence, type DiplomacyEntry } from './diplomacyPresence';

interface DiplomacyPanelProps {
  gameId: string;
  selectedRegionId: string;
  regions: Region[];
/** Cambia dopo ogni turno (currentTurn) — innesca il ricaricamento della matrice */
  refreshKey?: number | string;
}

interface RelationshipData {
  // Chiavi = polityId (codici paese per i template, 'player'/'ai-N' per mappe personalizzate)
  [polityId: string]: { [polityId: string]: string };
}

type RelationshipEntry = DiplomacyEntry;

const REL_COLOR: Record<string, string> = {
  ally: '#22c55e',
  hostile: '#ef4444',
  neutral: '#6b7280',
};

const FLAG_EMOJI: Record<string, string> = {
  USA: '🇺🇸', RUS: '🇷🇺', CHN: '🇨🇳', GBR: '🇬🇧', FRA: '🇫🇷',
  DEU: '🇩🇪', JPN: '🇯🇵', IND: '🇮🇳', BRA: '🇧🇷', CAN: '🇨🇦',
  ITA: '🇮🇹', ESP: '🇪🇸', MEX: '🇲🇽', AUS: '🇦🇺', KOR: '🇰🇷',
  SAU: '🇸🇦', TUR: '🇹🇷', POL: '🇵🇱', NLD: '🇳🇱', BEL: '🇧🇪',
  SWE: '🇸🇪', NOR: '🇳🇴', DNK: '🇩🇰', FIN: '🇫🇮', AUT: '🇦🇹',
  CHE: '🇨🇭', PRT: '🇵🇹', GRC: '🇬🇷', CZE: '🇨🇿', HUN: '🇭🇺',
  ROU: '🇷🇴', BGR: '🇧🇬', UKR: '🇺🇦', KAZ: '🇰🇿', ARG: '🇦🇷',
  CHL: '🇨🇱', COL: '🇨🇴', PER: '🇵🇪', VEN: '🇻🇪', ECU: '🇪🇨',
  BOL: '🇧🇴', PRY: '🇵🇾', URY: '🇺🇾', GTM: '🇬🇹', CUB: '🇨🇺',
  HTI: '🇭🇹', DOM: '🇩🇴', HND: '🇭🇳', NIC: '🇳🇮', CRI: '🇨🇷',
  PAN: '🇵🇦', SLV: '🇸🇻', JAM: '🇯🇲', TTO: '🇹🇹', PRK: '🇰🇵',
  VNM: '🇻🇳', THA: '🇹🇭', IDN: '🇮🇩', MYS: '🇲🇾', PHL: '🇵🇭',
  PAK: '🇵🇰', BGD: '🇧🇩', IRN: '🇮🇷', IRQ: '🇮🇶', SYR: '🇸🇾',
  ISR: '🇮🇱', EGY: '🇪🇬', LBY: '🇱🇾', DZA: '🇩🇿', MAR: '🇲🇦',
  TUN: '🇹🇳', NGA: '🇳🇬', ZAF: '🇿🇦', ETH: '🇪🇹', KEN: '🇰🇪',
  GHA: '🇬🇭', AGO: '🇦🇴', MOZ: '🇲🇿', TZA: '🇹🇿', CMR: '🇨🇲',
  COD: '🇨🇩', SDN: '🇸🇩', SOM: '🇸🇴', YEM: '🇾🇪', AFG: '🇦🇫',
  MMR: '🇲🇲', KHM: '🇰🇭', LAO: '🇱🇦', MNG: '🇲🇳', NPL: '🇳🇵',
  LKA: '🇱🇰', AZE: '🇦🇿', GEO: '🇬🇪', ARM: '🇦🇲', BLR: '🇧🇾',
  MDA: '🇲🇩', LTU: '🇱🇹', LVA: '🇱🇻', EST: '🇪🇪', SRB: '🇷🇸',
  HRV: '🇭🇷', BIH: '🇧🇦', SVN: '🇸🇮', SVK: '🇸🇰', MKD: '🇲🇰',
  MNE: '🇲🇪', ALB: '🇦🇱', RWA: '🇷🇼', UZB: '🇺🇿', TKM: '🇹🇲',
  KGZ: '🇰🇬', TJK: '🇹🇯',
};

export const DiplomacyPanel: React.FC<DiplomacyPanelProps> = ({
  gameId,
  selectedRegionId,
  regions,
  refreshKey,
}) => {
  const [relationships, setRelationships] = useState<RelationshipData | null>(null);
  // Nomi pubblici delle polity, dal motore: la relazione è per codice (`ITA`) e
  // il codice non è un nome. Prima il client lo risolveva con la provincia
  // capitale, e «ITA» diventava «Aosta».
  const [polityNames, setPolityNames] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  const fetchRelationships = React.useCallback(async () => {
    try {
      const data = await gameApi.getRelationships(gameId);
      // Il motore risponde `{ relationships, names }`; un server precedente
      // rispondeva con la sola matrice — in quel caso i nomi restano assenti e
      // il read model ripiega sul codice polity, mai sul nome di una città.
      const wrapped = data as unknown as {
        relationships?: RelationshipData | null;
        names?: Record<string, string> | null;
      };
      setRelationships(wrapped.relationships ?? null);
      setPolityNames(wrapped.names ?? null);
    } catch (e) {
      console.error('[DiplomacyPanel] Failed to load relationships:', e);
    }
  }, [gameId]);

  // Ricaricamento al cambio partita e dopo ogni turno (refreshKey = currentTurn).
  // Bug fix: in precedenza il pannello ascoltava l'evento window 'turn_complete', che
  // nessuno ha mai inviato, quindi la matrice non si aggiornava dopo i turni.
  useEffect(() => {
    fetchRelationships();
  }, [fetchRelationships, refreshKey]);

  // Pass the canonical polity ID, not its display name or the selected province.
  // Creation/reopening belongs to DiplomacyService; the client only navigates.
  const handleOpenChat = async (polityId: string) => {
    if (!polityId || openingChatId || gameId.startsWith('local_')) return;
    setOpeningChatId(polityId);
    setChatError(null);
    try {
      const { chat } = await chatsApi.create(gameId, [polityId]);
      const data = await chatsApi.messages(gameId, chat.id);
      const store = useChatStore.getState();
      if (store.gameId !== gameId) return; // prevent stale responses crossing games
      store.upsertChat(chat);
      store.setMessages(chat.id, data.messages || []);
      store.setActiveChat(chat.id);
      store.markRead(chat.id);
      store.setPanelTab('chats');
      store.setChatPanelVisible(true);
      void store.refreshChats();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Non è stato possibile avviare la trattativa.');
    } finally {
      setOpeningChatId(null);
    }
  };

  // regionOwner è il polityId del proprietario della regione selezionata
  const regionOwner = regions.find(r => r.id === selectedRegionId)?.owner;
  if (!regionOwner || regionOwner === 'neutral') {
    return null;
  }

  if (!relationships) {
    return (
      <div className="diplomacy-panel" style={{ opacity: 0.6 }}>
        <div style={{ padding: 8, fontSize: 12, color: '#888' }}>Caricamento diplomazia...</div>
      </div>
    );
  }

  const presence = deriveDiplomacyPresence({ relationships, regionOwner, regions, names: polityNames });
  const entries: RelationshipEntry[] = [...presence.allies, ...presence.hostiles];
  entries.sort((a, b) => {
    const order = { ally: 0, hostile: 1 };
    return (order[a.relationship as keyof typeof order] ?? 2) - (order[b.relationship as keyof typeof order] ?? 2);
  });

  const allies = entries.filter(e => e.relationship === 'ally');
  const hostiles = entries.filter(e => e.relationship === 'hostile');

  if (entries.length === 0 && presence.neutrals === 0) {
    return (
      <div className="diplomacy-panel">
        <div className="diplomacy-header">
          <span>Relazioni estere</span>
        </div>
        <div style={{ padding: 8, fontSize: 12, color: '#888' }}>Nessun alleato o nemico</div>
      </div>
    );
  }

  const closeSelf = () => {
    // Chiude il modulo diplomazia tramite l'evento globale ascoltato da App
    window.dispatchEvent(new CustomEvent('ws:close-module', { detail: 'diplomacy' }));
  };

  return (
    <div className="diplomacy-panel" style={{ position: 'relative' }}>
      <button type="button" className="desk-close-x" onClick={closeSelf} aria-label="Chiudi pannello diplomazia" title="Chiudi">✕</button>
      <div className="diplomacy-header" onClick={() => setCollapsed(c => !c)} style={{ cursor: 'pointer' }}>
        <span>Relazioni estere</span>
        <span className="diplomacy-summary" title="Quadro letto dal motore">{presence.summary}</span>
        <span style={{ fontSize: 11, color: '#888' }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <div className="diplomacy-content">
          {allies.length === 0 && hostiles.length === 0 && (
            <div className="diplomacy-section">
              <div className="diplomacy-section-title" style={{ color: REL_COLOR.neutral }}>Nessuna alleanza o ostilità aperta</div>
              {presence.neutrals > 0 && (
                <div className="diplomacy-entry">
                  <span className="diplomacy-status-dot" style={{ backgroundColor: REL_COLOR.neutral }} />
                  <span>{presence.neutrals} {presence.neutrals === 1 ? 'partner neutrale' : 'partner neutrali'}</span>
                </div>
              )}
            </div>
          )}
          {chatError && <p role="alert" className="diplomacy-chat-error">{chatError}</p>}
          {allies.length > 0 && (
            <div className="diplomacy-section">
              <div className="diplomacy-section-title" style={{ color: REL_COLOR.ally }}>
                Alleati ({allies.length})
              </div>
              {allies.map(e => (
                <div key={e.id} className="diplomacy-entry">
                  <span className="diplomacy-status-dot" style={{ backgroundColor: REL_COLOR.ally }} />
                  <span className="diplomacy-code">{FLAG_EMOJI[e.id] ? `${FLAG_EMOJI[e.id]} ` : ''}{e.id}</span>
                  <span>{e.name}</span>
                  <button type="button" className="btn-negotiate"
                    disabled={!!openingChatId || gameId.startsWith('local_')}
                    onClick={() => void handleOpenChat(e.id)}
                    aria-label={`Apri trattativa diplomatica con ${e.name}`}>
                    {openingChatId === e.id ? 'Apertura…' : '💬 Trattative'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {hostiles.length > 0 && (
            <div className="diplomacy-section">
              <div className="diplomacy-section-title" style={{ color: REL_COLOR.hostile }}>
                Nemici ({hostiles.length})
              </div>
              {hostiles.map(e => (
                <div key={e.id} className="diplomacy-entry">
                  <span className="diplomacy-status-dot" style={{ backgroundColor: REL_COLOR.hostile }} />
                  <span className="diplomacy-code">{FLAG_EMOJI[e.id] ? `${FLAG_EMOJI[e.id]} ` : ''}{e.id}</span>
                  <span>{e.name}</span>
                  <button type="button" className="btn-negotiate"
                    disabled={!!openingChatId || gameId.startsWith('local_')}
                    onClick={() => void handleOpenChat(e.id)}
                    aria-label={`Apri trattativa diplomatica con ${e.name}`}>
                    {openingChatId === e.id ? 'Apertura…' : '💬 Trattative'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DiplomacyPanel;
