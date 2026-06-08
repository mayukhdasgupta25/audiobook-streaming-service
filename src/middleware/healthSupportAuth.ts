/**
 * Health Support Authentication Middleware
 * Separate from JWT auth — uses HTTP Basic Auth for @srota-support.com accounts.
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';

const SUPPORT_EMAIL_DOMAIN = '@srota-support.com';
const BASIC_REALM = 'Srota Health Check';

function secureCompare(a: string, b: string): boolean {
   const bufA = Buffer.from(a);
   const bufB = Buffer.from(b);
   if (bufA.length !== bufB.length) {
      return false;
   }
   return crypto.timingSafeEqual(bufA, bufB);
}

function parseBasicAuth(header: string | undefined): { email: string; password: string } | null {
   if (!header || !header.startsWith('Basic ')) {
      return null;
   }

   try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const colonIndex = decoded.indexOf(':');
      if (colonIndex === -1) {
         return null;
      }

      return {
         email: decoded.slice(0, colonIndex),
         password: decoded.slice(colonIndex + 1),
      };
   } catch {
      return null;
   }
}

function isValidSupportEmail(email: string): boolean {
   return email.toLowerCase().endsWith(SUPPORT_EMAIL_DOMAIN);
}

export function requireHealthSupportAuth(
   req: Request,
   res: Response,
   next: NextFunction
): void {
   const credentials = parseBasicAuth(req.headers.authorization);

   if (
      credentials &&
      isValidSupportEmail(credentials.email) &&
      secureCompare(credentials.email.toLowerCase(), config.HEALTH_SUPPORT_EMAIL.toLowerCase()) &&
      secureCompare(credentials.password, config.HEALTH_SUPPORT_PASSWORD)
   ) {
      next();
      return;
   }

   res.setHeader('WWW-Authenticate', `Basic realm="${BASIC_REALM}"`);
   res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Valid @srota-support.com credentials are required to access health information',
   });
}
