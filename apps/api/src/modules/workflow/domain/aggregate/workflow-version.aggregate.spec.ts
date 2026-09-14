import { WorkflowConfig } from '../schema/workflow-config.schema';
import { WorkflowVersion } from './workflow-version.aggregate';

function sampleConfig(): WorkflowConfig {
  return {
    capture: {
      angles: [{ id: 'FRONT', isCardSource: true }],
      clickMode: {
        default: 'MANUAL_SEQUENTIAL',
        allowed: ['MANUAL_SEQUENTIAL'],
      },
      shotsPerCamera: 1,
      cardSourceAngleCode: 'FRONT',
    },
    identification: {
      methods: ['MANUAL_LOOKUP'],
      lookupKeyField: 'studentCode',
    },
    eligibility: { mode: 'NONE' },
    aiProcessing: { enabled: false, steps: [] },
    output: {
      photoKindCode: 'STUDENT_CARD',
      cardSpec: {
        size: '3x4',
        dpi: 300,
        backgroundColor: '#FFFFFF',
        headHeightRatio: [0.6, 0.8],
        eyeLineRatio: [0.4, 0.5],
        retouch: { enabled: false },
      },
    },
    printing: { mode: 'CENTRALIZED' },
  };
}

describe('WorkflowVersion aggregate (pure — no DB, per plan §6 Giai đoạn 0 unit test convention)', () => {
  describe('createDraft', () => {
    it('creates a draft version (isDraft = true, publishedAt null)', () => {
      const version = WorkflowVersion.createDraft({
        workflowId: 'workflow-1',
        version: 1,
        config: sampleConfig(),
      });
      expect(version.isDraft).toBe(true);
      expect(version.publishedAt).toBeNull();
      expect(version.publishedByUserId).toBeNull();
      expect(version.domainEvents).toHaveLength(0);
    });
  });

  describe('updateConfig', () => {
    it('replaces the config on a draft version', () => {
      const version = WorkflowVersion.createDraft({
        workflowId: 'workflow-1',
        version: 1,
        config: sampleConfig(),
      });
      const nextConfig = {
        ...sampleConfig(),
        printing: { mode: 'DIRECT' as const },
      };

      const result = version.updateConfig(nextConfig, 'ghi chú');
      expect(result.isSuccess).toBe(true);
      expect(version.config.printing.mode).toBe('DIRECT');
      expect(version.note).toBe('ghi chú');
    });

    it('fails once the version has been published', () => {
      const version = WorkflowVersion.createDraft({
        workflowId: 'workflow-1',
        version: 1,
        config: sampleConfig(),
      });
      version.publish('user-1');

      const result = version.updateConfig(sampleConfig());
      expect(result.isFailure).toBe(true);
    });
  });

  describe('publish', () => {
    it('freezes the version, sets publishedAt/publishedByUserId, and raises WorkflowVersionPublished', () => {
      const version = WorkflowVersion.createDraft({
        workflowId: 'workflow-1',
        version: 1,
        config: sampleConfig(),
      });

      const result = version.publish('user-1');
      expect(result.isSuccess).toBe(true);
      expect(version.isDraft).toBe(false);
      expect(version.publishedAt).toBeInstanceOf(Date);
      expect(version.publishedByUserId).toBe('user-1');
      expect(version.domainEvents).toHaveLength(1);
      expect(version.domainEvents[0].eventName).toBe(
        'WorkflowVersionPublished',
      );
    });

    it('fails when publishing an already-published version', () => {
      const version = WorkflowVersion.createDraft({
        workflowId: 'workflow-1',
        version: 1,
        config: sampleConfig(),
      });
      version.publish('user-1');

      const result = version.publish('user-2');
      expect(result.isFailure).toBe(true);
      // The original publisher/timestamp must not be overwritten by the failed retry.
      expect(version.publishedByUserId).toBe('user-1');
    });
  });

  describe('reconstruct', () => {
    it('rebuilds a version from persisted state without raising any event', () => {
      const version = WorkflowVersion.reconstruct({
        id: 'existing-id',
        workflowId: 'workflow-1',
        version: 2,
        config: sampleConfig(),
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        publishedByUserId: 'user-1',
        note: null,
      });
      expect(version.id).toBe('existing-id');
      expect(version.isDraft).toBe(false);
      expect(version.domainEvents).toHaveLength(0);
    });
  });
});
