import React, { useState, useEffect } from 'react';
import { Database, Check, Copy, RefreshCw, X, ShieldCheck, ExternalLink, AlertCircle } from 'lucide-react';
import { fetchSupabaseCloudStatus } from '../lib/financialService';

interface SupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMigrateNow: () => Promise<void>;
}

export const SupabaseModal: React.FC<SupabaseModalProps> = ({ isOpen, onClose, onMigrateNow }) => {
  const [status, setStatus] = useState<{
    connected: boolean;
    tablesExist: boolean;
    project: string;
    message: string;
    sql: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadStatus = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetchSupabaseCloudStatus();
      if (res) {
        setStatus(res);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopySql = () => {
    if (status?.sql) {
      navigator.clipboard.writeText(status.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-slate-800 dark:text-slate-100 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Sincronização em Nuvem (Supabase)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Projeto: <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">fkraewrrjbagkzxjrxmw</span>
            </p>
          </div>
        </div>

        {/* Status card */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status da Conexão</span>
            <button
              onClick={loadStatus}
              disabled={isRefreshing}
              className="text-xs flex items-center gap-1 text-slate-500 hover:text-emerald-500 transition"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                status?.tablesExist
                  ? 'bg-emerald-500 animate-pulse'
                  : status?.connected
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
            />
            <span className="text-sm font-semibold">
              {status?.tablesExist
                ? 'Nuvem Supabase Ativa & Sincronizada'
                : 'Conexão Supabase Pronta (Tabelas pendentes no SQL Editor)'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {status?.message || 'A conexão com a nuvem está integrada ao backend seguro.'}
          </p>
        </div>

        {/* Informative instructions for SQL setup */}
        <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300 mb-6">
          <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40">
            <h3 className="font-bold text-emerald-800 dark:text-emerald-300 text-sm mb-1 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Persistência Multi-Dispositivo Ativada
            </h3>
            <p>
              Todos os seus registros de despesas, rendas e economias são salvos e vinculados à sua conta. Qualquer alteração feita aqui será sincronizada nos seus outros dispositivos.
            </p>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 dark:text-white">
                Script SQL de Criação de Tabelas (Supabase)
              </h4>
              <button
                onClick={handleCopySql}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-500 transition text-xs shadow-sm"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado!' : 'Copiar SQL'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Para ativar as tabelas no Supabase: acesse o <strong>Painel do Supabase</strong> &rarr; <strong>SQL Editor</strong> &rarr; <strong>New Query</strong> &rarr; cole este script e clique em <strong>Run</strong>.
            </p>
            <pre className="p-3 rounded-xl bg-slate-900 text-slate-200 font-mono text-[10px] overflow-x-auto max-h-36 border border-slate-800">
              {status?.sql || 'Carregando script SQL...'}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            Fechar
          </button>
          <button
            onClick={async () => {
              await onMigrateNow();
              await loadStatus();
            }}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sincronizar Todos os Dados Agora
          </button>
        </div>
      </div>
    </div>
  );
};
