import pino from 'pino';
import pinoHttp from 'pino-http';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
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
  },
  customLogLevel: function (res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) return 'warn';
    if (res.statusCode >= 500 || err) return 'error';
    return 'info';
  },
});

export default logger;
