import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import { getAuthToken } from './authService';
import type { MonthlyFinancialData, FinancialItem } from '../types/finance';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://fkraewrrjbagkzxjrxmw.supabase.co';
const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_IAB4-aHqYr3PGeBZLXc0Sw_LG_PhlFO';

// Browser-safe Supabase client configured for Realtime WebSockets
export const supabaseRealtime = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 15,
    },
  },
});

export type RealtimeStatus = 'SUBSCRIBED' | 'CONNECTING' | 'DISCONNECTED' | 'ERROR';

export interface FinancialRealtimeEvent {
  action: 'UPSERT_MONTHLY' | 'DELETE_ITEM' | 'INSERT_ITEM' | 'UPDATE_ITEM';
  monthYear: string;
  type?: 'rendas' | 'despesas' | 'economias';
  itemId?: number;
  item?: FinancialItem;
  data?: MonthlyFinancialData;
  source: 'supabase_websocket' | 'server_sse';
  timestamp: string;
}

/**
 * Universal dual-channel Realtime Listener:
 * 1) Directly connects to Supabase Realtime WebSocket (postgres_changes)
 * 2) Connects to Server SSE Broadcast for instant zero-latency sync
 * Guarantees that changes from Device A appear on Device B in real-time!
 */
export function subscribeToFinancialRealtime(
  userId: string,
  onEvent: (event: FinancialRealtimeEvent) => void,
  onStatusChange?: (status: RealtimeStatus) => void
): () => void {
  let isCleanedUp = false;
  let supabaseChannel: RealtimeChannel | null = null;
  let sseEventSource: EventSource | null = null;
  let reconnectTimeout: any = null;

  onStatusChange?.('CONNECTING');

  // ==========================================
  // CHANNEL 1: SUPABASE REALTIME (WEBSOCKET)
  // ==========================================
  function setupSupabaseChannel() {
    if (isCleanedUp) return;

    try {
      const channelName = `realtime:financial:${userId}:${Date.now()}`;
      supabaseChannel = supabaseRealtime.channel(channelName);

      // Listen to individual item changes (financial_records)
      supabaseChannel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'financial_records',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (isCleanedUp) return;
          const eventType = payload.eventType; // INSERT | UPDATE | DELETE
          const newRec = payload.new;
          const oldRec = payload.old;

          if (eventType === 'DELETE' && oldRec) {
            const rawId = (oldRec.id ? String(oldRec.id).split('_').pop() : '') || '';
            const numId = parseInt(rawId, 10);
            if (numId) {
              onEvent({
                action: 'DELETE_ITEM',
                monthYear: oldRec.month_year || '',
                type: oldRec.type || 'despesas',
                itemId: numId,
                source: 'supabase_websocket',
                timestamp: new Date().toISOString(),
              });
            }
          } else if ((eventType === 'INSERT' || eventType === 'UPDATE') && newRec) {
            const rawId = (newRec.id ? String(newRec.id).split('_').pop() : '') || '';
            const numId = parseInt(rawId, 10) || Date.now();
            const item: FinancialItem = {
              id: numId,
              nome: newRec.nome,
              valor: Number(newRec.valor) || 0,
              status: newRec.status || undefined,
            };

            onEvent({
              action: eventType === 'INSERT' ? 'INSERT_ITEM' : 'UPDATE_ITEM',
              monthYear: newRec.month_year,
              type: newRec.type as any,
              itemId: numId,
              item,
              source: 'supabase_websocket',
              timestamp: newRec.updated_at || new Date().toISOString(),
            });
          }
        }
      );

      // Listen to full monthly table changes (monthly_data)
      supabaseChannel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'monthly_data',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (isCleanedUp) return;
          const newDoc = payload.new;
          if (newDoc && newDoc.month_year) {
            onEvent({
              action: 'UPSERT_MONTHLY',
              monthYear: newDoc.month_year,
              data: {
                rendas: Array.isArray(newDoc.rendas) ? newDoc.rendas : [],
                despesas: Array.isArray(newDoc.despesas) ? newDoc.despesas : [],
                economias: Array.isArray(newDoc.economias) ? newDoc.economias : [],
              },
              source: 'supabase_websocket',
              timestamp: newDoc.updated_at || new Date().toISOString(),
            });
          }
        }
      );

      supabaseChannel.subscribe((status: string, err?: any) => {
        if (isCleanedUp) return;
        if (status === 'SUBSCRIBED') {
          onStatusChange?.('SUBSCRIBED');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Supabase channel state [${status}]:`, err);
          onStatusChange?.('ERROR');
        } else if (status === 'CLOSED') {
          onStatusChange?.('DISCONNECTED');
        }
      });
    } catch (err) {
      console.warn('Error creating Supabase channel:', err);
    }
  }

  // ==========================================
  // CHANNEL 2: SERVER SSE BRIDGE (STREAM)
  // ==========================================
  function setupServerSSE() {
    if (isCleanedUp) return;

    try {
      const token = getAuthToken();
      if (!token) return;

      // EventSource requires url, pass auth token via query param
      const sseUrl = `/api/realtime/stream?token=${encodeURIComponent(token)}`;
      sseEventSource = new EventSource(sseUrl);

      sseEventSource.onopen = () => {
        if (!isCleanedUp) {
          onStatusChange?.('SUBSCRIBED');
        }
      };

      sseEventSource.onmessage = (e) => {
        if (isCleanedUp || !e.data || e.data.startsWith(':')) return;

        try {
          const parsed = JSON.parse(e.data);
          if (parsed.action && parsed.monthYear) {
            onEvent({
              action: parsed.action,
              monthYear: parsed.monthYear,
              type: parsed.type,
              itemId: parsed.itemId,
              item: parsed.item,
              data: parsed.data,
              source: 'server_sse',
              timestamp: parsed.timestamp || new Date().toISOString(),
            });
          }
        } catch {
          // ignore heartbeat / invalid json
        }
      };

      sseEventSource.onerror = () => {
        if (isCleanedUp) return;
        if (sseEventSource?.readyState === EventSource.CLOSED) {
          onStatusChange?.('DISCONNECTED');
          // Reconnect SSE after 4 seconds
          clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(() => {
            if (!isCleanedUp) {
              setupServerSSE();
            }
          }, 4000);
        }
      };
    } catch (err) {
      console.warn('Error setting up SSE stream:', err);
    }
  }

  // Start both channels
  setupSupabaseChannel();
  setupServerSSE();

  // Auto-reconnect when device comes back online
  const handleOnline = () => {
    if (isCleanedUp) return;
    onStatusChange?.('CONNECTING');
    if (!sseEventSource || sseEventSource.readyState === EventSource.CLOSED) {
      setupServerSSE();
    }
  };

  window.addEventListener('online', handleOnline);

  // Return cleanup function
  return () => {
    isCleanedUp = true;
    window.removeEventListener('online', handleOnline);
    clearTimeout(reconnectTimeout);

    if (supabaseChannel) {
      supabaseRealtime.removeChannel(supabaseChannel).catch(() => {});
      supabaseChannel = null;
    }

    if (sseEventSource) {
      sseEventSource.close();
      sseEventSource = null;
    }

    onStatusChange?.('DISCONNECTED');
  };
}
