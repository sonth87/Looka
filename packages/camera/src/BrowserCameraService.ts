import {
  CameraConstraints,
  CameraDevice,
  CameraService,
  ERROR_CODES,
  FacePlatformError,
  FrameInput,
} from '@face/core';

export class BrowserCameraService implements CameraService {
  private activeStream: MediaStream | null = null;
  private selectedDevice: CameraDevice | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | OffscreenCanvas | null = null;
  private canvasContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private isPaused = false;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();
  private deviceChangeListener: (() => void) | null = null;

  constructor() {
    this.setupDeviceChangeMonitoring();
  }

  public async enumerateDevices(): Promise<CameraDevice[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      throw new FacePlatformError(
        ERROR_CODES.CAMERA_UNAVAILABLE,
        'MediaDevices API is not supported in this environment.',
        'CAMERA'
      );
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === 'videoinput');

      return videoDevices.map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
        groupId: device.groupId,
        isDefault: device.deviceId === 'default' || index === 0,
      }));
    } catch (err: any) {
      throw new FacePlatformError(
        ERROR_CODES.CAMERA_UNAVAILABLE,
        `Failed to enumerate camera devices: ${err.message || err}`,
        'CAMERA',
        true,
        { originalError: err }
      );
    }
  }

  public async requestPermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new FacePlatformError(
        ERROR_CODES.CAMERA_UNAVAILABLE,
        'getUserMedia is not supported.',
        'CAMERA'
      );
    }

    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Clean up temporary permission stream
      tempStream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new FacePlatformError(
          ERROR_CODES.CAMERA_PERMISSION_DENIED,
          'Camera access permission was denied by the user or OS.',
          'CAMERA',
          true
        );
      }
      throw new FacePlatformError(
        ERROR_CODES.CAMERA_INIT_FAILED,
        `Camera permission check failed: ${err.message || err}`,
        'CAMERA',
        true,
        { originalError: err }
      );
    }
  }

  public async start(constraints?: CameraConstraints): Promise<MediaStream> {
    if (this.activeStream) {
      await this.stop();
    }

    const mediaConstraints: MediaStreamConstraints = {
      audio: false,
      video: {
        deviceId: constraints?.deviceId ? { exact: constraints.deviceId } : undefined,
        width: constraints?.width || { ideal: 1280 },
        height: constraints?.height || { ideal: 720 },
        frameRate: constraints?.frameRate || { ideal: 30 },
      },
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      this.activeStream = stream;
      this.isPaused = false;

      // Track active device
      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings();
        const devices = await this.enumerateDevices().catch(() => []);
        this.selectedDevice =
          devices.find((d) => d.id === settings.deviceId) || {
            id: settings.deviceId || 'active-camera',
            label: track.label || 'Active Camera',
          };

        // Attach track ended listener (detect camera disconnect)
        track.onended = () => {
          this.emit('disconnect', { device: this.selectedDevice });
        };
      }

      // Initialize frame capture elements
      this.setupFrameExtractor();

      return stream;
    } catch (err: any) {
      this.emit('error', err);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new FacePlatformError(
          ERROR_CODES.CAMERA_PERMISSION_DENIED,
          'Camera permission denied.',
          'CAMERA',
          true
        );
      }

      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new FacePlatformError(
          ERROR_CODES.CAMERA_UNAVAILABLE,
          'No camera device found.',
          'CAMERA',
          true
        );
      }

      throw new FacePlatformError(
        ERROR_CODES.CAMERA_INIT_FAILED,
        `Failed to start camera stream: ${err.message || err}`,
        'CAMERA',
        true,
        { originalError: err }
      );
    }
  }

  public async stop(): Promise<void> {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      this.activeStream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    this.canvasElement = null;
    this.canvasContext = null;
    this.selectedDevice = null;
    this.isPaused = false;
  }

  public pause(): void {
    if (this.activeStream) {
      this.activeStream.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
      this.isPaused = true;
    }
  }

  public resume(): void {
    if (this.activeStream) {
      this.activeStream.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
      this.isPaused = false;
    }
  }

  public getFrame(): FrameInput | null {
    if (!this.activeStream || this.isPaused || !this.videoElement || !this.canvasContext) {
      return null;
    }

    const video = this.videoElement;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (this.canvasElement instanceof HTMLCanvasElement) {
      if (this.canvasElement.width !== width || this.canvasElement.height !== height) {
        this.canvasElement.width = width;
        this.canvasElement.height = height;
      }
      (this.canvasContext as CanvasRenderingContext2D).drawImage(video, 0, 0, width, height);
      const imageData = (this.canvasContext as CanvasRenderingContext2D).getImageData(
        0,
        0,
        width,
        height
      );

      return {
        data: imageData.data,
        width,
        height,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  public captureBase64Snapshot(): string | null {
    let video: HTMLVideoElement | null = this.videoElement;
    if (!video || video.readyState < 2) {
      if (typeof document !== 'undefined') {
        video = document.querySelector('video');
      }
    }
    if (!video || video.readyState < 2) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  public getSelectedDevice(): CameraDevice | null {
    return this.selectedDevice;
  }

  public getActiveStream(): MediaStream | null {
    return this.activeStream;
  }

  public on(event: string, listener: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  public off(event: string, listener: (...args: any[]) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  private emit(event: string, ...args: any[]): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((listener) => listener(...args));
    }
  }

  private setupFrameExtractor(): void {
    if (typeof document === 'undefined' || !this.activeStream) return;

    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
    this.videoElement.srcObject = this.activeStream;
    this.videoElement.play().catch(() => {});

    this.canvasElement = document.createElement('canvas');
    this.canvasContext = this.canvasElement.getContext('2d');
  }

  private setupDeviceChangeMonitoring(): void {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.ondevicechange !== undefined) {
      this.deviceChangeListener = () => {
        this.enumerateDevices()
          .then((devices) => this.emit('device-change', devices))
          .catch(() => {});
      };
      navigator.mediaDevices.ondevicechange = this.deviceChangeListener;
    }
  }
}
