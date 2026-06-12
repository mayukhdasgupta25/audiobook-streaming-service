/**
 * Pino Logger Configuration
 * File-only structured logging per component
 */
import pino, { Logger } from 'pino';
import path from 'path';
import fs from 'fs';
import { config } from './env';

interface ServiceLoggers {
   logger: Logger;
   apiAccessLogger: Logger;
   redisLogger: Logger;
   bullLogger: Logger;
   rabbitmqLogger: Logger;
}

function createLoggers(): ServiceLoggers {
   if (config.NODE_ENV === 'test') {
      const silent = pino({ level: 'silent' });
      return {
         logger: silent,
         apiAccessLogger: silent,
         redisLogger: silent,
         bullLogger: silent,
         rabbitmqLogger: silent,
      };
   }

   const logDir = path.resolve(process.cwd(), config.LOG_DIR);
   if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
   }

   const baseLoggerConfig: pino.LoggerOptions = {
      level: config.LOG_LEVEL,
      formatters: {
         level: (label: string) => ({ level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
   };

   function createFileDestination(filename: string) {
      const fd = fs.openSync(path.join(logDir, filename), 'a');
      return pino.destination({ fd, minLength: 0, sync: false });
   }

   return {
      logger: pino(baseLoggerConfig, createFileDestination('app.log')),
      apiAccessLogger: pino(
         { ...baseLoggerConfig, base: { component: 'api-access' } },
         createFileDestination('api-access.log')
      ),
      redisLogger: pino(
         { ...baseLoggerConfig, base: { component: 'redis' } },
         createFileDestination('redis.log')
      ),
      bullLogger: pino(
         { ...baseLoggerConfig, base: { component: 'bull' } },
         createFileDestination('bull.log')
      ),
      rabbitmqLogger: pino(
         { ...baseLoggerConfig, base: { component: 'rabbitmq' } },
         createFileDestination('rabbitmq.log')
      ),
   };
}

const loggers = createLoggers();

export const logger = loggers.logger;
export const apiAccessLogger = loggers.apiAccessLogger;
export const redisLogger = loggers.redisLogger;
export const bullLogger = loggers.bullLogger;
export const rabbitmqLogger = loggers.rabbitmqLogger;
export default logger;
