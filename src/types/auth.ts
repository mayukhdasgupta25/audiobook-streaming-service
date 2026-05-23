/**
 * Authentication-related TypeScript interfaces and types
 * Used for JWT token verification and JWKS handling
 */

import { Request } from 'express';

/**
 * JWT header interface
 */
export interface JWTHeader {
   alg: string;
   typ: string;
   kid: string;
}

/**
 * Decoded JWT structure
 */
export interface DecodedJWT {
   header: JWTHeader;
   payload: Record<string, any>;
}

/**
 * JWKS (JSON Web Key Set) interfaces
 */
export interface JWK {
   kty: string; // Key type (e.g., "RSA")
   use: string; // Key use (e.g., "sig")
   kid: string; // Key ID
   alg: string; // Algorithm (e.g., "RS256")
   n?: string; // RSA modulus
   e?: string; // RSA exponent
   x5c?: string[]; // X.509 certificate chain
   x5t?: string; // X.509 certificate SHA-1 thumbprint
   'x5t#S256'?: string; // X.509 certificate SHA-256 thumbprint
}

export interface JWKSResponse {
   keys: JWK[];
}

/**
 * Extended Express Request with authenticated user info
 */
export interface AuthenticatedRequest extends Request {
   user?: {
      id: string;
      email?: string;
      role: string;
      // Add other user properties as needed
   };
}

