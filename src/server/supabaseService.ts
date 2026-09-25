import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { MonthlyFinancialData, FinancialItem } from '../types/finance';

// Supabase project credentials provided by the user
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fkraewrrjbagkzxjrxmw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_IAB4-aHqYr3PGeBZLXc0Sw_LG_PhlFO';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export const SQL_SETUP_SCRIPT = `-- ==========================================
-- ESTRUTURA OFICIAL DO BANCO SUPABASE
-- Execute este script no SQL Editor do Supabase
-- (Painel do Supabase -> SQL Editor -> New Query -> Run)
-- ==========================================

-- 1. Tabela para dados mensais consolidados
CREATE TABLE IF NOT EXISTS public.monthly_data (
    user_id TEXT NOT NULL,
    month_year TEXT NOT NULL,
    rendas JSONB DEFAULT '[]'::jsonb,
    despesas JSONB DEFAULT '[]'::jsonb,
    economias JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, month_year)
);

-- 2. Tabela para registros detalhados (despesas, rendas, economias)
CREATE TABLE IF NOT EXISTS public.financial_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    month_year TEXT NOT NULL,
    type TEXT NOT NULL, -- 'despesas' | 'rendas' | 'economias'
    nome TEXT NOT NULL,
    valor NUMERIC NOT NULL,
    status TEXT, -- 'Pendente' | 'Pago'
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para alta performance de consulta
CREATE INDEX IF NOT EXISTS idx_records_user_period ON public.financial_records(user_id, month_year);
CREATE INDEX IF NOT EXISTS idx_monthly_user_period ON public.monthly_data(user_id, month_year);

-- 3. Habilita Row Level Security (RLS)
ALTER TABLE public.monthly_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_records ENABLE ROW LEVEL SECURITY;

-- 4. Políticas seguras de acesso para o Backend e API
DROP POLICY IF EXISTS "allow_all_monthly_data" ON public.monthly_data;
CREATE POLICY "allow_all_monthly_data" ON public.monthly_data
    FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_financial_records" ON public.financial_records;
CREATE POLICY "allow_all_financial_records" ON public.financial_records
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 5. Habilita Realtime no Supabase para sincronização instantânea
ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.monthly_data;

-- Garante que UPDATE e DELETE incluam todas as colunas antigas nos eventos Realtime
ALTER TABLE public.financial_records REPLICA IDENTITY FULL;
ALTER TABLE public.monthly_data REPLICA IDENTITY FULL;
`;

/**
 * Check if Supabase connection is healthy and if tables exist in the schema
 */
export async function checkSupabaseStatus(): Promise<{
  connected: boolean;
  tablesExist: boolean;
  project: string;
  message: string;
}> {
  try {
    const { data: _data, error } = await supabase
      .from('monthly_data')
      .select('user_id')
      .limit(1);

    if (!error) {
      return {
        connected: true,
        tablesExist: true,
        project: 'fkraewrrjbagkzxjrxmw',
        message: 'Conectado ao Supabase com tabelas ativas.',
      };
    }

    if (error.code === 'PGRST205') {
      return {
        connected: true,
        tablesExist: false,
        project: 'fkraewrrjbagkzxjrxmw',
        message: 'Supabase conectado, aguardando criação das tabelas no SQL Editor.',
      };
    }

    return {
      connected: false,
      tablesExist: false,
      project: 'fkraewrrjbagkzxjrxmw',
      message: error.message || 'Erro ao conectar ao Supabase.',
    };
  } catch (err: any) {
    return {
      connected: false,
      tablesExist: false,
      project: 'fkraewrrjbagkzxjrxmw',
      message: err.message || 'Falha de rede ao contatar o Supabase.',
    };
  }
}

/**
 * Fetch monthly financial data for authenticated user from Supabase
 */
export async function getMonthlyDataFromSupabase(
  userId: string,
  monthYear: string
): Promise<MonthlyFinancialData | null> {
  try {
    // 1. Try to read from monthly_data
    const { data, error } = await supabase
      .from('monthly_data')
      .select('rendas, despesas, economias')
      .eq('user_id', userId)
      .eq('month_year', monthYear)
      .maybeSingle();

    if (!error && data) {
      return {
        rendas: Array.isArray(data.rendas) ? data.rendas : [],
        despesas: Array.isArray(data.despesas) ? data.despesas : [],
        economias: Array.isArray(data.economias) ? data.economias : [],
      };
    }

    // 2. Try to read from financial_records if monthly_data was empty
    const { data: records, error: recError } = await supabase
      .from('financial_records')
      .select('*')
      .eq('user_id', userId)
      .eq('month_year', monthYear)
      .order('created_at', { ascending: false });

    if (!recError && records && records.length > 0) {
      const result: MonthlyFinancialData = {
        rendas: [],
        despesas: [],
        economias: [],
      };

      for (const rec of records) {
        const idParts = rec.id.split('_');
        const numId = parseInt(idParts[idParts.length - 1], 10) || Date.now();
        const item: FinancialItem = {
          id: numId,
          nome: rec.nome,
          valor: Number(rec.valor) || 0,
          status: rec.status || undefined,
        };

        if (rec.type === 'rendas') {
          result.rendas.push(item);
        } else if (rec.type === 'economias') {
          result.economias.push(item);
        } else {
          result.despesas.push(item);
        }
      }

      return result;
    }

    return null;
  } catch (err) {
    console.warn('Supabase getMonthlyData error:', err);
    return null;
  }
}

/**
 * Save monthly financial data for authenticated user in Supabase
 */
export async function saveMonthlyDataToSupabase(
  userId: string,
  monthYear: string,
  data: MonthlyFinancialData
): Promise<boolean> {
  try {
    const now = new Date().toISOString();

    // 1. Upsert into monthly_data
    const { error: upsertErr } = await supabase
      .from('monthly_data')
      .upsert(
        {
          user_id: userId,
          month_year: monthYear,
          rendas: data.rendas || [],
          despesas: data.despesas || [],
          economias: data.economias || [],
          updated_at: now,
        },
        { onConflict: 'user_id,month_year' }
      );

    if (upsertErr && upsertErr.code !== 'PGRST205') {
      console.warn('Supabase monthly_data upsert error:', upsertErr);
    }

    // 2. Upsert individual records into financial_records
    const allItems: Array<{
      id: string;
      user_id: string;
      month_year: string;
      type: 'rendas' | 'despesas' | 'economias';
      nome: string;
      valor: number;
      status: string | null;
      updated_at: string;
    }> = [];

    (data.despesas || []).forEach((d) => {
      allItems.push({
        id: `${userId}_${monthYear}_desp_${d.id}`,
        user_id: userId,
        month_year: monthYear,
        type: 'despesas',
        nome: d.nome,
        valor: d.valor,
        status: d.status || 'Pendente',
        updated_at: now,
      });
    });

    (data.rendas || []).forEach((r) => {
      allItems.push({
        id: `${userId}_${monthYear}_rend_${r.id}`,
        user_id: userId,
        month_year: monthYear,
        type: 'rendas',
        nome: r.nome,
        valor: r.valor,
        status: null,
        updated_at: now,
      });
    });

    (data.economias || []).forEach((e) => {
      allItems.push({
        id: `${userId}_${monthYear}_econ_${e.id}`,
        user_id: userId,
        month_year: monthYear,
        type: 'economias',
        nome: e.nome,
        valor: e.valor,
        status: null,
        updated_at: now,
      });
    });

    if (allItems.length > 0) {
      const { error: recordsErr } = await supabase
        .from('financial_records')
        .upsert(allItems, { onConflict: 'id' });

      if (recordsErr && recordsErr.code !== 'PGRST205') {
        console.warn('Supabase financial_records upsert error:', recordsErr);
      }
    }

    return !upsertErr;
  } catch (err) {
    console.warn('Supabase save error:', err);
    return false;
  }
}

/**
 * Delete a specific item from Supabase
 */
export async function deleteItemFromSupabase(
  userId: string,
  monthYear: string,
  type: 'rendas' | 'despesas' | 'economias',
  itemId: number
): Promise<boolean> {
  try {
    const prefix = type === 'despesas' ? 'desp' : type === 'rendas' ? 'rend' : 'econ';
    const recordId = `${userId}_${monthYear}_${prefix}_${itemId}`;

    await supabase
      .from('financial_records')
      .delete()
      .eq('id', recordId)
      .eq('user_id', userId);

    return true;
  } catch (err) {
    console.warn('Supabase delete item error:', err);
    return false;
  }
}
