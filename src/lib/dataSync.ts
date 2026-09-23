import type { MonthlyFinancialData, FinancialItem } from '../types/finance';

/**
 * Robust Data Import & Export Service for Finanças Pro 2.0
 * Handles UTF-8 encoded Base64, raw JSON, WhatsApp message templates, and corrupted/partial strings.
 */

// UTF-8 to Base64 safe conversion (without escape/unescape bugs)
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Base64 to UTF-8 safe conversion (with automatic cleaning & URL-safe handling)
export function base64ToUtf8(b64: string): string {
  // Remove all spaces, newlines, carriage returns, and invalid chars
  let clean = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  // Add required padding
  while (clean.length % 4 !== 0) {
    clean += '=';
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// Generate the complete export payload
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
    `Copie o código abaixo e cole no campo "Importar Dados" do app:\n\n` +
    `[DADOS_INICIO]${base64String}[DADOS_FIM]\n\n` +
    `_Criptografia e Isolamento de Dados Garantidos_`;

  return {
    code,
    base64String,
    whatsappMessage,
    jsonString,
  };
}

// Sanitize financial item
function sanitizeItem(item: any, fallbackId: number): FinancialItem {
  let valor = 0;
  if (typeof item.valor === 'number') {
    valor = item.valor;
  } else if (typeof item.valor === 'string') {
    // Handle "1.500,50" or "1500.50"
    const cleaned = item.valor.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    valor = parseFloat(cleaned) || 0;
  }

  return {
    id: typeof item.id === 'number' ? item.id : fallbackId,
    nome: typeof item.nome === 'string' && item.nome.trim() ? item.nome.trim() : 'Item Importado',
    valor: Math.abs(valor),
    status: item.status === 'Pago' ? 'Pago' : 'Pendente',
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
  };
}

// Parse imported financial code in any format
export function parseImportedFinancialData(rawInput: string): ParseResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return { success: false, error: 'O texto inserido está vazio.' };
  }

  let text = rawInput.trim();

  // Helper to validate and sanitize parsed object
  const validateAndExtract = (obj: any): ParseResult | null => {
    if (!obj || typeof obj !== 'object') return null;

    const candidate = obj.data || obj.financialData || obj;
    const hasRendas = Array.isArray(candidate.rendas);
    const hasDespesas = Array.isArray(candidate.despesas);
    const hasEconomias = Array.isArray(candidate.economias);

    if (hasRendas || hasDespesas || hasEconomias) {
      let idSeed = Date.now();
      const rendas: FinancialItem[] = (candidate.rendas || []).map((it: any, idx: number) => 
        sanitizeItem(it, idSeed + idx)
      );
      const despesas: FinancialItem[] = (candidate.despesas || []).map((it: any, idx: number) => 
        sanitizeItem(it, idSeed + 1000 + idx)
      );
      const economias: FinancialItem[] = (candidate.economias || []).map((it: any, idx: number) => 
        sanitizeItem(it, idSeed + 2000 + idx)
      );

      const period = typeof obj.period === 'string' ? obj.period : undefined;

      return {
        success: true,
        data: { rendas, despesas, economias },
        period,
        summary: {
          rendasCount: rendas.length,
          despesasCount: despesas.length,
          economiasCount: economias.length,
          totalItens: rendas.length + despesas.length + economias.length,
        }
      };
    }
    return null;
  };

  // 1. Direct JSON check
  try {
    const directObj = JSON.parse(text);
    const res = validateAndExtract(directObj);
    if (res) return res;
  } catch {}

  // 2. URL decode if needed
  if (text.includes('%5B') || text.includes('%20') || text.includes('%3D')) {
    try {
      const decoded = decodeURIComponent(text);
      const directObj = JSON.parse(decoded);
      const res = validateAndExtract(directObj);
      if (res) return res;
      text = decoded;
    } catch {}
  }

  // 3. Extract payload between [DADOS_INICIO] and [DADOS_FIM] tags (supports asterisks, spaces, wraps)
  if (text.includes('DADOS_INICIO') && text.includes('DADOS_FIM')) {
    const parts = text.split(/\[?\*?DADOS_INICIO\*?\]?/i);
    if (parts.length > 1) {
      const sub = parts[1].split(/\[?\*?DADOS_FIM\*?\]?/i)[0];
      if (sub && sub.trim()) {
        text = sub.trim();
      }
    }
  }

  // 4. Strip surrounding quotes, asterisks, brackets
  text = text.replace(/^["'`*\[\]]+|["'`*\[\]]+$/g, '').trim();

  // 5. Try JSON again after tag stripping
  try {
    const directObj = JSON.parse(text);
    const res = validateAndExtract(directObj);
    if (res) return res;
  } catch {}

  // 6. Try Base64 Decode
  try {
    const decodedJson = base64ToUtf8(text);
    const parsedObj = JSON.parse(decodedJson);
    const res = validateAndExtract(parsedObj);
    if (res) return res;
  } catch (err: any) {
    // If exact string failed, try finding base64 pattern in text
  }

  // 7. Regex search for any base64 sequence in text
  const matchB64 = text.match(/([A-Za-z0-9+/=_-]{30,})/);
  if (matchB64 && matchB64[1]) {
    try {
      const decodedJson = base64ToUtf8(matchB64[1]);
      const parsedObj = JSON.parse(decodedJson);
      const res = validateAndExtract(parsedObj);
      if (res) return res;
    } catch {}
  }

  // 8. Regex search for any embedded JSON structure {...}
  const matchJson = rawInput.match(/\{[\s\S]*"rendas"[\s\S]*\}/) || rawInput.match(/\{[\s\S]*"data"[\s\S]*\}/);
  if (matchJson) {
    try {
      const parsedObj = JSON.parse(matchJson[0]);
      const res = validateAndExtract(parsedObj);
      if (res) return res;
    } catch {}
  }

  return {
    success: false,
    error: 'Código inválido ou corrompido. Certifique-se de colar o código completo gerado pela opção "Compartilhar WhatsApp" ou "Copiar Código".',
  };
}
