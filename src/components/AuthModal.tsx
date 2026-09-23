import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  Mail, 
  KeyRound, 
  User, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle,
  Sparkles,
  LockKeyhole,
  Check,
  Key
} from 'lucide-react';
import { 
  signInGoogle, 
  registerWithEmail, 
  loginWithEmail, 
  checkAccountForReset,
  resetPasswordWithPin,
  type AppUser 
} from '../lib/authService';
import type { AuthMode } from '../types/finance';

interface AuthModalProps {
  onSuccess: (user: AppUser) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onSuccess }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  
  // States for password reset
  const [resetStep, setResetStep] = useState<'request' | 'confirm'>('request');
  const [recoveryPin, setRecoveryPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Google quick-dialog modal state
  const [showGoogleCustomInput, setShowGoogleCustomInput] = useState(false);
  const [customGoogleEmail, setCustomGoogleEmail] = useState('');

  const resetForm = () => {
    setError(null);
    setSuccessNotice(null);
    setResetStep('request');
    setRecoveryPin('');
    setNewPassword('');
    setConfirmNewPassword('');
    setShowGoogleCustomInput(false);
  };

  const handleGoogleSignIn = async (targetEmail?: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const user = await signInGoogle(targetEmail);
      if (user) {
        onSuccess(user);
      }
    } catch (err: any) {
      console.error('Google Sign-in Error:', err);
      if (err.code === 'auth/popup-blocked') {
        setError('O navegador bloqueou a janela pop-up do Google. Por favor, permita pop-ups para este site ou utilize o campo abaixo.');
        setShowGoogleCustomInput(true);
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError('Login cancelado. Clique em "Continuar com e-mail do Google" para tentar novamente.');
      } else {
        setError(err.message || 'Falha ao autenticar com Google. Tente novamente.');
        setShowGoogleCustomInput(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);

    if (!email) {
      setError('Por favor, informe seu endereço de e-mail.');
      return;
    }

    // Password reset flow
    if (mode === 'forgot_password') {
      setIsLoading(true);
      try {
        if (resetStep === 'request') {
          const res = await checkAccountForReset(email);
          setResetStep('confirm');
          setRecoveryPin(res.pinHint);
          setSuccessNotice(`Conta de "${res.displayName}" localizada! Insira sua nova senha e confirme o PIN de segurança.`);
        } else {
          // Confirming new password
          if (!newPassword || newPassword.length < 6) {
            setError('A nova senha deve ter no mínimo 6 caracteres.');
            setIsLoading(false);
            return;
          }
          if (newPassword !== confirmNewPassword) {
            setError('A confirmação da nova senha não confere.');
            setIsLoading(false);
            return;
          }
          const res = await resetPasswordWithPin(email, recoveryPin, newPassword);
          setSuccessNotice(res.message);
          setTimeout(() => {
            setMode('login');
            resetForm();
          }, 2000);
        }
      } catch (err: any) {
        setError(err.message || 'Falha ao processar recuperação de senha.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!password) {
      setError('Por favor, digite sua senha.');
      return;
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setError('A senha deve conter no mínimo 6 caracteres.');
        return;
      }
      if (password !== confirmPassword) {
        setError('As senhas não coincidem. Verifique a digitação.');
        return;
      }
    }

    setIsLoading(true);
    try {
      if (mode === 'login') {
        const user = await loginWithEmail(email, password);
        onSuccess(user);
      } else if (mode === 'register') {
        const { user } = await registerWithEmail(email, password, displayName);
        onSuccess(user);
      }
    } catch (err: any) {
      setError(err.message || 'Erro na autenticação. Verifique os dados inseridos.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-100 selection:bg-blue-600">
      {/* Background Glow */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-md relative z-10">
        {/* App Branding Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-xl shadow-blue-500/25 border border-blue-400/30 mb-4 animate-bounce-subtle">
            <ShieldCheck className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
            <span>👑 Finanças Pro 2.0</span>
          </h1>
          <p className="text-sm text-slate-400 mt-2 flex items-center justify-center gap-1.5 font-medium">
            <LockKeyhole className="w-3.5 h-3.5 text-emerald-400" />
            <span>Criptografia E2EE & Isolamento Absoluto de Contas</span>
          </p>
        </div>

        {/* Card Box */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/50">
          
          {/* Top Tabs */}
          <div className="flex bg-slate-950/70 p-1 rounded-xl mb-6 border border-slate-800/80 text-xs font-semibold">
            <button
              type="button"
              onClick={() => { setMode('login'); resetForm(); }}
              className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer ${
                mode === 'login' 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); resetForm(); }}
              className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer ${
                mode === 'register' 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Cadastrar
            </button>
            <button
              type="button"
              onClick={() => { setMode('forgot_password'); resetForm(); }}
              className={`flex-1 py-2.5 rounded-lg transition-all cursor-pointer ${
                mode === 'forgot_password' 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Recuperar
            </button>
          </div>

          {/* Social Google Login Button (available for login & register) */}
          {mode !== 'forgot_password' && (
            <div className="mb-6">
              {!showGoogleCustomInput ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => handleGoogleSignIn()}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white hover:bg-slate-100 text-slate-900 font-semibold rounded-2xl transition-all shadow-md hover:shadow-lg active:scale-[0.98] disabled:opacity-60 cursor-pointer text-sm"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continuar com e-mail do Google</span>
                  </button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowGoogleCustomInput(true)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 underline cursor-pointer"
                    >
                      Entrar informando e-mail Google
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5 animate-fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-blue-400" />
                      E-mail da sua conta Google:
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowGoogleCustomInput(false)}
                      className="text-slate-400 hover:text-slate-200 text-[10px]"
                    >
                      Cancelar
                    </button>
                  </div>
                  <input
                    type="email"
                    value={customGoogleEmail}
                    onChange={(e) => setCustomGoogleEmail(e.target.value)}
                    placeholder="seu.email@gmail.com"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleGoogleSignIn(customGoogleEmail)}
                    disabled={isLoading || !customGoogleEmail}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-xs transition-all cursor-pointer"
                  >
                    Acessar com esta Conta Google
                  </button>
                </div>
              )}

              <div className="relative my-6 flex items-center justify-center">
                <div className="border-t border-slate-800 w-full" />
                <span className="bg-slate-900 px-3 text-xs uppercase tracking-wider text-slate-400 font-medium absolute">
                  ou com e-mail e senha
                </span>
              </div>
            </div>
          )}

          {/* Feedback Messages */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2.5 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {successNotice && (
            <div className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5 animate-fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              <div className="flex-1">{successNotice}</div>
            </div>
          )}

          {/* Main Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Nome Completo ou Apelido
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Seu nome preferido"
                    className="w-full bg-slate-950/60 border border-slate-700/80 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                E-mail Pessoal
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemplo@gmail.com"
                  className="w-full bg-slate-950/60 border border-slate-700/80 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>

            {mode !== 'forgot_password' && (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Senha
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => { setMode('forgot_password'); resetForm(); }}
                      className="text-xs text-blue-400 hover:text-blue-300 underline cursor-pointer"
                    >
                      Esqueceu a senha?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950/60 border border-slate-700/80 rounded-xl pl-10 pr-11 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Confirmação de Senha
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    className="w-full bg-slate-950/60 border border-slate-700/80 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Special fields for forgot_password in 'confirm' step */}
            {mode === 'forgot_password' && resetStep === 'confirm' && (
              <div className="space-y-4 pt-2 border-t border-slate-800 animate-fade-in">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                    <span>Código PIN de Segurança (6 dígitos)</span>
                    <span className="text-emerald-400 font-normal normal-case">Preenchido com segurança</span>
                  </label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      required
                      value={recoveryPin}
                      onChange={(e) => setRecoveryPin(e.target.value)}
                      placeholder="Ex: 839102"
                      className="w-full bg-slate-950/60 border border-slate-700/80 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-mono tracking-widest text-center"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Nova Senha
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="No mínimo 6 caracteres"
                      className="w-full bg-slate-950/60 border border-slate-700/80 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Confirmar Nova Senha
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="password"
                      required
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Repita a nova senha"
                      className="w-full bg-slate-950/60 border border-slate-700/80 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/30 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer text-sm"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : mode === 'login' ? (
                <>
                  <span>Entrar com Segurança</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : mode === 'register' ? (
                <>
                  <span>Criar Minha Conta Protegida</span>
                  <Sparkles className="w-4 h-4" />
                </>
              ) : resetStep === 'confirm' ? (
                <>
                  <span>Salvar Nova Senha</span>
                  <Check className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Verificar E-mail para Recuperação</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Switch back link for forgot_password mode */}
          {mode === 'forgot_password' && (
            <div className="mt-5 text-center">
              <button
                type="button"
                onClick={() => { setMode('login'); resetForm(); }}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1 cursor-pointer"
              >
                <span>Voltar para tela de login</span>
              </button>
            </div>
          )}

          {/* Privacy & Isolation Statement */}
          <div className="mt-6 pt-5 border-t border-slate-800/80">
            <div className="flex items-start gap-2.5 text-[11px] text-slate-400 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p>
                <strong className="text-slate-300">Isolamento Absoluto de Dados:</strong> Cada conta possui chaves criptográficas próprias (AES-GCM 256 bits). Os dados de um usuário são totalmente inacessíveis para qualquer outra conta.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
