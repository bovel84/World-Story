/**
 * World Story — SSE Hook
 * ====================
 * React hook for SSE real-time updates
 */

import { useEffect, useRef, useCallback } from 'react';

export interface SSEEvent {
  type: string;
  data: any;
}

interface UseSSEOptions {
  onTurnStart?: (data: any) => void;
  onTurnComplete?: (data: any) => void;
  onGeneratingNarration?: (data: any) => void;
  onLLMProgress?: (data: { mechanic: string; chars: number; eventsReady?: number }) => void;
  onJumpEvent?: (data: {
    index: number;
    total?: number;
    streaming?: boolean;
    /** Solo un checkpoint committato può aggiornare data e mappa. */
    checkpoint?: boolean;
    event: any;
    changedRegions?: any[];
    /** §9.3: ID canonico dell'evento applicato (dedup feed HTTP/SSE). */
    eventId?: string;
    /** Run che ha prodotto il checkpoint per-evento. */
    simulationId?: string;
    /** Ancora G22 del checkpoint mostrato. */
    checkpointId?: string;
    revision?: number;
    /** Il run resta in pausa: il giocatore decide sul checkpoint mostrato. */
    awaitingNext?: { remaining: number; destination: string };
    newDate?: string;
    newTurn?: number;
  }) => void;
  // Eventi del mondo generati dalla simulazione live (senza azione del giocatore)
  onWorldEvent?: (data: {
    narration: string;
    events: string[];
    eventDetails?: Array<{ id: string; date: string; headline: string; detail: string; source: 'world' | 'diplomacy' }>;
    newTurn: number;
    newDate: string;
    changedRegions?: any[];
  }) => void;
  onActionVoided?: (data: { action: string; reason: string }) => void;
  // Fase 3: messaggio in arrivo da una chat diplomatica
  onChatMessage?: (data: { chatId: string; polityId: string; polityName: string; message: any }) => void;
  // Fase 3: commento proattivo del consulente dopo il turno
  onAdvisorProactive?: (data: { content: string }) => void;
  onError?: (error: any) => void;
  onConnected?: () => void;
}

export function useSSE(gameId: string | null, options: UseSSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (!gameId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Base URL API da env (senza hardcode), lo stesso di services/api.ts
    const apiBase = import.meta.env.VITE_API_URL || '/api';
    const url = `${apiBase}/games/${gameId}/events`;
    console.log('[SSE] Connecting to:', url);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[SSE] Connected to game:', gameId);
      optionsRef.current.onConnected?.();
    };

    eventSource.onerror = (error) => {
      console.error('[SSE] Error:', error);
      optionsRef.current.onError?.(error);

      // Reconnect after 5 seconds
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('[SSE] Reconnecting...');
        connect();
      }, 5000);
    };

    // Handle specific events
    eventSource.addEventListener('connected', (e) => {
      console.log('[SSE] Received connected event:', e);
    });

    eventSource.addEventListener('turn_start', (e) => {
      console.log('[SSE] Turn start:', e.data);
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onTurnStart?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse turn_start:', err);
      }
    });

    eventSource.addEventListener('turn_complete', (e) => {
      console.log('[SSE] Turn complete:', e.data);
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onTurnComplete?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse turn_complete:', err);
      }
    });

    eventSource.addEventListener('world_event', (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onWorldEvent?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse world_event:', err);
      }
    });

    eventSource.addEventListener('generating_narration', (e) => {
      console.log('[SSE] Generating narration:', e.data);
      optionsRef.current.onGeneratingNarration?.({});
    });

    eventSource.addEventListener('processing_npcs_complete', (e) => {
      console.log('[SSE] NPCs processed:', e.data);
    });

    eventSource.addEventListener('narration_generated', (e) => {
      console.log('[SSE] Narration generated:', e.data);
    });

    eventSource.addEventListener('llm_progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onLLMProgress?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse llm_progress:', err);
      }
    });

    eventSource.addEventListener('jump_event', (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onJumpEvent?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse jump_event:', err);
      }
    });

    eventSource.addEventListener('action_voided', (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onActionVoided?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse action_voided:', err);
      }
    });

    eventSource.addEventListener('ping', () => {
      // Keep-alive, no action needed
    });

    // Fase 3: chat diplomatiche + Consulente live
    eventSource.addEventListener('chat_message', (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onChatMessage?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse chat_message:', err);
      }
    });

    eventSource.addEventListener('advisor_proactive', (e) => {
      try {
        const data = JSON.parse(e.data);
        optionsRef.current.onAdvisorProactive?.(data);
      } catch (err) {
        console.error('[SSE] Failed to parse advisor_proactive:', err);
      }
    });

  }, [gameId]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return {
    reconnect: connect,
  };
}
