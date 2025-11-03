/**
 * HLS Streaming Service
 * Handles HLS playlist generation and adaptive bitrate streaming
 */
import { PrismaClient } from '@prisma/client';
import { StreamingCacheService, StreamingCacheFactory } from './StreamingCacheService';
import { StorageProvider } from './storage/StorageProvider';
import { StorageFactory } from './storage/StorageFactory';
// import { config } from '../config/env';

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

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.cacheService = StreamingCacheFactory.getInstance();
      this.storageProvider = StorageFactory.getStorageProvider();
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

         // Cache the master playlist
         await this.cacheService.cachePlaylist(chapterId, 0, masterPlaylistInfo.masterPlaylist, true);

         return {
            contentType: 'application/vnd.apple.mpegurl',
            content: masterPlaylistInfo.masterPlaylist,
            headers: {
               'Cache-Control': 'public, max-age=300', // 5 minutes
               'Access-Control-Allow-Origin': '*',
               'Access-Control-Allow-Headers': 'Range, Content-Range'
            },
            statusCode: 200
         };

      } catch (error: any) {
         console.error('Error generating master playlist:', error);
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

         // Try to get from cache first
         let playlistContent = await this.cacheService.getCachedPlaylist(chapterId, bitrate);

         if (!playlistContent) {
            // Generate playlist from segments
            playlistContent = await this.generateVariantPlaylist(chapterId, bitrate, transcodedChapter);

            // Cache the playlist
            await this.cacheService.cachePlaylist(chapterId, bitrate, playlistContent);
         }

         return {
            contentType: 'application/vnd.apple.mpegurl',
            content: playlistContent,
            headers: {
               'Cache-Control': 'public, max-age=60', // 1 minute
               'Access-Control-Allow-Origin': '*',
               'Access-Control-Allow-Headers': 'Range, Content-Range'
            },
            statusCode: 200
         };

      } catch (error: any) {
         console.error('Error generating variant playlist:', error);
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

         // Construct storage path for segment
         const segmentPath = `${transcodedChapter.segmentsPath}/${segmentId}`;

         // Try to get from cache first
         let segmentContent = await this.cacheService.getCachedSegment(segmentId);

         if (!segmentContent) {
            // Get from storage with fallback
            segmentContent = await this.cacheService.getSegmentWithFallback(segmentId, segmentPath);

            if (!segmentContent) {
               return this.createErrorResponse('Segment not found', 404);
            }
         }

         return {
            contentType: 'video/mp2t',
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
         console.error('Error getting segment:', error);
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
   }> {
      try {
         // Check if chapter exists and user has access
         // const chapter = await this.validateChapterAccess(chapterId, userId);
         // if (!chapter) {
         //    throw new Error('Chapter not found or access denied');
         // }

         // Get available bitrates
         const availableBitrates = await this.getAvailableBitrates(chapterId);

         // Get transcoding status
         const transcodingJobs = await this.prisma.transcodingJob.findMany({
            where: { chapterId },
            orderBy: { createdAt: 'desc' },
            take: 1
         });

         const transcodingStatus = transcodingJobs.length > 0 && transcodingJobs[0]
            ? transcodingJobs[0].status
            : 'not_started';

         const canStream = availableBitrates.length > 0;

         return {
            chapterId,
            availableBitrates,
            transcodingStatus,
            canStream,
            estimatedBandwidth: this.estimateBandwidth(availableBitrates)
         };

      } catch (error: any) {
         console.error('Error getting streaming status:', error);
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
         console.error('Error getting available bitrates:', error);
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
               playlistUrl: `bit_transcode/${chapterId}/${bitrate}k/playlist.m3u8`,
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

      // Generate master playlist content
      let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

      for (const bitrateInfo of bitrateInfos) {
         masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${bitrateInfo.bandwidth},CODECS="mp4a.40.2"`;

         if (bitrateInfo.bitrate === recommendedBitrate) {
            masterPlaylist += ',RESOLUTION=0x0';
         }

         masterPlaylist += `\n${bitrateInfo.playlistUrl}\n\n`;
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
      _chapterId: string,
      _bitrate: number,
      transcodedChapter: any
   ): Promise<string> {
      try {
         // List segments in storage
         const segments = await this.storageProvider.listFiles(transcodedChapter.segmentsPath);
         const segmentFiles = segments.filter(seg => seg.endsWith('.ts')).sort();

         let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n\n';

         for (const segmentFile of segmentFiles) {
            const segmentName = segmentFile.split('/').pop();
            playlist += `#EXTINF:10.0,\n${segmentName}\n`;
         }

         playlist += '#EXT-X-ENDLIST\n';

         return playlist;
      } catch (error: any) {
         console.error('Error generating variant playlist:', error);
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
         const segmentFiles = segments.filter(seg => seg.endsWith('.ts'));

         await this.cacheService.preloadChapterSegments(chapterId, bitrate, segmentFiles.length);

         return true;
      } catch (error: any) {
         console.error('Error preloading chapter:', error);
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
         console.error('Error getting streaming analytics:', error);
         return {
            totalRequests: 0,
            cacheHitRate: 0,
            averageBandwidth: 0,
            popularBitrates: []
         };
      }
   }
}
