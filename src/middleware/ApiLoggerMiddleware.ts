/**
 * API Logger Middleware
 * Logs HTTP access via pino-http to api-access.log
 */
import { Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { apiAccessLogger } from '../config/logger';
import { formatIST } from '../utils/DateFormatter';

export const apiLoggerMiddleware = pinoHttp({
   logger: apiAccessLogger,
   customSuccessMessage: (req: Request, res: Response) => {
      const host = req.headers.host || req.ip || 'unknown';
      const api = req.originalUrl || req.url || 'unknown';
      const statusCode = res.statusCode || 200;
      const dateTimeIST = formatIST();
      return `${host}:${api}:${statusCode}:${dateTimeIST}`;
   },
   customErrorMessage: (req: Request, res: Response, _error: Error) => {
      const host = req.headers.host || req.ip || 'unknown';
      const api = req.originalUrl || req.url || 'unknown';
      const statusCode = res.statusCode || 500;
      const dateTimeIST = formatIST();
      return `${host}:${api}:${statusCode}:${dateTimeIST}`;
   },
   customAttributeKeys: {
      req: 'request',
      res: 'response',
      err: 'error',
      responseTime: 'responseTime',
   },
   serializers: {
      req: (req: Request) => ({
         id: req.id,
         method: req.method,
         url: req.url,
         query: req.query,
         params: req.params,
         remoteAddress: req.socket?.remoteAddress,
         remotePort: req.socket?.remotePort,
      }),
      res: (res: Response) => ({
         statusCode: res.statusCode,
      }),
   },
});
