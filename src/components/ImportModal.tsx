import React, { useState, useEffect } from 'react';
import { 
  Download, 
  Clipboard, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Sparkles, 
  RotateCcw,
  ArrowRight,
  Database,
  Layers
} from 'lucide-react';
import { 
  parseImportedFinancialData, 
  findLegacyBrowserData,
  type ParseResult 
} from '../lib/dataSync';
import type { MonthlyFinancialData } from '../types/finance';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: MonthlyFinancialData, period?: string) => void;
  currentMonth: string;
  currentYear: string;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  currentMonth,
  currentYear,
}) => {
  const [inputText, setInputText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [legacyBackups, setLegacyBackups] = useState<Array<{
    key: string;
    label: string;
    data: MonthlyFinancialData;
    totalItens: number;
  }>>([]);
  const [copiedNotice, setCopiedNotice] = useState(false);

  // Scan local storage on mount / open
  useEffect(() => {
    if (isOpen) {
      const found = findLegacyBrowserData();
      setLegacyBackups(found);
    }
  }, [isOpen]);

  // Parse as user types or pastes
  useEffect(() => {
    if (!inputText.trim()) {
      setParseResult(null);
      return;
    }

    const res = parseImportedFinancialData(inputText);
    setParseResult(res);
  }, [inputText]);

  if (!isOpen) return null;

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInputText(text);
        setCopiedNotice(true);
        setTimeout(() => setCopiedNotice(false), 2000);
      }
    } catch {
      // If permission denied, user will paste manually
    }
  };

  const handleConfirmImport = () => {
    if (parseResult && parseResult.success && parseResult.data) {
      onImport(parseResult.data, parseResult.period);
      setInputText('');
      onClose();
    }
  };

  const handleImportLegacy = (data: MonthlyFinancialData, label: string) => {
    onImport(data);
    onClose();
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100">
        
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>Assistente para Carregar Dados</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Universal
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Carregue dados da versão anterior, backup do WhatsApp ou JSON
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
          
          {/* Detected Local Backups in Browser */}
          {legacyBackups.length > 0 && (
            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 space-y-2.5">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                <Database className="w-4 h-4 shrink-0" />
                <span>Encontramos dados da versão anterior salvos neste navegador!</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Identificamos registros financeiros já gravados no seu dispositivo. Você pode restaurá-los diretamente com 1 clique:
              </p>
              <div className="space-y-2 pt-1">
                {legacyBackups.map((b) => (
                  <div 
                    key={b.key} 
                    className="flex items-center justify-between bg-slate-900/80 p-2.5 rounded-xl border border-emerald-500/20 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-white">{b.label}</span>
                      <span className="text-[11px] text-slate-400 ml-2">({b.totalItens} itens)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleImportLegacy(b.data, b.label)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition-all cursor-pointer flex items-center gap-1 active:scale-95"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Restaurar Agora</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Paste Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>Cole o Código ou Mensagem Copiada</span>
              </label>

              <button
                type="button"
                onClick={handlePasteClipboard}
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1.5 bg-blue-950/50 hover:bg-blue-900/50 px-2.5 py-1 rounded-lg border border-blue-800/60 transition-colors cursor-pointer"
              >
                <Clipboard className="w-3.5 h-3.5" />
                <span>{copiedNotice ? 'Colado!' : 'Colar da Área de Transferência'}</span>
              </button>
            </div>

            <textarea
              rows={4}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Cole aqui: código [DADOS_INICIO], mensagem inteira do WhatsApp, JSON da versão antiga ou lista de itens..."
              className="w-full bg-slate-950/80 border border-slate-700 rounded-2xl p-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono transition-all resize-y"
            />
          </div>

          {/* Real-Time Detection Result */}
          {parseResult && parseResult.success && parseResult.summary && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Dados Identificados com Sucesso!</span>
                </span>
                {parseResult.period && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Período: {parseResult.period}
                  </span>
                )}
              </div>

              {/* Grid of detected items */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <span className="block text-[10px] text-slate-400 uppercase font-semibold">Rendas</span>
                  <span className="text-sm font-bold text-emerald-400">{parseResult.summary.rendasCount} itens</span>
                  <span className="block text-[10px] text-slate-300">{formatCurrency(parseResult.summary.rendasTotal)}</span>
                </div>

                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <span className="block text-[10px] text-slate-400 uppercase font-semibold">Despesas</span>
                  <span className="text-sm font-bold text-red-400">{parseResult.summary.despesasCount} itens</span>
                  <span className="block text-[10px] text-slate-300">{formatCurrency(parseResult.summary.despesasTotal)}</span>
                </div>

                <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                  <span className="block text-[10px] text-slate-400 uppercase font-semibold">Economias</span>
                  <span className="text-sm font-bold text-blue-400">{parseResult.summary.economiasCount} itens</span>
                  <span className="block text-[10px] text-slate-300">{formatCurrency(parseResult.summary.economiasTotal)}</span>
                </div>
              </div>

              <p className="text-[11px] text-slate-300 text-center font-medium">
                Total de <strong>{parseResult.summary.totalItens} itens</strong> prontos para serem inseridos no mês selecionado ({currentMonth}/{currentYear}).
              </p>
            </div>
          )}

          {/* Error notice if user typed something invalid */}
          {parseResult && !parseResult.success && inputText.trim().length > 5 && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold block">{parseResult.error}</span>
                <span className="text-[11px] text-amber-200/80 block">
                  Certifique-se de copiar o texto por completo. Se tiver copiado pelo WhatsApp, pode colar todo o texto da mensagem aqui.
                </span>
              </div>
            </div>
          )}

          {/* Quick Guidance */}
          <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
            <span className="font-semibold text-slate-300 block">💡 Formatos aceitos:</span>
            <ul className="list-disc list-inside space-y-0.5 text-slate-400">
              <li>Mensagem completa exportada para o WhatsApp (com ou sem [DADOS_INICIO]).</li>
              <li>Código Base64 gerado pelo aplicativo.</li>
              <li>JSON da versão anterior (com rendas/despesas/economias ou receitas/gastos).</li>
              <li>Resumo em texto corrido (ex: "Salário: R$ 4.000,00").</li>
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={!parseResult || !parseResult.success}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer flex items-center gap-2"
          >
            <span>Carregar Dados</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
