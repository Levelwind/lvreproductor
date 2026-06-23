import { spawn, execSync, ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';
import { LoopMode, PlaybackState, Track } from '../types/player';
import { getConfigPath } from '../utils/config';

interface AudioConfig {
  audioDevice: string;
  exclusiveMode: boolean;
  gaplessMode: boolean;
  replayGainMode: 'off' | 'track' | 'album';
}

function getAudioConfig(): AudioConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.audio) {
        return {
          audioDevice: config.audio.audioDevice || 'wasapi/exclusive',
          exclusiveMode: config.audio.exclusiveMode !== false,
          gaplessMode: config.audio.gaplessMode !== false,
          replayGainMode: config.audio.replayGainMode || 'track'
        };
      }
    }
  } catch (err) {
    console.error('[Player] Error leyendo config.json para audio:', err);
  }
  return {
    audioDevice: 'wasapi/exclusive',
    exclusiveMode: true,
    gaplessMode: true,
    replayGainMode: 'track'
  };
}

type MpvCommand = Array<string | number | boolean>;

interface MpvMessage {
  event?: string;
  name?: string;
  data?: unknown;
  reason?: string;
  file_error?: string;
}

class PlayerService {
  private mpvProcess: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private ipcPath = '\\\\.\\pipe\\mpv-socket';
  private isConnected = false;
  private buffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private commandQueue: MpvCommand[] = [];
  private forceSharedMode = false;
  private isFileLoaded = false;
  private consecutiveErrors = 0;
  private lastSkipTime = 0;

  private state: PlaybackState = {
    isPlaying: false,
    currentTrack: null,
    volume: 0.8,
    progress: 0,
    duration: 0,
    isShuffle: false,
    loopMode: 'off',
    queue: [],
    shuffledQueue: [],
    playQueue: []
  };

  private history: string[] = [];
  private sseClients: Response[] = [];
  private lastPrevClick = 0;

  constructor() {
    // Limpiar procesos mpv huérfanos de sesiones anteriores
    // para liberar el named pipe y el dispositivo de audio WASAPI exclusive
    try {
      execSync('taskkill /F /IM mpv.exe', { stdio: 'ignore' });
      console.log('[MPV] Procesos mpv huérfanos terminados.');
      // Esperar a que el named pipe y el dispositivo de audio se liberen
      setTimeout(() => this.startMpv(), 500);
    } catch {
      // No había procesos stale, iniciar directamente
      this.startMpv();
    }
    this.registerProcessCleanup();
  }

  private registerProcessCleanup() {
    const cleanup = () => {
      if (this.mpvProcess) {
        try { this.mpvProcess.kill(); } catch { /* ignore */ }
        this.mpvProcess = null;
      }
      this.socket?.destroy();
      this.socket = null;
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(); });
    process.on('SIGTERM', () => { cleanup(); process.exit(); });
  }

  private startMpv() {
    if (this.mpvProcess) return;

    const mpvBinary = process.env.MPV_PATH || 'mpv.exe';

    try {
      const audioConfig = getAudioConfig();
      const args = [
        '--idle',
        `--input-ipc-server=${this.ipcPath}`,
        '--no-video',
        '--mc=0',
        '--audio-stream-silence=yes'
      ];

      const useExclusive = audioConfig.exclusiveMode && !this.forceSharedMode;
      if (useExclusive) {
        args.push(`--audio-device=${audioConfig.audioDevice}`);
      } else {
        args.push('--audio-device=auto');
      }

      if (audioConfig.gaplessMode) {
        args.push('--gapless-audio=yes');
      } else {
        args.push('--gapless-audio=no');
      }

      if (audioConfig.replayGainMode && audioConfig.replayGainMode !== 'off') {
        args.push(`--replaygain=${audioConfig.replayGainMode}`);
      } else {
        args.push('--replaygain=no');
      }

      console.log(`[MPV] Iniciando proceso con argumentos: ${args.join(' ')}`);

      const proc = spawn(mpvBinary, args, {
        windowsHide: true,
        stdio: 'ignore'
      });
      this.mpvProcess = proc;

      proc.once('spawn', () => {
        setTimeout(() => this.connectToIpc(), 500);
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (this.mpvProcess === proc) {
          this.mpvProcess = null;
          this.isConnected = false;
          this.socket?.destroy();
          this.socket = null;
        }

        if (err.code === 'ENOENT') {
          console.error('[MPV] No se encontró mpv.exe. Instala mpv o define MPV_PATH con la ruta absoluta al ejecutable.');
          return;
        }

        console.error('[MPV] Falló al iniciar:', err.message);
      });

      proc.on('exit', (code, signal) => {
        console.warn(`[MPV] Proceso finalizado. code=${code ?? 'null'} signal=${signal ?? 'null'}`);
        if (this.mpvProcess === proc) {
          this.mpvProcess = null;
          this.isConnected = false;
          this.socket?.destroy();
          this.socket = null;
        }
      });
    } catch (err) {
      console.error('[MPV] Error en spawn:', err);
      this.mpvProcess = null;
    }
  }

  private connectToIpc() {
    if (this.isConnected || this.socket || !this.mpvProcess) return;

    const socket = net.connect(this.ipcPath);
    this.socket = socket;

    socket.on('connect', () => {
      this.isConnected = true;
      this.clearReconnectTimer();
      console.log('[MPV] Conectado exitosamente por IPC Named Pipe.');
      this.initMpvProperties();
      this.flushCommandQueue();
    });

    socket.on('data', (data) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          this.handleMpvResponse(JSON.parse(line) as MpvMessage);
        } catch (err) {
          console.error('[MPV Socket] Respuesta JSON inválida:', line, err);
        }
      }
    });

    socket.on('error', (err) => {
      console.error('[MPV Socket] Error de conexión:', err.message);
      this.isConnected = false;
      this.socket = null;
      socket.destroy();
      this.scheduleReconnect();
    });

    socket.on('close', () => {
      this.isConnected = false;
      if (this.socket === socket) {
        this.socket = null;
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.mpvProcess) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToIpc();
    }, 1000);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private sendCommand(command: MpvCommand) {
    if (!this.mpvProcess) {
      console.log('[Player] mpv no está corriendo. Iniciando mpv...');
      this.startMpv();
    }

    if (!this.isConnected || !this.socket) {
      if (this.commandQueue.length >= 25) this.commandQueue.shift();
      this.commandQueue.push(command);
      return;
    }

    this.socket.write(`${JSON.stringify({ command })}\n`);
  }

  private flushCommandQueue() {
    const pending = [...this.commandQueue];
    this.commandQueue = [];
    pending.forEach(command => this.sendCommand(command));
  }

  private initMpvProperties() {
    this.sendCommand(['observe_property', 1, 'time-pos']);
    this.sendCommand(['observe_property', 2, 'pause']);
    this.sendCommand(['observe_property', 3, 'volume']);
    this.sendCommand(['observe_property', 4, 'duration']);
    this.sendCommand(['observe_property', 5, 'path']);
  }

  private handleMpvResponse(msg: MpvMessage) {
    if (msg.event === 'property-change') {
      this.handlePropertyChange(msg.name, msg.data);
    }

    if (msg.event === 'end-file') {
      this.isFileLoaded = false;
      if (msg.reason === 'eof') {
        console.log('[MPV] Canción finalizada naturalmente (EOF).');
        this.handleTrackEnd();
      } else if (msg.reason === 'error') {
        if (msg.file_error === 'audio output initialization failed') {
          console.error('[MPV] Error al inicializar salida de audio (WASAPI exclusive probablemente ocupado o no soportado).');
          if (!this.forceSharedMode) {
            console.warn('[MPV] Forzando modo compartido (audio-device=auto) y reiniciando mpv...');
            this.forceSharedMode = true;

            const currentTrack = this.state.currentTrack;
            const currentQueue = this.state.queue;
            const currentProgress = this.state.progress;

            // Apagar mpv actual
            if (this.mpvProcess) {
              try { this.mpvProcess.kill(); } catch { /* ignore */ }
              this.mpvProcess = null;
            }
            this.isConnected = false;
            this.socket?.destroy();
            this.socket = null;

            // Iniciar mpv de nuevo
            this.startMpv();

            // Si había una canción reproduciéndose, volver a intentar
            if (currentTrack) {
              setTimeout(() => {
                console.log(`[Player] Reintentando reproducir pista fallida: ${currentTrack.title}`);
                this.playTrack(currentTrack, currentQueue, currentProgress);
              }, 1000);
            }
          }
        } else {
          console.error(`[MPV] Error en archivo de música: ${msg.file_error || 'Desconocido'}`);
          this.consecutiveErrors += 1;
          const totalTracks = this.state.queue.length || 1;
          if (this.consecutiveErrors >= totalTracks) {
            console.error('[Player] Todos los tracks en la cola fallaron. Deteniendo reproducción.');
            this.consecutiveErrors = 0;
            this.state.isPlaying = false;
            this.broadcastState('isPlaying');
            this.sendCommand(['stop']);
          } else {
            console.log('[Player] Saltando al siguiente track disponible por error en reproducción...');
            this.skipNext(false);
          }
        }
      }
    }
  }

  private handlePropertyChange(name: string | undefined, data: unknown) {
    if (name === 'time-pos' && typeof data === 'number') {
      this.state.progress = data;
      this.broadcastState('progress');
      return;
    }

    if (name === 'pause' && typeof data === 'boolean') {
      this.state.isPlaying = !data;
      this.broadcastState('isPlaying');
      return;
    }

    if (name === 'volume' && typeof data === 'number') {
      this.state.volume = data / 100;
      this.broadcastState('volume');
      return;
    }

    if (name === 'duration' && typeof data === 'number') {
      this.state.duration = data;
      this.broadcastState('duration');
      return;
    }

    if (name === 'path') {
      this.isFileLoaded = typeof data === 'string' && data !== '';
      if (typeof data === 'string' && data !== '') {
        this.consecutiveErrors = 0;
        const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
        const track = activeQueue.find(t => t.filePath === data);
        if (track && this.state.currentTrack?.id !== track.id) {
          console.log(`[MPV] Transición de pista detectada por cambio de ruta: ${track.title}`);
          this.state.currentTrack = track;
          this.state.progress = 0;
          this.state.duration = track.duration || 0;
          this.state.isPlaying = true;
          this.addToHistory(track.id);
          this.broadcastFullState();
          this.preloadNextTrack();
        }
      }
    }
  }

  private preloadNextTrack() {
    if (this.state.playQueue.length > 0) {
      const currentInPlayQueueIndex = this.state.playQueue.findIndex(t => t.id === this.state.currentTrack?.id);
      let nextTrack: Track | undefined;
      
      if (currentInPlayQueueIndex !== -1) {
        if (currentInPlayQueueIndex < this.state.playQueue.length - 1) {
          nextTrack = this.state.playQueue[currentInPlayQueueIndex + 1];
        } else {
          // Último de la playQueue, precargar el siguiente track de la playlist activa
          const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
          if (activeQueue.length > 0) {
            const activeIndex = activeQueue.findIndex(t => t.id === this.state.currentTrack?.id);
            if (activeIndex >= 0 && activeIndex < activeQueue.length - 1) {
              nextTrack = activeQueue[activeIndex + 1];
            } else if (activeIndex === activeQueue.length - 1 && this.state.loopMode === 'all') {
              nextTrack = activeQueue[0];
            }
          }
        }
      } else {
        // La canción actual no pertenece a la playQueue manual, por lo tanto el siguiente será el primero en la playQueue
        nextTrack = this.state.playQueue[0];
      }

      if (nextTrack && nextTrack.filePath) {
        console.log(`[Player] Precargando siguiente pista prioritaria en mpv: ${nextTrack.title}`);
        this.sendCommand(['loadfile', nextTrack.filePath, 'append']);
        return;
      }
    }

    const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
    if (activeQueue.length === 0 || !this.state.currentTrack) return;

    const index = activeQueue.findIndex(track => track.id === this.state.currentTrack?.id);
    if (index >= 0 && index < activeQueue.length - 1) {
      const nextTrack = activeQueue[index + 1];
      if (nextTrack.filePath) {
        console.log(`[Player] Precargando siguiente pista en mpv: ${nextTrack.title}`);
        this.sendCommand(['loadfile', nextTrack.filePath, 'append']);
      }
    }
  }

  private distributeShuffle(tracks: Track[]): Track[] {
    if (tracks.length <= 1) return tracks;

    const grouped = tracks.reduce((acc, track) => {
      const artist = track.artist || 'Unknown';
      if (!acc[artist]) acc[artist] = [];
      acc[artist].push(track);
      return acc;
    }, {} as Record<string, Track[]>);

    const shuffleArray = (arr: Track[]) => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };

    for (const artist of Object.keys(grouped)) {
      grouped[artist] = shuffleArray(grouped[artist]);
    }

    const spreadList: { track: Track; sortKey: number }[] = [];
    const artists = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);

    for (const artist of artists) {
      const artistTracks = grouped[artist];
      const count = artistTracks.length;
      const step = tracks.length / count;
      const offset = Math.random() * step;

      artistTracks.forEach((track, i) => {
        const jitter = Math.random() * 0.2;
        let sortKey = offset + (i * step) + jitter;

        if (this.history.length > 0) {
          const historyIndex = this.history.indexOf(track.id);
          if (historyIndex !== -1) {
            const recencyFactor = (historyIndex + 1) / this.history.length;
            const penalty = recencyFactor * tracks.length * 0.7;
            sortKey += penalty;
          }
        }

        spreadList.push({ track, sortKey });
      });
    }

    spreadList.sort((a, b) => a.sortKey - b.sortKey);
    return spreadList.map(item => item.track);
  }

  public getState(): PlaybackState {
    return {
      ...this.state,
      queue: [...this.state.queue],
      shuffledQueue: [...this.state.shuffledQueue]
    };
  }

  /**
   * Estado ligero para SSE: excluye queue/shuffledQueue para evitar
   * payloads de ~1.2MB que rompen la conexión SSE (ERR_CONNECTION_RESET).
   * El frontend ya gestiona su propia cola localmente.
   */
  private getLightState() {
    return {
      isPlaying: this.state.isPlaying,
      currentTrack: this.state.currentTrack,
      volume: this.state.volume,
      progress: this.state.progress,
      duration: this.state.duration,
      isShuffle: this.state.isShuffle,
      loopMode: this.state.loopMode,
      playQueue: this.state.playQueue
    };
  }

  public playTrack(track: Track, newQueue?: Track[], startSeconds = 0) {
    if (newQueue) {
      this.state.queue = newQueue;
      if (this.state.isShuffle) {
        this.generateShuffledQueue(track);
      }
    }

    if (!this.isTrackAvailable(track)) {
      console.warn(`[Player] El track '${track.title}' no está disponible. Buscando el siguiente...`);
      this.consecutiveErrors += 1;
      const totalTracks = this.state.queue.length || 1;
      if (this.consecutiveErrors >= totalTracks) {
        console.error('[Player] Todos los tracks en la cola fallaron. Deteniendo reproducción.');
        this.consecutiveErrors = 0;
        this.state.isPlaying = false;
        this.broadcastState('isPlaying');
        this.sendCommand(['stop']);
        return;
      }

      const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
      const index = activeQueue.findIndex(t => t.id === track.id);
      const nextInfo = this.findNextAvailableTrack(activeQueue, index >= 0 ? index + 1 : 0);
      if (nextInfo) {
        this.playTrack(nextInfo.track, undefined, startSeconds);
      } else {
        console.error('[Player] No hay más tracks disponibles en la cola.');
        this.state.isPlaying = false;
        this.broadcastState('isPlaying');
        this.sendCommand(['stop']);
      }
      return;
    }

    this.state.currentTrack = track;
    this.state.progress = startSeconds;
    this.state.duration = track.duration || 0;
    this.addToHistory(track.id);
    this.broadcastFullState();

    if (!track.filePath) {
      console.error('[Player] Error: el track no tiene filePath absoluto.');
      return;
    }

    console.log(`[Player] Cargando canción local en mpv: ${track.filePath}`);
    this.isFileLoaded = true;
    this.sendCommand(['loadfile', track.filePath]);

    if (startSeconds > 0) {
      setTimeout(() => this.sendCommand(['seek', startSeconds, 'absolute']), 300);
    }
  }

  public togglePlay() {
    if (!this.state.currentTrack) return;
    if (this.isFileLoaded) {
      this.sendCommand(['cycle', 'pause']);
    } else {
      this.playTrack(this.state.currentTrack, undefined, this.state.progress);
    }
  }

  public setVolume(volume: number) {
    const normalizedVolume = Math.max(0, Math.min(1, volume));
    this.state.volume = normalizedVolume;
    this.sendCommand(['set_property', 'volume', normalizedVolume * 100]);
    this.broadcastState('volume');
  }

  public seekTo(seconds: number) {
    const targetSeconds = Math.max(0, seconds);
    this.state.progress = targetSeconds;
    this.sendCommand(['seek', targetSeconds, 'absolute']);
    this.broadcastState('progress');
  }

  public toggleShuffle() {
    this.state.isShuffle = !this.state.isShuffle;

    if (this.state.isShuffle && this.state.queue.length > 0) {
      this.generateShuffledQueue(this.state.currentTrack);
    } else {
      this.state.shuffledQueue = [];
    }

    this.broadcastFullState();
  }

  public toggleLoop() {
    const modes: LoopMode[] = ['off', 'all', 'one'];
    const nextIndex = (modes.indexOf(this.state.loopMode) + 1) % modes.length;
    this.state.loopMode = modes[nextIndex];
    this.broadcastState('loopMode');
  }

  private isTrackAvailable(track: Track | null): boolean {
    if (!track) return false;
    if (track.isUnavailable) return false;
    if (!track.filePath) return false;
    return fs.existsSync(track.filePath);
  }

  private findNextAvailableTrack(queue: Track[], startIndex: number): { track: Track; index: number } | null {
    if (queue.length === 0) return null;
    
    // Buscar hacia adelante
    for (let i = startIndex; i < queue.length; i++) {
      if (this.isTrackAvailable(queue[i])) {
        return { track: queue[i], index: i };
      }
    }
    
    // Si loopMode es 'all', buscar desde el principio
    if (this.state.loopMode === 'all') {
      for (let i = 0; i < startIndex; i++) {
        if (this.isTrackAvailable(queue[i])) {
          return { track: queue[i], index: i };
        }
      }
    }
    
    return null;
  }

  private findPrevAvailableTrack(queue: Track[], startIndex: number): { track: Track; index: number } | null {
    if (queue.length === 0) return null;
    
    // Buscar hacia atrás
    for (let i = startIndex; i >= 0; i--) {
      if (this.isTrackAvailable(queue[i])) {
        return { track: queue[i], index: i };
      }
    }
    
    // Si loopMode es 'all', buscar desde el final
    if (this.state.loopMode === 'all') {
      for (let i = queue.length - 1; i > startIndex; i--) {
        if (this.isTrackAvailable(queue[i])) {
          return { track: queue[i], index: i };
        }
      }
    }
    
    return null;
  }

  public skipNext(isManual = false) {
    if (isManual) {
      const now = Date.now();
      if (now - this.lastSkipTime < 400) {
        console.log('[Player] Manual skipNext ignorado por rate limit (anti-spam)');
        return;
      }
      this.lastSkipTime = now;
    }

    const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
    if (activeQueue.length === 0 || !this.state.currentTrack) return;

    const index = activeQueue.findIndex(track => track.id === this.state.currentTrack?.id);
    let nextInfo = this.findNextAvailableTrack(activeQueue, index + 1);

    if (nextInfo) {
      if (this.state.isShuffle && nextInfo.index <= index) {
        console.log('[Shuffle] Fin de cola detectado al saltar. Regenerando orden...');
        this.generateShuffledQueue(null);
        const newShuffled = this.state.shuffledQueue;
        nextInfo = this.findNextAvailableTrack(newShuffled, 0);
        if (nextInfo) {
          this.playTrack(nextInfo.track);
        } else {
          this.state.isPlaying = false;
          this.broadcastState('isPlaying');
          this.sendCommand(['stop']);
        }
      } else {
        this.playTrack(nextInfo.track);
      }
    } else {
      this.state.isPlaying = false;
      this.broadcastState('isPlaying');
      this.sendCommand(['stop']);
    }
  }

  public skipPrevious(isManual = false) {
    if (isManual) {
      const now = Date.now();
      if (now - this.lastSkipTime < 400) {
        console.log('[Player] Manual skipPrevious ignorado por rate limit (anti-spam)');
        return;
      }
      this.lastSkipTime = now;
    }

    const nowTime = Date.now();
    const timeSinceLastClick = nowTime - this.lastPrevClick;
    this.lastPrevClick = nowTime;

    if (this.state.progress > 3 && timeSinceLastClick > 2000) {
      this.seekTo(0);
      return;
    }

    const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
    if (activeQueue.length === 0 || !this.state.currentTrack) return;

    const index = activeQueue.findIndex(track => track.id === this.state.currentTrack?.id);
    const prevInfo = this.findPrevAvailableTrack(activeQueue, index - 1);
    if (prevInfo) {
      this.playTrack(prevInfo.track);
    }
  }

  private generateShuffledQueue(firstTrack: Track | null) {
    let shuffled = this.distributeShuffle(this.state.queue);

    if (firstTrack) {
      shuffled = [firstTrack, ...shuffled.filter(track => track.id !== firstTrack.id)];
    }

    this.state.shuffledQueue = shuffled;
  }

  public addToPlayQueue(track: Track) {
    this.state.playQueue.push(track);
    this.broadcastState('playQueue');
    this.preloadNextTrack();
  }

  private handleTrackEnd() {
    if (this.state.loopMode === 'one' && this.state.currentTrack && this.isTrackAvailable(this.state.currentTrack)) {
      this.playTrack(this.state.currentTrack);
      return;
    }

    if (this.state.playQueue.length > 0) {
      while (this.state.playQueue.length > 0) {
        const nextTrack = this.state.playQueue.shift()!;
        this.broadcastState('playQueue');
        if (this.isTrackAvailable(nextTrack)) {
          this.playTrack(nextTrack);
          return;
        }
      }
    }

    const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
    if (activeQueue.length === 0 || !this.state.currentTrack) return;

    const index = activeQueue.findIndex(track => track.id === this.state.currentTrack?.id);
    let nextInfo = this.findNextAvailableTrack(activeQueue, index + 1);

    if (nextInfo) {
      if (this.state.isShuffle && nextInfo.index <= index) {
        console.log('[Shuffle] Fin de cola detectado al reproducir. Regenerando orden...');
        this.generateShuffledQueue(null);
        const newShuffled = this.state.shuffledQueue;
        nextInfo = this.findNextAvailableTrack(newShuffled, 0);
        if (nextInfo) {
          this.playTrack(nextInfo.track);
        } else {
          this.state.isPlaying = false;
          this.broadcastState('isPlaying');
        }
      } else {
        this.playTrack(nextInfo.track);
      }
    } else {
      this.state.isPlaying = false;
      this.broadcastState('isPlaying');
    }
  }

  private addToHistory(id: string) {
    this.history = this.history.filter(historyId => historyId !== id);
    this.history.push(id);
    if (this.history.length > 50) this.history.shift();
  }

  public registerSseClient(res: Response) {
    this.sseClients.push(res);
    res.write(`data: ${JSON.stringify({ type: 'full', state: this.getLightState() })}\n\n`);

    res.on('close', () => {
      this.sseClients = this.sseClients.filter(client => client !== res);
    });
  }

  private broadcastState(property: keyof PlaybackState) {
    const payload = JSON.stringify({
      type: 'update',
      property,
      value: this.state[property]
    });

    this.sseClients.forEach(client => client.write(`data: ${payload}\n\n`));
  }

  private broadcastFullState() {
    const payload = JSON.stringify({
      type: 'full',
      state: this.getLightState()
    });

    this.sseClients.forEach(client => client.write(`data: ${payload}\n\n`));
  }
}

export default new PlayerService();
