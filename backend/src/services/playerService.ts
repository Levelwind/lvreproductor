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
  replayGainPreamp: number;
  crossfadeEnabled: boolean;
  crossfadeDuration: number;
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
          replayGainMode: config.audio.replayGainMode || 'track',
          replayGainPreamp: typeof config.audio.replayGainPreamp === 'number' ? config.audio.replayGainPreamp : 6,
          crossfadeEnabled: config.audio.crossfadeEnabled === true,
          crossfadeDuration: typeof config.audio.crossfadeDuration === 'number' ? config.audio.crossfadeDuration : 0
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
    replayGainMode: 'track',
    replayGainPreamp: 6,
    crossfadeEnabled: false,
    crossfadeDuration: 0
  };
}

function getMusicDirectory(): string {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.paths?.musicFolders && config.paths.musicFolders.length > 0) {
        return config.paths.musicFolders[0];
      }
    }
  } catch (err) {
    console.error('[Player] Error leyendo config.json para musicFolders:', err);
  }
  return 'C:/Users/Sebas/Music'; // Fallback
}

interface MpdPendingCommand {
  command: string;
  resolve: (lines: string[]) => void;
  reject: (err: Error) => void;
  collectedLines: string[];
}

class PlayerService {
  private mpdProcess: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private isConnected = false;
  private waitingForGreeting = false;
  private buffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  
  private commandQueue: MpdPendingCommand[] = [];
  private activeCommand: MpdPendingCommand | null = null;
  
  private pollInterval: NodeJS.Timeout | null = null;
  private isPollingStatus = false;
  
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
  private crossfadeCleanupPending = false;
  private crossfadeTransitionElapsed = 0;
  private verifyStopPending = false;
  private lastUserActionAt = Date.now();
  private autoRecoveryTimer: NodeJS.Timeout | null = null;
  private lastAutoRecoveryAt = 0;
  private sseClients: Response[] = [];
  private lastPrevClick = 0;

  constructor() {
    // Matar MPD anterior por PID guardado (más preciso que taskkill /IM)
    this.killPreviousMpd();

    // Iniciar MPD
    setTimeout(() => this.startMpd(), 500);
    this.registerProcessCleanup();
  }

  private getMpdDir(): string {
    const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
    return path.join(backendDir, 'src', 'mpd');
  }

  private getMpdPidPath(): string {
    return path.join(this.getMpdDir(), 'level-player-mpd.pid');
  }

  private killPreviousMpd(): void {
    // Matar TODOS los mpd.exe huérfanos de sesiones anteriores
    // (en Windows los event handlers de proceso no son confiables,
    //  así que limpiamos al arrancar en vez de al cerrar)
    try {
      const killed = execSync('taskkill /F /IM mpd.exe 2>nul', { stdio: 'pipe' });
      console.log('[MPD] Procesos MPD huérfanos terminados.');
    } catch {
      // No había procesos MPD corriendo
    }

    // Limpiar PID file viejo si existe
    try {
      const pidPath = this.getMpdPidPath();
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    } catch { /* ignore */ }
  }

  private saveMpdPid(): void {
    if (this.mpdProcess && this.mpdProcess.pid) {
      try {
        fs.writeFileSync(this.getMpdPidPath(), String(this.mpdProcess.pid), 'utf-8');
      } catch (err) {
        console.error('[MPD] Error al guardar PID:', err);
      }
    }
  }

  private registerProcessCleanup() {
    const cleanup = () => {
      this.stopStatusPolling();
      if (this.socket) {
        try {
          this.socket.write('stop\n');
          this.socket.write('close\n');
        } catch { /* ignore */ }
        try { this.socket.destroy(); } catch { /* ignore */ }
        this.socket = null;
      }
      if (this.mpdProcess) {
        try { this.mpdProcess.kill(); } catch { /* ignore */ }
        this.mpdProcess = null;
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(); });
    process.on('SIGTERM', () => { cleanup(); process.exit(); });
  }

  private startMpd() {
    if (this.mpdProcess) return;

    try {
      const backendDir = process.cwd().endsWith('backend') ? process.cwd() : path.join(process.cwd(), 'backend');
      const mpdDir = path.join(backendDir, 'src', 'mpd');
      
      // Crear directorios de configuración de MPD
      fs.mkdirSync(mpdDir, { recursive: true });
      fs.mkdirSync(path.join(mpdDir, 'playlists'), { recursive: true });

      let mpdBinary = process.env.MPD_PATH || '';
      if (!mpdBinary) {
        const localMpd = path.join(mpdDir, 'mpd.exe');
        if (fs.existsSync(localMpd)) {
          mpdBinary = localMpd;
        } else {
          mpdBinary = 'mpd.exe';
        }
      }

      const musicDir = getMusicDirectory();
      const audioConfig = getAudioConfig();
      
      const dbFile = path.join(mpdDir, 'mpd.db').replace(/\\/g, '/');
      const logFile = path.join(mpdDir, 'mpd.log').replace(/\\/g, '/');
      const pidFile = path.join(mpdDir, 'mpd.pid').replace(/\\/g, '/');
      const stateFile = path.join(mpdDir, 'mpdstate').replace(/\\/g, '/');
      const playlistsDir = path.join(mpdDir, 'playlists').replace(/\\/g, '/');
      
      const confPath = path.join(mpdDir, 'mpd.conf');
      
      let confContent = `music_directory     "${musicDir.replace(/\\/g, '/')}"
db_file             "${dbFile}"
log_file            "${logFile}"
pid_file            "${pidFile}"
state_file          "${stateFile}"
playlist_directory  "${playlistsDir}"

bind_to_address     "127.0.0.1"
port                "6600"

`;

      if (audioConfig.exclusiveMode) {
        // WASAPI exclusive mode -> bit-perfect, sin mezclador de Windows
        let deviceLine = '';
        if (audioConfig.audioDevice && 
            audioConfig.audioDevice !== 'wasapi/exclusive' && 
            audioConfig.audioDevice !== 'auto' && 
            audioConfig.audioDevice !== 'default') {
          deviceLine = `\n    device          "${audioConfig.audioDevice}"`;
        }
        confContent += `audio_output {
    type            "wasapi"
    name            "WASAPI Output (Exclusive)"
    exclusive       "yes"${deviceLine}
    mixer_type      "software"
}
`;
      } else {
        // Modo compartido -> winmm (DirectSound no está disponible en este binario)
        // winmm usa waveOut API, siempre pasa por el mezclador de Windows, no bloquea otras apps.
        // La calidad es idéntica a WASAPI shared (mismo mixer).
        confContent += `audio_output {
    type            "winmm"
    name            "Windows Multimedia Output (Shared)"
    mixer_type      "software"
}
`;
      }
      
      let written = false;
      for (let i = 0; i < 5; i++) {
        try {
          fs.writeFileSync(confPath, confContent, 'utf-8');
          written = true;
          break;
        } catch (err: any) {
          if (err.code === 'EBUSY' && i < 4) {
            console.warn(`[MPD] mpd.conf está ocupado/bloqueado, reintentando en 200ms... (intento ${i + 1}/5)`);
            try {
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
            } catch {
              execSync('powershell -Command "Start-Sleep -Milliseconds 200"', { stdio: 'ignore' });
            }
          } else {
            throw err;
          }
        }
      }
      console.log(`[MPD] mpd.conf generado dinámicamente en: ${confPath}`);

      console.log(`[MPD] Iniciando proceso MPD con comando: ${mpdBinary} "${confPath}"`);
      
      const proc = spawn(mpdBinary, [confPath], {
        windowsHide: true,
        stdio: 'ignore'
      });
      this.mpdProcess = proc;

      proc.once('spawn', () => {
        this.saveMpdPid();
        setTimeout(() => this.connectToMpd(), 500);
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (this.mpdProcess === proc) {
          this.mpdProcess = null;
          this.isConnected = false;
          this.socket?.destroy();
          this.socket = null;
        }

        if (err.code === 'ENOENT') {
          console.error('[MPD] No se encontró mpd.exe. Asegúrate de que esté en tu PATH o configúralo en MPD_PATH en tu .env.');
          return;
        }
        console.error('[MPD] Falló al iniciar:', err.message);
      });

      proc.on('exit', (code, signal) => {
        console.warn(`[MPD] Proceso finalizado. code=${code ?? 'null'} signal=${signal ?? 'null'}`);
        if (this.mpdProcess === proc) {
          this.mpdProcess = null;
        }
        this.handleDisconnect();

        // Intentar reiniciar el proceso de MPD en 2 segundos si el cierre fue inesperado
        if (code !== 0) {
          console.log('[MPD] Cierre inesperado detectado. Intentando reiniciar MPD en 2 segundos...');
          setTimeout(() => this.startMpd(), 2000);
        }
      });
    } catch (err) {
      console.error('[MPD] Error en spawn:', err);
      this.mpdProcess = null;
    }
  }

  private connectToMpd() {
    if (this.isConnected || this.socket || !this.mpdProcess) return;

    console.log('[MPD] Conectando a 127.0.0.1:6600...');
    const socket = net.connect({ port: 6600, host: '127.0.0.1' });
    this.socket = socket;
    this.waitingForGreeting = true;
    this.buffer = '';

    socket.on('connect', () => {
      console.log('[MPD] Socket TCP conectado.');
      this.clearReconnectTimer();
    });

    socket.on('data', (data) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (this.waitingForGreeting) {
          if (trimmedLine.startsWith('OK MPD')) {
            console.log('[MPD] Saludo recibido:', trimmedLine);
            this.waitingForGreeting = false;
            this.isConnected = true;
            
            // Inicializar las propiedades del reproductor
            this.initMpdProperties();
            this.processQueue();
          } else {
            console.error('[MPD] Saludo de protocolo inválido:', trimmedLine);
            socket.destroy();
          }
        } else if (this.activeCommand) {
          if (trimmedLine === 'OK') {
            const cmd = this.activeCommand;
            this.activeCommand = null;
            cmd.resolve(cmd.collectedLines);
            this.processQueue();
          } else if (trimmedLine.startsWith('ACK ')) {
            const cmd = this.activeCommand;
            this.activeCommand = null;
            console.error(`[MPD Command Error] Comando '${cmd.command}' falló:`, trimmedLine);
            cmd.reject(new Error(trimmedLine));
            this.processQueue();
          } else {
            this.activeCommand.collectedLines.push(trimmedLine);
          }
        } else {
          console.warn('[MPD Socket] Datos recibidos sin comando activo:', trimmedLine);
        }
      }
    });

    socket.on('error', (err) => {
      console.error('[MPD Socket] Error:', err.message);
      this.handleDisconnect();
    });

    socket.on('close', () => {
      console.log('[MPD Socket] Conexión cerrada.');
      this.handleDisconnect();
    });
  }

  private handleDisconnect() {
    this.isConnected = false;
    this.waitingForGreeting = false;
    this.socket = null;

    if (this.activeCommand) {
      this.activeCommand.reject(new Error('Connection lost'));
      this.activeCommand = null;
    }

    const pending = [...this.commandQueue];
    this.commandQueue = [];
    pending.forEach(cmd => cmd.reject(new Error('Connection lost')));

    this.stopStatusPolling();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.mpdProcess) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToMpd();
    }, 1000);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private sendMpdCommand(cmd: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.socket) {
        return reject(new Error('Not connected to MPD'));
      }
      const pending: MpdPendingCommand = {
        command: cmd,
        resolve,
        reject,
        collectedLines: []
      };
      this.commandQueue.push(pending);
      this.processQueue();
    });
  }

  private processQueue() {
    if (!this.isConnected || !this.socket || this.activeCommand) return;
    if (this.commandQueue.length === 0) return;

    this.activeCommand = this.commandQueue.shift() || null;
    if (this.activeCommand) {
      this.socket.write(this.activeCommand.command + '\n');
    }
  }

  private async initMpdProperties() {
    try {
      // Asegurar que la única salida de audio definida esté habilitada
      try {
        const lines = await this.sendMpdCommand('outputs');
        let currentId: string | null = null;
        for (const line of lines) {
          const idx = line.indexOf(':');
          if (idx === -1) continue;
          const key = line.substring(0, idx).trim().toLowerCase();
          const val = line.substring(idx + 1).trim();
          
          if (key === 'outputid') {
            currentId = val;
          } else if (key === 'outputenabled' && val === '0' && currentId !== null) {
            console.log(`[MPD] Habilitando salida de audio ID ${currentId}...`);
            await this.sendMpdCommand(`enableoutput ${currentId}`);
          }
        }
      } catch (err) {
        console.error('[MPD] Error al habilitar salida de audio:', err);
      }

      // Sincronizar volumen inicial
      await this.sendMpdCommand(`setvol ${Math.round(this.state.volume * 100)}`);
      
      // Aplicar crossfade inicial
      const audioConfig = getAudioConfig();
      const duration = audioConfig.crossfadeEnabled ? audioConfig.crossfadeDuration : 0;
      await this.sendMpdCommand(`crossfade ${duration}`);
      
      // Aplicar ReplayGain para normalizar volumen entre pistas
      await this.sendMpdCommand(`replay_gain_mode ${audioConfig.replayGainMode}`);
      // replay_gain_preamp no está disponible en este build de MPD 0.22.9
      try {
        await this.sendMpdCommand(`replay_gain_preamp ${audioConfig.replayGainPreamp}`);
      } catch (err) {
        console.warn('[MPD] replay_gain_preamp no soportado por este build.');
      }
      
      // Limpiar playlist de MPD
      await this.sendMpdCommand('clear');
      console.log('[MPD] Inicialización de propiedades completada.');
    } catch (err) {
      console.error('[MPD] Error en initMpdProperties:', err);
    }
  }

  private startStatusPolling() {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.pollStatus(), 250);
  }

  private stopStatusPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollStatus() {
    if (!this.isConnected || this.isPollingStatus) return;
    this.isPollingStatus = true;
    try {
      const lines = await this.sendMpdCommand(`command_list_begin\nstatus\ncurrentsong\ncommand_list_end`);
      const mpdState: {
        state?: string;
        volume?: number;
        progress?: number;
        duration?: number;
        file?: string;
        songid?: string;
        playlistLength?: number;
      } = {};

      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.substring(0, idx).trim().toLowerCase();
        const val = line.substring(idx + 1).trim();

        if (key === 'state') {
          mpdState.state = val;
        } else if (key === 'volume') {
          const vol = parseInt(val, 10);
          if (!isNaN(vol)) mpdState.volume = vol;
        } else if (key === 'time') {
          const parts = val.split(':');
          if (parts.length >= 2) {
            const el = parseFloat(parts[0]);
            const tot = parseFloat(parts[1]);
            if (!isNaN(el)) mpdState.progress = el;
            if (!isNaN(tot)) mpdState.duration = tot;
          }
        } else if (key === 'elapsed') {
          const el = parseFloat(val);
          if (!isNaN(el)) mpdState.progress = el;
        } else if (key === 'duration') {
          const tot = parseFloat(val);
          if (!isNaN(tot)) mpdState.duration = tot;
        } else if (key === 'file') {
          mpdState.file = val;
        } else if (key === 'songid') {
          mpdState.songid = val;
        } else if (key === 'playlistlength') {
          const len = parseInt(val, 10);
          if (!isNaN(len)) mpdState.playlistLength = len;
        }
      }

      this.handleMpdStateUpdate(mpdState);
    } catch (err: any) {
      console.error('[MPD] Error en sondeo de estado:', err.message || err);
    } finally {
      this.isPollingStatus = false;
    }
  }

  private handleMpdStateUpdate(mpdState: {
    state?: string;
    volume?: number;
    progress?: number;
    duration?: number;
    file?: string;
    songid?: string;
    playlistLength?: number;
  }) {
    // 1. volume
    if (mpdState.volume !== undefined) {
      const mappedVolume = mpdState.volume / 100;
      if (mappedVolume !== this.state.volume) {
        this.state.volume = mappedVolume;
        this.broadcastState('volume');
      }
    }

    // 2. isPlaying
    if (mpdState.state !== undefined) {
      const isPlaying = mpdState.state === 'play';

      if (mpdState.state === 'play') {
        this.verifyStopPending = false;
      }

      if (isPlaying !== this.state.isPlaying) {
        this.state.isPlaying = isPlaying;
        this.broadcastState('isPlaying');
        if (isPlaying) {
          this.startStatusPolling();
        }

        if (mpdState.state === 'stop' && !isPlaying) {
          // Detección en dos polls para handleTrackEnd (evita cortar
          // canción por glitch transitorio), pero mostramos el estado real.
          if (this.verifyStopPending || this.crossfadeCleanupPending) {
            console.log('[MPD] Detención confirmada (2o poll o cleanup crossfade).');
            this.verifyStopPending = false;
            this.crossfadeCleanupPending = false;
            this.stopStatusPolling();
            this.handleTrackEnd();
          } else {
            console.log('[MPD] Posible detención. Verificando en próximo poll...');
            this.verifyStopPending = true;
          }
          return;
        }
      }

      // Auto-recuperación: si MPD está en pause/stop sin intervención
      // del usuario por más de 5s, reanudar automáticamente (suficiente
      // para diferenciar pausa intencional de glitch WASAPI).
      // Cooldown de 30s entre intentos para evitar loops infinitos.
      if ((mpdState.state === 'pause' || mpdState.state === 'stop') &&
          this.state.currentTrack && !this.autoRecoveryTimer &&
          !this.verifyStopPending && !this.crossfadeCleanupPending) {
        const sinceUser = Date.now() - this.lastUserActionAt;
        const sinceRecovery = Date.now() - this.lastAutoRecoveryAt;
        if (sinceUser > 5000 && sinceRecovery > 30000) {
          this.autoRecoveryTimer = setTimeout(() => {
            this.autoRecoveryTimer = null;
            this.lastAutoRecoveryAt = Date.now();
            this.sendMpdCommand('pause 0').catch(() => {});
          }, 800);
        }
      }
      if (mpdState.state === 'play' && this.autoRecoveryTimer) {
        clearTimeout(this.autoRecoveryTimer);
        this.autoRecoveryTimer = null;
      }
    }

    // 3. duration
    if (mpdState.duration !== undefined && mpdState.duration !== this.state.duration) {
      this.state.duration = mpdState.duration;
      this.broadcastState('duration');
    }

    // 4. progress
    if (mpdState.progress !== undefined && Math.abs(mpdState.progress - this.state.progress) > 0.1) {
      this.state.progress = mpdState.progress;
      this.broadcastState('progress');
    }

    // 4.5 Crossfade cleanup check: si estamos en ventana de crossfade,
    // esperar a que la nueva canción haya sonado crossfadeDuration segundos
    // antes de limpiar la canción anterior de la playlist.
    if (this.crossfadeCleanupPending && mpdState.progress !== undefined) {
      const audioConfig = getAudioConfig();
      const elapsedSinceTransition = mpdState.progress - this.crossfadeTransitionElapsed;
      if (elapsedSinceTransition >= audioConfig.crossfadeDuration) {
        console.log('[Crossfade] Ventana de crossfade completada. Limpiando playlist.');
        const playlistLength = mpdState.playlistLength || 1;
        this.onTrackTransitioned(playlistLength);
        this.crossfadeCleanupPending = false;
      }
    }

    // 5. file transition detection
    if (mpdState.file) {
      const musicDir = getMusicDirectory();
      const absoluteFile = path.resolve(musicDir, mpdState.file).replace(/\\/g, '/');
      const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
      
      const track = activeQueue.find(t => t.filePath && t.filePath.replace(/\\/g, '/').toLowerCase() === absoluteFile.toLowerCase());
      if (track && this.state.currentTrack?.id !== track.id) {
        console.log(`[MPD] Transición de pista detectada por cambio de ruta: ${track.title}`);
        
        const audioConfig = getAudioConfig();
        const currentTrackId = this.state.currentTrack?.id;
        this.state.currentTrack = track;
        this.state.progress = 0;
        this.state.duration = track.duration || mpdState.duration || 0;
        this.state.isPlaying = true;
        this.addToHistory(track.id);
        this.broadcastFullState();
        
        const playlistLength = mpdState.playlistLength || 0;
        
        if (audioConfig.crossfadeEnabled && currentTrackId) {
          // Crossfade activo: MPD cambió de canción temprano (crossfade engine).
          // No eliminar la canción anterior (A) todavía - sigue sonando en la mezcla.
          if (!this.crossfadeCleanupPending) {
            this.crossfadeCleanupPending = true;
            this.crossfadeTransitionElapsed = mpdState.progress || 0;
            console.log(`[Crossfade] Limpieza diferida programada. crossfadeDuration=${audioConfig.crossfadeDuration}s, elapsed=${(mpdState.progress || 0).toFixed(1)}s`);
          }
        } else {
          // Sin crossfade: limpiar inmediatamente (comportamiento original)
          this.onTrackTransitioned(playlistLength);
          this.crossfadeCleanupPending = false;
        }
      }
    }
  }

  private async onTrackTransitioned(playlistLength: number) {
    try {
      if (playlistLength > 1) {
        console.log('[MPD] Eliminando pista anterior (índice 0) de la playlist...');
        await this.sendMpdCommand('delete 0');
      }
    } catch (err) {
      console.error('[MPD] Error eliminando pista anterior:', err);
    }
    this.preloadNextTrack();
  }

  private getMpdTrackPath(filePath: string): string {
    const musicDir = getMusicDirectory();
    const normFile = path.resolve(filePath).replace(/\\/g, '/');
    const normMusic = path.resolve(musicDir).replace(/\\/g, '/');
    
    const fileLower = normFile.toLowerCase();
    const musicLower = normMusic.toLowerCase();
    
    if (fileLower.startsWith(musicLower)) {
      let relative = normFile.substring(normMusic.length);
      if (relative.startsWith('/')) {
        relative = relative.substring(1);
      }
      return relative;
    }
    return normFile;
  }

  private async preloadNextTrack() {
    let nextTrack: Track | undefined;

    if (this.state.loopMode === 'one') {
      nextTrack = this.state.currentTrack || undefined;
    } else if (this.state.playQueue.length > 0) {
      const currentInPlayQueueIndex = this.state.playQueue.findIndex(t => t.id === this.state.currentTrack?.id);
      if (currentInPlayQueueIndex !== -1) {
        if (currentInPlayQueueIndex < this.state.playQueue.length - 1) {
          nextTrack = this.state.playQueue[currentInPlayQueueIndex + 1];
        } else {
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
        nextTrack = this.state.playQueue[0];
      }
    } else {
      const activeQueue = this.state.isShuffle ? this.state.shuffledQueue : this.state.queue;
      if (activeQueue.length > 0 && this.state.currentTrack) {
        const index = activeQueue.findIndex(track => track.id === this.state.currentTrack?.id);
        if (index >= 0 && index < activeQueue.length - 1) {
          nextTrack = activeQueue[index + 1];
        } else if (index === activeQueue.length - 1 && this.state.loopMode === 'all') {
          nextTrack = activeQueue[0];
        }
      }
    }

    try {
      const lines = await this.sendMpdCommand('playlistinfo');
      const files: string[] = [];
      for (const line of lines) {
        if (line.toLowerCase().startsWith('file:')) {
          files.push(line.substring(5).trim());
        }
      }

      if (nextTrack && nextTrack.filePath) {
        const mpdPath = this.getMpdTrackPath(nextTrack.filePath);
        
        if (files.length === 1) {
          console.log(`[Player] Precargando siguiente pista en MPD: ${nextTrack.title}`);
          await this.sendMpdCommand(`add "${mpdPath}"`);
        } else if (files.length > 1) {
          if (files[1].toLowerCase() !== mpdPath.toLowerCase()) {
            console.log(`[Player] La pista precargada vieja no coincide. Reemplazando con la nueva: ${nextTrack.title}`);
            for (let i = files.length - 1; i >= 1; i--) {
              await this.sendMpdCommand(`delete ${i}`);
            }
            await this.sendMpdCommand(`add "${mpdPath}"`);
          }
        }
      } else {
        if (files.length > 1) {
          console.log('[Player] Eliminando precargas obsoletas ya que no hay siguiente pista logica.');
          for (let i = files.length - 1; i >= 1; i--) {
            await this.sendMpdCommand(`delete ${i}`);
          }
        }
      }
    } catch (err) {
      console.error('[Player] Error al sincronizar precargas en MPD:', err);
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

  public async playTrack(track: Track, newQueue?: Track[], startSeconds = 0) {
    if (newQueue) {
      this.state.queue = newQueue;
      if (this.state.isShuffle) {
        this.generateShuffledQueue(track);
      }
    }

    // Resetear cualquier limpieza diferida de crossfade pendiente
    this.crossfadeCleanupPending = false;

    if (!this.isTrackAvailable(track)) {
      console.warn(`[Player] El track '${track.title}' no está disponible. Buscando el siguiente...`);
      this.consecutiveErrors += 1;
      const totalTracks = this.state.queue.length || 1;
      if (this.consecutiveErrors >= totalTracks) {
        console.error('[Player] Todos los tracks en la cola fallaron. Deteniendo reproducción.');
        this.consecutiveErrors = 0;
        this.state.isPlaying = false;
        this.broadcastState('isPlaying');
        try {
          await this.sendMpdCommand('stop');
        } catch { /* ignore */ }
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
        try {
          await this.sendMpdCommand('stop');
        } catch { /* ignore */ }
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

    console.log(`[Player] Cargando canción local en MPD: ${track.filePath}`);
    
    try {
      const mpdPath = this.getMpdTrackPath(track.filePath);
      
      const audioConfig = getAudioConfig();
      const crossfadeDur = audioConfig.crossfadeEnabled ? audioConfig.crossfadeDuration : 0;
      
      await this.sendMpdCommand(
        `command_list_begin\n` +
        `crossfade ${crossfadeDur}\n` +
        `clear\n` +
        `add "${mpdPath}"\n` +
        `play\n` +
        `command_list_end`
      );
      
      if (startSeconds > 0) {
        await this.sendMpdCommand(`seekcur ${startSeconds}`);
      }

      this.state.isPlaying = true;
      this.lastUserActionAt = Date.now();
      this.broadcastState('isPlaying');
      this.startStatusPolling();
      
      this.preloadNextTrack();
    } catch (err) {
      console.error('[Player] Error al reproducir pista en MPD:', err);
    }
  }

  public async togglePlay() {
    if (!this.state.currentTrack) return;
    
    try {
      const lines = await this.sendMpdCommand('status');
      let mpdState = 'stop';
      for (const line of lines) {
        if (line.toLowerCase().startsWith('state:')) {
          mpdState = line.substring(6).trim().toLowerCase();
        }
      }

      if (mpdState === 'play') {
        await this.sendMpdCommand('pause 1');
        this.lastUserActionAt = Date.now();
        this.state.isPlaying = false;
        this.broadcastState('isPlaying');
        this.stopStatusPolling();
      } else if (mpdState === 'pause') {
        await this.sendMpdCommand('pause 0');
        this.lastUserActionAt = Date.now();
        this.state.isPlaying = true;
        this.broadcastState('isPlaying');
        this.startStatusPolling();
      } else {
        this.playTrack(this.state.currentTrack, undefined, this.state.progress);
      }
    } catch (err) {
      console.error('[Player] Error al alternar reproducción en MPD:', err);
    }
  }

  public async reapplyAudioConfig() {
    try {
      const audioConfig = getAudioConfig();
      await this.sendMpdCommand(`replay_gain_mode ${audioConfig.replayGainMode}`);
      try {
        await this.sendMpdCommand(`replay_gain_preamp ${audioConfig.replayGainPreamp}`);
      } catch {
        console.warn('[MPD] replay_gain_preamp no soportado por este build.');
      }
      const crossfadeDur = audioConfig.crossfadeEnabled ? audioConfig.crossfadeDuration : 0;
      await this.sendMpdCommand(`crossfade ${crossfadeDur}`);
      console.log('[MPD] Configuración de audio re-aplicada desde archivo.');
    } catch (err) {
      console.error('[MPD] Error al re-aplicar configuración de audio:', err);
    }
  }

  public async restartMpd() {
    console.log('[MPD] Reiniciando MPD para aplicar cambios de dispositivo de audio...');
    this.stopStatusPolling();
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* ignore */ }
      this.socket = null;
    }
    this.isConnected = false;
    this.waitingForGreeting = false;
    this.commandQueue = [];
    this.activeCommand = null;
    if (this.mpdProcess) {
      try { this.mpdProcess.kill(); } catch { /* ignore */ }
      this.mpdProcess = null;
    }
    // Pequeña pausa para que Windows libere el dispositivo WASAPI
    await new Promise(r => setTimeout(r, 1000));
    this.startMpd();
  }

  public async setVolume(volume: number) {
    const normalizedVolume = Math.max(0, Math.min(1, volume));
    this.state.volume = normalizedVolume;
    this.broadcastState('volume');
    try {
      await this.sendMpdCommand(`setvol ${Math.round(normalizedVolume * 100)}`);
    } catch (err) {
      console.error('[Player] Error al ajustar volumen en MPD:', err);
    }
  }

  public async seekTo(seconds: number) {
    const targetSeconds = Math.max(0, seconds);
    this.state.progress = targetSeconds;
    this.broadcastState('progress');
    try {
      await this.sendMpdCommand(`seekcur ${targetSeconds}`);
    } catch (err) {
      console.error('[Player] Error al buscar tiempo en MPD:', err);
    }
  }

  public toggleShuffle() {
    this.state.isShuffle = !this.state.isShuffle;

    if (this.state.isShuffle && this.state.queue.length > 0) {
      this.generateShuffledQueue(this.state.currentTrack);
    } else {
      this.state.shuffledQueue = [];
    }

    this.broadcastFullState();
    this.preloadNextTrack();
  }

  public toggleLoop() {
    const modes: LoopMode[] = ['off', 'all', 'one'];
    const nextIndex = (modes.indexOf(this.state.loopMode) + 1) % modes.length;
    this.state.loopMode = modes[nextIndex];
    this.broadcastState('loopMode');
    this.preloadNextTrack();
  }

  private isTrackAvailable(track: Track | null): boolean {
    if (!track) return false;
    if (track.isUnavailable) return false;
    if (!track.filePath) return false;
    return fs.existsSync(track.filePath);
  }

  private findNextAvailableTrack(queue: Track[], startIndex: number): { track: Track; index: number } | null {
    if (queue.length === 0) return null;
    
    for (let i = startIndex; i < queue.length; i++) {
      if (this.isTrackAvailable(queue[i])) {
        return { track: queue[i], index: i };
      }
    }
    
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
    
    for (let i = startIndex; i >= 0; i--) {
      if (this.isTrackAvailable(queue[i])) {
        return { track: queue[i], index: i };
      }
    }
    
    if (this.state.loopMode === 'all') {
      for (let i = queue.length - 1; i > startIndex; i--) {
        if (this.isTrackAvailable(queue[i])) {
          return { track: queue[i], index: i };
        }
      }
    }
    
    return null;
  }

  private async playNextTrackOrCommand(track: Track) {
    try {
      const lines = await this.sendMpdCommand('playlistinfo');
      const files: string[] = [];
      for (const line of lines) {
        if (line.toLowerCase().startsWith('file:')) {
          files.push(line.substring(5).trim());
        }
      }

      if (files.length > 1 && track.filePath) {
        const expectedMpdPath = this.getMpdTrackPath(track.filePath);
        if (files[1].toLowerCase() === expectedMpdPath.toLowerCase()) {
          console.log(`[Player] SkipNext manual coincide con pista precargada '${track.title}'. Usando comando 'next'.`);
          const audioConfig = getAudioConfig();
          const crossfadeDur = audioConfig.crossfadeEnabled ? audioConfig.crossfadeDuration : 0;
          await this.sendMpdCommand(
            `command_list_begin\ncrossfade ${crossfadeDur}\nnext\ncommand_list_end`
          );
          return;
        }
      }
    } catch (err) {
      console.error('[Player] Error al intentar usar "next" de MPD:', err);
    }

    // Fallback si no coincide, no está precargada o falla el comando
    await this.playTrack(track);
  }

  public async skipNext(isManual = false) {
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
          await this.playNextTrackOrCommand(nextInfo.track);
        } else {
          this.state.isPlaying = false;
          this.broadcastState('isPlaying');
          this.sendMpdCommand('stop').catch(() => {});
        }
      } else {
        await this.playNextTrackOrCommand(nextInfo.track);
      }
    } else {
      this.state.isPlaying = false;
      this.broadcastState('isPlaying');
      this.sendMpdCommand('stop').catch(() => {});
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
