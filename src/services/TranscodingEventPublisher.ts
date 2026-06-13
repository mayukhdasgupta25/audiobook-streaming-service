/**
 * Transcoding Event Publisher
 * Redis pub/sub for live transcoding SSE events with throttled progress
 */
import Redis from 'ioredis';
import { RedisConnection } from '../config/redis';
import { TranscodingEvent, BitrateTranscodingState } from '../types/transcoding';
import { redisLogger } from '../config/logger';

const THROTTLE_MS = 500;
const MIN_PROGRESS_DELTA = 2;

interface ThrottleState {
   lastPublishedAt: number;
   lastProgress: number;
}

export class TranscodingEventPublisher {
   private static instance: TranscodingEventPublisher | null = null;
   private readonly publisher: Redis;
   private readonly throttleMap = new Map<string, ThrottleState>();

   private constructor() {
      this.publisher = RedisConnection.getInstance().getClient();
   }

   static getInstance(): TranscodingEventPublisher {
      if (!TranscodingEventPublisher.instance) {
         TranscodingEventPublisher.instance = new TranscodingEventPublisher();
      }
      return TranscodingEventPublisher.instance;
   }

   static channelForChapter(chapterId: string): string {
      return `transcoding:chapter:${chapterId}`;
   }

   buildEvent(
      chapterId: string,
      bitrate: number,
      status: BitrateTranscodingState,
      progress: number,
      errorMessage?: string
   ): TranscodingEvent {
      return {
         chapterId,
         bitrate,
         status,
         progress: Math.max(0, Math.min(100, Math.round(progress))),
         ...(errorMessage ? { errorMessage } : {}),
         timestamp: new Date().toISOString(),
      };
   }

   async publish(
      chapterId: string,
      event: TranscodingEvent,
      options?: { force?: boolean }
   ): Promise<void> {
      const channel = TranscodingEventPublisher.channelForChapter(chapterId);
      try {
         await this.publisher.publish(channel, JSON.stringify(event));
      } catch (error) {
         redisLogger.error({ err: error, chapterId, channel }, 'Failed to publish transcoding event');
      }

      const key = `${chapterId}:${event.bitrate}`;
      this.throttleMap.set(key, {
         lastPublishedAt: Date.now(),
         lastProgress: event.progress,
      });
   }

   async publishProgress(
      chapterId: string,
      bitrate: number,
      progress: number,
      options?: { force?: boolean }
   ): Promise<void> {
      const key = `${chapterId}:${bitrate}`;
      const now = Date.now();
      const state = this.throttleMap.get(key);
      const clamped = Math.max(0, Math.min(100, Math.round(progress)));

      if (!options?.force && state) {
         const elapsed = now - state.lastPublishedAt;
         const delta = Math.abs(clamped - state.lastProgress);
         if (elapsed < THROTTLE_MS && delta < MIN_PROGRESS_DELTA) {
            return;
         }
      }

      const event = this.buildEvent(chapterId, bitrate, 'processing', clamped);
      await this.publish(chapterId, event);
   }

   async publishStatusTransition(
      chapterId: string,
      bitrate: number,
      status: BitrateTranscodingState,
      progress: number,
      errorMessage?: string
   ): Promise<void> {
      const event = this.buildEvent(chapterId, bitrate, status, progress, errorMessage);
      await this.publish(chapterId, event, { force: true });
   }

   createSubscriber(): Redis {
      return this.publisher.duplicate();
   }

   clearThrottle(chapterId: string, bitrate?: number): void {
      if (bitrate !== undefined) {
         this.throttleMap.delete(`${chapterId}:${bitrate}`);
         return;
      }
      for (const key of this.throttleMap.keys()) {
         if (key.startsWith(`${chapterId}:`)) {
            this.throttleMap.delete(key);
         }
      }
   }
}
