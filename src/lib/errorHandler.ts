/**
 * Centralized Error Normalizer & Formatter
 * 
 * Guarantees that users NEVER receive:
 * - "[object Object]"
 * - "Unexpected token 'T', "The page "... is not valid JSON"
 * - Raw stack traces or internal server error dumps
 * - HTML proxy / 502 / 503 / 404 error pages
 *
 * Always produces a clean, human-friendly Portuguese message.
 */

function isUnhelpfulString(str: string): boolean {
  if (!str || typeof str !== 'string') return true;
  const trimmed = str.trim();
  if (!trimmed) return true;
  if (trimmed === '[object Object]' || trimmed.includes('[object Object]')) return true;
  if (trimmed === 'undefined' || trimmed === 'null') return true;

  // JSON SyntaxErrors
  if (
    trimmed.includes('Unexpected token') ||
    trimmed.includes('is not valid JSON') ||
    trimmed.includes('JSON.parse') ||
    trimmed.includes('SyntaxError')
  ) {
    return true;
  }

  // HTML / Proxy / Gateway error dumps
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('The page cannot') ||
    trimmed.includes('The page could not') ||
    trimmed.includes('502 Bad Gateway') ||
    trimmed.includes('503 Service Unavailable') ||
    trimmed.includes('504 Gateway')
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts and sanitizes any candidate string
 */
function sanitizeCandidate(candidate: unknown): string | null {
  if (candidate === null || candidate === undefined) return null;

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!isUnhelpfulString(trimmed)) {
      return trimmed;
    }

    // Try parsing if candidate was a JSON string like '{"message":"Conta não encontrada"}'
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        const extracted = extractErrorMessage(parsed, '');
        if (extracted && !isUnhelpfulString(extracted)) {
          return extracted;
        }
      } catch {
        // ignore parse error
      }
    }
    return null;
  }

  if (typeof candidate === 'number' || typeof candidate === 'boolean') {
    return String(candidate);
  }

  return null;
}

/**
 * Main safe error extraction function
 */
export function extractErrorMessage(err: unknown, fallback = 'Ocorreu um erro ao processar. Tente novamente.'): string {
  if (err === null || err === undefined) {
    return fallback;
  }

  // 1. Direct string
  if (typeof err === 'string') {
    const res = sanitizeCandidate(err);
    if (res) return res;

    // Known common HTML error patterns
    if (err.includes('The page cannot') || err.includes('Unexpected token')) {
      return 'Serviço temporariamente indisponível. Por favor, tente novamente em instantes.';
    }
    return fallback;
  }

  // 2. Standard JavaScript Error instances
  if (err instanceof Error) {
    // Check known fetch / network errors
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      return 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.';
    }
    if (err.name === 'AbortError') {
      return 'A operação foi cancelada. Tente novamente.';
    }

    // Check custom properties attached to Error instance (e.g., Axios / Fetch wrappers)
    const errObj = err as any;

    const fromResponse =
      sanitizeCandidate(errObj.response?.data?.message) ||
      sanitizeCandidate(errObj.response?.data?.error?.message) ||
      sanitizeCandidate(errObj.response?.data?.error) ||
      sanitizeCandidate(errObj.data?.message) ||
      sanitizeCandidate(errObj.data?.error);

    if (fromResponse) return fromResponse;

    const fromCause = errObj.cause ? extractErrorMessage(errObj.cause, '') : null;
    if (fromCause && !isUnhelpfulString(fromCause)) return fromCause;

    const fromMessage = sanitizeCandidate(err.message);
    if (fromMessage) return fromMessage;

    return fallback;
  }

  // 3. Plain Objects (API responses, GIS callbacks, custom rejections)
  if (typeof err === 'object') {
    const obj = err as Record<string, any>;

    // Handle Google GIS specific error codes
    if (obj.error === 'idpiframe_initialization_failed') {
      return 'O navegador restringiu cookies no ambiente. Utilize a opção de informar seu e-mail Google.';
    }
    if (obj.error === 'popup_closed_by_user') {
      return 'A janela de autenticação foi fechada antes de concluir.';
    }
    if (obj.error === 'access_denied') {
      return 'Acesso não concedido pela conta Google.';
    }

    // Check nested response structures
    const candidate =
      sanitizeCandidate(obj.response?.data?.message) ||
      sanitizeCandidate(obj.response?.data?.error?.message) ||
      sanitizeCandidate(obj.response?.data?.error) ||
      sanitizeCandidate(obj.message) ||
      sanitizeCandidate(obj.error?.message) ||
      sanitizeCandidate(obj.error) ||
      sanitizeCandidate(obj.data?.message) ||
      sanitizeCandidate(obj.data?.error) ||
      sanitizeCandidate(obj.description) ||
      sanitizeCandidate(obj.details) ||
      sanitizeCandidate(obj.detail);

    if (candidate) {
      return candidate;
    }

    // If HTTP status is provided
    if (typeof obj.status === 'number') {
      if (obj.status === 401) return 'E-mail ou senha incorretos.';
      if (obj.status === 403) return 'Acesso negado.';
      if (obj.status === 404) return 'Recurso não encontrado.';
      if (obj.status === 409) return 'Este e-mail já está cadastrado.';
      if (obj.status === 429) return 'Muitas tentativas sem sucesso. Aguarde 5 minutos.';
      if (obj.status >= 500) return 'Servidor temporariamente indisponível. Tente novamente.';
    }
  }

  return fallback;
}
