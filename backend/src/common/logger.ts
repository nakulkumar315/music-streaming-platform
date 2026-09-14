import pino from 'pino';
import pinoHttp from 'pino-http';

const isProduction = process.env.NODE_ENV === 'production';

const SENSITIVE_QUERY_PARAM = /([?&](?:token|signature|secret|key|authorization)=)[^&\s]+/gi;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+/gi;

function sanitizeLogString(value: unknown): string {
  return String(value ?? '')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(SENSITIVE_QUERY_PARAM, '$1[REDACTED]')
    .replace(JWT_LIKE, '[REDACTED_JWT]');
}

function serializeError(value: unknown) {
  if (!value) return value;

  if (value instanceof Error) {
    return {
      type: value.name,
      message: sanitizeLogString(value.message),
      ...(isProduction ? {} : { stack: sanitizeLogString(value.stack || '') }),
    };
  }

  if (typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    const statusCandidate = Number(raw.status ?? raw.statusCode);
    return {
      type: sanitizeLogString(raw.name ?? raw.type ?? 'Error'),
      message: sanitizeLogString(raw.message ?? raw.code ?? 'Operation failed'),
      ...(raw.code !== undefined ? { code: sanitizeLogString(raw.code) } : {}),
      ...(Number.isFinite(statusCandidate) ? { status: statusCandidate } : {}),
    };
  }

  return { message: sanitizeLogString(value) };
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Defense in depth for structured log metadata. Error objects are separately
  // collapsed by serializers below so Axios/provider request configs can never
  // persist headers, signed URLs or request bodies through error logging.
  redact: {
    paths: [
      'authorization',
      'password',
      'token',
      'secret',
      'signature',
      'signedUrl',
      'playbackUrl',
      'mediaUrl',
      '*.authorization',
      '*.password',
      '*.token',
      '*.secret',
      '*.signature',
      '*.signedUrl',
      '*.playbackUrl',
      '*.mediaUrl',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: serializeError,
    error: serializeError,
  },
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

function requestPathOnly(req: { url?: string; originalUrl?: string }) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

export const httpLogger = pinoHttp({
  logger,
  serializers: {
    req: (req) => ({
      method: req.method,
      // Never log raw query strings here. Protected media URLs carry short-lived
      // security tokens in the query and request logging must not persist them.
      path: requestPathOnly(req),
      params: req.params,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-correlation-id': req.headers['x-correlation-id'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    err: serializeError,
  },
  customLogLevel: function (res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
    if (res.statusCode >= 500 || err) return 'error';
    return 'info';
  },
});

export default logger;
