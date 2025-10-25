/**
 * Bull Queue Manager
 * Manages all Bull queues for transcoding jobs
 */
import Bull from 'bull';
import { PrismaClient } from '@prisma/client';
import {
   QUEUE_NAMES,
   createQueue,
   getAllQueueNames,
   getQueueNameForBitrate,
   BitrateTranscodingJobData,
   MasterPlaylistJobData,
   DEFAULT_JOB_OPTIONS
} from '../config/bull';

export class BullQueueManager {
   private static instance: BullQueueManager;
   private queues: Map<string, Bull.Queue> = new Map();
   private prisma: PrismaClient;
   private isInitialized = false;

   private constructor(prisma: PrismaClient) {
      this.prisma = prisma;
   }

   /**
    * Get singleton instance
    */
   public static getInstance(prisma: PrismaClient): BullQueueManager {
      if (!BullQueueManager.instance) {
         BullQueueManager.instance = new BullQueueManager(prisma);
      }
      return BullQueueManager.instance;
   }

   /**
    * Initialize all queues
    */
   public async initialize(): Promise<void> {
      if (this.isInitialized) {
         return;
      }

      try {
         console.log('Initializing Bull queues...');

         // Create all queues
         for (const queueName of getAllQueueNames()) {
            const queue = createQueue(queueName);
            this.queues.set(queueName, queue);

            // Set up queue event listeners
            this.setupQueueEventListeners(queue, queueName);

            console.log(`Created queue: ${queueName}`);
         }

         this.isInitialized = true;
         console.log('All Bull queues initialized successfully');
      } catch (error: any) {
         console.error('Error initializing Bull queues:', error);
         throw error;
      }
   }

   /**
    * Set up event listeners for a queue
    */
   private setupQueueEventListeners(queue: Bull.Queue, queueName: string): void {
      queue.on('completed', async (job: Bull.Job) => {
         console.log(`Job ${job.id} completed in queue ${queueName}`);
         await this.updateJobStatus(job.data.chapterId, 'completed', 100);
      });

      queue.on('failed', async (job: Bull.Job, error: Error) => {
         console.error(`Job ${job.id} failed in queue ${queueName}:`, error);
         await this.updateJobStatus(job.data.chapterId, 'failed', 0, error.message);
      });

      queue.on('progress', async (job: Bull.Job, progress: number) => {
         console.log(`Job ${job.id} progress in queue ${queueName}: ${progress}%`);
         await this.updateJobStatus(job.data.chapterId, 'processing', progress);
      });

      queue.on('stalled', (job: Bull.Job) => {
         console.warn(`Job ${job.id} stalled in queue ${queueName}`);
      });
   }

   /**
    * Add bitrate transcoding job
    */
   public async addBitrateTranscodingJob(
      data: BitrateTranscodingJobData,
      priority: 'low' | 'normal' | 'high' = 'normal'
   ): Promise<Bull.Job> {
      const queueName = getQueueNameForBitrate(data.bitrate);
      const queue = this.queues.get(queueName);

      if (!queue) {
         throw new Error(`Queue ${queueName} not found`);
      }

      const jobOptions: Bull.JobOptions = {
         ...DEFAULT_JOB_OPTIONS,
         priority: priority === 'high' ? 10 : priority === 'normal' ? 5 : 1,
         jobId: `${data.chapterId}-${data.bitrate}k-${Date.now()}`
      };

      const job = await queue.add(data, jobOptions);
      console.log(`Added bitrate transcoding job for chapter ${data.chapterId}, bitrate ${data.bitrate}k`);

      return job;
   }

   /**
    * Add master playlist generation job
    */
   public async addMasterPlaylistJob(
      data: MasterPlaylistJobData,
      priority: 'low' | 'normal' | 'high' = 'normal'
   ): Promise<Bull.Job> {
      const queue = this.queues.get(QUEUE_NAMES.MASTER_PLAYLIST);

      if (!queue) {
         throw new Error(`Queue ${QUEUE_NAMES.MASTER_PLAYLIST} not found`);
      }

      const jobOptions: Bull.JobOptions = {
         ...DEFAULT_JOB_OPTIONS,
         priority: priority === 'high' ? 10 : priority === 'normal' ? 5 : 1,
         jobId: `${data.chapterId}-master-${Date.now()}`,
         delay: 5000 // Delay 5 seconds to allow bitrate jobs to start
      };

      const job = await queue.add(data, jobOptions);
      console.log(`Added master playlist job for chapter ${data.chapterId}`);

      return job;
   }

   /**
    * Get queue by name
    */
   public getQueue(queueName: string): Bull.Queue | undefined {
      return this.queues.get(queueName);
   }

   /**
    * Get all queues
    */
   public getAllQueues(): Map<string, Bull.Queue> {
      return this.queues;
   }

   /**
    * Get queue statistics
    */
   public async getQueueStats(): Promise<{
      [queueName: string]: {
         waiting: number;
         active: number;
         completed: number;
         failed: number;
         delayed: number;
      };
   }> {
      const stats: any = {};

      for (const [queueName, queue] of this.queues) {
         const counts = await queue.getJobCounts();
         stats[queueName] = {
            waiting: counts.waiting,
            active: counts.active,
            completed: counts.completed,
            failed: counts.failed,
            delayed: counts.delayed
         };
      }

      return stats;
   }

   /**
    * Get job by ID
    */
   public async getJob(queueName: string, jobId: string): Promise<Bull.Job | null> {
      const queue = this.queues.get(queueName);
      if (!queue) {
         return null;
      }
      return await queue.getJob(jobId);
   }

   /**
    * Retry failed job
    */
   public async retryJob(queueName: string, jobId: string): Promise<void> {
      const queue = this.queues.get(queueName);
      if (!queue) {
         throw new Error(`Queue ${queueName} not found`);
      }

      const job = await queue.getJob(jobId);
      if (!job) {
         throw new Error(`Job ${jobId} not found in queue ${queueName}`);
      }

      await job.retry();
      console.log(`Retried job ${jobId} in queue ${queueName}`);
   }

   /**
    * Clean up old jobs
    */
   public async cleanupOldJobs(queueName: string, maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
      const queue = this.queues.get(queueName);
      if (!queue) {
         return;
      }

      await queue.clean(maxAge, 'completed');
      await queue.clean(maxAge, 'failed');
      console.log(`Cleaned up old jobs in queue ${queueName}`);
   }

   /**
    * Update job status in database
    */
   private async updateJobStatus(
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
         }
      } catch (error: any) {
         console.error('Error updating job status:', error);
      }
   }

   /**
    * Gracefully close all queues
    */
   public async close(): Promise<void> {
      console.log('Closing Bull queues...');

      const closePromises = Array.from(this.queues.values()).map(queue => queue.close());
      await Promise.all(closePromises);

      this.queues.clear();
      this.isInitialized = false;
      console.log('All Bull queues closed');
   }

   /**
    * Check if manager is initialized
    */
   public isReady(): boolean {
      return this.isInitialized;
   }
}
