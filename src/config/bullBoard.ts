/**
 * Bull Board Configuration
 * Web interface for monitoring Bull queues
 */
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullQueueManager } from '../services/BullQueueManager';
import { PrismaClient } from '@prisma/client';

export class BullBoardManager {
   private static instance: BullBoardManager;
   private serverAdapter: ExpressAdapter;
   private prisma: PrismaClient;

   private constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.serverAdapter = new ExpressAdapter();
      this.serverAdapter.setBasePath('/admin/queues');
   }

   /**
    * Get singleton instance
    */
   public static getInstance(prisma: PrismaClient): BullBoardManager {
      if (!BullBoardManager.instance) {
         BullBoardManager.instance = new BullBoardManager(prisma);
      }
      return BullBoardManager.instance;
   }

   /**
    * Initialize Bull Board with all queues
    */
   public async initialize(): Promise<void> {
      try {
         const bullQueueManager = BullQueueManager.getInstance(this.prisma);

         // Ensure Bull queues are initialized
         if (!bullQueueManager.isReady()) {
            await bullQueueManager.initialize();
         }

         // Get all queues
         const queues = bullQueueManager.getAllQueues();
         const queueAdapters = Array.from(queues.values()).map(queue => new BullAdapter(queue));

         // Create Bull Board
         createBullBoard({
            queues: queueAdapters,
            serverAdapter: this.serverAdapter,
         });

         console.log('Bull Board initialized successfully');
      } catch (error: any) {
         console.error('Error initializing Bull Board:', error);
         throw error;
      }
   }

   /**
    * Get Express router for Bull Board
    */
   public getRouter() {
      return this.serverAdapter.getRouter();
   }

   /**
    * Get base path for Bull Board
    */
   public getBasePath(): string {
      return '/admin/queues';
   }
}
