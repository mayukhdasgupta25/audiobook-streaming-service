/**
 * HLS Streaming Service
 * Handles HLS playlist generation and adaptive bitrate streaming
 */
import { PrismaClient } from '@prisma/client';
import { StreamingCacheService, StreamingCacheFactory } from './StreamingCacheService';
import { StorageProvider } from './storage/StorageProvider';
import { StorageFactory } from './storage/StorageFactory';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { DetailedTranscodingService } from './DetailedTranscodingService';
import {
   isDevelopmentStreaming,
   presignMasterPlaylistUrls,
   presignVariantPlaylistUrls,
   getMasterPlaylistResponseCacheControl,
   getPlaylistResponseCacheControl,
   buildVariantStorageKey,
   getPresignedObjectUrl,
} from '../utils/streamingStorage';

export interface StreamingOptions {
   chapterId: string;
   userId: string;
   clientBandwidth?: number;
   preferredBitrate?: number;
}

export interface StreamingResponse {
   contentType: string;
   content: Buffer | string;
   headers: Record<string, string>;
   statusCode: number;
}

export interface BitrateInfo {
   bitrate: number;
   bandwidth: number;
   playlistUrl: string;
   segmentsPath: string;
   available: boolean;
}

export interface MasterPlaylistInfo {
   chapterId: string;
   availableBitrates: BitrateInfo[];
   recommendedBitrate: number;
   masterPlaylist: string;
}

export class HLSStreamingService {
   private prisma: PrismaClient;
   private cacheService: StreamingCacheService;
   private storageProvider: StorageProvider;
   private readonly detailService: DetailedTranscodingService;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.cacheService = StreamingCacheFactory.getInstance();
      this.storageProvider = StorageFactory.getStorageProvider();
      this.detailService = new DetailedTranscodingService(prisma);
   }

   /**
    * Get master playlist for a chapter
    */
   async getMasterPlaylist(options: StreamingOptions): Promise<StreamingResponse> {
      const { chapterId, clientBandwidth, preferredBitrate } = options;

      try {
         // Check if chapter exists and user has access
         // const chapter = await this.validateChapterAccess(chapterId, userId);
         // if (!chapter) {
         //    return this.createErrorResponse('Chapter not found or access denied', 404);
         // }

         // Get available transcoded bitrates
         const availableBitrates = await this.getAvailableBitrates(chapterId);

         if (availableBitrates.length === 0) {
            return this.createErrorResponse('No transcoded versions available', 404);
         }

         // Generate master playlist
         const masterPlaylistInfo = await this.generateMasterPlaylist(
            chapterId,
            availableBitrates,
            clientBandwidth,
            preferredBitrate
         );

         if (isDevelopmentStreaming()) {
            await this.cacheService.cachePlaylist(chapterId, 0, masterPlaylistInfo.masterPlaylist, true);
         }

         return {
            contentType: 'application/vnd.apple.mpegurl',
            content: masterPlaylistInfo.masterPlaylist,
            headers: {
               'Cache-Control': getMasterPlaylistResponseCacheControl(),
               'Access-Control-Allow-Origin': '*',
               'Access-Control-Allow-Headers': 'Range, Content-Range'
            },
            statusCode: 200
         };

      } catch (error: any) {
         logger.error({ err: error }, 'Error generating master playlist');
         return this.createErrorResponse('Internal server error', 500);
      }
   }

   /**
    * Get variant playlist for specific bitrate
    */
   async getVariantPlaylist(
      chapterId: string,
      bitrate: number
   ): Promise<StreamingResponse> {
      try {
         // Check if chapter exists and user has access
         // const chapter = await this.validateChapterAccess(chapterId, userId);
         // if (!chapter) {
         //    return this.createErrorResponse('Chapter not found or access denied', 404);
         // }

         // Check if transcoded version exists for this bitrate
         const transcodedChapter = await this.prisma.transcodedChapter.findUnique({
            where: {
               chapterId_bitrate: {
                  chapterId,
                  bitrate
               }
            }
         });

         if (!transcodedChapter || transcodedChapter.status !== 'completed') {
            return this.createErrorResponse('Transcoded version not available', 404);
         }

         let playlistContent: string;

         if (isDevelopmentStreaming()) {
            playlistContent = await this.cacheService.getCachedPlaylist(chapterId, bitrate) ?? '';
            if (!playlistContent) {
               playlistContent = await this.generateVariantPlaylist(chapterId, bitrate, transcodedChapter);
               await this.cacheService.cachePlaylist(chapterId, bitrate, playlistContent);
            }
         } else {
            playlistContent = await this.generateVariantPlaylist(chapterId, bitrate, transcodedChapter);
         }

         return {
            contentType: 'application/vnd.apple.mpegurl',
            content: playlistContent,
            headers: {
               'Cache-Control': getPlaylistResponseCacheControl(),
               'Access-Control-Allow-Origin': '*',
               'Access-Control-Allow-Headers': 'Range, Content-Range'
            },
            statusCode: 200
         };

      } catch (error: any) {
         logger.error({ err: error }, 'Error generating variant playlist');
         return this.createErrorResponse('Internal server error', 500);
      }
   }

   /**
    * Get HLS segment
    */
   async getSegment(
      chapterId: string,
      bitrate: number,
      segmentId: string
   ): Promise<StreamingResponse> {
      try {
         // Check if chapter exists and user has access
         // const chapter = await this.validateChapterAccess(chapterId, userId);
         // if (!chapter) {
         //    return this.createErrorResponse('Chapter not found or access denied', 404);
         // }

         // Check if transcoded version exists for this bitrate
         const transcodedChapter = await this.prisma.transcodedChapter.findUnique({
            where: {
               chapterId_bitrate: {
                  chapterId,
                  bitrate
               }
            }
         });

         if (!transcodedChapter || transcodedChapter.status !== 'completed') {
            return this.createErrorResponse('Transcoded version not available', 404);
         }

         if (!isDevelopmentStreaming()) {
            const segmentKey = buildVariantStorageKey(chapterId, bitrate, segmentId);
            const presignedUrl = await getPresignedObjectUrl(segmentKey, this.storageProvider);
            const contentType = segmentId.endsWith('.m4s') ? 'video/mp4' : 'video/mp2t';

            return {
               contentType,
               content: '',
               headers: {
                  Location: presignedUrl,
                  'Cache-Control': 'private, no-cache, no-store',
                  'Access-Control-Allow-Origin': '*',
               },
               statusCode: 302,
            };
         }

         // Construct storage path for segment
         const segmentPath = `${transcodedChapter.segmentsPath}/${segmentId}`;

         // Try to get from cache first
         let segmentContent = await this.cacheService.getCachedSegment(chapterId, bitrate, segmentId);

         if (!segmentContent) {
            // Get from storage with fallback
            segmentContent = await this.cacheService.getSegmentWithFallback(chapterId, bitrate, segmentId, segmentPath);

            if (!segmentContent) {
               return this.createErrorResponse('Segment not found', 404);
            }
         }

         // Determine content type based on segment extension
         const contentType = segmentId.endsWith('.m4s') ? 'video/mp4' : 'video/mp2t';

         return {
            contentType,
            content: segmentContent,
            headers: {
               'Cache-Control': 'public, max-age=3600', // 1 hour
               'Access-Control-Allow-Origin': '*',
               'Access-Control-Allow-Headers': 'Range, Content-Range',
               'Content-Length': segmentContent.length.toString()
            },
            statusCode: 200
         };

      } catch (error: any) {
         logger.error({ err: error }, 'Error getting segment');
         return this.createErrorResponse('Internal server error', 500);
      }
   }

   /**
    * Get streaming status for a chapter
    */
   async getStreamingStatus(chapterId: string): Promise<{
      chapterId: string;
      availableBitrates: number[];
      transcodingStatus: string;
      canStream: boolean;
      estimatedBandwidth?: number;
      masterPlaylistReady: boolean;
      aggregateStatus: string;
      bitrates: Array<{
         bitrate: number;
         status: string;
         progress: number;
         errorMessage?: string;
      }>;
   }> {
      try {
         const detailed = await this.detailService.getDetailedStatus(chapterId);
         const availableBitrates = detailed.bitrates
            .filter(b => b.status === 'completed')
            .map(b => b.bitrate);

         return {
            chapterId,
            availableBitrates,
            transcodingStatus: detailed.aggregateStatus,
            canStream: detailed.canStream,
            estimatedBandwidth: this.estimateBandwidth(availableBitrates),
            masterPlaylistReady: detailed.masterPlaylistReady,
            aggregateStatus: detailed.aggregateStatus,
            bitrates: detailed.bitrates,
         };
      } catch (error: unknown) {
         logger.error({ err: error }, 'Error getting streaming status');
         throw error;
      }
   }

   /**
    * Validate chapter access for user
    */
   // private async validateChapterAccess(chapterId: string, _userId: string): Promise<any> {
   //    try {
   //       const chapter = await this.prisma.chapter.findUnique({
   //          where: { id: chapterId },
   //          include: {
   //             audiobook: {
   //                select: {
   //                   id: true,
   //                   title: true,
   //                   isPublic: true,
   //                   isActive: true
   //                }
   //             }
   //          }
   //       });

   //       if (!chapter) {
   //          return null;
   //       }

   //       // Check if audiobook is active and public
   //       if (!chapter.audiobook.isActive || !chapter.audiobook.isPublic) {
   //          return null;
   //       }

   //       // TODO: Add user-specific access checks (subscription, purchase, etc.)
   //       // For now, all public audiobooks are accessible

   //       return chapter;
   //    } catch (error: any) {
   //       console.error('Error validating chapter access:', error);
   //       return null;
   //    }
   // }

   /**
    * Get available bitrates for a chapter
    */
   public async getAvailableBitrates(chapterId: string): Promise<number[]> {
      try {
         const transcodedChapters = await this.prisma.transcodedChapter.findMany({
            where: {
               chapterId,
               status: 'completed'
            },
            select: { bitrate: true },
            orderBy: { bitrate: 'asc' }
         });

         return transcodedChapters.map(tc => tc.bitrate);
      } catch (error: any) {
         logger.error({ err: error }, 'Error getting available bitrates');
         return [];
      }
   }

   /**
    * Generate master playlist
    */
   private async generateMasterPlaylist(
      chapterId: string,
      availableBitrates: number[],
      clientBandwidth?: number,
      preferredBitrate?: number
   ): Promise<MasterPlaylistInfo> {
      const bitrateInfos: BitrateInfo[] = [];

      for (const bitrate of availableBitrates) {
         const transcodedChapter = await this.prisma.transcodedChapter.findUnique({
            where: {
               chapterId_bitrate: {
                  chapterId,
                  bitrate
               }
            }
         });

         if (transcodedChapter) {
            bitrateInfos.push({
               bitrate,
               bandwidth: bitrate * 1000, // Convert kbps to bps
               playlistUrl: `bit_transcode/${chapterId}/${bitrate}k/playlist.m3u8`, // Keep for reference, but we'll use absolute URL in generation
               segmentsPath: transcodedChapter.segmentsPath,
               available: true
            });
         }
      }

      // Determine recommended bitrate
      const recommendedBitrate = this.selectRecommendedBitrate(
         bitrateInfos,
         clientBandwidth,
         preferredBitrate
      );

      // When client requests a specific bitrate, master playlist lists only that variant
      const playlistVariants = preferredBitrate !== undefined
         ? bitrateInfos.filter((bi) => bi.bitrate === recommendedBitrate)
         : bitrateInfos;

      // Generate master playlist content (CMAF-compliant HLS)
      let masterPlaylist: string;

      if (isDevelopmentStreaming()) {
         const baseUrl = config.STREAMING_BASE_URL;
         masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:7\n\n';

         for (const bitrateInfo of playlistVariants) {
            masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${bitrateInfo.bandwidth},CODECS="mp4a.40.2"`;

            if (bitrateInfo.bitrate === recommendedBitrate) {
               masterPlaylist += ',RESOLUTION=0x0';
            }

            const playlistUrl = `${baseUrl}/bit_transcode/${chapterId}/${bitrateInfo.bitrate}k/playlist.m3u8`;
            masterPlaylist += `\n${playlistUrl}\n\n`;
         }
      } else {
         const bitrates = playlistVariants.map((bi) => bi.bitrate);
         const segmentFilesByBitrate = new Map<number, string[]>();

         for (const bitrateInfo of playlistVariants) {
            const segments = await this.storageProvider.listFiles(bitrateInfo.segmentsPath);
            const segmentFiles = segments
               .filter(seg => seg.endsWith('.m4s') || seg.endsWith('.ts'))
               .map(seg => seg.split('/').pop()!)
               .filter(Boolean)
               .sort();
            segmentFilesByBitrate.set(bitrateInfo.bitrate, segmentFiles);
         }

         masterPlaylist = await presignMasterPlaylistUrls(
            chapterId,
            bitrates,
            this.storageProvider,
            recommendedBitrate,
            segmentFilesByBitrate,
         );
      }

      return {
         chapterId,
         availableBitrates: bitrateInfos,
         recommendedBitrate,
         masterPlaylist
      };
   }

   /**
    * Generate variant playlist from segments
    */
   private async generateVariantPlaylist(
      chapterId: string,
      bitrate: number,
      transcodedChapter: { segmentsPath: string }
   ): Promise<string> {
      try {
         const segments = await this.storageProvider.listFiles(transcodedChapter.segmentsPath);
         const segmentFiles = segments
            .filter(seg => seg.endsWith('.m4s') || seg.endsWith('.ts'))
            .map(seg => seg.split('/').pop()!)
            .filter(Boolean)
            .sort();

         let extractedChapterId = chapterId;
         let extractedBitrate = bitrate;

         if (transcodedChapter.segmentsPath) {
            const pathMatch = transcodedChapter.segmentsPath.match(/(?:uploads\/)?bit_transcode\/([^/]+)\/(\d+)k/);
            if (pathMatch) {
               extractedChapterId = pathMatch[1] ?? chapterId;
               extractedBitrate = parseInt(pathMatch[2] ?? String(bitrate), 10);
            }
         }

         if (!isDevelopmentStreaming()) {
            return presignVariantPlaylistUrls(
               extractedChapterId,
               extractedBitrate,
               segmentFiles,
               this.storageProvider,
            );
         }

         const baseUrl = config.STREAMING_BASE_URL;
         const segmentsBasePath = `bit_transcode/${extractedChapterId}/${extractedBitrate}k`;
         const initUri = `${baseUrl}/${segmentsBasePath}/init.mp4`;

         let playlist = `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:5\n#EXT-X-MAP:URI="${initUri}"\n\n`;

         for (const segmentName of segmentFiles) {
            const segmentUrl = `${baseUrl}/${segmentsBasePath}/${segmentName}`;
            playlist += `#EXTINF:${config.HLS_SEGMENT_DURATION}.0,\n${segmentUrl}\n`;
         }

         playlist += '#EXT-X-ENDLIST\n';

         return playlist;
      } catch (error: any) {
         logger.error({ err: error }, 'Error generating variant playlist');
         throw error;
      }
   }

   /**
    * Select recommended bitrate based on client bandwidth
    */
   private selectRecommendedBitrate(
      bitrateInfos: BitrateInfo[],
      clientBandwidth?: number,
      preferredBitrate?: number
   ): number {
      if (preferredBitrate && bitrateInfos.some(bi => bi.bitrate === preferredBitrate)) {
         return preferredBitrate;
      }

      if (!clientBandwidth) {
         // Default to middle bitrate
         const sortedBitrates = bitrateInfos.map(bi => bi.bitrate).sort((a, b) => a - b);
         return sortedBitrates[Math.floor(sortedBitrates.length / 2)] || sortedBitrates[0] || 128;
      }

      // Select highest bitrate that doesn't exceed client bandwidth
      const suitableBitrates = bitrateInfos.filter(bi => bi.bandwidth <= clientBandwidth);

      if (suitableBitrates.length > 0) {
         return suitableBitrates[suitableBitrates.length - 1]?.bitrate || 128;
      }

      // Fallback to lowest bitrate
      return bitrateInfos[0]?.bitrate || 128;
   }

   /**
    * Estimate bandwidth from available bitrates
    */
   private estimateBandwidth(availableBitrates: number[]): number {
      if (availableBitrates.length === 0) {
         return 0;
      }

      // Return the highest available bitrate as estimated bandwidth
      return Math.max(...availableBitrates) * 1000; // Convert to bps
   }

   /**
    * Create error response
    */
   private createErrorResponse(message: string, statusCode: number): StreamingResponse {
      return {
         contentType: 'text/plain',
         content: message,
         headers: {
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*'
         },
         statusCode
      };
   }

   /**
    * Preload chapter for streaming
    */
   async preloadChapter(chapterId: string, bitrate: number): Promise<boolean> {
      try {
         const transcodedChapter = await this.prisma.transcodedChapter.findUnique({
            where: {
               chapterId_bitrate: {
                  chapterId,
                  bitrate
               }
            }
         });

         if (!transcodedChapter || transcodedChapter.status !== 'completed') {
            return false;
         }

         // Preload segments into cache
         const segments = await this.storageProvider.listFiles(transcodedChapter.segmentsPath);
         const segmentFiles = segments.filter(seg => seg.endsWith('.m4s') || seg.endsWith('.ts'));

         await this.cacheService.preloadChapterSegments(chapterId, bitrate, segmentFiles.length);

         return true;
      } catch (error: any) {
         logger.error({ err: error }, 'Error preloading chapter');
         return false;
      }
   }

   /**
    * Get streaming analytics
    */
   async getStreamingAnalytics(_chapterId: string): Promise<{
      totalRequests: number;
      cacheHitRate: number;
      averageBandwidth: number;
      popularBitrates: Array<{ bitrate: number; requests: number }>;
   }> {
      try {
         const cacheStats = await this.cacheService.getCacheStats();

         // TODO: Implement detailed analytics tracking
         // This would require additional database tables to track streaming metrics

         return {
            totalRequests: cacheStats.totalRequests,
            cacheHitRate: cacheStats.hitRate,
            averageBandwidth: 0, // TODO: Calculate from actual usage
            popularBitrates: [] // TODO: Track bitrate usage
         };
      } catch (error: any) {
         logger.error({ err: error }, 'Error getting streaming analytics');
         return {
            totalRequests: 0,
            cacheHitRate: 0,
            averageBandwidth: 0,
            popularBitrates: []
         };
      }
   }
}
