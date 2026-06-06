/**
 * Authentication Middleware
 * Verifies JWT tokens by fetching JWKS from the auth-service
 * Protects routes that require authentication
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import convertJwkToPem from 'jwk-to-pem';
import axios from 'axios';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { JWKSResponse, JWK, JWTHeader, AuthenticatedRequest } from '../types/auth';

/**
 * Authentication middleware to verify JWT tokens
 * Extracts token from Authorization header, fetches JWKS from auth-service,
 * and verifies the token signature
 */
export async function authenticateJWT(
   req: Request,
   res: Response,
   next: NextFunction
): Promise<void> {
   try {
      // 1. Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
         res.status(401).json({
            success: false,
            message: 'Missing or invalid authorization header',
            details: 'Authorization header must be in format: Bearer <token>'
         });
         return;
      }

      const token = authHeader.substring(7).trim(); // Remove 'Bearer ' prefix and trim
      // 2. Decode JWT header to get kid (key ID)
      let decodedHeader: JWTHeader;
      try {
         const decoded = jwt.decode(token, { complete: true });
         if (!decoded || !decoded.header) {
            res.status(401).json({
               success: false,
               message: 'Invalid token format',
               details: 'Token could not be decoded'
            });
            return;
         }
         decodedHeader = decoded.header as JWTHeader;
      } catch (decodeError: any) {
         res.status(401).json({
            success: false,
            message: 'Invalid token',
            details: `Token header could not be decoded: ${decodeError.message}`
         });
         return;
      }

      const kid = decodedHeader.kid?.trim();
      if (!kid) {
         res.status(401).json({
            success: false,
            message: 'Missing key ID in token header',
            details: 'Token header must contain a kid (key ID) field'
         });
         return;
      }

      // 3. Fetch JWKS from auth-service
      let jwks: JWKSResponse;
      try {
         const jwksResponse = await axios.get<JWKSResponse>(config.JWKS_ENDPOINT);
         jwks = jwksResponse.data;

         // Trim whitespace from all JWK values in the keys array
         jwks.keys.forEach(key => {
            if (key.n) key.n = key.n.trim();
            if (key.e) key.e = key.e.trim();
            if (key.kid) key.kid = key.kid.trim();
            if (key.kty) key.kty = key.kty.trim();
            if (key.use) key.use = key.use.trim();
            if (key.alg) key.alg = key.alg.trim();
         });
      } catch (fetchError: any) {
         // Handle axios errors with more detailed information
         if (axios.isAxiosError(fetchError)) {
            const statusCode = fetchError.response?.status || 500;
            const errorMessage = fetchError.response?.statusText || fetchError.message;
            res.status(statusCode).json({
               success: false,
               message: 'Failed to fetch JWKS from auth-service',
               details: `Auth service returned status ${statusCode}: ${errorMessage}`
            });
         } else {
            res.status(500).json({
               success: false,
               message: 'Failed to fetch JWKS from auth-service',
               details: `Unable to connect to authentication service: ${fetchError.message || 'Unknown error'}`
            });
         }
         return;
      }

      // 4. Find the matching key by kid
      const jwk = jwks.keys.find((k: JWK) => k.kid === kid);
      if (!jwk) {
         res.status(401).json({
            success: false,
            message: 'Key not found',
            details: `No matching key found for kid: ${kid}`
         });
         return;
      }

      // 5. Convert JWK to PEM format
      let publicKey: string;
      try {
         publicKey = convertJwkToPem(jwk as any);
      } catch (conversionError) {
         // console.error('Conversion error:', conversionError);
         res.status(500).json({
            success: false,
            message: 'Failed to convert JWK to PEM format',
            details: String(conversionError)
         });
         return;
      }

      // 6. Verify token signature and extract payload
      try {
         const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as jwt.JwtPayload;
         logger.info('Token verified successfully');

         // Extract user info from token payload
         // Standard JWT claims: sub (subject/user ID), email, and custom claims like role
         const userId = decoded.sub || decoded['userId'] || decoded['id'];
         const email = decoded['email'];
         let role = decoded['role'];

         // If role is not in token payload, fetch from auth service
         if (!role && userId) {
            try {
               const userInfo = await fetchUserInfoFromAuthService(token, userId);
               role = userInfo.role;
            } catch (fetchError: any) {
               logger.error({ err: fetchError, message: fetchError.message }, 'Failed to fetch user info from auth service');
               // Continue without role - will be handled by role middleware
               role = undefined;
            }
         }

         if (!userId) {
            res.status(401).json({
               success: false,
               message: 'Invalid token payload',
               details: 'Token does not contain user identifier'
            });
            return;
         }

         // Attach user info to request object
         (req as AuthenticatedRequest).user = {
            id: userId,
            email: email,
            role: role || 'User' // Default to 'User' if role not found
         };

         next();
      } catch (verifyError: any) {
         // console.error('Verification error:', verifyError.name, verifyError.message);
         res.status(401).json({
            success: false,
            message: 'Invalid token signature',
            details: verifyError.name === 'TokenExpiredError' ? 'Token has expired' : 'Token verification failed'
         });
         return;
      }
   } catch (_error) {
      // Catch any unexpected errors
      // console.error('Authentication error:', error);
      res.status(500).json({
         success: false,
         message: 'Authentication error',
         details: 'An unexpected error occurred during authentication'
      });
   }
}

/**
 * Fetch user information from auth service
 * This is called when role is not present in JWT token payload
 */
async function fetchUserInfoFromAuthService(token: string, userId: string): Promise<{ role: string }> {
   try {
      // Call auth service to get user info with role
      // Assuming endpoint: GET /auth/user or /auth/user/:userId
      const response = await axios.get(`${config.AUTH_SERVICE_URL}/auth/user/${userId}`, {
         headers: {
            Authorization: `Bearer ${token}`
         }
      });

      // Extract role from response
      // Adjust based on actual API response structure
      const role = response.data?.role || response.data?.data?.role;

      if (!role) {
         throw new Error('Role not found in auth service response');
      }

      return { role };
   } catch (error: any) {
      if (axios.isAxiosError(error)) {
         const statusCode = error.response?.status || 500;
         const errorMessage = error.response?.statusText || error.message;
         throw new Error(`Auth service returned status ${statusCode}: ${errorMessage}`);
      }
      throw error;
   }
}

