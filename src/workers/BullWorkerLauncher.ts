/**
 * Bull Worker Launcher
 * Starts all Bull processors for transcoding jobs
 */
import { PrismaClient } from '@prisma/client';
import { BullQueueManager } from '../services/BullQueueManager';
import { BitrateTranscodingProcessor } from './BitrateTranscodingProcessor';
import { MasterPlaylistProcessor } from './MasterPlaylistProcessor';
import { QUEUE_NAMES, getBitrateQueueNames } from '../config/bull';
import { bullLogger } from '../config/logger';

export class BullWorkerLauncher {
   private static instance: BullWorkerLauncher;
   private prisma: PrismaClient;
   private bullQueueManager: BullQueueManager;
   private bitrateProcessor: BitrateTranscodingProcessor;
   private masterProcessor: MasterPlaylistProcessor;
   private isRunning = false;

   private constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.bullQueueManager = BullQueueManager.getInstance(prisma);
      this.bitrateProcessor = new BitrateTranscodingProcessor(prisma);
      this.masterProcessor = new MasterPlaylistProcessor(prisma);
   }

   /**
    * Get singleton instance
    */
   public static getInstance(prisma: PrismaClient): BullWorkerLauncher {
      if (!BullWorkerLauncher.instance) {
         BullWorkerLauncher.instance = new BullWorkerLauncher(prisma);
      }
      return BullWorkerLauncher.instance;
   }

   /**
    * Start all Bull processors
    */
   public async start(): Promise<void> {
      if (this.isRunning) {
         bullLogger.info('Bull workers are already running');
         return;
      }

      try {
         bullLogger.info('Starting Bull workers...');

         // Ensure Bull queues are initialized
         if (!this.bullQueueManager.isReady()) {
            await this.bullQueueManager.initialize();
         }

         // Start bitrate transcoding processors
         await this.startBitrateProcessors();

         // Start master playlist processor
         await this.startMasterPlaylistProcessor();

         this.isRunning = true;
         bullLogger.info('All Bull workers started successfully');

      } catch (error: any) {
         bullLogger.error({ err: error }, 'Failed to start Bull workers');
         throw error;
      }
   }

   /**
    * Start bitrate transcoding processors
    */
   private async startBitrateProcessors(): Promise<void> {
      const bitrateQueues = getBitrateQueueNames();

      for (const queueName of bitrateQueues) {
         const queue = this.bullQueueManager.getQueue(queueName);
         if (!queue) {
            throw new Error(`Queue ${queueName} not found`);
         }

         // Process jobs with concurrency of 2 per queue
         queue.process(2, async (job: any) => {
            return await this.bitrateProcessor.processBitrateTranscoding(job);
         });

         bullLogger.info({ queueName }, 'Started bitrate processor for queue');
      }
   }

   /**
    * Start master playlist processor
    */
   private async startMasterPlaylistProcessor(): Promise<void> {
      const queue = this.bullQueueManager.getQueue(QUEUE_NAMES.MASTER_PLAYLIST);
      if (!queue) {
         throw new Error(`Queue ${QUEUE_NAMES.MASTER_PLAYLIST} not found`);
      }

      // Process master playlist jobs with concurrency of 1
      queue.process(1, async (job: any) => {
         return await this.masterProcessor.processMasterPlaylist(job);
      });

      bullLogger.info({ queueName: QUEUE_NAMES.MASTER_PLAYLIST }, 'Started master playlist processor for queue');
   }

   /**
    * Stop all Bull processors
    */
   public async stop(): Promise<void> {
      if (!this.isRunning) {
         bullLogger.info('Bull workers are not running');
         return;
      }

      try {
         bullLogger.info('Stopping Bull workers...');

         // Close all queues (this will stop processing)
         await this.bullQueueManager.close();

         this.isRunning = false;
         bullLogger.info('All Bull workers stopped');

      } catch (error: any) {
         bullLogger.error({ err: error }, 'Error stopping Bull workers');
      }
   }

   /**
    * Get worker statistics
    */
   public async getWorkerStats(): Promise<{
      isRunning: boolean;
      queueStats: any;
      recentJobs: any[];
   }> {
      try {
         const queueStats = await this.bullQueueManager.getQueueStats();

         const recentJobs = await this.prisma.transcodingJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
               id: true,
               chapterId: true,
               status: true,
               progress: true,
               createdAt: true,
               completedAt: true
            }
         });

         return {
            isRunning: this.isRunning,
            queueStats,
            recentJobs
         };
      } catch (error: any) {
         bullLogger.error({ err: error }, 'Error getting worker stats');
         return {
            isRunning: this.isRunning,
            queueStats: {},
            recentJobs: []
         };
      }
   }

   /**
    * Test worker functionality
    */
   public async testWorker(): Promise<boolean> {
      try {
         // Test Bull queue manager
         const isReady = this.bullQueueManager.isReady();

         // Test database connection
         await this.prisma.$queryRaw`SELECT 1`;

         bullLogger.info({
            bullQueuesReady: isReady,
            databaseConnected: true
         }, 'Bull worker test results');

         return isReady;
      } catch (error: any) {
         bullLogger.error({ err: error }, 'Bull worker test failed');
         return false;
      }
   }

   /**
    * Check if workers are running
    */
   public isReady(): boolean {
      return this.isRunning;
   }
}
