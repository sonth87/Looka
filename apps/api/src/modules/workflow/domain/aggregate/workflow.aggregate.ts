import { randomUUID } from 'node:crypto';
import { AggregateRoot } from '@app/shared/domain/aggregate-root';
import { Result } from '@app/shared/domain/result';
import { WorkflowArchivedEvent } from '../event/workflow-archived.event';
import { WorkflowCreatedEvent } from '../event/workflow-created.event';
import { WorkflowPublishedEvent } from '../event/workflow-published.event';

export type WorkflowStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface WorkflowProps {
  readonly id: string;
  readonly code: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  currentVersionId: string | null;
  readonly createdByUserId: string | null;
}

/**
 * "Nghiệp vụ" — cms-8-screens-api-plan.md §2.2. `code` is immutable (no
 * `changeCode()`, same convention `Role.code` already uses). Lifecycle,
 * exactly as the plan states it:
 *
 *   create → DRAFT (no version ever published)
 *          → publish(v1) → ACTIVE, currentVersionId = v1
 *          → [optionally: a new draft version gets authored in parallel —
 *             does NOT change this aggregate's status; see
 *             `workflow-version.aggregate.ts`'s own doc comment]
 *          → publish(v2) → still ACTIVE, currentVersionId now = v2
 *          → archive() → ARCHIVED (existing campaigns pinned to whatever
 *             version they already reference keep working; new campaigns
 *             can no longer select this workflow)
 *
 * A DRAFT workflow (never published) is abandoned via DELETE, not
 * archive() — `archive()` only accepts a transition FROM `ACTIVE`,
 * matching the plan's literal "ACTIVE → archive → ARCHIVED" wording; see
 * `delete-workflow.handler.ts` for the DRAFT-only deletion rule.
 */
export class Workflow extends AggregateRoot<string> {
  private props: WorkflowProps;

  private constructor(props: WorkflowProps) {
    super(props.id);
    this.props = props;
  }

  get code(): string {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get status(): WorkflowStatus {
    return this.props.status;
  }

  get currentVersionId(): string | null {
    return this.props.currentVersionId;
  }

  get createdByUserId(): string | null {
    return this.props.createdByUserId;
  }

  static reconstruct(props: WorkflowProps): Workflow {
    return new Workflow(props);
  }

  static create(input: {
    code: string;
    name: string;
    description?: string | null;
    createdByUserId: string | null;
  }): Result<Workflow> {
    const code = input.code.trim().toUpperCase();
    if (!code) {
      return Result.fail('Mã nghiệp vụ không được để trống.');
    }
    if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(code)) {
      return Result.fail(
        'Mã nghiệp vụ chỉ gồm chữ hoa, số, gạch dưới, bắt đầu bằng chữ, tối đa 50 ký tự.',
      );
    }
    const name = input.name.trim();
    if (!name) {
      return Result.fail('Tên nghiệp vụ không được để trống.');
    }

    const workflow = new Workflow({
      id: randomUUID(),
      code,
      name,
      description: input.description?.trim() || null,
      status: 'DRAFT',
      currentVersionId: null,
      createdByUserId: input.createdByUserId,
    });
    workflow.raise(new WorkflowCreatedEvent(workflow.id, code));
    return Result.ok(workflow);
  }

  rename(name: string, description?: string | null): Result<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return Result.fail('Tên nghiệp vụ không được để trống.');
    }
    if (
      this.props.name === trimmedName &&
      (this.props.description ?? null) === (description?.trim() || null)
    ) {
      return Result.noop(undefined);
    }
    this.props.name = trimmedName;
    this.props.description = description?.trim() || null;
    return Result.ok(undefined);
  }

  /** Called after the target `WorkflowVersion` itself has been published — see that aggregate's `publish()`. */
  markVersionPublished(versionId: string): Result<void> {
    if (this.props.status === 'ARCHIVED') {
      return Result.fail(
        'Nghiệp vụ đã lưu trữ, không thể publish version mới.',
      );
    }
    this.props.status = 'ACTIVE';
    this.props.currentVersionId = versionId;
    this.raise(new WorkflowPublishedEvent(this.id, this.props.code, versionId));
    return Result.ok(undefined);
  }

  archive(): Result<void> {
    if (this.props.status !== 'ACTIVE') {
      return Result.fail(
        `Chỉ nghiệp vụ đang ACTIVE mới lưu trữ được (hiện tại: ${this.props.status}).`,
      );
    }
    this.props.status = 'ARCHIVED';
    this.raise(new WorkflowArchivedEvent(this.id, this.props.code));
    return Result.ok(undefined);
  }
}
