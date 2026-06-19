export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  coverArt?: string;
  urlPath: string;
  filePath?: string;
  lyrics?: string;
  syncedLyrics?: string;
  canvasPath?: string;
  mtimeMs?: number;
  fileSize?: number;
  isUnavailable?: boolean;
}

export type LoopMode = 'off' | 'all' | 'one';

export interface PlaybackState {
  isPlaying: boolean;
  currentTrack: Track | null;
  volume: number;
  progress: number;
  duration: number;
  isShuffle: boolean;
  loopMode: LoopMode;
  queue: Track[];
  shuffledQueue: Track[];
  playQueue: Track[];
}
