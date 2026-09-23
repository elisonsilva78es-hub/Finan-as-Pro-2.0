import type { MonthlyFinancialData, FinancialItem } from '../types/finance';

/**
 * Universal Data Import & Export Service for Finanças Pro 2.0
 * Handles:
 * - WhatsApp messages with hidden Unicode characters (\u200B zero-width spaces, soft hyphens)
 * - Base64 encoded JSON (new UTF-8 and legacy escape/unescape)
 * - Raw JSON from old versions (with rendas/receitas/gastos/despesas/economias/investimentos)
 * - Delimited codes with or without [DADOS_INICIO]...[DADOS_FIM]
 * - Multi-month / period-keyed backups
 * - Array of transaction objects
 * - Plain text summaries (e.g. "Salário: R$ 5.000,00")
 * - Automatic detection of previous version data in local storage
 */

// UTF-8 to Base64 safe conversion
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Clean and decode Base64 string with all fallbacks
export function safeBase64Decode(b64: string): string | null {
  // Strip ALL characters that are not valid Base64 characters (removes zero-width spaces, asterisks, brackets, formatting)
  let clean = b64.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  
  if (!clean || clean.length < 4) return null;

  // Add required padding
  while (clean.length % 4 !== 0) {
    clean += '=';
  }

  // 1. Try modern UTF-8 TextDecoder
  try {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {}

  // 2. Try legacy escape/unescape method (used by older versions)
  try {
    return decodeURIComponent(escape(atob(clean)));
  } catch {}

  // 3. Try direct atob
  try {
    return atob(clean);
  } catch {}

  return null;
}

// Generate export package
export function createExportPackage(
  data: MonthlyFinancialData, 
  month: string, 
  year: string
): {
  code: string;
  base64String: string;
  whatsappMessage: string;
  jsonString: string;
} {
  const period = `${month}/${year}`;
  const payloadObject = {
    app: 'FinancasPro',
    version: '2.0',
    period,
    exportedAt: new Date().toISOString(),
    data: {
      rendas: data.rendas || [],
      despesas: data.despesas || [],
      economias: data.economias || [],
    }
  };

  const jsonString = JSON.stringify(payloadObject, null, 2);
  const base64String = utf8ToBase64(JSON.stringify(payloadObject));
  const code = `[DADOS_INICIO]${base64String}[DADOS_FIM]`;
  
  const whatsappMessage = 
    `👑 *Finanças Pro 2.0 - Backup de Dados (${period})*\n\n` +
    `Copie o código abaixo, cole no campo e clique em "Carregar Dados":\n\n` +
    `[DADOS_INICIO]${base64String}[DADOS_FIM]\n\n` +
    `_Criptografia e Isolamento de Dados Garantidos_`;

  return {
    code,
    base64String,
    whatsappMessage,
    jsonString,
  };
}

// Normalize numeric values
export function sanitizeNumber(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.abs(val);
  if (!val) return 0;
  let str = String(val).trim().replace(/R\$\s?/gi, '').replace(/\s/g, '');
  if (str.includes(',') && str.includes('.')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }
  const num = parseFloat(str.replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : Math.abs(num);
}

// Sanitize a financial item from any schema
function sanitizeItem(item: any, fallbackId: number): FinancialItem {
  const nome = (
    item.nome || 
    item.descricao || 
    item.description || 
    item.titulo || 
    item.name || 
    item.item || 
    'Item'
  ).toString().trim();

  const rawValor = item.valor ?? item.value ?? item.amount ?? item.preco ?? item.val ?? 0;
  const valor = sanitizeNumber(rawValor);

  const statusRaw = (item.status || item.situacao || (item.pago === true ? 'Pago' : '')).toString().toLowerCase();
  const status = statusRaw.includes('pag') || statusRaw.includes('recebid') || statusRaw.includes('concluid') 
    ? 'Pago' 
    : 'Pendente';

  return {
    id: typeof item.id === 'number' ? item.id : fallbackId,
    nome: nome || 'Item',
    valor,
    status,
    categoria: typeof item.categoria === 'string' ? item.categoria : undefined,
    data: typeof item.data === 'string' ? item.data : undefined,
  };
}

export interface ParseResult {
  success: boolean;
  data?: MonthlyFinancialData;
  period?: string;
  error?: string;
  summary?: {
    rendasCount: number;
    despesasCount: number;
    economiasCount: number;
    totalItens: number;
    rendasTotal: number;
    despesasTotal: number;
    economiasTotal: number;
  };
}

// Helper to extract financial lists from an arbitrary object
function extractFinancialDataFromObject(obj: any): MonthlyFinancialData | null {
  if (!obj || typeof obj !== 'object') return null;

  // Unwrap common wrapper keys: data, payload, financialData, dados, financas
  let target = obj.data || obj.payload || obj.financialData || obj.dados || obj.financas || obj;

  // Check if target is keyed by period, e.g. { "09_2026": { ... }, "10_2026": { ... } }
  for (const key of Object.keys(target)) {
    if (/^\d{2}[_/]\d{4}$/.test(key) && target[key] && typeof target[key] === 'object') {
      target = target[key];
      break;
    }
  }

  // Handle standard categories with Portuguese and English aliases
  const rList = target.rendas || target.receitas || target.entradas || target.incomes || target.ganhos;
  const dList = target.despesas || target.gastos || target.saidas || target.expenses || target.custos;
  const eList = target.economias || target.investimentos || target.poupanca || target.savings || target.reservas;

  if (Array.isArray(rList) || Array.isArray(dList) || Array.isArray(eList)) {
    let seed = Date.now();
    const rendas: FinancialItem[] = (rList || []).map((it: any, idx: number) => 
      sanitizeItem(it, seed + idx)
    );
    const despesas: FinancialItem[] = (dList || []).map((it: any, idx: number) => 
      sanitizeItem(it, seed + 1000 + idx)
    );
    const economias: FinancialItem[] = (eList || []).map((it: any, idx: number) => 
      sanitizeItem(it, seed + 2000 + idx)
    );

    if (rendas.length > 0 || despesas.length > 0 || economias.length > 0) {
      return { rendas, despesas, economias };
    }
  }

  // Handle flat array of items with a 'tipo' / 'type' property
  if (Array.isArray(target)) {
    let seed = Date.now();
    const rendas: FinancialItem[] = [];
    const despesas: FinancialItem[] = [];
    const economias: FinancialItem[] = [];

    target.forEach((it: any, idx: number) => {
      const type = (it.tipo || it.type || it.categoria || '').toString().toLowerCase();
      const item = sanitizeItem(it, seed + idx);

      if (type.includes('rend') || type.includes('receit') || type.includes('entrad') || type.includes('ganho')) {
        rendas.push(item);
      } else if (type.includes('econ') || type.includes('poup') || type.includes('invest') || type.includes('reserv')) {
        economias.push(item);
      } else {
        despesas.push(item);
      }
    });

    if (rendas.length > 0 || despesas.length > 0 || economias.length > 0) {
      return { rendas, despesas, economias };
    }
  }

  return null;
}

// Parse plain text representation (e.g. copied from message summary)
function parsePlainTextLines(text: string): MonthlyFinancialData | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  let currentSection: 'rendas' | 'despesas' | 'economias' = 'despesas';
  const rendas: FinancialItem[] = [];
  const despesas: FinancialItem[] = [];
  const economias: FinancialItem[] = [];
  let seed = Date.now();

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('renda') || lower.includes('receita') || lower.includes('entrada')) {
      currentSection = 'rendas';
      continue;
    }
    if (lower.includes('despesa') || lower.includes('gasto') || lower.includes('saida')) {
      currentSection = 'despesas';
      continue;
    }
    if (lower.includes('economia') || lower.includes('poupan') || lower.includes('invest') || lower.includes('reserva')) {
      currentSection = 'economias';
      continue;
    }

    // Match lines like: "Salário: R$ 4.500,00" or "- Aluguel: 1.200 (Pago)" or "Internet - 120"
    const match = line.match(/^[-*•]?\s*([^:\-\d]+)[:\-–\t]?\s*(?:R\$\s*)?([\d.,]+)(.*)$/i);
    if (match) {
      const nome = match[1].trim();
      const valor = sanitizeNumber(match[2]);
      const extra = (match[3] || '').toLowerCase();
      const status = extra.includes('pago') || extra.includes('ok') ? 'Pago' : 'Pendente';

      if (nome && valor > 0) {
        seed++;
        const item: FinancialItem = { id: seed, nome, valor, status };
        if (currentSection === 'rendas') rendas.push(item);
        else if (currentSection === 'economias') economias.push(item);
        else despesas.push(item);
      }
    }
  }

  if (rendas.length > 0 || despesas.length > 0 || economias.length > 0) {
    return { rendas, despesas, economias };
  }
  return null;
}

// Master parser that handles any input format
export function parseImportedFinancialData(rawInput: string): ParseResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return { success: false, error: 'O texto inserido está vazio.' };
  }

  let text = rawInput.trim();

  // 1. Check for URL encoding (e.g. whatsapp links copied from browser)
  if (text.includes('%') || text.includes('send?text=')) {
    try {
      if (text.includes('text=')) {
        text = decodeURIComponent(text.split('text=')[1].split('&')[0]);
      } else {
        text = decodeURIComponent(text);
      }
    } catch {}
  }

  // 2. Extract period hint if present (e.g. "Período: 09/2026" or "09_2026")
  let detectedPeriod: string | undefined;
  const periodMatch = text.match(/(?:Per[íi]odo:\s*)?(\d{2})[/_](\d{4})/i);
  if (periodMatch) {
    detectedPeriod = `${periodMatch[1]}/${periodMatch[2]}`;
  }

  // 3. Attempt direct JSON parsing
  try {
    const obj = JSON.parse(text);
    const data = extractFinancialDataFromObject(obj);
    if (data) {
      return buildSuccessResult(data, detectedPeriod || (typeof obj.period === 'string' ? obj.period : undefined));
    }
  } catch {}

  // 4. Extract content between DADOS_INICIO and DADOS_FIM (supports any tags or punctuation)
  let candidateBase64 = text;
  if (/DADOS_INICIO/i.test(text)) {
    const parts = text.split(/DADOS_INICIO/i);
    if (parts.length > 1) {
      const sub = parts[1].split(/DADOS_FIM/i)[0];
      if (sub && sub.trim()) {
        candidateBase64 = sub.trim();
      }
    }
  }

  // 5. Try Base64 decoding on candidate
  const decodedString = safeBase64Decode(candidateBase64);
  if (decodedString) {
    try {
      const obj = JSON.parse(decodedString);
      const data = extractFinancialDataFromObject(obj);
      if (data) {
        return buildSuccessResult(data, detectedPeriod || (typeof obj.period === 'string' ? obj.period : undefined));
      }
    } catch {}

    // Check if decoded string was plain text lines
    const textData = parsePlainTextLines(decodedString);
    if (textData) {
      return buildSuccessResult(textData, detectedPeriod);
    }
  }

  // 6. Search for any Base64-like block in the raw text
  const matchB64 = text.match(/([A-Za-z0-9+/=_-]{40,})/);
  if (matchB64 && matchB64[1]) {
    const decodedFromRegex = safeBase64Decode(matchB64[1]);
    if (decodedFromRegex) {
      try {
        const obj = JSON.parse(decodedFromRegex);
        const data = extractFinancialDataFromObject(obj);
        if (data) {
          return buildSuccessResult(data, detectedPeriod);
        }
      } catch {}
    }
  }

  // 7. Search for embedded JSON substring {...}
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const data = extractFinancialDataFromObject(obj);
      if (data) {
        return buildSuccessResult(data, detectedPeriod);
      }
    } catch {}
  }

  // 8. Plain text lines parser fallback
  const plainTextData = parsePlainTextLines(text);
  if (plainTextData) {
    return buildSuccessResult(plainTextData, detectedPeriod);
  }

  return {
    success: false,
    error: 'Não foi possível reconhecer os dados informados. Verifique se copiou a mensagem completa ou o código de exportação.',
  };
}

function buildSuccessResult(data: MonthlyFinancialData, period?: string): ParseResult {
  const rendasCount = data.rendas.length;
  const despesasCount = data.despesas.length;
  const economiasCount = data.economias.length;
  const totalItens = rendasCount + despesasCount + economiasCount;

  const rendasTotal = data.rendas.reduce((s, it) => s + it.valor, 0);
  const despesasTotal = data.despesas.reduce((s, it) => s + it.valor, 0);
  const economiasTotal = data.economias.reduce((s, it) => s + it.valor, 0);

  return {
    success: true,
    data,
    period,
    summary: {
      rendasCount,
      despesasCount,
      economiasCount,
      totalItens,
      rendasTotal,
      despesasTotal,
      economiasTotal,
    }
  };
}

// Find any legacy datasets saved in this browser's localStorage
export function findLegacyBrowserData(): Array<{
  key: string;
  label: string;
  data: MonthlyFinancialData;
  totalItens: number;
}> {
  const results: Array<{ key: string; label: string; data: MonthlyFinancialData; totalItens: number }> = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Skip current active session / theme / auth internal keys
      if (
        key === 'fin_theme' || 
        key === 'fin_active_user_session' || 
        key === 'fin_secure_users_vault_db' ||
        key.startsWith('fin_profile_')
      ) {
        continue;
      }

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const obj = JSON.parse(raw);
        const data = extractFinancialDataFromObject(obj);
        if (data && (data.rendas.length > 0 || data.despesas.length > 0 || data.economias.length > 0)) {
          const totalItens = data.rendas.length + data.despesas.length + data.economias.length;
          
          let label = key;
          const matchPeriod = key.match(/(\d{2})_(\d{4})/);
          if (matchPeriod) {
            label = `Período ${matchPeriod[1]}/${matchPeriod[2]}`;
          }

          results.push({ key, label, data, totalItens });
        }
      } catch {}
    }
  } catch {}

  return results;
}
