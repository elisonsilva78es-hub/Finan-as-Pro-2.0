import React, { useState } from 'react';
import { 
  X, 
  Share2, 
  Copy, 
  Download, 
  ArrowUpDown, 
  Sparkles, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle 
} from 'lucide-react';
import type { MonthlyFinancialData } from '../types/finance';
import { parseImportedFinancialData } from '../lib/dataSync';

interface DataTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMonth: string;
  selectedYear: string;
  theme: 'light' | 'dark';
  legacyBackupsFound: Array<{ key: string; label?: string; period?: string; totalItens: number; data: MonthlyFinancialData }>;
  onShareWhatsApp: () => void;
  onCopyCode: () => void;
  onLoadData: (code: string) => void;
  onOpenAssistant: () => void;
  onRestoreLegacy: (data: MonthlyFinancialData) => void;
}

export const DataTransferModal: React.FC<DataTransferModalProps> = ({
  isOpen,
  onClose,
  selectedMonth,
  selectedYear,
  theme,
  legacyBackupsFound,
  onShareWhatsApp,
  onCopyCode,
  onLoadData,
  onOpenAssistant,
  onRestoreLegacy,
}) => {
  const [code, setCode] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!isOpen) return null;

  const handleCarregar = () => {
    if (!code || !code.trim()) {
      setFeedback({ type: 'error', message: 'Cole o código ou mensagem no campo antes de carregar.' });
      return;
    }

    const res = parseImportedFinancialData(code);
    if (res.success && res.data) {
      onLoadData(code);
      setCode('');
      setFeedback({ type: 'success', message: `✅ ${res.summary?.totalItens ?? 0} itens carregados com sucesso!` });
      setTimeout(() => {
        setFeedback(null);
        onClose();
      }, 1200);
    } else {
      setFeedback({ type: 'error', message: res.error || 'Código não reconhecido. Use o Assistente Completo.' });
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setCode(text);
        setFeedback({ type: 'success', message: 'Texto colado da área de transferência!' });
        setTimeout(() => setFeedback(null), 2000);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Clique e segure para colar manualmente no campo.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div 
        className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all ${
          theme === 'dark' ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Modal Header */}
        <div className={`p-4 sm:p-5 border-b flex items-center justify-between ${
          theme === 'dark' ? 'border-slate-800 bg-slate-950/60' : 'border-slate-100 bg-slate-50/80'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-500">
              <ArrowUpDown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                <span>Exportar e Carregar Dados</span>
              </h3>
              <p className="text-xs text-slate-400">
                Mês de referência: <strong className="text-blue-500">{selectedMonth}/{selectedYear}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Legacy Backup Banner if detected */}
          {legacyBackupsFound.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between animate-fade-in">
              <div className="flex items-center gap-2 text-emerald-400">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span className="font-medium">
                  Detectamos {legacyBackupsFound[0].totalItens} dados anteriores salvos neste navegador!
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onRestoreLegacy(legacyBackupsFound[0].data);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all cursor-pointer shrink-0 ml-2 active:scale-95 shadow-sm"
              >
                Carregar
              </button>
            </div>
          )}

          {/* Quick Action Export Buttons */}
          <div>
            <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-400 mb-2">
              Opções de Compartilhamento e Backup
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={onShareWhatsApp}
                className="py-2.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                title="Compartilhar pelo WhatsApp"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={onCopyCode}
                className="py-2.5 px-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                title="Copiar código de backup para a área de transferência"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar Código</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAssistant();
                }}
                className="py-2.5 px-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                title="Abrir Assistente com detecção e área de transferência"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Assistente</span>
              </button>
            </div>
          </div>

          {/* Feedback */}
          {feedback && (
            <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
              feedback.type === 'success' 
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' 
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Carregar Dados Section */}
          <div className="pt-2 border-t border-slate-800/60 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] uppercase font-bold tracking-wider text-slate-400">
                Carregar Dados Colados
              </label>
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="text-[11px] text-blue-500 hover:text-blue-400 font-medium cursor-pointer underline"
              >
                Colar da Área de Transferência
              </button>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1 flex items-center">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text');
                    if (pasted) {
                      e.preventDefault();
                      setCode(pasted);
                    }
                  }}
                  placeholder="Cole aqui o código ou mensagem copiada..."
                  className={`w-full text-xs pl-3.5 pr-8 py-2.5 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
                    theme === 'dark' 
                      ? 'bg-slate-950 border-slate-700 text-white placeholder-slate-500' 
                      : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'
                  }`}
                />
                {code && (
                  <button
                    type="button"
                    onClick={() => setCode('')}
                    className="absolute right-2 text-slate-400 hover:text-white text-xs p-1 cursor-pointer"
                    title="Limpar"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleCarregar}
                className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shrink-0 active:scale-95 cursor-pointer flex items-center gap-1.5 shadow-md shadow-blue-500/20"
                title="Carregar os dados colados para a planilha"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Carregar Dados</span>
              </button>
            </div>

            <p className="text-[10px] text-slate-400">
              💡 Aceita mensagens do WhatsApp com [DADOS_INICIO], códigos Base64 ou backups em JSON.
            </p>
          </div>

          {/* Privacy Note */}
          <div className="p-3 rounded-2xl bg-slate-950/40 border border-slate-800/60 flex items-start gap-2 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p>
              Ao exportar, seus dados são empacotados com verificação de integridade. Apenas quem possuir o código poderá importar os registros.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className={`p-4 border-t flex justify-end ${
          theme === 'dark' ? 'border-slate-800 bg-slate-950/50' : 'border-slate-100 bg-slate-50'
        }`}>
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              theme === 'dark' ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
            }`}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
