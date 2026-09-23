import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Lock, AlertCircle, Sparkles, CheckCircle2 } from 'lucide-react';

interface PassphraseModalProps {
  isNewUser: boolean;
  onUnlock: (passphrase: string) => Promise<boolean>;
  onSignOut: () => void;
  userEmail: string;
}

export const PassphraseModal: React.FC<PassphraseModalProps> = ({
  isNewUser,
  onUnlock,
  onSignOut,
  userEmail,
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!passphrase || passphrase.length < 6) {
      setError('A chave mestra deve ter pelo menos 6 caracteres.');
      return;
    }

    if (isNewUser && passphrase !== confirmPassphrase) {
      setError('As chaves mestras digitadas não coincidem.');
      return;
    }

    setIsLoading(true);
    try {
      const ok = await onUnlock(passphrase);
      if (!ok) {
        setError('Chave de descriptografia incorreta. Não foi possível decifrar seus dados protegidos.');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Falha ao processar criptografia.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-slate-100 relative">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-slate-950 mb-3 shadow-lg shadow-emerald-500/20">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white">
            {isNewUser ? 'Defina sua Chave E2EE' : 'Desbloquear Cofre Criptografado'}
          </h2>
          <p className="text-xs text-slate-400 mt-2">
            Conta: <span className="font-semibold text-slate-200">{userEmail}</span>
          </p>
        </div>

        <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-4 mb-5 text-xs text-slate-300 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p>
              <strong>Criptografia Zero-Knowledge:</strong> Seus dados são criptografados no seu próprio navegador antes de irem para a nuvem. Nem mesmo os administradores do servidor conseguem ler seus gastos ou rendas.
            </p>
          </div>
          {isNewUser && (
            <p className="text-[11px] text-amber-300/90 border-t border-slate-800/80 pt-2">
              ⚠️ <strong>Importante:</strong> Guarde esta senha em local seguro. Por ser criptografia de ponta a ponta sem chave mestra no servidor, se você perder essa frase, seus dados não poderão ser recuperados.
            </p>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              {isNewUser ? 'Crie sua Chave de Criptografia' : 'Digite sua Chave Mestra'}
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPassphrase ? 'text' : 'password'}
                required
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={isNewUser ? 'Ex: Uma frase secreta ou senha forte' : 'Sua senha mestra'}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-10 pr-12 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
              >
                {showPassphrase ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </div>

          {isNewUser && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Confirmar Chave de Criptografia
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  required
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Repita a frase secreta"
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
            </div>
          )}

          <div className="pt-2 flex flex-col gap-2.5">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-2xl shadow-lg shadow-emerald-500/20 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer text-sm"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
              ) : isNewUser ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Inicializar Cofre Seguro</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Desbloquear Meus Registros</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onSignOut}
              className="w-full py-2.5 text-xs text-slate-400 hover:text-slate-200 transition-colors font-medium"
            >
              Sair desta conta / Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
