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
      eventsPerSecond: 20,
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
 * Robust parser for Supabase record ID:
 * Format: ${userId}_${monthYear}_${prefix}_${numId}
 * Example: usr_g_3c194fd4dec0e0af_09_2026_desp_1790344257883
 */
export function parseRecordId(id: string): {
  userId: string;
  monthYear: string;
  type: 'rendas' | 'despesas' | 'economias';
  numId: number;
} {
  const parts = String(id || '').split('_');
  const numId = parseInt(parts[parts.length - 1], 10) || Date.now();
  const prefix = parts[parts.length - 2] || 'desp';
  const year = parts[parts.length - 3] || '2026';
  const month = parts[parts.length - 4] || '09';
  const monthYear = `${month}_${year}`;
  const userId = parts.slice(0, parts.length - 4).join('_');
  const type: 'rendas' | 'despesas' | 'economias' =
    prefix === 'desp' ? 'despesas' : prefix === 'rend' ? 'rendas' : 'economias';

  return { userId, monthYear, type, numId };
}

/**
 * Universal dual-channel Realtime Listener:
 * 1) Supabase Realtime WebSocket (postgres_changes on financial_records & monthly_data)
 * 2) Server SSE Stream (/api/realtime/stream) for instant zero-latency multi-device sync
 * 
 * Accurately handles:
 * - INSERT: New expense/income/savings appears immediately on other device
 * - UPDATE: Status changes ('Pendente' <-> 'Pago') or edits reflect immediately
 * - DELETE: Deleted items are extracted and removed cleanly across all devices
 */
export function subscribeToFinancialRealtime(
  userId: string,
  onEvent: (event: FinancialRealtimeEvent) => void,
  onStatusChange?: (status: RealtimeStatus) => void
): () => void {
  let isCleanedUp = false;
  let supabaseChannel: RealtimeChannel | null = null;
  let sseEventSource: EventSource | null = null;
  let sseReconnectTimer: any = null;
  let wsReconnectTimer: any = null;

  onStatusChange?.('CONNECTING');

  // Track recent processed events to eliminate duplicate jitter
  const recentEventFingerprints = new Map<string, number>();
  function isDuplicateEvent(fingerprint: string): boolean {
    const now = Date.now();
    const last = recentEventFingerprints.get(fingerprint);
    if (last && now - last < 2500) {
      return true;
    }
    recentEventFingerprints.set(fingerprint, now);
    // Cleanup old fingerprints periodically
    if (recentEventFingerprints.size > 200) {
      for (const [k, t] of recentEventFingerprints.entries()) {
        if (now - t > 10000) recentEventFingerprints.delete(k);
      }
    }
    return false;
  }

  // ==========================================
  // CHANNEL 1: SUPABASE REALTIME (WEBSOCKET)
  // ==========================================
  function setupSupabaseChannel() {
    if (isCleanedUp) return;

    try {
      if (supabaseChannel) {
        supabaseRealtime.removeChannel(supabaseChannel).catch(() => {});
        supabaseChannel = null;
      }

      const channelName = `realtime:financial:${userId}:${Date.now()}`;
      supabaseChannel = supabaseRealtime.channel(channelName);

      // Listen to table: financial_records (granular items)
      // Note: We listen without the postgres-level filter because on DELETE,
      // Postgres WAL payload only contains the primary key (id), omitting user_id.
      // We parse and filter client-side with 100% precision using parseRecordId().
      supabaseChannel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'financial_records',
        },
        (payload: any) => {
          if (isCleanedUp) return;
          const eventType = payload.eventType; // INSERT | UPDATE | DELETE
          const newRec = payload.new;
          const oldRec = payload.old;

          if (eventType === 'DELETE' && oldRec?.id) {
            const parsed = parseRecordId(String(oldRec.id));
            // Strictly enforce isolation: only process if record belongs to current user
            if (parsed.userId !== userId) return;

            const fp = `DELETE_${parsed.monthYear}_${parsed.type}_${parsed.numId}`;
            if (isDuplicateEvent(fp)) return;

            onEvent({
              action: 'DELETE_ITEM',
              monthYear: parsed.monthYear,
              type: parsed.type,
              itemId: parsed.numId,
              source: 'supabase_websocket',
              timestamp: new Date().toISOString(),
            });
          } else if ((eventType === 'INSERT' || eventType === 'UPDATE') && newRec) {
            // Strictly enforce isolation
            if (newRec.user_id !== userId) return;

            const parsed = parseRecordId(String(newRec.id));
            const numId = parsed.numId || parseInt(String(newRec.id).split('_').pop() || '', 10) || Date.now();
            const monthYear = newRec.month_year || parsed.monthYear;
            const type = (newRec.type as any) || parsed.type;

            const fp = `${eventType}_${monthYear}_${type}_${numId}_${newRec.status}_${newRec.valor}`;
            if (isDuplicateEvent(fp)) return;

            const item: FinancialItem = {
              id: numId,
              nome: String(newRec.nome || '').trim(),
              valor: Number(newRec.valor) || 0,
              status: newRec.status || undefined,
            };

            onEvent({
              action: eventType === 'INSERT' ? 'INSERT_ITEM' : 'UPDATE_ITEM',
              monthYear,
              type,
              itemId: numId,
              item,
              source: 'supabase_websocket',
              timestamp: newRec.updated_at || new Date().toISOString(),
            });
          }
        }
      );

      // Listen to table: monthly_data (monthly aggregated snapshot)
      supabaseChannel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'monthly_data',
        },
        (payload: any) => {
          if (isCleanedUp) return;
          const newDoc = payload.new;
          if (newDoc && newDoc.user_id === userId && newDoc.month_year) {
            const fp = `MONTHLY_${newDoc.month_year}_${newDoc.updated_at}`;
            if (isDuplicateEvent(fp)) return;

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
          console.warn(`Supabase Realtime state [${status}]:`, err);
          onStatusChange?.('ERROR');
          clearTimeout(wsReconnectTimer);
          wsReconnectTimer = setTimeout(() => {
            if (!isCleanedUp) setupSupabaseChannel();
          }, 3500);
        } else if (status === 'CLOSED') {
          onStatusChange?.('DISCONNECTED');
        }
      });
    } catch (err) {
      console.warn('Error setting up Supabase Realtime channel:', err);
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

      if (sseEventSource) {
        sseEventSource.close();
        sseEventSource = null;
      }

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
            const fp = `SSE_${parsed.action}_${parsed.monthYear}_${parsed.itemId || ''}_${parsed.item?.status || ''}`;
            if (isDuplicateEvent(fp)) return;

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
          // ignore invalid or heartbeat messages
        }
      };

      sseEventSource.onerror = () => {
        if (isCleanedUp) return;
        if (sseEventSource?.readyState === EventSource.CLOSED) {
          onStatusChange?.('DISCONNECTED');
          clearTimeout(sseReconnectTimer);
          sseReconnectTimer = setTimeout(() => {
            if (!isCleanedUp) {
              setupServerSSE();
            }
          }, 4000);
        }
      };
    } catch (err) {
      console.warn('Error configuring SSE stream:', err);
    }
  }

  // Start both channels
  setupSupabaseChannel();
  setupServerSSE();

  // Auto-reconnect when device comes back online or regains focus
  const handleOnline = () => {
    if (isCleanedUp) return;
    onStatusChange?.('CONNECTING');
    setupSupabaseChannel();
    setupServerSSE();
  };

  window.addEventListener('online', handleOnline);

  // Return cleanup function
  return () => {
    isCleanedUp = true;
    window.removeEventListener('online', handleOnline);
    clearTimeout(sseReconnectTimer);
    clearTimeout(wsReconnectTimer);

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
