/**
 * Production-safe logger utility.
 * Development logs remain useful, while production error logs are sanitized so
 * auth/payment/media credentials and signed playback URLs are never persisted.
 */

const isDev = __DEV__;
const SENSITIVE_KEY = /(?:authorization|password|passwd|token|secret|signature|signed.?url|playback.?url|media.?url|razorpay.?key|razorpay.?secret|card|cvv)/i;

function sanitizeString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|signature|secret|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : sanitize(nested, depth + 1);
    }
    return output;
  }
  return sanitizeString(String(value));
}

function sanitizedArgs(args: unknown[]) {
  return args.map((arg) => sanitize(arg));
}

export const logger = {
  log: (...args: any[]) => {
    if (isDev) console.log(...sanitizedArgs(args));
  },
  warn: (...args: any[]) => {
    if (isDev) console.warn(...sanitizedArgs(args));
  },
  error: (...args: any[]) => {
    // Keep production errors available for crash diagnostics, but never emit raw
    // request/error objects that may contain bearer tokens or signed media URLs.
    console.error(...sanitizedArgs(args));
  },
  info: (...args: any[]) => {
    if (isDev) console.info(...sanitizedArgs(args));
  },
  debug: (...args: any[]) => {
    if (isDev) console.debug(...sanitizedArgs(args));
  },
};

export default logger;
