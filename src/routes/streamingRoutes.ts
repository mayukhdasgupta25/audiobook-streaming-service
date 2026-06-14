import { PrismaClient } from '@prisma/client';
import { StreamingController } from '../controllers/StreamingController';
import { TranscodingEventsController } from '../controllers/TranscodingEventsController';
import { authenticateJWT } from '../middleware/authenticateJWT';

/**
 * Streaming routes factory
 * All routes use external service authentication (user_id header)
 */
export const createStreamingRoutes = (prisma: PrismaClient) => {
   const router = require('express').Router();
   const streamingController = new StreamingController(prisma);
   const transcodingEventsController = new TranscodingEventsController(prisma);

   router.use(authenticateJWT);
   // HLS Master playlist endpoint
   router.get('/chapters/:chapterId/master.m3u8', streamingController.getMasterPlaylist);

   // HLS Variant playlist endpoint
   router.get('/chapters/:chapterId/:bitrate/playlist.m3u8', streamingController.getVariantPlaylist);

   // HLS Segment endpoint
   router.get('/chapters/:chapterId/:bitrate/segments/:segmentId', streamingController.getSegment);

   // Status endpoint
   router.get('/chapters/:chapterId/status', streamingController.getStreamingStatus);

   // Detailed transcoding status
   router.get('/chapters/:chapterId/transcoding', transcodingEventsController.getDetailedTranscodingStatus);

   // SSE transcoding events
   router.get('/chapters/:chapterId/transcoding/events', transcodingEventsController.getChapterTranscodingEvents);
   router.get('/transcoding/events', transcodingEventsController.getMultiplexedTranscodingEvents);

   // Retry failed bitrates
   router.post('/chapters/:chapterId/transcode/retry', transcodingEventsController.retryTranscoding);

   // Preload endpoint
   router.post('/chapters/:chapterId/preload', streamingController.preloadChapter);

   // Analytics endpoint
   router.get('/analytics', streamingController.getAnalytics);

   return router;
};
