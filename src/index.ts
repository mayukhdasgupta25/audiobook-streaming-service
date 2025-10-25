/**
 * Standalone Streaming Service
 * Independent Express app for audio streaming service
 */
import './config/env';
import './types/session'; // Load session type extensions
import cors from 'cors';
import session from 'express-session';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/env';
import { ErrorHandler } from './middleware/ErrorHandler';
import { AuthMiddleware } from './middleware/AuthMiddleware';
import { RabbitMQFactory } from './config/rabbitmq';
import { TranscodingWorkerFactory } from './workers/TranscodingWorker';
import { BullWorkerLauncher } from './workers/BullWorkerLauncher';
import { BullBoardManager } from './config/bullBoard';
import { createStreamingRoutes } from './routes/streamingRoutes';
import { PrismaClient } from '@prisma/client';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
   origin: [
      process.env['CLIENT_URL'] || 'http://localhost:8081',
      'http://localhost:5173'
   ],
   credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
   secret: process.env['SESSION_SECRET'] || 'your-secret-key',
   resave: false,
   saveUninitialized: false,
   cookie: {
      secure: process.env['NODE_ENV'] === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
   }
}));

// Session validation middleware (exclude Bull Board and streaming routes)
app.use((req, res, next) => {
   // Skip session validation for Bull Board routes
   if (req.path.startsWith('/admin/queues')) {
      return next();
   }

   // Skip session validation for streaming routes (they use external service auth)
   if (req.path.startsWith('/api/v1/stream')) {
      return next();
   }

   next();
});

// Initialize Prisma client
const prisma = new PrismaClient();

// Initialize RabbitMQ, storage provider, and transcoding worker
(async (): Promise<void> => {
   try {
      // Initialize storage provider first
      const { StorageFactory } = require('./services/storage/StorageFactory');
      await StorageFactory.initialize();
      console.log('Storage provider initialized successfully');

      await RabbitMQFactory.initialize();
      console.log('RabbitMQ initialized successfully');

      // Start transcoding worker
      await TranscodingWorkerFactory.startWorker(prisma);

      // Start Bull workers
      const bullWorkerLauncher = BullWorkerLauncher.getInstance(prisma);
      await bullWorkerLauncher.start();

      // Initialize Bull Board
      const bullBoardManager = BullBoardManager.getInstance(prisma);
      await bullBoardManager.initialize();
   } catch (error) {
      console.error('Failed to initialize services:', error);
   }
})();

// Streaming Routes
app.use('/api/v1/stream', createStreamingRoutes(prisma));

// Bull Board Dashboard (Unauthorized access for now)
const bullBoardManager = BullBoardManager.getInstance(prisma);
app.use(bullBoardManager.getBasePath(), bullBoardManager.getRouter());

// Health check endpoint
app.get('/health', async (_req, res) => {
   try {
      const healthStatus = {
         status: 'healthy',
         service: 'audio-streaming',
         timestamp: new Date().toISOString(),
         components: {
            database: false,
            redis: false,
            rabbitmq: false,
            storage: false,
            ffmpeg: false,
            bullWorkers: false
         }
      };

      // Test database connection
      try {
         await prisma.$queryRaw`SELECT 1`;
         healthStatus.components.database = true;
      } catch (error) {
         console.error('Database health check failed:', error);
      }

      // Test Redis connection
      try {
         const redis = require('./config/redis').RedisConnection.getInstance();
         healthStatus.components.redis = await redis.testConnection();
      } catch (error) {
         console.error('Redis health check failed:', error);
      }

      // Test RabbitMQ connection
      try {
         const rabbitMQ = RabbitMQFactory.getConnection();
         healthStatus.components.rabbitmq = rabbitMQ.isConnected();
      } catch (error) {
         console.error('RabbitMQ health check failed:', error);
      }

      // Test storage provider
      try {
         const storageProvider = require('./services/storage/StorageFactory').StorageFactory.getStorageProvider();
         healthStatus.components.storage = await storageProvider.testConnection();
      } catch (error) {
         console.error('Storage health check failed:', error);
      }

      // Test FFmpeg
      try {
         const transcodingService = require('./services/TranscodingService').TranscodingService;
         const service = new transcodingService(prisma);
         healthStatus.components.ffmpeg = await service.testFFmpegInstallation();
      } catch (error) {
         console.error('FFmpeg health check failed:', error);
      }

      // Test Bull workers
      try {
         const bullWorkerLauncher = BullWorkerLauncher.getInstance(prisma);
         healthStatus.components.bullWorkers = bullWorkerLauncher.isReady();
      } catch (error) {
         console.error('Bull workers health check failed:', error);
      }

      // Determine overall status
      const allHealthy = Object.values(healthStatus.components).every(status => status === true);
      healthStatus.status = allHealthy ? 'healthy' : 'degraded';

      const statusCode = allHealthy ? 200 : 503;
      res.status(statusCode).json(healthStatus);

   } catch (error: any) {
      console.error('Health check failed:', error);
      res.status(500).json({
         status: 'unhealthy',
         service: 'audio-streaming',
         error: error.message,
         timestamp: new Date().toISOString()
      });
   }
});

// Service info endpoint
app.get('/', (_req, res) => {
   res.json({
      service: 'Audio Streaming Service',
      version: '1.0.0',
      status: 'running',
      timestamp: new Date().toISOString(),
      endpoints: {
         health: '/health',
         streaming: '/api/v1/stream',
         masterPlaylist: '/api/v1/stream/chapters/:chapterId/master.m3u8',
         variantPlaylist: '/api/v1/stream/chapters/:chapterId/:bitrate/playlist.m3u8',
         segment: '/api/v1/stream/chapters/:chapterId/:bitrate/segments/:segmentId',
         status: '/api/v1/stream/chapters/:chapterId/status',
         transcode: '/api/v1/stream/chapters/:chapterId/transcode',
         preload: '/api/v1/stream/chapters/:chapterId/preload',
         analytics: '/api/v1/stream/analytics',
         bullBoard: '/admin/queues'
      }
   });
});

// 404 handler for undefined routes
app.use((req, res) => ErrorHandler.handleNotFound(req, res));

// Global error handler
app.use(ErrorHandler.handleError);

// Store server instance for graceful shutdown
let server: any;

// Graceful shutdown function
const gracefulShutdown = async (signal: string) => {
   console.log(`${signal} received, shutting down gracefully...`);

   try {
      // Stop accepting new connections
      if (server) {
         server.close(() => {
            console.log('HTTP server closed');
         });
      }

      // Stop transcoding worker
      await TranscodingWorkerFactory.stopWorker();
      console.log('Transcoding worker stopped');

      // Stop Bull workers
      const bullWorkerLauncher = BullWorkerLauncher.getInstance(prisma);
      await bullWorkerLauncher.stop();
      console.log('Bull workers stopped');

      // Close RabbitMQ connection
      await RabbitMQFactory.shutdown();
      console.log('RabbitMQ connection closed');

      // Close Prisma connection
      await prisma.$disconnect();
      console.log('Database connection closed');

      console.log('Graceful shutdown completed');
      process.exit(0);
   } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
   }
};

// Graceful shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle nodemon restart
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

// Start server
const port = config.STREAMING_PORT;
server = app.listen(port, () => {
   console.log(`🎵 Audio Streaming Service running on port ${port}`);
   console.log(`📚 Environment: ${config.NODE_ENV}`);
   console.log(`🔗 Service URL: http://localhost:${port}`);
   console.log(`❤️  Health Check: http://localhost:${port}/health`);
   console.log(`📊 Streaming API: http://localhost:${port}/api/v1/stream`);
   console.log(`🎛️  Bull Board: http://localhost:${port}/admin/queues`);
}).on('error', (err: any) => {
   if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use. Please kill the existing process or use a different port.`);
      console.error(`💡 Try running: netstat -ano | findstr :${port} to find the process using this port`);
      process.exit(1);
   } else {
      console.error('❌ Server error:', err);
      process.exit(1);
   }
});
