/**
 * Transcoding Worker
 * RabbitMQ consumer for processing audio transcoding jobs
 */
import { RabbitMQFactory, TranscodingJobData } from '../config/rabbitmq';
import { BullQueueManager } from '../services/BullQueueManager';
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env';

export class TranscodingWorker {
   private prisma: PrismaClient;
   private bullQueueManager: BullQueueManager;
   private isRunning = false;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.bullQueueManager = BullQueueManager.getInstance(prisma);
   }

   /**
    * Start the transcoding worker
    */
   async start(): Promise<void> {
      if (this.isRunning) {
         console.log('Transcoding worker is already running');
         return;
      }

      try {
         // Initialize RabbitMQ connection
         await RabbitMQFactory.initialize();

         // Initialize Bull queues
         await this.bullQueueManager.initialize();

         console.log('Starting transcoding worker...');

         // Start consuming from all priority queues
         await Promise.all([
            this.startConsumer('priority'),
            this.startConsumer('normal'),
            this.startConsumer('low')
         ]);

         this.isRunning = true;
         console.log('Transcoding worker started successfully');

      } catch (error: any) {
         console.error('Failed to start transcoding worker:', error);
         throw error;
      }
   }

   /**
    * Stop the transcoding worker
    */
   async stop(): Promise<void> {
      if (!this.isRunning) {
         console.log('Transcoding worker is not running');
         return;
      }

      try {
         await RabbitMQFactory.shutdown();
         await this.bullQueueManager.close();
         this.isRunning = false;
         console.log('Transcoding worker stopped');
      } catch (error: any) {
         console.error('Error stopping transcoding worker:', error);
      }
   }

   /**
    * Start consumer for specific queue
    */
   private async startConsumer(queueName: string): Promise<void> {
      try {
         const rabbitMQ = RabbitMQFactory.getConnection();

         await rabbitMQ.consumeTranscodingJobs(queueName, async (jobData: TranscodingJobData, message) => {
            await this.processTranscodingJob(jobData, message);
         });

         console.log(`Started consuming ${queueName} priority transcoding jobs`);
      } catch (error: any) {
         console.error(`Error starting consumer for ${queueName} queue:`, error);
      }
   }

   /**
    * Process transcoding job
    */
   private async processTranscodingJob(jobData: TranscodingJobData, _message: any): Promise<void> {
      const {
         chapter,
         bitrates,
         priority,
         userId,
         retryCount = 0
      } = jobData;

      const { id, filePath } = chapter;

      console.log(`Processing transcoding job for chapter ${id}, bitrates: ${bitrates.join(',')}, priority: ${priority}`);

      try {
         if (!chapter.id) {
            throw new Error(`Chapter ${chapter.id} not found`);
         }

         // Check if chapter is already transcoded for all requested bitrates
         const existingTranscoded = await this.prisma.transcodedChapter.findMany({
            where: {
               chapterId: chapter.id,
               bitrate: { in: bitrates },
               status: 'completed'
            },
            select: { bitrate: true }
         });

         const existingBitrates = existingTranscoded.map(tc => tc.bitrate);
         const remainingBitrates = bitrates.filter(bitrate => !existingBitrates.includes(bitrate));

         if (remainingBitrates.length === 0) {
            console.log(`Chapter ${chapter.id} already transcoded for all requested bitrates`);
            return;
         }

         // Create transcoding job record
         await this.prisma.transcodingJob.create({
            data: {
               chapterId: chapter.id,
               status: 'processing',
               progress: 0,
               startedAt: new Date()
            }
         });

         // Prepare transcoding options - store under bit_transcode/{chapter_id}/{bitrate}k structure
         const outputDir = `bit_transcode/${chapter.id}`;

         // Create Bull jobs for each bitrate
         const bitrateJobs: any[] = [];
         for (const bitrate of remainingBitrates) {
            try {
               const job = await this.bullQueueManager.addBitrateTranscodingJob({
                  chapterId: chapter.id,
                  inputPath: filePath,
                  outputDir,
                  bitrate,
                  segmentDuration: config.HLS_SEGMENT_DURATION,
                  ...(userId && { userId })
               }, priority);

               bitrateJobs.push(job);
               console.log(`Created Bull job for bitrate ${bitrate}k: ${job.id}`);
            } catch (error: any) {
               console.error(`Failed to create Bull job for bitrate ${bitrate}k:`, error);
               // Continue with other bitrates
            }
         }

         // Create master playlist job if we have any bitrate jobs
         if (bitrateJobs.length > 0) {
            try {
               const masterJob = await this.bullQueueManager.addMasterPlaylistJob({
                  chapterId: chapter.id,
                  outputDir,
                  variantBitrates: remainingBitrates
               }, priority);

               console.log(`Created master playlist Bull job: ${masterJob.id}`);
            } catch (error: any) {
               console.error('Failed to create master playlist Bull job:', error);
            }
         }

         console.log(`Successfully dispatched ${bitrateJobs.length} bitrate jobs and 1 master job for chapter ${chapter.id}`);

      } catch (error: any) {
         console.error(`Transcoding job failed for chapter ${chapter.id}:`, error);

         // Handle retry logic
         if (retryCount < 3) {
            console.log(`Retrying transcoding job for chapter ${chapter.id} (attempt ${retryCount + 1})`);

            // Publish job back to queue with increased retry count
            const retryJobData: TranscodingJobData = {
               ...jobData,
               retryCount: retryCount + 1,
               priority: 'low' // Lower priority for retries
            };

            await this.publishTranscodingJob(retryJobData, 'low');
         } else {
            console.error(`Max retries reached for chapter ${chapter.id}, marking as failed`);
         }

         // Update job status in database
         await this.updateTranscodingJobStatus(chapter.id, 'failed', 0, error.message);
      }
   }

   /**
    * Publish transcoding job
    */
   private async publishTranscodingJob(jobData: TranscodingJobData, priority: 'normal' | 'low' | 'high'): Promise<void> {
      try {
         const rabbitMQ = RabbitMQFactory.getConnection();
         await rabbitMQ.publishTranscodingJob(jobData, priority);
      } catch (error: any) {
         console.error('Error publishing transcoding job:', error);
      }
   }

   /**
    * Update transcoding job status in database
    */
   private async updateTranscodingJobStatus(
      chapterId: string,
      status: string,
      progress: number,
      errorMessage?: string
   ): Promise<void> {
      try {
         // Find the most recent job for this chapter
         const existingJob = await this.prisma.transcodingJob.findFirst({
            where: { chapterId },
            orderBy: { createdAt: 'desc' }
         });

         if (existingJob) {
            // Update existing job
            await this.prisma.transcodingJob.update({
               where: { id: existingJob.id },
               data: {
                  status,
                  progress,
                  ...(errorMessage && { errorMessage }),
                  ...(status === 'processing' && !existingJob.startedAt && { startedAt: new Date() }),
                  ...((status === 'completed' || status === 'failed') && { completedAt: new Date() }),
                  updatedAt: new Date()
               }
            });
         } else {
            // Create new job if none exists
            await this.prisma.transcodingJob.create({
               data: {
                  chapterId,
                  status,
                  progress,
                  ...(errorMessage && { errorMessage }),
                  ...(status === 'processing' && { startedAt: new Date() }),
                  ...((status === 'completed' || status === 'failed') && { completedAt: new Date() })
               }
            });
         }
      } catch (error: any) {
         console.error('Error updating transcoding job status:', error);
      }
   }

   /**
    * Get worker statistics
    */
   async getWorkerStats(): Promise<{
      isRunning: boolean;
      queueStats: any;
      recentJobs: any[];
   }> {
      try {
         const rabbitMQ = RabbitMQFactory.getConnection();
         const queueStats = await rabbitMQ.getQueueStats();

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
         console.error('Error getting worker stats:', error);
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
   async testWorker(): Promise<boolean> {
      try {
         // Test RabbitMQ connection
         const rabbitMQ = RabbitMQFactory.getConnection();
         const isConnected = rabbitMQ.isConnected();

         // Test Bull queue manager
         const bullReady = this.bullQueueManager.isReady();

         // Test database connection
         await this.prisma.$queryRaw`SELECT 1`;

         console.log('Worker test results:', {
            rabbitMQConnected: isConnected,
            bullQueuesReady: bullReady,
            databaseConnected: true
         });

         return isConnected && bullReady;
      } catch (error: any) {
         console.error('Worker test failed:', error);
         return false;
      }
   }
}

/**
 * Worker factory for easy access
 */
export class TranscodingWorkerFactory {
   private static worker: TranscodingWorker | null = null;

   /**
    * Get worker instance
    */
   public static getWorker(prisma: PrismaClient): TranscodingWorker {
      if (!TranscodingWorkerFactory.worker) {
         TranscodingWorkerFactory.worker = new TranscodingWorker(prisma);
      }
      return TranscodingWorkerFactory.worker;
   }

   /**
    * Start worker
    */
   public static async startWorker(prisma: PrismaClient): Promise<void> {
      const worker = TranscodingWorkerFactory.getWorker(prisma);
      await worker.start();
   }

   /**
    * Stop worker
    */
   public static async stopWorker(): Promise<void> {
      if (TranscodingWorkerFactory.worker) {
         await TranscodingWorkerFactory.worker.stop();
         TranscodingWorkerFactory.worker = null;
      }
   }
}
