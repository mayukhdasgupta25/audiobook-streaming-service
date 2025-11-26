/**
 * DASH Streaming Service
 * Handles DASH manifest generation and adaptive bitrate streaming
 */
import { PrismaClient } from '@prisma/client';
import { StreamingCacheService, StreamingCacheFactory } from './StreamingCacheService';
import { StorageProvider } from './storage/StorageProvider';
import { StorageFactory } from './storage/StorageFactory';
import { config } from '../config/env';

export interface DASHStreamingOptions {
   chapterId: string;
   userId: string;
   clientBandwidth?: number;
   preferredBitrate?: number;
}

export interface DASHStreamingResponse {
   contentType: string;
   content: Buffer | string;
   headers: Record<string, string>;
   statusCode: number;
}

export interface DASHBitrateInfo {
   bitrate: number;
   bandwidth: number;
   segmentsPath: string;
   available: boolean;
   channels: number; // 1 for mono, 2 for stereo
}

export interface DASHManifestInfo {
   chapterId: string;
   availableBitrates: DASHBitrateInfo[];
   recommendedBitrate: number;
   manifest: string;
   segmentDuration: number;
}

export class DASHStreamingService {
   private prisma: PrismaClient;
   private cacheService: StreamingCacheService;
   private storageProvider: StorageProvider;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.cacheService = StreamingCacheFactory.getInstance();
      this.storageProvider = StorageFactory.getStorageProvider();
   }

   /**
    * Get DASH manifest (MPD) for a chapter
    */
   async getDASHManifest(options: DASHStreamingOptions): Promise<DASHStreamingResponse> {
      const { chapterId, clientBandwidth, preferredBitrate } = options;

      try {
         // Get available transcoded bitrates
         const availableBitrates = await this.getAvailableBitrates(chapterId);

         if (availableBitrates.length === 0) {
            return this.createErrorResponse('No transcoded versions available', 404);
         }

         // Generate DASH manifest
         const manifestInfo = await this.generateDASHManifest(
            chapterId,
            availableBitrates,
            clientBandwidth,
            preferredBitrate
         );

         // Cache the manifest
         await this.cacheService.cachePlaylist(chapterId, 0, manifestInfo.manifest, true);

         return {
            contentType: 'application/dash+xml',
            content: manifestInfo.manifest,
            headers: {
               'Cache-Control': 'public, max-age=300', // 5 minutes
               'Access-Control-Allow-Origin': '*',
               'Access-Control-Allow-Headers': 'Range, Content-Range'
            },
            statusCode: 200
         };

      } catch (error: any) {
         console.error('Error generating DASH manifest:', error);
         return this.createErrorResponse('Internal server error', 500);
      }
   }

   /**
    * Get DASH segment
    */
   async getDASHSegment(
      chapterId: string,
      bitrate: number,
      segmentId: string
   ): Promise<DASHStreamingResponse> {
      try {
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
         let segmentContent = await this.cacheService.getCachedSegment(chapterId, bitrate, segmentId);

         if (!segmentContent) {
            // Get from storage with fallback
            segmentContent = await this.cacheService.getSegmentWithFallback(chapterId, bitrate, segmentId, segmentPath);

            if (!segmentContent) {
               return this.createErrorResponse('Segment not found', 404);
            }
         }

         // Determine content type based on segment extension
         const contentType = segmentId.endsWith('.m4s') ? 'video/mp4' :
            segmentId.endsWith('.mp4') ? 'video/mp4' :
               'video/mp2t';

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
         console.error('Error getting DASH segment:', error);
         return this.createErrorResponse('Internal server error', 500);
      }
   }

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
    * Generate DASH manifest (MPD) - Public method for use by processors
    */
   public async generateDASHManifest(
      chapterId: string,
      availableBitrates: number[],
      clientBandwidth?: number,
      preferredBitrate?: number
   ): Promise<DASHManifestInfo> {
      const bitrateInfos: DASHBitrateInfo[] = [];

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
            // Determine channels: 1 for 64k, 2 for others
            const channels = bitrate === 64 ? 1 : 2;

            bitrateInfos.push({
               bitrate,
               bandwidth: bitrate * 1000, // Convert kbps to bps
               segmentsPath: transcodedChapter.segmentsPath,
               available: true,
               channels
            });
         }
      }

      // Determine recommended bitrate
      const recommendedBitrate = this.selectRecommendedBitrate(
         bitrateInfos,
         clientBandwidth,
         preferredBitrate
      );

      // Get segment duration from config
      const segmentDuration = config.HLS_SEGMENT_DURATION;

      // Generate MPD XML
      const manifest = this.generateMPD(chapterId, bitrateInfos, segmentDuration);

      return {
         chapterId,
         availableBitrates: bitrateInfos,
         recommendedBitrate,
         manifest,
         segmentDuration
      };
   }

   /**
    * Generate MPD (Media Presentation Description) XML
    */
   private generateMPD(
      chapterId: string,
      bitrateInfos: DASHBitrateInfo[],
      segmentDuration: number
   ): string {
      const now = new Date().toISOString();
      const minBufferTime = 'PT1.5S';
      const mediaPresentationDuration = `PT${Math.ceil(segmentDuration * 10)}S`; // Estimate, should be calculated from actual duration

      let mpd = '<?xml version="1.0" encoding="UTF-8"?>\n';
      mpd += '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" ';
      mpd += 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ';
      mpd += 'xsi:schemaLocation="urn:mpeg:dash:schema:mpd:2011 DASH-MPD.xsd" ';
      mpd += `type="static" mediaPresentationDuration="${mediaPresentationDuration}" `;
      mpd += `minBufferTime="${minBufferTime}" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">\n`;

      mpd += '  <Period id="0" start="PT0S">\n';
      mpd += '    <AdaptationSet id="0" contentType="audio" segmentAlignment="true" startWithSAP="1">\n';

      // Add each bitrate as a Representation
      for (const bitrateInfo of bitrateInfos) {
         const representationId = `audio_${bitrateInfo.bitrate}`;
         const audioSamplingRate = '48000';
         const codecs = 'mp4a.40.2'; // AAC-LC

         mpd += `      <Representation id="${representationId}" `;
         mpd += `bandwidth="${bitrateInfo.bandwidth}" `;
         mpd += `codecs="${codecs}" `;
         mpd += `audioSamplingRate="${audioSamplingRate}">\n`;

         // SegmentTemplate
         const segmentBasePath = `${bitrateInfo.bitrate}k`;
         const initPath = `${segmentBasePath}/init.mp4`;
         const mediaPath = `${segmentBasePath}/segment_$Number$.m4s`;

         mpd += `        <SegmentTemplate `;
         mpd += `initialization="${initPath}" `;
         mpd += `media="${mediaPath}" `;
         mpd += `duration="${segmentDuration}" `;
         mpd += `startNumber="0" `;
         mpd += `timescale="1"/>\n`;

         mpd += '      </Representation>\n';
      }

      mpd += '    </AdaptationSet>\n';
      mpd += '  </Period>\n';
      mpd += '</MPD>';

      return mpd;
   }

   /**
    * Select recommended bitrate based on client bandwidth
    */
   private selectRecommendedBitrate(
      bitrateInfos: DASHBitrateInfo[],
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
    * Create error response
    */
   private createErrorResponse(message: string, statusCode: number): DASHStreamingResponse {
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
}

