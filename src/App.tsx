import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  LogOut, 
  Moon, 
  Sun, 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  PiggyBank, 
  Share2, 
  Download, 
  Sparkles, 
  Check, 
  Edit2, 
  Trash2, 
  GripVertical, 
  CloudCheck, 
  RefreshCw, 
  Info,
  KeyRound,
  Copy,
  ArrowUpDown
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { 
  subscribeToAuth, 
  logoutUser,
  type AppUser 
} from './lib/authService';
import { AuthModal } from './components/AuthModal';
import { PassphraseModal } from './components/PassphraseModal';
import { ImportModal } from './components/ImportModal';
import { DataTransferModal } from './components/DataTransferModal';
import { 
  createExportPackage, 
  parseImportedFinancialData,
  findLegacyBrowserData 
} from './lib/dataSync';
import { 
  getOrCreateUserProfile, 
  initializeUserSecurity, 
  unlockUserVault, 
  saveEncryptedMonthlyData, 
  loadEncryptedMonthlyData,
  syncLocalRecordsToCloud,
  resetUserVault
} from './lib/storage';
import type { 
  FinancialItem, 
  MonthlyFinancialData, 
  UserSecurityProfile 
} from './types/finance';

export default function App() {
  // Authentication & Security state
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserSecurityProfile | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [showDataTransferModal, setShowDataTransferModal] = useState(false);
  
  // Theme & Period state
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeTab, setActiveTab] = useState<'resumo' | 'renda' | 'despesas' | 'economias'>('resumo');
  const [selectedMonth, setSelectedMonth] = useState('09');
  const [selectedYear, setSelectedYear] = useState('2026');

  // Financial Data state
  const [dados, setDados] = useState<MonthlyFinancialData>({
    rendas: [],
    despesas: [],
    economias: []
  });

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Form states
  const [inputNome, setInputNome] = useState('');
  const [inputValor, setInputValor] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [whatsappCode, setWhatsappCode] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [legacyBackupsFound, setLegacyBackupsFound] = useState<Array<{ key: string; label: string; data: MonthlyFinancialData; totalItens: number }>>([]);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Canvas ref for chart
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Check initial system theme & date
  useEffect(() => {
    const savedTheme = localStorage.getItem('fin_theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setTheme('dark');
      document.documentElement.classList.add('dark');
    } else {
      setTheme('light');
      document.documentElement.classList.remove('dark');
    }

    const today = new Date();
    const currentM = String(today.getMonth() + 1).padStart(2, '0');
    const currentY = String(today.getFullYear());
    setSelectedMonth(currentM);
    setSelectedYear(currentY);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('fin_theme', next);
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Auth listener
  useEffect(() => {
    const unsubscribe = subscribeToAuth(async (user) => {
      setAuthLoading(true);
      setCurrentUser(user);

      if (user) {
        try {
          const { profile, isNewUser: isNew } = await getOrCreateUserProfile(user);
          setUserProfile(profile);
          setIsNewUser(isNew);
          setShowPassphraseModal(true);
        } catch (err) {
          console.error('Error fetching user profile:', err);
        }
      } else {
        setCryptoKey(null);
        setUserProfile(null);
        setShowPassphraseModal(false);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Handle Passphrase Unlock
  const handlePassphraseUnlock = async (passphrase: string): Promise<boolean> => {
    if (!currentUser) return false;

    let activeProfile = userProfile;
    let shouldInitialize = isNewUser;

    if (!activeProfile && !shouldInitialize) {
      try {
        const refreshed = await getOrCreateUserProfile(currentUser);
        activeProfile = refreshed.profile;
        if (!activeProfile && refreshed.isNewUser) {
          shouldInitialize = true;
          setIsNewUser(true);
        }
      } catch {
        // fallback
      }
    }

    if (shouldInitialize || !activeProfile) {
      // Create new security setup
      const { key } = await initializeUserSecurity(currentUser, passphrase);
      setCryptoKey(key);
      setShowPassphraseModal(false);
      setIsNewUser(false);
      showToast('Cofre criptografado com chave mestra com sucesso!');
      // Sync any local records to Cloud Server
      syncLocalRecordsToCloud(currentUser.uid, key).catch(console.error);
      // Trigger celebrate confetti
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
      return true;
    } else {
      // Unlock existing
      const key = await unlockUserVault(currentUser, activeProfile, passphrase);
      if (key) {
        setCryptoKey(key);
        setShowPassphraseModal(false);
        showToast('Cofre desbloqueado com sucesso!');
        // Sync any local records to Cloud Server
        syncLocalRecordsToCloud(currentUser.uid, key).catch(console.error);
        return true;
      }
      return false;
    }
  };

  const handleResetVault = () => {
    if (!currentUser) return;
    resetUserVault(currentUser.uid);
    setUserProfile(null);
    setIsNewUser(true);
    showToast('Cofre redefinido. Crie sua nova chave mestra.');
  };

  // Fetch monthly records when period changes or vault unlocked
  const periodKey = `${selectedMonth}_${selectedYear}`;

  useEffect(() => {
    if (!currentUser || !cryptoKey) return;

    let isMounted = true;
    async function fetchData() {
      setIsSyncing(true);
      try {
        const cloudData = await loadEncryptedMonthlyData(currentUser!.uid, cryptoKey!, periodKey);
        if (isMounted) {
          if (cloudData) {
            setDados(cloudData);
            setLastSyncedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
          } else {
            // Check local fallback or blank
            const local = localStorage.getItem(`fin_local_${currentUser!.uid}_${periodKey}`);
            if (local) {
              setDados(JSON.parse(local));
            } else {
              setDados({ rendas: [], despesas: [], economias: [] });
            }
          }
        }
      } catch (err) {
        console.error('Failed to load encrypted data:', err);
      } finally {
        if (isMounted) setIsSyncing(false);
      }
    }

    fetchData();
    return () => { isMounted = false; };
  }, [currentUser, cryptoKey, periodKey]);

  // Persist encrypted data on change
  const persistData = async (newData: MonthlyFinancialData) => {
    setDados(newData);
    if (!currentUser) return;

    // Cache local encrypted fallback
    localStorage.setItem(`fin_local_${currentUser.uid}_${periodKey}`, JSON.stringify(newData));

    if (cryptoKey) {
      setIsSyncing(true);
      try {
        await saveEncryptedMonthlyData(currentUser.uid, cryptoKey, periodKey, newData);
        setLastSyncedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      } catch (err) {
        console.error('Failed to sync encrypted data to Cloud Server:', err);
      } finally {
        setIsSyncing(false);
      }
    }
  };

  // Manual Cloud Sync Trigger
  const handleManualSync = async () => {
    if (!currentUser || !cryptoKey) {
      showToast('Desbloqueie o cofre para sincronizar na nuvem.');
      return;
    }
    setIsSyncing(true);
    try {
      await saveEncryptedMonthlyData(currentUser.uid, cryptoKey, periodKey, dados);
      await syncLocalRecordsToCloud(currentUser.uid, cryptoKey);
      setLastSyncedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      showToast('☁️ Todos os registros foram salvos e sincronizados na nuvem!');
    } catch (err) {
      console.warn('Manual sync error:', err);
      showToast('Aviso ao sincronizar na nuvem. Verifique sua conexão.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Add or update item
  const handleAddItem = (type: 'rendas' | 'despesas' | 'economias') => {
    const valor = parseFloat(inputValor.replace(',', '.'));
    if (!inputNome.trim() || isNaN(valor) || valor <= 0) {
      showToast('Por favor, informe uma descrição e um valor válido.');
      return;
    }

    const nextData = { ...dados };

    if (editingId !== null) {
      const idx = nextData[type].findIndex(i => i.id === editingId);
      if (idx !== -1) {
        nextData[type][idx] = {
          ...nextData[type][idx],
          nome: inputNome.trim(),
          valor
        };
      }
      setEditingId(null);
      showToast('Item atualizado com sucesso!');
    } else {
      const newItem: FinancialItem = {
        id: Date.now(),
        nome: inputNome.trim(),
        valor,
        status: type === 'despesas' ? 'Pendente' : undefined
      };
      nextData[type] = [newItem, ...nextData[type]];
      showToast('Item adicionado e protegido na nuvem!');
    }

    setInputNome('');
    setInputValor('');
    persistData(nextData);
  };

  const startEdit = (item: FinancialItem) => {
    setInputNome(item.nome);
    setInputValor(item.valor.toString());
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setInputNome('');
    setInputValor('');
    setEditingId(null);
  };

  const deleteItem = (type: 'rendas' | 'despesas' | 'economias', id: number) => {
    const nextData = {
      ...dados,
      [type]: dados[type].filter(i => i.id !== id)
    };
    persistData(nextData);
    showToast('Item excluído com sucesso.');
  };

  const toggleStatus = (id: number) => {
    const nextDespesas = dados.despesas.map(d => {
      if (d.id === id) {
        const nextStatus = d.status === 'Pago' ? 'Pendente' : 'Pago';
        return { ...d, status: nextStatus as 'Pendente' | 'Pago' };
      }
      return d;
    });
    persistData({ ...dados, despesas: nextDespesas });
  };

  // Drag and drop for despesas
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newItems = [...dados.despesas];
    const draggedItem = newItems[draggedIndex];
    newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, draggedItem);

    setDraggedIndex(index);
    setDados({ ...dados, despesas: newItems });
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDados(prev => {
      persistData(prev);
      return prev;
    });
  };

  // Export / WhatsApp integration
  const compartilharWhatsAppDados = () => {
    const pkg = createExportPackage(dados, selectedMonth, selectedYear);
    
    // Automatically copy the formatted message to clipboard as well
    try {
      navigator.clipboard.writeText(pkg.whatsappMessage);
    } catch {
      // clipboard fallback
    }

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(pkg.whatsappMessage)}`;
    try {
      window.open(url, '_blank');
      showToast('Mensagem enviada para o WhatsApp e copiada para a área de transferência!');
    } catch {
      showToast('Código de exportação copiado para a área de transferência!');
    }
  };

  const copiarCodigoExportacao = async () => {
    const pkg = createExportPackage(dados, selectedMonth, selectedYear);
    try {
      await navigator.clipboard.writeText(pkg.code);
      showToast('✅ Código copiado! Cole no campo e clique em "Carregar Dados".');
    } catch {
      setWhatsappCode(pkg.code);
      showToast('Código inserido no campo para você carregar.');
    }
  };

  const carregarDadosWhatsApp = async (directCode?: string) => {
    let codeToParse = directCode?.trim() || whatsappCode?.trim();

    // If input is empty, try to auto-read from clipboard as a convenience
    if (!codeToParse) {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim()) {
          codeToParse = clip.trim();
          setWhatsappCode(codeToParse);
        }
      } catch {}
    }

    if (!codeToParse) {
      showToast('Por favor, cole os dados no campo e clique em "Carregar Dados".');
      setShowImportModal(true);
      return;
    }

    const result = parseImportedFinancialData(codeToParse);
    if (result.success && result.data) {
      persistData(result.data);
      setWhatsappCode('');
      confetti({ particleCount: 75, spread: 75, origin: { y: 0.7 } });
      const total = result.summary?.totalItens ?? 0;
      showToast(`✅ Sucesso! ${total} itens carregados e salvos para ${selectedMonth}/${selectedYear}!`);
    } else {
      showToast(result.error || 'Código inválido. Abrindo assistente de carregamento...');
      setShowImportModal(true);
    }
  };

  const handleImportFromModal = (importedData: MonthlyFinancialData, detectedPeriod?: string) => {
    persistData(importedData);
    confetti({ particleCount: 85, spread: 80, origin: { y: 0.7 } });
    const count = (importedData.rendas?.length || 0) + (importedData.despesas?.length || 0) + (importedData.economias?.length || 0);
    showToast(`✅ Sucesso! ${count} registros carregados com êxito!`);
  };

  // Calculations
  const totalRenda = dados.rendas.reduce((acc, curr) => acc + curr.valor, 0);
  const totalDespesas = dados.despesas.reduce((acc, curr) => acc + curr.valor, 0);
  const totalEconomias = dados.economias.reduce((acc, curr) => acc + curr.valor, 0);
  const saldo = totalRenda - totalDespesas - totalEconomias;
  const percentualGasto = totalRenda > 0 ? Math.min(100, Math.round((totalDespesas / totalRenda) * 100)) : 0;

  // Render chart on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeTab !== 'resumo') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 200;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, size, size);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.40;
    const lineWidth = 18;

    // Background track
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = theme === 'dark' ? '#334155' : '#e2e8f0';
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    if (totalRenda > 0) {
      // Despesas slice
      const despesasAngle = (totalDespesas / totalRenda) * (2 * Math.PI);
      const safeAngle = Math.min(2 * Math.PI, Math.max(0.01, despesasAngle));

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + safeAngle);
      ctx.strokeStyle = '#ef4444'; // Red
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Saldo slice if positive
      if (totalRenda > totalDespesas) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, -Math.PI / 2 + safeAngle, -Math.PI / 2 + 2 * Math.PI);
        ctx.strokeStyle = '#3b82f6'; // Blue
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
  }, [dados, activeTab, theme, totalRenda, totalDespesas]);

  // Loading screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-4">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4" />
        <h2 className="text-base font-semibold text-slate-300">Carregando ambiente seguro...</h2>
        <p className="text-xs text-slate-400 mt-1">Verificando chaves de segurança e autenticação</p>
      </div>
    );
  }

  // Not logged in -> Show Authentication View
  if (!currentUser) {
    return <AuthModal onSuccess={(user) => setCurrentUser(user)} />;
  }

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} transition-colors duration-200 pb-28 font-sans`}>
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-2.5 text-xs font-medium backdrop-blur-md animate-fade-in">
          <Info className="w-4 h-4 text-blue-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Zero-Knowledge Passphrase Modal */}
      {showPassphraseModal && (
        <PassphraseModal
          isNewUser={isNewUser}
          onUnlock={handlePassphraseUnlock}
          onResetVault={handleResetVault}
          onSignOut={() => logoutUser()}
          userEmail={currentUser.email || currentUser.displayName || 'Usuário'}
        />
      )}

      {/* Top Header */}
      <header className={`sticky top-0 z-30 border-b backdrop-blur-md ${theme === 'dark' ? 'bg-slate-900/90 border-slate-800' : 'bg-white/90 border-slate-200'} px-4 py-3.5 shadow-xs`}>
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight flex items-center gap-1.5 leading-none">
                <span>👑 Finanças Pro 2.0</span>
              </h1>
              <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <Lock className="w-3 h-3" /> E2EE Ativo
                </span>
                <span>•</span>
                <span className="truncate max-w-[130px] font-medium" title={currentUser.email || ''}>
                  {currentUser.displayName || currentUser.email?.split('@')[0]}
                </span>
              </div>
            </div>
          </div>

          {/* Controls: Data Transfer, Theme & Logout */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDataTransferModal(true)}
              className={`p-2 rounded-xl border transition-all flex items-center justify-center cursor-pointer active:scale-95 shadow-sm ${
                theme === 'dark' 
                  ? 'bg-slate-800 border-slate-700 text-blue-400 hover:bg-slate-700' 
                  : 'bg-slate-100 border-slate-200 text-blue-600 hover:bg-slate-200'
              }`}
              title="Exportar e Carregar Dados"
              aria-label="Exportar e Carregar Dados"
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className={`p-2 rounded-xl border transition-colors ${
                theme === 'dark' 
                  ? 'bg-slate-800 border-slate-700 text-yellow-400 hover:bg-slate-700' 
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
              title="Alternar Tema"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => {
                if (confirm('Deseja realmente encerrar sua sessão segura?')) {
                  logoutUser();
                }
              }}
              className="p-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
              title="Sair da Conta"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Date Selector Row */}
        <div className="max-w-md mx-auto flex items-center justify-between mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                theme === 'dark' 
                  ? 'bg-slate-800 border-slate-700 text-slate-200' 
                  : 'bg-slate-100 border-slate-200 text-slate-800'
              }`}
            >
              <option value="01">Janeiro</option>
              <option value="02">Fevereiro</option>
              <option value="03">Março</option>
              <option value="04">Abril</option>
              <option value="05">Maio</option>
              <option value="06">Junho</option>
              <option value="07">Julho</option>
              <option value="08">Agosto</option>
              <option value="09">Setembro</option>
              <option value="10">Outubro</option>
              <option value="11">Novembro</option>
              <option value="12">Dezembro</option>
            </select>

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                theme === 'dark' 
                  ? 'bg-slate-800 border-slate-700 text-slate-200' 
                  : 'bg-slate-100 border-slate-200 text-slate-800'
              }`}
            >
              <option value="2025">2025</option>
              <option value="2026">2026</option>
              <option value="2027">2027</option>
              <option value="2028">2028</option>
              <option value="2029">2029</option>
              <option value="2030">2030</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={handleManualSync}
              disabled={isSyncing}
              className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer active:scale-95"
              title="Clique para sincronizar e salvar todos os registros na nuvem agora"
            >
              {isSyncing ? (
                <span className="flex items-center gap-1 text-blue-500 animate-pulse font-semibold">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Salvando na nuvem...
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                  <CloudCheck className="w-3.5 h-3.5" /> Salvo na Nuvem {lastSyncedAt ? `(${lastSyncedAt})` : ''}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-md mx-auto p-4 space-y-4">
        
        {/* TAB 1: RESUMO */}
        {activeTab === 'resumo' && (
          <div className="space-y-4 animate-fade-in">
            {/* Doughnut Chart Card */}
            <div className={`p-6 rounded-3xl border shadow-sm text-center flex flex-col items-center justify-center relative ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="relative w-[200px] h-[200px] flex items-center justify-center">
                <canvas ref={canvasRef} className="block" />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-3xl font-black tracking-tight">{percentualGasto}%</span>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Comprometido</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-4 mt-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
                  <span>Despesas ({percentualGasto}%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
                  <span>Disponível ({Math.max(0, 100 - percentualGasto)}%)</span>
                </div>
              </div>
            </div>

            {/* Summary Metrics */}
            <div className={`p-5 rounded-3xl border shadow-sm space-y-4 ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Resumo Financeiro</h2>
              
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-normal">
                  <TrendingUp className="w-4 h-4 text-emerald-500" /> Renda Mensal Total
                </span>
                <span className="text-slate-900 dark:text-white font-bold">
                  R$ {totalRenda.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-normal">
                  <TrendingDown className="w-4 h-4 text-red-500" /> Despesas Totais
                </span>
                <span className="text-red-500 font-bold">
                  R$ {totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-normal">
                  <PiggyBank className="w-4 h-4 text-indigo-500" /> Economias Totais
                </span>
                <span className="text-indigo-500 font-bold">
                  R$ {totalEconomias.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  💵 Saldo em Dinheiro
                </span>
                <span className={`text-xl font-black ${saldo >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-500'}`}>
                  R$ {saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Privacy & E2EE Info Callout */}
            <div className={`p-4 rounded-2xl border text-xs leading-relaxed flex items-start gap-3 ${
              theme === 'dark' ? 'bg-blue-950/30 border-blue-900/50 text-blue-200' : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}>
              <Lock className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold">Privacidade Absoluta Garantida:</strong> Cada registro deste mês ({selectedMonth}/{selectedYear}) é criptografado com AES-GCM-256 e sua chave pessoal. Usuários de outras contas não possuem acesso nem visualização.
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RENDA */}
        {activeTab === 'renda' && (
          <div className="space-y-4 animate-fade-in">
            {/* Input Card */}
            <div className={`p-5 rounded-3xl border shadow-sm ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                {editingId !== null ? 'Editar Renda' : 'Registrar Renda'}
              </h2>
              <div className="space-y-3">
                <input
                  type="text"
                  value={inputNome}
                  onChange={(e) => setInputNome(e.target.value)}
                  placeholder="Fonte (ex: Salário, Freela, Vendas)"
                  className={`w-full p-3.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
                <input
                  type="number"
                  step="0.01"
                  value={inputValor}
                  onChange={(e) => setInputValor(e.target.value)}
                  placeholder="Valor (R$)"
                  className={`w-full p-3.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleAddItem('rendas')}
                    className="flex-1 py-3.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-blue-600/20 active:scale-95"
                  >
                    {editingId !== null ? 'Salvar Alterações' : 'Adicionar Renda'}
                  </button>
                  {editingId !== null && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="py-3.5 px-4 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-sm transition-all"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* List Table */}
            <div className={`p-4 rounded-3xl border shadow-sm ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Fontes de Renda</span>
                <span className="text-xs font-bold text-emerald-500">Total: R$ {totalRenda.toFixed(2)}</span>
              </div>

              {dados.rendas.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  Nenhuma renda cadastrada para {selectedMonth}/{selectedYear}.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dados.rendas.map((item) => (
                    <div key={item.id} className="py-3 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{item.nome}</p>
                        <p className="text-xs font-bold text-emerald-500">R$ {item.valor.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteItem('rendas', item.id)}
                          className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: DESPESAS */}
        {activeTab === 'despesas' && (
          <div className="space-y-4 animate-fade-in">
            {/* Input Card */}
            <div className={`p-5 rounded-3xl border shadow-sm ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                {editingId !== null ? 'Editar Despesa' : 'Registrar Despesa'}
              </h2>
              <div className="space-y-3">
                <input
                  type="text"
                  value={inputNome}
                  onChange={(e) => setInputNome(e.target.value)}
                  placeholder="Item (ex: Internet, Aluguel, Supermercado)"
                  className={`w-full p-3.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
                <input
                  type="number"
                  step="0.01"
                  value={inputValor}
                  onChange={(e) => setInputValor(e.target.value)}
                  placeholder="Valor (R$)"
                  className={`w-full p-3.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleAddItem('despesas')}
                    className="flex-1 py-3.5 px-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-red-600/20 active:scale-95"
                  >
                    {editingId !== null ? 'Salvar Alterações' : 'Adicionar Gasto'}
                  </button>
                  {editingId !== null && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="py-3.5 px-4 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-sm transition-all"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 text-center">
              💡 Pressione e arraste qualquer gasto para reorganizar a lista!
            </p>

            {/* Draggable List */}
            <div className={`p-4 rounded-3xl border shadow-sm ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Gastos do Mês</span>
                <span className="text-xs font-bold text-red-500">Total: R$ {totalDespesas.toFixed(2)}</span>
              </div>

              {dados.despesas.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  Nenhuma despesa cadastrada para {selectedMonth}/{selectedYear}.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dados.despesas.map((item, index) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                      className={`py-3 flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing transition-opacity ${
                        draggedIndex === index ? 'opacity-40 bg-blue-500/10' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <GripVertical className="w-4 h-4 text-slate-400 shrink-0 select-none" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm truncate">{item.nome}</p>
                          <p className="text-xs font-bold text-red-500">R$ {item.valor.toFixed(2)}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleStatus(item.id)}
                          className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border transition-all ${
                            item.status === 'Pago'
                              ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                              : 'bg-red-500/15 text-red-500 border-red-500/30'
                          }`}
                        >
                          {item.status || 'Pendente'}
                        </button>

                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteItem('despesas', item.id)}
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ECONOMIAS */}
        {activeTab === 'economias' && (
          <div className="space-y-4 animate-fade-in">
            {/* Input Card */}
            <div className={`p-5 rounded-3xl border shadow-sm ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                {editingId !== null ? 'Editar Economia' : 'Registrar Poupança / Investimento'}
              </h2>
              <div className="space-y-3">
                <input
                  type="text"
                  value={inputNome}
                  onChange={(e) => setInputNome(e.target.value)}
                  placeholder="Fonte (ex: Tesouro Direto, Poupança, CDB)"
                  className={`w-full p-3.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
                <input
                  type="number"
                  step="0.01"
                  value={inputValor}
                  onChange={(e) => setInputValor(e.target.value)}
                  placeholder="Valor Guardado (R$)"
                  className={`w-full p-3.5 rounded-xl border text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleAddItem('economias')}
                    className="flex-1 py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-indigo-600/20 active:scale-95"
                  >
                    {editingId !== null ? 'Salvar Alterações' : 'Salvar Economia'}
                  </button>
                  {editingId !== null && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="py-3.5 px-4 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-sm transition-all"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* List Table */}
            <div className={`p-4 rounded-3xl border shadow-sm ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Reservas Acumuladas</span>
                <span className="text-xs font-bold text-indigo-500">Total: R$ {totalEconomias.toFixed(2)}</span>
              </div>

              {dados.economias.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  Nenhuma economia registrada para {selectedMonth}/{selectedYear}.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dados.economias.map((item) => (
                    <div key={item.id} className="py-3 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{item.nome}</p>
                        <p className="text-xs font-bold text-indigo-500">R$ {item.valor.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteItem('economias', item.id)}
                          className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Sticky Navigation Bar */}
      <nav className={`fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-lg ${
        theme === 'dark' ? 'bg-slate-900/90 border-slate-800' : 'bg-white/90 border-slate-200'
      }`}>
        <div className="max-w-md mx-auto flex justify-around py-2.5 px-2">
          <button
            type="button"
            onClick={() => setActiveTab('resumo')}
            className={`flex flex-col items-center gap-1 text-[10px] font-extrabold uppercase transition-colors ${
              activeTab === 'resumo' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span>Resumo</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('renda')}
            className={`flex flex-col items-center gap-1 text-[10px] font-extrabold uppercase transition-colors ${
              activeTab === 'renda' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <TrendingUp className="w-5 h-5" />
            <span>Renda</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('despesas')}
            className={`flex flex-col items-center gap-1 text-[10px] font-extrabold uppercase transition-colors ${
              activeTab === 'despesas' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <TrendingDown className="w-5 h-5" />
            <span>Gastos</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('economias')}
            className={`flex flex-col items-center gap-1 text-[10px] font-extrabold uppercase transition-colors ${
              activeTab === 'economias' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <PiggyBank className="w-5 h-5" />
            <span>Poupança</span>
          </button>
        </div>
      </nav>

      {/* Universal Import Assistant Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportFromModal}
        currentMonth={selectedMonth}
        currentYear={selectedYear}
      />

      {/* Exportar e Carregar Dados Modal */}
      <DataTransferModal
        isOpen={showDataTransferModal}
        onClose={() => setShowDataTransferModal(false)}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        theme={theme}
        legacyBackupsFound={legacyBackupsFound}
        onShareWhatsApp={compartilharWhatsAppDados}
        onCopyCode={copiarCodigoExportacao}
        onLoadData={(code) => {
          setWhatsappCode(code);
          carregarDadosWhatsApp(code);
        }}
        onOpenAssistant={() => setShowImportModal(true)}
        onRestoreLegacy={(legacyData) => {
          persistData(legacyData);
          confetti({ particleCount: 75, spread: 70, origin: { y: 0.7 } });
          showToast('✅ Dados da versão anterior carregados com sucesso!');
        }}
      />
    </div>
  );
}
