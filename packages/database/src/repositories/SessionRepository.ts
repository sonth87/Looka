import { CaptureSession, CaptureStepResult } from '@face/core';
import { SQLiteStorageAdapter } from '../SQLiteStorageAdapter.js';

export class SessionRepository {
  constructor(private adapter: SQLiteStorageAdapter) {}

  public async saveSession(session: CaptureSession): Promise<void> {
    const key = `session:${session.id}`;
    await this.adapter.set(key, session);

    // Also record audit event in database
    this.adapter.run(
      'INSERT INTO audit_events (id, type, entity_type, entity_id, actor_id, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        'SESSION_SAVE',
        'CAPTURE_SESSION',
        session.id,
        session.personId || 'system',
        Date.now(),
        JSON.stringify({ status: session.status, stepCount: session.steps.length }),
      ]
    );
  }

  public async getSession(sessionId: string): Promise<CaptureSession | null> {
    const key = `session:${sessionId}`;
    return this.adapter.get<CaptureSession>(key);
  }

  public async updateStepResult(sessionId: string, stepResult: CaptureStepResult): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const idx = session.steps.findIndex((s) => s.stepId === stepResult.stepId);
    if (idx !== -1) {
      session.steps[idx] = stepResult;
    } else {
      session.steps.push(stepResult);
    }

    await this.saveSession(session);
  }
}
