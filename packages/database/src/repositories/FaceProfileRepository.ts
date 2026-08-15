import { SqlExecutor } from '../sql/SqlDriver.js';
import { FaceProfile, FaceEmbedding } from '@face/core';

/**
 * Identifies one embedding space. Vectors are only comparable when all three
 * match — same model with different preprocessing produces incompatible vectors.
 */
export interface ModelIdentity {
  modelFamily: string;
  modelVersion: string;
  preprocessingVersion: string;
}

export interface SaveProfileParams {
  profile: FaceProfile;
  embeddings: Array<{
    id: string;
    embedding: FaceEmbedding;
    pose: { yaw: number; pitch: number; roll: number };
    qualityScore: number;
    taskType: string;
  }>;
}

export class FaceProfileRepository {
  constructor(private adapter: SqlExecutor) {}

  /**
   * Replace the person's active profile with a new one.
   *
   * Transactional: a profile row without its embeddings would enter the
   * recognition index matching nothing, silently degrading accuracy.
   */
  public async saveProfile(params: SaveProfileParams): Promise<void> {
    const { profile, embeddings } = params;

    this.adapter.transaction(() => {
      // 1. Deactivate old profiles for this person if replacing
      this.adapter.run(
        `UPDATE face_profiles SET status = 'REPLACED', updated_at = ? WHERE person_id = ? AND status = 'ACTIVE'`,
        [profile.updatedAt, profile.personId]
      );

      // 2. Insert new profile
      this.adapter.run(
        `INSERT INTO face_profiles (id, person_id, profile_version, status, model_family, model_version, preprocessing_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profile.id,
          profile.personId,
          profile.profileVersion,
          profile.status,
          profile.modelFamily,
          profile.modelVersion,
          profile.preprocessingVersion,
          profile.createdAt,
          profile.updatedAt,
        ]
      );

      // 3. Insert embeddings
      for (const item of embeddings) {
        const v = item.embedding.vector;
        const vectorBlob = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        this.adapter.run(
          `INSERT INTO face_embeddings (
            id, face_profile_id, vector_blob, dimension, pose_yaw, pose_pitch, pose_roll,
            quality_score, model_family, model_version, preprocessing_version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            profile.id,
            vectorBlob,
            item.embedding.dimension,
            item.pose.yaw,
            item.pose.pitch,
            item.pose.roll,
            item.qualityScore,
            item.embedding.modelFamily,
            item.embedding.modelVersion,
            item.embedding.preprocessingVersion,
            profile.createdAt,
          ]
        );
      }
    });
  }

  /**
   * Active profiles, optionally restricted to one embedding space.
   *
   * Pass `model` whenever the result feeds recognition: mixing embedding spaces
   * produces meaningless similarity scores with no error to show for it.
   */
  public async getActiveProfiles(
    model?: ModelIdentity
  ): Promise<Array<{ profile: FaceProfile; vectors: Float32Array[] }>> {
    const profileRows = model
      ? this.adapter.exec(
          `SELECT id, person_id, profile_version, status, model_family, model_version, preprocessing_version, created_at, updated_at
           FROM face_profiles
           WHERE status = 'ACTIVE' AND model_family = ? AND model_version = ? AND preprocessing_version = ?`,
          [model.modelFamily, model.modelVersion, model.preprocessingVersion]
        )
      : this.adapter.exec(
          `SELECT id, person_id, profile_version, status, model_family, model_version, preprocessing_version, created_at, updated_at
           FROM face_profiles WHERE status = 'ACTIVE'`
        );

    const results: Array<{ profile: FaceProfile; vectors: Float32Array[] }> = [];

    for (const pRow of profileRows) {
      const pId = pRow.id as string;
      const embRows = this.adapter.exec(
        `SELECT vector_blob, dimension FROM face_embeddings WHERE face_profile_id = ?`,
        [pId]
      );

      const vectors: Float32Array[] = embRows.map((eRow) => {
        const blob = eRow.vector_blob as Uint8Array;
        return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
      });

      results.push({
        profile: {
          id: pId,
          personId: pRow.person_id as string,
          profileVersion: pRow.profile_version as number,
          status: pRow.status as 'ACTIVE',
          modelFamily: pRow.model_family as string,
          modelVersion: pRow.model_version as string,
          preprocessingVersion: pRow.preprocessing_version as string,
          embeddings: [],
          createdAt: pRow.created_at as number,
          updatedAt: pRow.updated_at as number,
        },
        vectors,
      });
    }

    return results;
  }
}
