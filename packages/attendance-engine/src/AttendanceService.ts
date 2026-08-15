import { AttendanceResult, LivenessResult } from '@face/core';
import {
  IdentificationEngine,
  TemporalConfirmer,
  GalleryEntry,
  ModelIdentity,
  SecurityLevel,
  TemporalPolicy,
  TemporalDecision,
} from '@face/recognition-engine';
import { AttendanceRepository, PersonRepository, businessDayOf } from '@face/database';

export type AttendanceType = 'CHECK_IN' | 'CHECK_OUT';

export interface AttendanceServiceConfig {
  /** Ignore repeat recognitions of the same person within this window. Default 5 min. */
  cooldownWindowMs?: number;
  securityLevel?: SecurityLevel;
  deviceId?: string;
  attendanceSessionId?: string;
  /** Hour a working day starts. 4am keeps a shift ending at 02:00 on the previous day. */
  businessDayStartHour?: number;
  /** When true, a missing or failed liveness check rejects the attempt. */
  requireLiveness?: boolean;
  /**
   * How many frames must agree before an identity counts.
   *
   * Set to null to decide on a single frame — only appropriate for tests or a
   * caller that has already confirmed the identity itself.
   */
  temporal?: TemporalPolicy | null;
}

export interface ProcessRecognitionInput {
  probeVector: Float32Array;
  gallery: GalleryEntry[];
  /** Embedding space of probeVector. Gallery entries outside it are excluded. */
  model: ModelIdentity;
  type?: AttendanceType;
  /** Result of the liveness check, or null when it was not run. */
  liveness?: LivenessResult | null;
  /** Quality of the frame that produced the probe, or null when not measured. */
  qualityScore?: number | null;
  currentTime?: number;
}

/**
 * Turns a verified identity into a business event.
 *
 * Recognition alone never creates attendance: person status, liveness policy,
 * cooldown and per-day uniqueness are checked first, and success is reported
 * only after the local transaction commits.
 */
export class AttendanceService {
  private identificationEngine = new IdentificationEngine();
  private confirmer: TemporalConfirmer | null;
  private repo: AttendanceRepository;
  private persons: PersonRepository;
  private config: Required<Omit<AttendanceServiceConfig, 'temporal'>>;
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  constructor(
    repo: AttendanceRepository,
    persons: PersonRepository,
    config: AttendanceServiceConfig = {}
  ) {
    this.repo = repo;
    this.persons = persons;
    this.config = {
      cooldownWindowMs: config.cooldownWindowMs ?? 300_000,
      securityLevel: config.securityLevel ?? 'BALANCED',
      deviceId: config.deviceId ?? 'device_kiosk_01',
      attendanceSessionId: config.attendanceSessionId ?? `session_${Date.now()}`,
      businessDayStartHour: config.businessDayStartHour ?? 4,
      requireLiveness: config.requireLiveness ?? false,
    };
    // Default on: a single frame is not enough evidence to attribute attendance
    // to a person. Opt out explicitly with `temporal: null`.
    this.confirmer =
      config.temporal === null ? null : new TemporalConfirmer(config.temporal ?? {});
  }

  /** Forget the current identity — call when a session ends or the kiosk resets. */
  public resetTemporal(): void {
    this.confirmer?.reset();
  }

  public on(event: string, listener: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  public off(event: string, listener: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: string, ...args: any[]): void {
    // A throwing listener must not abort an attendance that already committed.
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(...args);
      } catch {
        /* listener failures are not the caller's problem */
      }
    });
  }

  public async processRecognition(input: ProcessRecognitionInput): Promise<AttendanceResult> {
    const {
      probeVector,
      gallery,
      model,
      type = 'CHECK_IN',
      liveness = null,
      qualityScore = null,
      currentTime = Date.now(),
    } = input;

    // 1. Liveness gate — before identity, so a photo attack never reaches the gallery.
    if (this.config.requireLiveness && (!liveness || !liveness.isLive)) {
      return this.reject('Liveness check did not pass.');
    }

    // 2. Identity from this frame.
    const { result } = this.identificationEngine.identify(probeVector, gallery, {
      requiredModel: model,
      level: this.config.securityLevel,
    });

    // 3. Agreement across frames.
    //
    // One frame is not evidence: a blink or a bad angle can make a single frame
    // agree with the wrong person, and an attendance record keeps that mistake.
    // Frames that do not yet decide anything return PENDING, which is not a
    // failure — the caller keeps feeding frames.
    let personId: string;
    let identityScore: number;

    if (this.confirmer) {
      const decision = this.confirmer.observe(result, currentTime);
      this.emit('temporal', decision);

      if (decision.state !== 'CONFIRMED') {
        return this.pending(decision, result.status);
      }
      personId = decision.personId!;
      identityScore = decision.score ?? 0;
    } else {
      if (result.status !== 'MATCH' || !result.personId) {
        return this.reject(`Recognition returned ${result.status}.`);
      }
      personId = result.personId;
      identityScore = result.score ?? 0;
    }

    // 4. Person must still be active.
    const person = await this.persons.getPersonById(personId);
    if (!person) return this.reject('Recognised person is not in the local database.');
    if (person.status !== 'ACTIVE') return this.reject(`Person is ${person.status}.`);

    // 5. Cooldown — a confirmed person standing there must not produce an event per frame.
    const last = this.repo.getLastAttendance(personId, type);
    if (last && currentTime - last.timestamp < this.config.cooldownWindowMs) {
      return this.alreadyRecorded(personId, last.attendanceId, last.timestamp, 'Within cooldown window.');
    }

    // 6. One event of each type per working day.
    const businessDay = businessDayOf(currentTime, this.config.businessDayStartHour);
    const sameDay = this.repo.findByBusinessDay(personId, type, businessDay);
    if (sameDay) {
      return this.alreadyRecorded(personId, sameDay.attendanceId, sameDay.timestamp, `Already has a ${type} on ${businessDay}.`);
    }

    // 7. Commit. SUCCESS is reported only after this returns.
    const attendanceId = `att_${currentTime}_${Math.random().toString(36).substring(2, 7)}`;
    try {
      this.repo.recordAttendance({
        id: attendanceId,
        personId,
        attendanceSessionId: this.config.attendanceSessionId,
        timestamp: currentTime,
        type,
        identityScore,
        // Recorded as measured. A hardcoded 1.0 would make every later audit
        // believe liveness passed on runs where it never executed.
        livenessScore: liveness ? liveness.score : null,
        qualityScore,
        modelVersion: result.modelVersion,
        policyVersion: this.config.securityLevel,
        deviceId: this.config.deviceId,
        businessDay,
      });
    } catch (err) {
      // Storage failed: report an error, never a success.
      const errorResult: AttendanceResult = {
        status: 'ERROR',
        personId,
        message: `Could not save attendance: ${(err as Error).message}`,
      };
      this.emit('error', errorResult);
      return errorResult;
    }

    const recorded: AttendanceResult = {
      status: 'RECORDED',
      attendanceId,
      personId,
      timestamp: currentTime,
      message: 'Attendance recorded successfully.',
    };
    this.emit('recorded', recorded);
    return recorded;
  }

  /**
   * Not enough agreement yet.
   *
   * Distinct from REJECTED: nothing is wrong, the window simply has not filled.
   * A caller that treats this as a failure would flash an error on every frame
   * of a perfectly normal check-in.
   */
  private pending(decision: TemporalDecision, frameStatus: string): AttendanceResult {
    const result: AttendanceResult = {
      status: 'PENDING',
      message:
        decision.state === 'IDLE'
          ? 'Waiting for a face.'
          : `Confirming identity (${decision.agreeing}/${decision.windowSize} frames agree, ${decision.reason ?? frameStatus}).`,
    };
    this.emit('pending', result, decision);
    return result;
  }

  private reject(message: string): AttendanceResult {
    const result: AttendanceResult = { status: 'REJECTED', message };
    this.emit('rejected', result);
    return result;
  }

  private alreadyRecorded(
    personId: string,
    attendanceId: string,
    timestamp: number,
    message: string
  ): AttendanceResult {
    const result: AttendanceResult = {
      status: 'ALREADY_RECORDED',
      personId,
      attendanceId,
      timestamp,
      message,
    };
    this.emit('already-recorded', result);
    return result;
  }
}
