import amqp from 'amqplib';
import { config } from './env';


export interface TranscodingJobData {
   // Chapter object (nested)
   chapter: {
      id: string;
      audiobookId: string;
      title: string;
      description?: string;
      chapterNumber: number;
      duration: number;
      filePath: string;
      fileSize: number;
      startPosition: number;
      endPosition: number;
      createdAt: Date;
      updatedAt: Date;
   };

   // Job-specific fields
   bitrates: number[];
   priority: 'low' | 'normal' | 'high';
   userId?: string;
   retryCount?: number;
}

export class RabbitMQConnection {
   private static instance: RabbitMQConnection;
   private connection: amqp.Connection | null = null;
   private channel: amqp.Channel | null = null;
   private isConnecting = false;
   private reconnectAttempts = 0;
   private maxReconnectAttempts = 10;
   private reconnectDelay = 5000; // 5 seconds

   private constructor() { }

   /**
    * Get RabbitMQ connection instance
    */
   public static getInstance(): RabbitMQConnection {
      if (!RabbitMQConnection.instance) {
         RabbitMQConnection.instance = new RabbitMQConnection();
      }
      return RabbitMQConnection.instance;
   }

   /**
    * Connect to RabbitMQ
    */
   public async connect(): Promise<void> {
      if (this.connection && this.channel) {
         return;
      }

      if (this.isConnecting) {
         return;
      }

      this.isConnecting = true;

      try {
         console.log('Connecting to RabbitMQ...');
         this.connection = await amqp.connect(config.RABBITMQ_URL) as unknown as amqp.Connection;

         this.connection!.on('error', (error: Error) => {
            console.error('RabbitMQ connection error:', error);
            this.handleConnectionError();
         });

         this.connection!.on('close', () => {
            console.log('RabbitMQ connection closed');
            this.handleConnectionError();
         });

         this.channel = await (this.connection as any).createChannel();

         // Set prefetch to prevent overwhelming workers
         await this.channel!.prefetch(1);

         console.log('Connected to RabbitMQ successfully');
         this.reconnectAttempts = 0;
         this.isConnecting = false;

         // Setup exchanges and queues
         await this.setupExchangesAndQueues();

      } catch (error) {
         console.error('Failed to connect to RabbitMQ:', error);
         this.isConnecting = false;
         await this.handleConnectionError();
         throw error;
      }
   }

   /**
    * Setup exchanges and queues
    */
   private async setupExchangesAndQueues(): Promise<void> {
      if (!this.channel) {
         throw new Error('Channel not available');
      }

      try {
         // Main transcoding exchange
         await this.channel.assertExchange('transcoding.exchange', 'direct', {
            durable: true,
            autoDelete: false
         });

         // Try to create queues with TTL first, fallback to basic configuration if conflicts exist
         const queues = [
            'audiobook.transcode.priority',
            'audiobook.transcode.normal',
            'audiobook.transcode.low'
         ];

         for (const queueName of queues) {
            await this.assertQueueWithFallback(queueName);
         }

         // Bind queues to exchange
         await this.channel.bindQueue('audiobook.transcode.priority', 'transcoding.exchange', 'priority');
         await this.channel.bindQueue('audiobook.transcode.normal', 'transcoding.exchange', 'normal');
         await this.channel.bindQueue('audiobook.transcode.low', 'transcoding.exchange', 'low');

         console.log('RabbitMQ exchanges and queues setup completed');
      } catch (error: any) {
         console.error('Error setting up exchanges and queues:', error);
         throw error;
      }
   }

   /**
    * Assert queue with fallback to basic configuration if TTL conflicts exist
    */
   private async assertQueueWithFallback(queueName: string): Promise<void> {
      if (!this.channel) {
         throw new Error('Channel not available');
      }

      // Different queues may have different TTL configurations
      // Map queue names to their expected TTL values
      const queueTTLMap: { [key: string]: number } = {
         'audiobook.transcode.priority': 3600000, // 1 hour
         'audiobook.transcode.normal': 3600000,    // 1 hour  
         'audiobook.transcode.low': 7200000       // 2 hours
      };

      const ttl = queueTTLMap[queueName] || config.RABBITMQ_MESSAGE_TTL;

      const configWithTTL = {
         durable: true,
         exclusive: false,
         autoDelete: false,
         arguments: {
            'x-message-ttl': ttl
         }
      };

      try {
         await this.channel.assertQueue(queueName, configWithTTL);
         console.log(`Successfully connected to queue ${queueName} with TTL ${ttl}`);
      } catch (error: any) {
         console.error(`Failed to connect to queue ${queueName}:`, error);
         throw error;
      }
   }

   /**
    * Publish transcoding job
    */
   public async publishTranscodingJob(
      jobData: TranscodingJobData,
      priority: 'low' | 'normal' | 'high' = 'normal'
   ): Promise<boolean> {
      if (!this.channel) {
         throw new Error('Channel not available');
      }

      const routingKey = priority;

      try {
         const message = Buffer.from(JSON.stringify({
            ...jobData,
            priority,
            timestamp: new Date().toISOString(),
            retryCount: jobData.retryCount || 0
         }));

         const published = this.channel.publish(
            'transcoding.exchange',
            routingKey,
            message,
            {
               persistent: true,
               priority: priority === 'high' ? 10 : priority === 'normal' ? 5 : 1,
               messageId: `${jobData.chapter.id}-${Date.now()}`
            }
         );

         if (published) {
            console.log(`Transcoding job published for chapter ${jobData.chapter.id} with priority ${priority}`);
            return true;
         } else {
            console.error('Failed to publish transcoding job - channel buffer full');
            return false;
         }
      } catch (error) {
         console.error('Error publishing transcoding job:', error);
         return false;
      }
   }

   /**
    * Consume transcoding jobs
    */
   public async consumeTranscodingJobs(
      queueName: string,
      callback: (jobData: TranscodingJobData, message: amqp.Message) => Promise<void>
   ): Promise<void> {
      if (!this.channel) {
         throw new Error('Channel not available');
      }

      const fullQueueName = `audiobook.transcode.${queueName}`;

      try {
         await this.channel.consume(fullQueueName, async (message: amqp.Message | null) => {
            if (!message) {
               return;
            }

            try {
               const jobData: TranscodingJobData = JSON.parse(message.content.toString());
               console.log(`Processing transcoding job for chapter ${jobData.chapter.id}`);

               await callback(jobData, message);

               // Acknowledge the message
               this.channel!.ack(message);
            } catch (error) {
               console.error('Error processing transcoding job:', error);

               // Reject and requeue the message
               this.channel!.nack(message, false, true);
            }
         }, {
            noAck: false
         });

         console.log(`Started consuming transcoding jobs from ${fullQueueName}`);
      } catch (error) {
         console.error(`Error setting up consumer for ${fullQueueName}:`, error);
         throw error;
      }
   }

   /**
    * Get queue statistics
    */
   public async getQueueStats(): Promise<{
      [queueName: string]: {
         messageCount: number;
         consumerCount: number;
      };
   }> {
      if (!this.channel) {
         throw new Error('Channel not available');
      }

      const stats: any = {};
      const queues = ['priority', 'normal', 'low'];

      for (const queue of queues) {
         try {
            const queueInfo = await this.channel.checkQueue(`audiobook.transcode.${queue}`);
            stats[queue] = {
               messageCount: queueInfo.messageCount,
               consumerCount: queueInfo.consumerCount
            };
         } catch (error) {
            console.error(`Error getting stats for queue ${queue}:`, error);
            stats[queue] = {
               messageCount: 0,
               consumerCount: 0
            };
         }
      }

      return stats;
   }

   /**
    * Handle connection errors and implement reconnection logic
    */
   private async handleConnectionError(): Promise<void> {
      this.connection = null;
      this.channel = null;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
         console.error('Max reconnection attempts reached. Stopping reconnection attempts.');
         return;
      }

      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

      console.log(`Attempting to reconnect to RabbitMQ in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(async () => {
         try {
            await this.connect();
         } catch (error) {
            console.error('Reconnection attempt failed:', error);
         }
      }, delay);
   }

   /**
    * Close connection gracefully
    */
   public async close(): Promise<void> {
      try {
         if (this.channel) {
            await this.channel.close();
            this.channel = null;
         }

         if (this.connection) {
            await (this.connection as any).close();
            this.connection = null;
         }

         console.log('RabbitMQ connection closed gracefully');
      } catch (error) {
         console.error('Error closing RabbitMQ connection:', error);
      }
   }

   /**
    * Check if connected
    */
   public isConnected(): boolean {
      return this.connection !== null && this.channel !== null;
   }
}

/**
 * RabbitMQ connection factory
 */
export class RabbitMQFactory {
   private static connection = RabbitMQConnection.getInstance();

   /**
    * Get RabbitMQ connection instance
    */
   public static getConnection(): RabbitMQConnection {
      return this.connection;
   }

   /**
    * Initialize RabbitMQ connection
    */
   public static async initialize(): Promise<void> {
      await this.connection.connect();
   }

   /**
    * Close RabbitMQ connection
    */
   public static async shutdown(): Promise<void> {
      await this.connection.close();
   }
}
