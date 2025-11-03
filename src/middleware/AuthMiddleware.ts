import { Request, Response, NextFunction } from 'express';

// Extend Express Request interface to include user
declare module 'express-serve-static-core' {
   interface Request {
      user?: {
         id?: string;
         role?: string;
      };
      externalUserId?: string; // For external service authentication
   }
}

/**
 * Authentication middleware for session validation
 */
export class AuthMiddleware {
   /**
    * External service authentication - validates user_id from request header
    * This middleware is specifically designed for external services accessing streaming APIs
    */
   static validateExternalService = (req: Request, res: Response, next: NextFunction): void => {
      // Skip authentication for health check endpoints
      if (req.path === '/health' || req.path.endsWith('/health')) {
         return next();
      }

      // Extract user_id from request header
      const userId = req.headers['user_id'] as string;

      // Check if header is missing entirely
      if (userId === undefined || userId === null) {
         res.status(401).json({
            error: 'Unauthorized',
            message: 'user_id header is required for external service authentication',
            code: 'MISSING_USER_ID_HEADER'
         });
         return;
      }

      // Validate user_id format (check for empty or whitespace-only strings)
      if (typeof userId !== 'string' || userId.trim().length === 0) {
         res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid user_id format in header',
            code: 'INVALID_USER_ID_FORMAT'
         });
         return;
      }

      // Store the external user ID for use in controllers
      req.externalUserId = userId.trim();

      // Also set it in the user object for compatibility with existing controller logic
      req.user = {
         id: userId.trim(),
         role: 'external_service'
      };

      next();
   };

   /**
    * Hybrid authentication - supports both session and external service authentication
    * Tries external service auth first, falls back to session auth
    */
   static hybridAuth = (req: Request, res: Response, next: NextFunction): void => {
      // Skip authentication for health check endpoints
      if (req.path === '/health' || req.path.endsWith('/health')) {
         return next();
      }

      console.log('==========req.headers=============', req.headers);
      // Check for external service authentication first
      const userId = req.headers['user_id'] as string;

      if (userId && typeof userId === 'string' && userId.trim().length > 0) {
         // External service authentication
         req.externalUserId = userId.trim();
         req.user = {
            id: userId.trim(),
            role: 'external_service'
         };
         return next();
      }

      // Fall back to session authentication
      if ((req.session as any)?.isAuthenticated) {
         req.user = {
            id: (req.session as any).userId,
            role: (req.session as any).userRole
         };
         return next();
      }

      // No valid authentication found
      res.status(401).json({
         error: 'Unauthorized',
         message: 'Valid authentication required - either user_id header for external services or valid session',
         code: 'AUTHENTICATION_REQUIRED'
      });
   };
}
