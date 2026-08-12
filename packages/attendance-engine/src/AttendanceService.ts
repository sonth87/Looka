import { AttendanceResult } from '@face/core';
import { IdentificationEngine, GalleryEntry, SecurityLevel } from '@face/recognition-engine';
import { AttendanceRepository } from '@face/database';

export interface AttendanceServiceConfig {
  cooldownWindowMs?: number; // default: 300,000 (5 mins)
  securityLevel?: SecurityLevel; // default: 'BALANCED'
  deviceId?: string;
  attendanceSessionId?: string;
}

export class AttendanceService {
  private identificationEngine = new IdentificationEngine();
  private repo: AttendanceRepository;
  private config: Required<AttendanceServiceConfig>;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor(repo: AttendanceRepository, config: AttendanceServiceConfig = {}) {
    this.repo = repo;
    this.config = {
      cooldownWindowMs: config.cooldownWindowMs ?? 300000,
      securityLevel: config.securityLevel ?? 'BALANCED',
      deviceId: config.deviceId ?? 'device_kiosk_01',
      attendanceSessionId: config.attendanceSessionId ?? `session_${Date.now()}`,
    };
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

  public async processRecognition(
    probeVector: Float32Array,
    gallery: GalleryEntry[],
    currentTime: number = Date.now()
  ): Promise<AttendanceResult> {
    const recognition = this.identificationEngine.identify(
      probeVector,
      gallery,
      5,
      this.config.securityLevel
    );

    if (recognition.status !== 'MATCH' || !recognition.personId || !recognition.score) {
      const rejectedResult: AttendanceResult = {
        status: 'REJECTED',
        message: `Recognition failed with status: ${recognition.status}`,
      };
      this.emit('rejected', rejectedResult);
      return rejectedResult;
    }

    const personId = recognition.personId;

    // Check Anti-duplicate Cooldown Window
    const lastRec = await this.repo.getLastAttendance(personId);
    if (lastRec && currentTime - lastRec.timestamp < this.config.cooldownWindowMs) {
      const duplicateResult: AttendanceResult = {
        status: 'ALREADY_RECORDED',
        personId,
        attendanceId: lastRec.attendanceId,
        timestamp: lastRec.timestamp,
        message: 'Person already checked in within cooldown window.',
      };
      this.emit('already-recorded', duplicateResult);
      return duplicateResult;
    }

    // Record new attendance
    const attendanceId = `att_${currentTime}_${Math.random().toString(36).substring(2, 7)}`;
    await this.repo.recordAttendance({
      id: attendanceId,
      personId,
      attendanceSessionId: this.config.attendanceSessionId,
      timestamp: currentTime,
      type: 'CHECK_IN',
      identityScore: recognition.score,
      livenessScore: 1.0,
      qualityScore: 0.9,
      modelVersion: recognition.modelVersion,
      policyVersion: this.config.securityLevel,
      deviceId: this.config.deviceId,
    });

    const recordedResult: AttendanceResult = {
      status: 'RECORDED',
      attendanceId,
      personId,
      timestamp: currentTime,
      message: 'Attendance recorded successfully.',
    };

    this.emit('recorded', recordedResult);
    return recordedResult;
  }
}
