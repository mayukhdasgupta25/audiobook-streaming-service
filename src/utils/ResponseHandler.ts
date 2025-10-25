/**
 * Response Handler Utility
 * Standardized HTTP response methods for consistent API responses
 */
import { Response } from 'express';

export interface ApiResponse<T = any> {
   success: boolean;
   message: string;
   data?: T;
   timestamp: string;
   statusCode: number;
}

export interface ErrorResponse {
   success: false;
   error: string;
   message: string;
   timestamp: string;
   statusCode: number;
   path?: string;
   method?: string;
}

/**
 * Response Handler class with static methods for standardized responses
 */
export class ResponseHandler {
   /**
    * Send successful response with data
    */
   static success<T>(res: Response, data: T, message: string, statusCode: number = 200): void {
      const response: ApiResponse<T> = {
         success: true,
         message,
         data,
         timestamp: new Date().toISOString(),
         statusCode
      };

      res.status(statusCode).json(response);
   }

   /**
    * Send created response (201)
    */
   static created<T>(res: Response, data: T, message: string): void {
      this.success(res, data, message, 201);
   }

   /**
    * Send not found response (404)
    */
   static notFound(res: Response, message: string): void {
      const response: ErrorResponse = {
         success: false,
         error: 'Not Found',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 404,
         path: res.req.originalUrl,
         method: res.req.method
      };

      res.status(404).json(response);
   }

   /**
    * Send unauthorized response (401)
    */
   static unauthorized(res: Response, message: string): void {
      const response: ErrorResponse = {
         success: false,
         error: 'Unauthorized',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 401,
         path: res.req.originalUrl,
         method: res.req.method
      };

      res.status(401).json(response);
   }

   /**
    * Send forbidden response (403)
    */
   static forbidden(res: Response, message: string): void {
      const response: ErrorResponse = {
         success: false,
         error: 'Forbidden',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 403,
         path: res.req.originalUrl,
         method: res.req.method
      };

      res.status(403).json(response);
   }

   /**
    * Send validation error response (400)
    */
   static validationError(res: Response, message: string, details?: any): void {
      const response: ErrorResponse & { details?: any } = {
         success: false,
         error: 'Validation Error',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 400,
         path: res.req.originalUrl,
         method: res.req.method,
         ...(details && { details })
      };

      res.status(400).json(response);
   }

   /**
    * Send bad request response (400)
    */
   static badRequest(res: Response, message: string): void {
      const response: ErrorResponse = {
         success: false,
         error: 'Bad Request',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 400,
         path: res.req.originalUrl,
         method: res.req.method
      };

      res.status(400).json(response);
   }

   /**
    * Send internal server error response (500)
    */
   static serverError(res: Response, message: string, error?: any): void {
      const response: ErrorResponse & { errorDetails?: any } = {
         success: false,
         error: 'Internal Server Error',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 500,
         path: res.req.originalUrl,
         method: res.req.method,
         ...(error && process.env.NODE_ENV === 'development' && { errorDetails: error })
      };

      res.status(500).json(response);
   }

   /**
    * Send service unavailable response (503)
    */
   static serviceUnavailable(res: Response, message: string): void {
      const response: ErrorResponse = {
         success: false,
         error: 'Service Unavailable',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 503,
         path: res.req.originalUrl,
         method: res.req.method
      };

      res.status(503).json(response);
   }

   /**
    * Send conflict response (409)
    */
   static conflict(res: Response, message: string): void {
      const response: ErrorResponse = {
         success: false,
         error: 'Conflict',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 409,
         path: res.req.originalUrl,
         method: res.req.method
      };

      res.status(409).json(response);
   }

   /**
    * Send too many requests response (429)
    */
   static tooManyRequests(res: Response, message: string): void {
      const response: ErrorResponse = {
         success: false,
         error: 'Too Many Requests',
         message,
         timestamp: new Date().toISOString(),
         statusCode: 429,
         path: res.req.originalUrl,
         method: res.req.method
      };

      res.status(429).json(response);
   }

   /**
    * Send custom error response
    */
   static customError(res: Response, message: string, statusCode: number, errorType?: string): void {
      const response: ErrorResponse = {
         success: false,
         error: errorType || 'Error',
         message,
         timestamp: new Date().toISOString(),
         statusCode,
         path: res.req.originalUrl,
         method: res.req.method
      };

      res.status(statusCode).json(response);
   }

   /**
    * Send raw response (for non-JSON responses like HLS playlists)
    */
   static raw(res: Response, content: Buffer | string, contentType: string, statusCode: number = 200): void {
      res.status(statusCode)
         .set('Content-Type', contentType)
         .send(content);
   }

   /**
    * Send file response
    */
   static file(res: Response, filePath: string, fileName?: string): void {
      if (fileName) {
         res.download(filePath, fileName);
      } else {
         res.download(filePath);
      }
   }

   /**
    * Send redirect response
    */
   static redirect(res: Response, url: string, statusCode: number = 302): void {
      res.redirect(statusCode, url);
   }
}
