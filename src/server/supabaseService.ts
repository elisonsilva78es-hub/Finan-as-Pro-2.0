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

export const SQL_SETUP_SCRIPT = `-- ====================================================================
-- SCRIPT SQL OFICIAL DE CRIAÇÃO E CONFIGURAÇÃO DE TABELAS (SUPABASE)
-- Execute este script no SQL Editor do seu projeto Supabase:
-- (Painel do Supabase -> SQL Editor -> New Query -> Cole e clique RUN)
-- ====================================================================

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

-- 3. Índices de alta performance para busca e sincronização
CREATE INDEX IF NOT EXISTS idx_records_user_period ON public.financial_records(user_id, month_year);
CREATE INDEX IF NOT EXISTS idx_records_type ON public.financial_records(type);
CREATE INDEX IF NOT EXISTS idx_monthly_user_period ON public.monthly_data(user_id, month_year);

-- 4. Habilita Row Level Security (RLS)
ALTER TABLE public.monthly_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_records ENABLE ROW LEVEL SECURITY;

-- 5. Concede permissões essenciais para os papéis do Supabase
GRANT ALL ON TABLE public.monthly_data TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.financial_records TO postgres, anon, authenticated, service_role;

-- 6. Políticas RLS seguras e funcionais
DROP POLICY IF EXISTS "allow_all_monthly_data" ON public.monthly_data;
CREATE POLICY "allow_all_monthly_data" ON public.monthly_data
    FOR ALL
    TO anon, authenticated, service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_financial_records" ON public.financial_records;
CREATE POLICY "allow_all_financial_records" ON public.financial_records
    FOR ALL
    TO anon, authenticated, service_role
    USING (true)
    WITH CHECK (true);

-- 7. Garante que UPDATE e DELETE incluam todas as colunas antigas nos eventos Realtime
ALTER TABLE public.financial_records REPLICA IDENTITY FULL;
ALTER TABLE public.monthly_data REPLICA IDENTITY FULL;

-- 8. Ativação segura do Supabase Realtime (Idempotente: nunca gera erro caso já adicionado)
DO $$
BEGIN
  -- Garante a criação da publicação caso não exista
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  -- Adiciona financial_records sem falhar caso já faça parte da publicação
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'financial_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_records;
  END IF;

  -- Adiciona monthly_data sem falhar caso já faça parte da publicação
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'monthly_data'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.monthly_data;
  END IF;
END $$;
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
 * Prioritizes the granular financial_records table (primary source of truth)
 */
export async function getMonthlyDataFromSupabase(
  userId: string,
  monthYear: string
): Promise<MonthlyFinancialData | null> {
  try {
    // 1. First priority: Read granular financial_records
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

    // 2. Secondary fallback: Check monthly_data snapshot table
    const { data, error } = await supabase
      .from('monthly_data')
      .select('rendas, despesas, economias')
      .eq('user_id', userId)
      .eq('month_year', monthYear)
      .maybeSingle();

    if (!error && data && (data.rendas?.length || data.despesas?.length || data.economias?.length)) {
      return {
        rendas: Array.isArray(data.rendas) ? data.rendas : [],
        despesas: Array.isArray(data.despesas) ? data.despesas : [],
        economias: Array.isArray(data.economias) ? data.economias : [],
      };
    }

    return null;
  } catch (err) {
    console.warn('Supabase getMonthlyData error:', err);
    return null;
  }
}

/**
 * Insert a single verified financial record in Supabase
 */
export async function insertFinancialRecordInSupabase(
  userId: string,
  monthYear: string,
  type: 'rendas' | 'despesas' | 'economias',
  item: { id?: number; nome: string; valor: number; status?: 'Pago' | 'Pendente' }
): Promise<{ success: boolean; item?: FinancialItem; error?: string }> {
  try {
    const numId = typeof item.id === 'number' ? item.id : Date.now();
    const prefix = type === 'despesas' ? 'desp' : type === 'rendas' ? 'rend' : 'econ';
    const recordId = `${userId}_${monthYear}_${prefix}_${numId}`;
    const now = new Date().toISOString();

    const recordPayload = {
      id: recordId,
      user_id: userId,
      month_year: monthYear,
      type,
      nome: item.nome.trim(),
      valor: item.valor,
      status: type === 'despesas' ? (item.status === 'Pago' ? 'Pago' : 'Pendente') : null,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from('financial_records')
      .upsert(recordPayload, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      console.error('Supabase INSERT failed in financial_records:', error);
      return { success: false, error: error.message || 'Erro ao salvar no banco de dados.' };
    }

    const createdItem: FinancialItem = {
      id: numId,
      nome: data.nome,
      valor: Number(data.valor),
      status: data.status || undefined,
    };

    return { success: true, item: createdItem };
  } catch (err: any) {
    console.error('Supabase insert exception:', err);
    return { success: false, error: err.message || 'Falha de comunicação com o Supabase.' };
  }
}

/**
 * Update an existing financial record in Supabase
 */
export async function updateFinancialRecordInSupabase(
  userId: string,
  monthYear: string,
  type: 'rendas' | 'despesas' | 'economias',
  item: { id: number; nome: string; valor: number; status?: 'Pago' | 'Pendente' }
): Promise<{ success: boolean; item?: FinancialItem; error?: string }> {
  try {
    const prefix = type === 'despesas' ? 'desp' : type === 'rendas' ? 'rend' : 'econ';
    const recordId = `${userId}_${monthYear}_${prefix}_${item.id}`;
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('financial_records')
      .update({
        nome: item.nome.trim(),
        valor: item.valor,
        status: type === 'despesas' ? (item.status === 'Pago' ? 'Pago' : 'Pendente') : null,
        updated_at: now,
      })
      .eq('id', recordId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      console.error('Supabase UPDATE failed in financial_records:', error);
      return { success: false, error: error.message || 'Erro ao atualizar no banco de dados.' };
    }

    return {
      success: true,
      item: {
        id: item.id,
        nome: data.nome,
        valor: Number(data.valor),
        status: data.status || undefined,
      },
    };
  } catch (err: any) {
    console.error('Supabase update exception:', err);
    return { success: false, error: err.message || 'Falha de comunicação com o Supabase.' };
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

    // 1. Delete by exact composite ID
    const { error: err1 } = await supabase
      .from('financial_records')
      .delete()
      .eq('id', recordId)
      .eq('user_id', userId);

    // 2. Also delete where user, period, type match and ID ends with itemId
    const { error: err2 } = await supabase
      .from('financial_records')
      .delete()
      .eq('user_id', userId)
      .eq('month_year', monthYear)
      .eq('type', type)
      .like('id', `%_${itemId}`);

    if (err1 && err2 && err1.code !== 'PGRST205') {
      console.warn('Supabase delete item error:', err1 || err2);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('Supabase delete item exception:', err);
    return false;
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

    // 3. Remove any orphan records in financial_records that are no longer in allItems
    try {
      const { data: currentDbRecords } = await supabase
        .from('financial_records')
        .select('id')
        .eq('user_id', userId)
        .eq('month_year', monthYear);

      if (currentDbRecords && currentDbRecords.length > 0) {
        const activeIds = new Set(allItems.map(i => i.id));
        const idsToDelete = currentDbRecords
          .map(r => r.id)
          .filter(id => !activeIds.has(id));

        if (idsToDelete.length > 0) {
          await supabase
            .from('financial_records')
            .delete()
            .in('id', idsToDelete)
            .eq('user_id', userId);
        }
      }
    } catch (cleanupErr) {
      console.warn('Error cleaning up removed records in Supabase:', cleanupErr);
    }

    return !upsertErr;
  } catch (err) {
    console.warn('Supabase save error:', err);
    return false;
  }
}
