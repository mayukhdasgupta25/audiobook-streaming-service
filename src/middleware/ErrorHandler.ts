import { Request, Response } from 'express';

/**
 * Error handling utilities
 */
export class ErrorHandler {
   /**
    * Handle 404 Not Found errors
    */
   static handleNotFound = (req: Request, res: Response): void => {
      res.status(404).json({
         error: 'Not Found',
         message: `Route ${req.method} ${req.originalUrl} not found`,
         timestamp: new Date().toISOString()
      });
   };

   /**
    * Global error handler
    */
   static handleError = (err: Error, req: Request, res: Response, next: any): void => {
      console.error('Error:', err);

      // Default error response
      let statusCode = 500;
      let message = 'Internal Server Error';

      // Handle specific error types
      if (err.name === 'ValidationError') {
         statusCode = 400;
         message = 'Validation Error';
      } else if (err.name === 'UnauthorizedError') {
         statusCode = 401;
         message = 'Unauthorized';
      } else if (err.name === 'ForbiddenError') {
         statusCode = 403;
         message = 'Forbidden';
      } else if (err.name === 'NotFoundError') {
         statusCode = 404;
         message = 'Not Found';
      }

      const errorResponse = {
         error: message,
         timestamp: new Date().toISOString(),
         path: req.originalUrl,
         method: req.method
      };

      // Include error details in development
      if (process.env.NODE_ENV === 'development') {
         (errorResponse as any).details = err.message;
         (errorResponse as any).stack = err.stack;
      }

      res.status(statusCode).json(errorResponse);
   };

   /**
    * Create custom error
    */
   static createError = (message: string, statusCode: number = 500, name?: string): Error => {
      const error = new Error(message);
      error.name = name || 'CustomError';
      (error as any).statusCode = statusCode;
      return error;
   };

   /**
    * Handle async errors
    */
   static asyncHandler = (fn: Function) => {
      return (req: Request, res: Response, next: any) => {
         Promise.resolve(fn(req, res, next)).catch(next);
      };
   };
}
