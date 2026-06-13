export type BitrateTranscodingState = 'pending' | 'processing' | 'completed' | 'failed';

export type AggregateTranscodingStatus =
   | 'not_started'
   | 'processing'
   | 'completed'
   | 'partial'
   | 'failed';

export interface TranscodingEvent {
   chapterId: string;
   bitrate: number;
   status: BitrateTranscodingState;
   progress: number;
   errorMessage?: string;
   timestamp: string;
}

export interface BitrateStatusDetail {
   bitrate: number;
   status: BitrateTranscodingState;
   progress: number;
   errorMessage?: string;
}

export interface ChapterTranscodingStatusDetail {
   chapterId: string;
   canStream: boolean;
   masterPlaylistReady: boolean;
   aggregateStatus: AggregateTranscodingStatus;
   bitrates: BitrateStatusDetail[];
}

export interface TranscodingSnapshotEvent {
   chapterId: string;
   bitrates: BitrateStatusDetail[];
   timestamp: string;
}
