/**
 * Chapter Deletion Worker
 * RabbitMQ consumer for processing chapter deletion messages
 * Deletes all transcoded_chapters records matching the chapterId
 */
import { RabbitMQFactory, ChapterDeletionMessage } from '../config/rabbitmq';
import { PrismaClient } from '@prisma/client';

export class ChapterDeletionWorker {
   private prisma: PrismaClient;
   private isRunning = false;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
   }

   /**
    * Start the chapter deletion worker
    */
   async start(): Promise<void> {
      if (this.isRunning) {
         console.log('Chapter deletion worker is already running');
         return;
      }

      try {
         // Ensure RabbitMQ connection is initialized
         await RabbitMQFactory.initialize();

         console.log('Starting chapter deletion worker...');

         // Start consuming from the chapter deletion queue
         await this.startConsumer();

         this.isRunning = true;
         console.log('Chapter deletion worker started successfully');

      } catch (error: any) {
         console.error('Failed to start chapter deletion worker:', error);
         throw error;
      }
   }

   /**
    * Stop the chapter deletion worker
    */
   async stop(): Promise<void> {
      if (!this.isRunning) {
         console.log('Chapter deletion worker is not running');
         return;
      }

      try {
         // Note: We don't close RabbitMQ connection here as it may be used by other workers
         // The connection will be closed during application shutdown
         this.isRunning = false;
         console.log('Chapter deletion worker stopped');
      } catch (error: any) {
         console.error('Error stopping chapter deletion worker:', error);
      }
   }

   /**
    * Start consumer for chapter deletion queue
    */
   private async startConsumer(): Promise<void> {
      try {
         const rabbitMQ = RabbitMQFactory.getConnection();

         await rabbitMQ.consume<ChapterDeletionMessage>(
            'audiobook.chapters.deleted',
            async (messageData: ChapterDeletionMessage, message) => {
               await this.processChapterDeletion(messageData, message);
            }
         );

         console.log('Started consuming chapter deletion messages from audiobook.chapters.deleted');
      } catch (error: any) {
         console.error('Error starting consumer for chapter deletion queue:', error);
         throw error;
      }
   }

   /**
    * Process chapter deletion message
    */
   private async processChapterDeletion(
      messageData: ChapterDeletionMessage,
      _message: any
   ): Promise<void> {
      const { chapterId, timestamp } = messageData;

      console.log(`Processing chapter deletion for chapterId: ${chapterId}, timestamp: ${timestamp}`);

      // Validate message structure
      if (!chapterId || typeof chapterId !== 'string') {
         throw new Error(`Invalid chapterId in deletion message: ${chapterId}`);
      }

      try {
         // Check if there are any transcoded chapters for this chapterId
         const existingChapters = await this.prisma.transcodedChapter.findMany({
            where: {
               chapterId: chapterId
            },
            select: {
               id: true,
               bitrate: true
            }
         });

         if (existingChapters.length === 0) {
            console.log(`No transcoded chapters found for chapterId: ${chapterId}`);
            return;
         }

         console.log(`Found ${existingChapters.length} transcoded chapter(s) to delete for chapterId: ${chapterId}`);

         // Delete all transcoded chapters matching the chapterId
         const deleteResult = await this.prisma.transcodedChapter.deleteMany({
            where: {
               chapterId: chapterId
            }
         });

         console.log(
            `Successfully deleted ${deleteResult.count} transcoded chapter(s) for chapterId: ${chapterId}`
         );

      } catch (error: any) {
         console.error(`Error deleting transcoded chapters for chapterId ${chapterId}:`, error);
         throw error;
      }
   }

   /**
    * Get worker status
    */
   async getWorkerStatus(): Promise<{
      isRunning: boolean;
      queueName: string;
   }> {
      return {
         isRunning: this.isRunning,
         queueName: 'audiobook.chapters.deleted'
      };
   }

   /**
    * Test worker functionality
    */
   async testWorker(): Promise<boolean> {
      try {
         // Test RabbitMQ connection
         const rabbitMQ = RabbitMQFactory.getConnection();
         const isConnected = rabbitMQ.isConnected();

         // Test database connection
         await this.prisma.$queryRaw`SELECT 1`;

         console.log('Chapter deletion worker test results:', {
            rabbitMQConnected: isConnected,
            databaseConnected: true
         });

         return isConnected;
      } catch (error: any) {
         console.error('Chapter deletion worker test failed:', error);
         return false;
      }
   }
}

/**
 * Worker factory for easy access
 */
export class ChapterDeletionWorkerFactory {
   private static worker: ChapterDeletionWorker | null = null;

   /**
    * Get worker instance
    */
   public static getWorker(prisma: PrismaClient): ChapterDeletionWorker {
      if (!ChapterDeletionWorkerFactory.worker) {
         ChapterDeletionWorkerFactory.worker = new ChapterDeletionWorker(prisma);
      }
      return ChapterDeletionWorkerFactory.worker;
   }

   /**
    * Start worker
    */
   public static async startWorker(prisma: PrismaClient): Promise<void> {
      const worker = ChapterDeletionWorkerFactory.getWorker(prisma);
      await worker.start();
   }

   /**
    * Stop worker
    */
   public static async stopWorker(): Promise<void> {
      if (ChapterDeletionWorkerFactory.worker) {
         await ChapterDeletionWorkerFactory.worker.stop();
         ChapterDeletionWorkerFactory.worker = null;
      }
   }
}

