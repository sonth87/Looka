import {
  CameraConstraints,
  CameraDevice,
  CameraService,
  ERROR_CODES,
  FacePlatformError,
  FrameInput,
} from '@face/core';

/**
 * Width the CV pipeline works at.
 *
 * Wide enough for landmarks to stay accurate, narrow enough that the per-frame
 * readback stays cheap. Stills are unaffected and keep the sensor's full size.
 */
const ANALYSIS_WIDTH = 960;

export class BrowserCameraService implements CameraService {
  private activeStream: MediaStream | null = null;
  private selectedDevice: CameraDevice | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | OffscreenCanvas | null = null;
  private canvasContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private isPaused = false;
  /**
   * Whether stills are written mirrored, matching a mirrored preview.
   *
   * The preview is mirrored so people can position themselves as they would in
   * a mirror, but drawImage copies the raw sensor frame — a CSS transform never
   * reaches the pixels. Left alone, the photo therefore appears to flip the
   * instant it is taken. This flag exists so the preview and the saved frame
   * cannot drift apart: whatever the preview shows, the still matches.
   */
  private mirrorStills = true;
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
        // Ask for more than the preview needs. Distance is fixed by the lens,
        // so the only way a face further away yields a usable photo is more
        // sensor pixels landing on it; a camera that cannot manage this simply
        // returns what it has. The CV loop reads a downscaled copy, so the extra
        // resolution costs nothing per frame and is spent only on the still.
        width: constraints?.width || { ideal: 1920 },
        height: constraints?.height || { ideal: 1080 },
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

    // Analysis runs on a downscaled copy. Landmarks come back normalised and
    // every measure built on them is a ratio, so nothing geometric changes —
    // but reading a 1920x1080 frame back from the GPU costs 8 MB per call,
    // which is what held the CV loop at single-digit frames per second.
    const scale = Math.min(1, ANALYSIS_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

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

    if (this.mirrorStills) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /**
   * Match saved stills to the preview orientation.
   *
   * Pass false when the stored image must be the true, unmirrored view — text
   * on a badge reads correctly and asymmetric features stay on the side they
   * are really on, which matters if the photo is later compared against another
   * source. Note that face embeddings are not mirror-invariant, so enrolment
   * and matching must agree on this.
   */
  public setMirrorStills(mirrored: boolean): void {
    this.mirrorStills = mirrored;
  }

  /**
   * The camera's own zoom range, if it has one.
   *
   * Optical or sensor-crop zoom driven by the device produces a genuinely larger
   * face: more sensor pixels land on it. Scaling the picture afterwards cannot
   * do that, it only enlarges the pixels already captured. Most USB and laptop
   * webcams expose nothing here, so callers must handle null as the normal case
   * rather than an error.
   */
  public getZoomCapability(): { min: number; max: number; step: number } | null {
    const track = this.activeStream?.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return null;

    const caps = track.getCapabilities() as MediaTrackCapabilities & {
      zoom?: { min: number; max: number; step: number };
    };
    if (!caps.zoom || caps.zoom.max <= caps.zoom.min) return null;
    return { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
  }

  /** Current zoom, or null when the camera does not report one. */
  public getZoom(): number | null {
    const track = this.activeStream?.getVideoTracks()[0];
    if (!track || typeof track.getSettings !== 'function') return null;
    const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
    return typeof settings.zoom === 'number' ? settings.zoom : null;
  }

  /**
   * Ask the camera to zoom, clamped to what it says it supports.
   *
   * Returns the value actually applied, or null if the device has no zoom —
   * never throws, since a camera without zoom is an ordinary configuration and
   * not a failure the caller needs to handle specially.
   */
  public async setZoom(value: number): Promise<number | null> {
    const track = this.activeStream?.getVideoTracks()[0];
    const caps = this.getZoomCapability();
    if (!track || !caps) return null;

    const clamped = Math.min(caps.max, Math.max(caps.min, value));
    try {
      await track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] });
      return clamped;
    } catch {
      // Some drivers advertise the capability and then reject the constraint.
      return null;
    }
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
    // getFrame reads this canvas back every frame. Without the hint the browser
    // keeps it GPU-resident and each getImageData forces a stall to copy it
    // down; it warns about exactly this in the console.
    this.canvasContext = this.canvasElement.getContext('2d', { willReadFrequently: true });
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
