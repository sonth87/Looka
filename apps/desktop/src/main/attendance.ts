/**
 * Wires Pillar B (recognition + attendance) into a real running app for the
 * first time — see ROADMAP.md's cross-cutting finding: `AttendanceService`,
 * `IdentificationEngine`, and `TemporalConfirmer` were a complete, tested
 * library with zero callers anywhere in `apps/desktop`/`apps/web` until now.
 *
 * DEMO MODE, deliberately, not production recognition: `MockEmbeddingExtractor`
 * derives a vector from a text seed, not image content (its own doc comment:
 * "Two photos of the same person produce unrelated vectors"), and
 * `ProfileBuilder` correctly marks every profile built from it `DRAFT` — which
 * `FaceProfileRepository.getActiveProfiles()` never returns. The gallery this
 * module recognizes against is therefore always empty by construction: this
 * exercises the full real pipeline (enroll -> gallery -> live identify ->
 * temporal confirmation -> attendance business rules -> DB write) end to end,
 * but it will never actually recognize anyone until FIX-PLAN.md step 18 (a
 * real model) lands. That's a deliberate choice, not a bug — see the
 * conversation this was built from. Do not relax the DRAFT/ACTIVE split to
 * make a demo "succeed"; that would let mock data back into the real
 * recognition index, exactly what FIX-PLAN step 7 exists to prevent.
 */
import {
  PersonRepository,
  FaceProfileRepository,
  AttendanceRepository,
  type ModelIdentity as DbModelIdentity,
} from '@face/database';
import { MockEmbeddingExtractor, ProfileBuilder, l2Normalize } from '@face/biometric';
import { AttendanceService } from '@face/attendance-engine';
import type { GalleryEntry } from '@face/recognition-engine';
import type { AttendanceResult, CaptureSession, CaptureStepResult, Person } from '@face/core';
import { randomUUID } from 'node:crypto';
import { getDatabase } from './db.js';

const extractor = new MockEmbeddingExtractor();
const profileBuilder = new ProfileBuilder();

let personRepo: PersonRepository | null = null;
let profileRepo: FaceProfileRepository | null = null;
let attendanceRepo: AttendanceRepository | null = null;
let attendanceService: AttendanceService | null = null;

function repos() {
  if (!personRepo) personRepo = new PersonRepository(getDatabase());
  if (!profileRepo) profileRepo = new FaceProfileRepository(getDatabase());
  if (!attendanceRepo) attendanceRepo = new AttendanceRepository(getDatabase());
  return { personRepo, profileRepo, attendanceRepo };
}

/**
 * One instance for the whole attendance session, not one per call: its
 * internal `TemporalConfirmer` only works by accumulating observations
 * across repeated frames — a fresh instance per IPC call would never confirm
 * anyone, mock model or not.
 */
function service(): AttendanceService {
  if (!attendanceService) {
    const { attendanceRepo, personRepo } = repos();
    attendanceService = new AttendanceService(attendanceRepo, personRepo, {
      deviceId: 'desktop-attendance-demo',
      requireLiveness: false, // liveness isn't wired into this pass either — see ROADMAP.md step 11
    });
  }
  return attendanceService;
}

export interface EnrollAttendanceInput {
  displayName: string;
}

export interface EnrollAttendanceResult {
  personId: string;
  profileId: string;
  profileStatus: string;
  modelFamily: string;
}

/**
 * Builds a profile from a single snapshot (not the 5-angle capture flow —
 * that's a separate, unrelated pipeline; see this module's own doc comment
 * for why gluing the two together wasn't worth it for a demo-mode model
 * that ignores image content either way). Synthesizes the minimal
 * `CaptureSession` shape `ProfileBuilder` expects.
 */
export async function enrollAttendancePerson(input: EnrollAttendanceInput): Promise<EnrollAttendanceResult> {
  const { personRepo, profileRepo } = repos();
  const now = Date.now();
  const personId = `person_${randomUUID()}`;

  const person: Person = {
    id: personId,
    displayName: input.displayName,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
  await personRepo.savePerson(person);

  const step: CaptureStepResult = {
    stepId: 'step-front',
    stepType: 'FRONT',
    status: 'COMPLETED',
    attempts: 1,
    capturedImagePath: 'demo-snapshot', // mock extractor never reads this — see module doc comment
    timestamp: now,
  };
  const session: CaptureSession = {
    id: `session_${randomUUID()}`,
    personId,
    workflowId: 'attendance-demo-enroll',
    workflowVersion: 1,
    startedAt: now,
    completedAt: now,
    status: 'COMPLETED',
    steps: [step],
  };

  const { profile, centroid } = profileBuilder.buildProfileFromSession(personId, session);
  await profileRepo.saveProfile({
    profile,
    embeddings: [
      {
        id: profile.embeddings[0].id,
        embedding: {
          vector: centroid,
          dimension: centroid.length,
          modelFamily: profile.modelFamily,
          modelVersion: profile.modelVersion,
          preprocessingVersion: profile.preprocessingVersion,
          similarityMetric: 'cosine',
        },
        pose: profile.embeddings[0].pose,
        qualityScore: profile.embeddings[0].qualityScore,
        taskType: profile.embeddings[0].taskType,
      },
    ],
  });

  return {
    personId,
    profileId: profile.id,
    profileStatus: profile.status,
    modelFamily: profile.modelFamily,
  };
}

export async function listAttendancePersons(): Promise<Person[]> {
  return repos().personRepo.listActivePersons();
}

const MOCK_MODEL: DbModelIdentity = {
  modelFamily: extractor.modelFamily,
  modelVersion: extractor.modelVersion,
  preprocessingVersion: extractor.preprocessingVersion,
};

/** Averages a profile's per-angle embeddings into one comparable vector, same reduction `ProfileBuilder` applies at enrollment time. */
async function loadGallery(): Promise<GalleryEntry[]> {
  const { profileRepo } = repos();
  const rows = await profileRepo.getActiveProfiles(MOCK_MODEL); // always [] today — see module doc comment
  return rows.map(({ profile, vectors }) => {
    const dim = vectors[0]?.length ?? extractor.dimension;
    const sum = new Float32Array(dim);
    for (const v of vectors) for (let i = 0; i < dim; i++) sum[i] += v[i];
    return { profile, centroid: l2Normalize(sum) };
  });
}

/**
 * Call on every frame the renderer's own (real) face detector reports a face
 * present. Feeds `AttendanceService`'s internal temporal confirmer — a
 * single call proves nothing, a steady stream of them over a couple seconds
 * is what lets it decide.
 */
export async function processAttendanceFrame(): Promise<AttendanceResult> {
  const gallery = await loadGallery();
  // The probe vector is a demo placeholder for the same reason the gallery
  // above is always empty — see this module's own doc comment. Any seed
  // works; it can never match a gallery that structurally can't have
  // entries yet.
  const probe = extractor.generateEmbedding(`live-frame-${Date.now()}`);

  return service().processRecognition({
    probeVector: probe,
    gallery,
    model: MOCK_MODEL,
  });
}

export function resetAttendanceSession(): void {
  service().resetTemporal();
}
