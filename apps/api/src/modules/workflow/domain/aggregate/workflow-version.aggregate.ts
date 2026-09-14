import { randomUUID } from 'node:crypto';
import { AggregateRoot } from '@app/shared/domain/aggregate-root';
import { Result } from '@app/shared/domain/result';
import { WorkflowVersionPublishedEvent } from '../event/workflow-version-published.event';
import { WorkflowConfig } from '../schema/workflow-config.schema';

export interface WorkflowVersionProps {
  readonly id: string;
  readonly workflowId: string;
  readonly version: number;
  config: WorkflowConfig;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  note: string | null;
}

/**
 * One row of `workflow_versions` — "KHÔNG BAO GIỜ UPDATE sau khi publish"
 * (cms-8-screens-api-plan.md §2.2). A draft version (`publishedAt ===
 * null`) can have its `config` replaced freely via `updateConfig()`;
 * `publish()` freezes it forever — every method after that returns
 * `Result.fail`, never mutates.
 *
 * At most one version per workflow is ever a draft at a time (enforced by
 * the application handler that creates one, not by this aggregate, which
 * only knows about itself) — publishing an ALREADY-active workflow's next
 * version does not touch the currently-live version at all; both exist
 * side by side until the new one is published, at which point `Workflow.
 * markVersionPublished()` swaps `currentVersionId` over.
 */
export class WorkflowVersion extends AggregateRoot<string> {
  private props: WorkflowVersionProps;

  private constructor(props: WorkflowVersionProps) {
    super(props.id);
    this.props = props;
  }

  get workflowId(): string {
    return this.props.workflowId;
  }

  get version(): number {
    return this.props.version;
  }

  get config(): WorkflowConfig {
    return this.props.config;
  }

  get publishedAt(): Date | null {
    return this.props.publishedAt;
  }

  get publishedByUserId(): string | null {
    return this.props.publishedByUserId;
  }

  get note(): string | null {
    return this.props.note;
  }

  get isDraft(): boolean {
    return this.props.publishedAt === null;
  }

  static reconstruct(props: WorkflowVersionProps): WorkflowVersion {
    return new WorkflowVersion(props);
  }

  static createDraft(input: {
    workflowId: string;
    version: number;
    config: WorkflowConfig;
    note?: string | null;
  }): WorkflowVersion {
    return new WorkflowVersion({
      id: randomUUID(),
      workflowId: input.workflowId,
      version: input.version,
      config: input.config,
      publishedAt: null,
      publishedByUserId: null,
      note: input.note?.trim() || null,
    });
  }

  updateConfig(config: WorkflowConfig, note?: string | null): Result<void> {
    if (!this.isDraft) {
      return Result.fail(
        `Version ${this.props.version} đã publish — không thể sửa. Tạo version nháp mới để sửa tiếp.`,
      );
    }
    this.props.config = config;
    if (note !== undefined) this.props.note = note?.trim() || null;
    return Result.ok(undefined);
  }

  publish(publishedByUserId: string | null): Result<void> {
    if (!this.isDraft) {
      return Result.fail(`Version ${this.props.version} đã publish trước đó.`);
    }
    this.props.publishedAt = new Date();
    this.props.publishedByUserId = publishedByUserId;
    this.raise(
      new WorkflowVersionPublishedEvent(
        this.id,
        this.props.workflowId,
        this.props.version,
      ),
    );
    return Result.ok(undefined);
  }
}
