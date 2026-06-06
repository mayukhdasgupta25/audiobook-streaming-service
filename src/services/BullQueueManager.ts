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
import { bullLogger } from '../config/logger';

export class BullQueueManager {
   private static instance: BullQueueManager;
   private queues: Map<string, Bull.Queue> = new Map();
   private prisma: PrismaClient;
   private isInitialized = false;

   private constructor(prisma: PrismaClient) {
      this.prisma = prisma;
   }

   public static getInstance(prisma: PrismaClient): BullQueueManager {
      if (!BullQueueManager.instance) {
         BullQueueManager.instance = new BullQueueManager(prisma);
      }
      return BullQueueManager.instance;
   }

   public async initialize(): Promise<void> {
      if (this.isInitialized) {
         return;
      }

      try {
         bullLogger.info('Initializing Bull queues...');

         for (const queueName of getAllQueueNames()) {
            const queue = createQueue(queueName);
            this.queues.set(queueName, queue);
            this.setupQueueEventListeners(queue, queueName);
            bullLogger.info({ queueName }, 'Queue created successfully');
         }

         this.isInitialized = true;
         bullLogger.info('All Bull queues initialized successfully');
      } catch (error: any) {
         bullLogger.error({ err: error }, 'Error initializing Bull queues');
         throw error;
      }
   }

   private setupQueueEventListeners(queue: Bull.Queue, queueName: string): void {
      queue.on('ready', () => {
         bullLogger.info({ queueName }, 'Queue is ready');
      });

      queue.on('error', (error) => {
         bullLogger.error({ err: error, queueName }, 'Queue error');
      });

      queue.on('waiting', (jobId) => {
         bullLogger.debug({ jobId, queueName }, 'Job is waiting in queue');
      });

      queue.on('active', (job) => {
         bullLogger.info({ jobId: job.id, queueName }, 'Job is active in queue');
      });

      queue.on('stalled', (job) => {
         bullLogger.warn({ jobId: job.id, queueName }, 'Job is stalled in queue');
      });

      queue.on('progress', async (job, progress) => {
         bullLogger.debug({ jobId: job.id, progress, queueName }, 'Job progress');
         await this.updateJobStatus(job.data.chapterId, 'processing', progress);
      });

      queue.on('completed', async (job) => {
         bullLogger.info({ jobId: job.id, queueName }, 'Job completed in queue');
         await this.updateJobStatus(job.data.chapterId, 'completed', 100);
      });

      queue.on('failed', async (job, err) => {
         bullLogger.error({ err, jobId: job.id, queueName }, 'Job failed in queue');
         await this.updateJobStatus(job.data.chapterId, 'failed', 0, err.message);
      });

      queue.on('paused', () => {
         bullLogger.info({ queueName }, 'Queue is paused');
      });

      queue.on('resumed', () => {
         bullLogger.info({ queueName }, 'Queue is resumed');
      });

      queue.on('cleaned', (jobs, type) => {
         bullLogger.info({ count: jobs.length, type, queueName }, 'Cleaned jobs from queue');
      });

      queue.on('drained', () => {
         bullLogger.info({ queueName }, 'Queue is drained');
      });
   }

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
      bullLogger.info({ chapterId: data.chapterId, bitrate: data.bitrate, queueName }, 'Added bitrate transcoding job');

      return job;
   }

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
         delay: 5000
      };

      const job = await queue.add(data, jobOptions);
      bullLogger.info({ chapterId: data.chapterId, queueName: QUEUE_NAMES.MASTER_PLAYLIST }, 'Added master playlist job');

      return job;
   }

   public getQueue(queueName: string): Bull.Queue | undefined {
      return this.queues.get(queueName);
   }

   public getAllQueues(): Map<string, Bull.Queue> {
      return this.queues;
   }

   public async getQueueStats(): Promise<{
      [queueName: string]: {
         waiting: number;
         active: number;
         completed: number;
         failed: number;
         delayed: number;
      };
   }> {
      const stats: Record<string, {
         waiting: number;
         active: number;
         completed: number;
         failed: number;
         delayed: number;
      }> = {};

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

   public async getJob(queueName: string, jobId: string): Promise<Bull.Job | null> {
      const queue = this.queues.get(queueName);
      if (!queue) {
         return null;
      }
      return await queue.getJob(jobId);
   }

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
      bullLogger.info({ jobId, queueName }, 'Retried job in queue');
   }

   public async cleanupOldJobs(queueName: string, maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
      const queue = this.queues.get(queueName);
      if (!queue) {
         return;
      }

      await queue.clean(maxAge, 'completed');
      await queue.clean(maxAge, 'failed');
      bullLogger.info({ queueName }, 'Cleaned up old jobs in queue');
   }

   private async updateJobStatus(
      chapterId: string,
      status: string,
      progress: number,
      errorMessage?: string
   ): Promise<void> {
      try {
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
         bullLogger.error({ err: error, chapterId }, 'Error updating job status');
      }
   }

   public async close(): Promise<void> {
      bullLogger.info('Closing Bull queues...');

      const closePromises = Array.from(this.queues.values()).map(queue => queue.close());
      await Promise.all(closePromises);

      this.queues.clear();
      this.isInitialized = false;
      bullLogger.info('All Bull queues closed');
   }

   public isReady(): boolean {
      return this.isInitialized;
   }
}
