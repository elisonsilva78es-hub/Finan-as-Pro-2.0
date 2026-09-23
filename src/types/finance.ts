export interface FinancialItem {
  id: number;
  nome: string;
  valor: number;
  status?: 'Pendente' | 'Pago';
  categoria?: string;
  data?: string;
}

export interface MonthlyFinancialData {
  rendas: FinancialItem[];
  despesas: FinancialItem[];
  economias: FinancialItem[];
}

export interface UserSecurityProfile {
  userId: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  e2eeSalt: string;
  e2eeVerificationHash: string; // Encrypted challenge string with IV embedded or packed
  e2eeIv: string;
  createdAt: string;
  updatedAt: string;
}

export type AuthMode = 'login' | 'register' | 'forgot_password';
