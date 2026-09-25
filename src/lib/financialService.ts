import { safeApiCall, cloudFetch, getActiveUser } from './authService';
import type { MonthlyFinancialData, FinancialItem } from '../types/finance';

const DEFAULT_FINANCIAL_DATA: MonthlyFinancialData = {
  rendas: [],
  despesas: [],
  economias: [],
};

/**
 * Service to manage persistent financial data synchronized across all devices
 * with Supabase as the official cloud database and source of truth.
 */

export interface ConfirmedItemResponse {
  confirmed: boolean;
  item: FinancialItem;
  data: MonthlyFinancialData;
  monthYear: string;
}

/**
 * Explicitly create a new financial record in Supabase
 * Strict persistence: only resolves when the database confirms the INSERT.
 * If Supabase or the backend fails, throws an Error with details so the UI
 * can notify the user and keep form inputs intact for retry.
 */
export async function createFinancialItem(
  monthYear: string,
  type: 'rendas' | 'despesas' | 'economias',
  item: { nome?: string; valor: number; status?: 'Pago' | 'Pendente' }
): Promise<ConfirmedItemResponse> {
  const user = getActiveUser();
  const res = await safeApiCall<ConfirmedItemResponse>(
    `/api/financial/${monthYear}/item`,
    {
      method: 'POST',
      body: JSON.stringify({
        type,
        item: {
          nome: (item.nome || '').trim(),
          valor: item.valor,
          status: type === 'despesas' ? (item.status === 'Pago' ? 'Pago' : 'Pendente') : undefined,
        },
      }),
    }
  );

  if (!res.success || !res.data) {
    const errorMsg = res.error || 'Falha ao salvar registro. Verifique sua conexão e tente novamente.';
    throw new Error(errorMsg);
  }

  // Update local cache with latest data
  if (user && res.data.data) {
    try {
      localStorage.setItem(`fin_local_${user.uid}_${monthYear}`, JSON.stringify(res.data.data));
    } catch {}
  }

  return res.data;
}

/**
 * Explicitly update an existing financial record in Supabase & cloud backend
 */
export async function updateFinancialItem(
  monthYear: string,
  type: 'rendas' | 'despesas' | 'economias',
  item: { id: number; nome?: string; valor: number; status?: 'Pago' | 'Pendente' }
): Promise<ConfirmedItemResponse> {
  const user = getActiveUser();
  const res = await safeApiCall<ConfirmedItemResponse>(
    `/api/financial/${monthYear}/item/${type}/${item.id}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        item: {
          id: item.id,
          nome: (item.nome || '').trim(),
          valor: item.valor,
          status: type === 'despesas' ? (item.status === 'Pago' ? 'Pago' : 'Pendente') : undefined,
        },
      }),
    }
  );

  if (!res.success || !res.data) {
    const errorMsg = res.error || 'Falha ao atualizar registro. Tente novamente.';
    throw new Error(errorMsg);
  }

  if (user && res.data.data) {
    try {
      localStorage.setItem(`fin_local_${user.uid}_${monthYear}`, JSON.stringify(res.data.data));
    } catch {}
  }

  return res.data;
}

/**
 * Explicitly delete a financial record from Supabase & cloud backend
 */
export async function deleteFinancialItem(
  monthYear: string,
  type: 'rendas' | 'despesas' | 'economias',
  itemId: number
): Promise<{ confirmed: boolean; data: MonthlyFinancialData }> {
  const user = getActiveUser();

  // Optimistically remove from local cache immediately
  if (user) {
    const cacheKey = `fin_local_${user.uid}_${monthYear}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed[type])) {
          parsed[type] = parsed[type].filter(
            (i: any) => String(i.id) !== String(itemId) && Number(i.id) !== Number(itemId)
          );
          localStorage.setItem(cacheKey, JSON.stringify(parsed));
        }
      }
    } catch {}
  }

  const res = await safeApiCall<{ data: MonthlyFinancialData }>(
    `/api/financial/${monthYear}/item/${type}/${itemId}`,
    {
      method: 'DELETE',
    }
  );

  if (!res.success || !res.data) {
    const errorMsg = res.error || 'Falha ao excluir registro. Tente novamente.';
    throw new Error(errorMsg);
  }

  const confirmedData: MonthlyFinancialData = res.data.data || {
    rendas: [],
    despesas: [],
    economias: [],
  };

  if (user) {
    try {
      localStorage.setItem(`fin_local_${user.uid}_${monthYear}`, JSON.stringify(confirmedData));
    } catch {}
  }

  return {
    confirmed: true,
    data: confirmedData,
  };
}

/**
 * Load financial data for a specific period (e.g. "09_2026")
 * Supabase is the primary source of truth.
 */
export async function loadMonthlyFinancialData(
  userId: string,
  monthYear: string
): Promise<{ data: MonthlyFinancialData; source: 'supabase' | 'cloud' | 'cache' }> {
  try {
    const response = await cloudFetch<{
      data: MonthlyFinancialData;
      source: string;
    }>(`/api/financial/${monthYear}`);

    if (response && response.data) {
      const serverData = response.data;
      const cleanData: MonthlyFinancialData = {
        rendas: Array.isArray(serverData.rendas) ? serverData.rendas : [],
        despesas: Array.isArray(serverData.despesas) ? serverData.despesas : [],
        economias: Array.isArray(serverData.economias) ? serverData.economias : [],
      };

      try {
        localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(cleanData));
      } catch {}

      return {
        data: cleanData,
        source: response.source === 'supabase' ? 'supabase' : 'cloud',
      };
    }
  } catch (err) {
    console.warn('Network error loading data from cloud:', err);
  }

  // Fallback to local cache only if offline
  try {
    const cached = localStorage.getItem(`fin_local_${userId}_${monthYear}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      return {
        data: {
          rendas: Array.isArray(parsed.rendas) ? parsed.rendas : [],
          despesas: Array.isArray(parsed.despesas) ? parsed.despesas : [],
          economias: Array.isArray(parsed.economias) ? parsed.economias : [],
        },
        source: 'cache',
      };
    }
  } catch {}

  return {
    data: { ...DEFAULT_FINANCIAL_DATA },
    source: 'cloud',
  };
}

/**
 * Save monthly financial data snapshot to cloud server and Supabase
 * Used primarily for batch updates or drag-and-drop reordering.
 */
export async function saveMonthlyFinancialData(
  userId: string,
  monthYear: string,
  data: MonthlyFinancialData
): Promise<MonthlyFinancialData> {
  try {
    const res = await cloudFetch<{ data: MonthlyFinancialData; supabaseSynced: boolean }>(
      `/api/financial/${monthYear}`,
      {
        method: 'POST',
        body: JSON.stringify({
          rendas: data.rendas || [],
          despesas: data.despesas || [],
          economias: data.economias || [],
        }),
      }
    );

    if (res && res.data) {
      try {
        localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(res.data));
      } catch {}
      return res.data;
    }
  } catch (err) {
    console.warn('Could not persist monthly snapshot:', err);
  }

  return data;
}

/**
 * Check Supabase Cloud status and get table creation script
 */
export async function fetchSupabaseCloudStatus(): Promise<{
  connected: boolean;
  tablesExist: boolean;
  project: string;
  message: string;
  sql: string;
} | null> {
  try {
    return await cloudFetch<any>('/api/supabase/status');
  } catch {
    return null;
  }
}

/**
 * Safe local data migration
 * Only runs if the user has legacy unmigrated local items.
 * Never overwrites existing cloud data.
 */
export async function migrateLocalDataToCloud(userId: string): Promise<number> {
  const migrationFlag = `fin_migrated_v3_${userId}`;
  if (localStorage.getItem(migrationFlag)) {
    return 0;
  }

  let count = 0;
  try {
    const localMonths: Record<string, MonthlyFinancialData> = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      let monthYear = '';
      if (key.startsWith(`fin_local_${userId}_`)) {
        monthYear = key.replace(`fin_local_${userId}_`, '');
      } else if (key.startsWith('financas_')) {
        monthYear = key.replace('financas_', '');
      }

      if (monthYear && /^\d{2}_\d{4}$/.test(monthYear)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && (parsed.rendas?.length || parsed.despesas?.length || parsed.economias?.length)) {
              localMonths[monthYear] = parsed;
              count++;
            }
          }
        } catch {}
      }
    }

    if (Object.keys(localMonths).length > 0) {
      await cloudFetch('/api/supabase/migrate', {
        method: 'POST',
        body: JSON.stringify({ data: localMonths }),
      });
    }

    localStorage.setItem(migrationFlag, 'true');
  } catch (err) {
    console.warn('Error during local to cloud migration:', err);
  }
  return count;
}
