import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config/env';
import { logger } from '../config/logger';

let configured = false;

function getWindowsCandidatePaths(exeName: string): string[] {
   const localAppData = process.env['LOCALAPPDATA'];
   const programFiles = process.env['ProgramFiles'];

   return [
      localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links', exeName) : '',
      path.join('C:', 'ffmpeg', 'bin', exeName),
      programFiles ? path.join(programFiles, 'ffmpeg', 'bin', exeName) : '',
      localAppData ? path.join(localAppData, 'Programs', 'ffmpeg', 'bin', exeName) : '',
   ].filter((candidate): candidate is string => Boolean(candidate));
}

/**
 * Resolve ffmpeg/ffprobe when configured as a bare command name but not on PATH.
 */
export function resolveExecutablePath(configuredPath: string, defaultName: 'ffmpeg' | 'ffprobe'): string {
   if (path.isAbsolute(configuredPath)) {
      if (fs.existsSync(configuredPath)) {
         return configuredPath;
      }
      logger.warn({ configuredPath, executable: defaultName }, 'Configured executable path does not exist, trying fallbacks');
   }

   if (process.platform === 'win32') {
      const exeName = `${defaultName}.exe`;
      for (const candidate of getWindowsCandidatePaths(exeName)) {
         if (fs.existsSync(candidate)) {
            logger.info({ path: candidate, executable: defaultName }, 'Resolved executable from common install location');
            return candidate;
         }
      }
   }

   return configuredPath;
}

export function configureFfmpeg(): void {
   if (configured) {
      return;
   }

   const ffmpegPath = resolveExecutablePath(config.FFMPEG_PATH, 'ffmpeg');
   const ffprobePath = resolveExecutablePath(config.FFPROBE_PATH, 'ffprobe');

   ffmpeg.setFfmpegPath(ffmpegPath);
   ffmpeg.setFfprobePath(ffprobePath);

   configured = true;
   logger.info({ ffmpegPath, ffprobePath }, 'FFmpeg configured for transcoding');
}
