import { PrismaClient } from '@prisma/client';
import { StreamingController } from '../controllers/StreamingController';
import { AuthMiddleware } from '../middleware/AuthMiddleware';

/**
 * Streaming routes factory
 * All routes use external service authentication (user_id header)
 */
export const createStreamingRoutes = (prisma: PrismaClient) => {
   const router = require('express').Router();
   const streamingController = new StreamingController(prisma);

   // Apply external service authentication middleware to all streaming routes
   // This ensures all /api/v1/stream/* endpoints require user_id header
   router.use(AuthMiddleware.validateExternalService);

   // Master playlist endpoint
   router.get('/chapters/:chapterId/master.m3u8', streamingController.getMasterPlaylist);

   // Variant playlist endpoint
   router.get('/chapters/:chapterId/:bitrate/playlist.m3u8', streamingController.getVariantPlaylist);

   // Segment endpoint
   router.get('/chapters/:chapterId/:bitrate/segments/:segmentId', streamingController.getSegment);

   // Status endpoint
   router.get('/chapters/:chapterId/status', streamingController.getStreamingStatus);

   // Preload endpoint
   router.post('/chapters/:chapterId/preload', streamingController.preloadChapter);

   // Analytics endpoint
   router.get('/analytics', streamingController.getAnalytics);

   // Health check endpoint (excluded from auth by middleware)
   router.get('/health', streamingController.getHealthStatus);

   return router;
};
