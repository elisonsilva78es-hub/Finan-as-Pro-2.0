import { cloudFetch } from './authService';
import type { MonthlyFinancialData, FinancialItem } from '../types/finance';

const DEFAULT_FINANCIAL_DATA: MonthlyFinancialData = {
  rendas: [],
  despesas: [],
  economias: [],
};

/**
 * Service to manage persistent financial data synchronized across all devices
 * with Supabase and Cloud Server as the official source of truth.
 */

// Load financial data for a specific period (e.g. "09_2026")
export async function loadMonthlyFinancialData(
  userId: string,
  monthYear: string
): Promise<{ data: MonthlyFinancialData; source: 'supabase' | 'cloud' | 'cache' }> {
  try {
    // 1. Fetch from persistent cloud / Supabase backend
    const response = await cloudFetch<{
      data: MonthlyFinancialData;
      source: string;
    }>(`/api/financial/${monthYear}`);

    if (response && response.data) {
      const serverData = response.data;
      // Ensure all arrays are present
      const cleanData: MonthlyFinancialData = {
        rendas: Array.isArray(serverData.rendas) ? serverData.rendas : [],
        despesas: Array.isArray(serverData.despesas) ? serverData.despesas : [],
        economias: Array.isArray(serverData.economias) ? serverData.economias : [],
      };

      // Update local device cache
      try {
        localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(cleanData));
      } catch {}

      return {
        data: cleanData,
        source: response.source === 'supabase' ? 'supabase' : 'cloud',
      };
    }
  } catch (err) {
    console.warn('Network error fetching from cloud, checking local cache:', err);
  }

  // 2. Fallback to local device cache if offline or server temporarily unavailable
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

// Persist financial data to cloud server and Supabase
export async function saveMonthlyFinancialData(
  userId: string,
  monthYear: string,
  data: MonthlyFinancialData
): Promise<MonthlyFinancialData> {
  // 1. Immediately update local device cache for instant UI response
  try {
    localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(data));
  } catch {}

  // 2. Persist to official cloud / Supabase backend
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
      return res.data;
    }
  } catch (err) {
    console.warn('Could not persist to cloud immediately:', err);
  }

  return data;
}

// Delete an item from the cloud and update
export async function deleteMonthlyFinancialItem(
  userId: string,
  monthYear: string,
  type: 'rendas' | 'despesas' | 'economias',
  itemId: number,
  currentData: MonthlyFinancialData
): Promise<MonthlyFinancialData> {
  // 1. Optimistically update local data
  const updatedData: MonthlyFinancialData = {
    ...currentData,
    [type]: currentData[type].filter((item) => item.id !== itemId),
  };

  try {
    localStorage.setItem(`fin_local_${userId}_${monthYear}`, JSON.stringify(updatedData));
  } catch {}

  // 2. Send delete request to backend & Supabase
  try {
    const res = await cloudFetch<{ data: MonthlyFinancialData }>(
      `/api/financial/${monthYear}/item/${type}/${itemId}`,
      {
        method: 'DELETE',
      }
    );

    if (res && res.data) {
      return res.data;
    }
  } catch (err) {
    console.warn('Could not delete from cloud server immediately:', err);
  }

  return updatedData;
}

// Check Supabase Cloud status and get table creation script
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

// Migrate any legacy or local records found in localStorage to the Cloud/Supabase
export async function migrateLocalDataToCloud(userId: string): Promise<number> {
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
  } catch (err) {
    console.warn('Error during local to cloud migration:', err);
  }
  return count;
}
