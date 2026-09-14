import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Pagination } from '@app/shared/http/pagination';
import {
  WorkflowReadModel,
  WorkflowUsageReadModel,
  WorkflowVersionSummary,
} from '../../application/queries/read-model/workflow.read-model';
import type { WorkflowConfig } from '../../domain/schema/workflow-config.schema';

export interface ListWorkflowsFilter {
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  q?: string;
  page: number;
  limit: number;
}

interface WorkflowRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  currentVersionId: string | null;
  currentVersion: number | null;
  currentConfig: WorkflowConfig | null;
  campaignCount: string;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_WORKFLOW = `
  SELECT
    w.id, w.code, w.name, w.description, w.status,
    w.current_version_id AS "currentVersionId",
    cv.version AS "currentVersion",
    COALESCE(cv.config, draft.config) AS "currentConfig",
    w.created_at AS "createdAt", w.updated_at AS "updatedAt",
    (SELECT COUNT(*)::text FROM campaigns c WHERE c.workflow_id = w.id) AS "campaignCount"
  FROM workflows w
  LEFT JOIN workflow_versions cv ON cv.id = w.current_version_id
  LEFT JOIN LATERAL (
    SELECT config FROM workflow_versions dv
    WHERE dv.workflow_id = w.id AND dv.published_at IS NULL
    ORDER BY dv.version DESC LIMIT 1
  ) draft ON w.current_version_id IS NULL
`;

/** Query-side read repository (plan §7 Q7) — `currentConfig` falls back to the draft version's config when nothing has ever been published yet, so a DRAFT workflow's author can still see what they are editing. */
@Injectable()
export class WorkflowCatalogReadRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(
    filter: ListWorkflowsFilter,
  ): Promise<Pagination<WorkflowReadModel>> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.status) {
      params.push(filter.status);
      conditions.push(`w.status = $${params.length}`);
    }
    if (filter.q) {
      params.push(`%${filter.q}%`);
      conditions.push(
        `(w.name ILIKE $${params.length} OR w.code ILIKE $${params.length})`,
      );
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(*)::text AS count FROM workflows w ${where}`,
      params,
    );
    const totalItems = Number(countRows[0]?.count ?? 0);

    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;
    const rows: WorkflowRow[] = await this.dataSource.query(
      `${SELECT_WORKFLOW} ${where} ORDER BY w.updated_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...params, filter.limit, (filter.page - 1) * filter.limit],
    );

    return new Pagination<WorkflowReadModel>(
      rows.map((r) => this.toReadModel(r)),
      {
        itemCount: rows.length,
        totalItems,
        itemsPerPage: filter.limit,
        totalPages: Math.ceil(totalItems / filter.limit) || 1,
        currentPage: filter.page,
      },
    );
  }

  async getById(id: string): Promise<WorkflowReadModel | null> {
    const rows: WorkflowRow[] = await this.dataSource.query(
      `${SELECT_WORKFLOW} WHERE w.id = $1`,
      [id],
    );
    return rows[0] ? this.toReadModel(rows[0]) : null;
  }

  /** Resolves a workflow BY the pinned version id — used by `device-management`'s config merge, cross-module (see `identity.module.ts` export precedent for why this repository is exported from `WorkflowModule`). */
  async getConfigByVersionId(
    versionId: string,
  ): Promise<WorkflowConfig | null> {
    const rows: Array<{ config: WorkflowConfig }> = await this.dataSource.query(
      `SELECT config FROM workflow_versions WHERE id = $1`,
      [versionId],
    );
    return rows[0]?.config ?? null;
  }

  /**
   * Everything `CampaignService.toCampaignResponse()` needs to populate
   * `CampaignDao.workflow` in one round trip: the parent workflow's id/
   * code, this version's number, and its config. Only returns a row for a
   * PUBLISHED version (`published_at IS NOT NULL`) — a campaign is never
   * allowed to pin a draft (see `CampaignService`'s own resolution logic),
   * so a null result here also doubles as "not a valid pin" if that
   * invariant were ever violated directly in the DB.
   */
  async getVersionRef(versionId: string): Promise<{
    workflowId: string;
    workflowCode: string;
    version: number;
    config: WorkflowConfig;
  } | null> {
    const rows: Array<{
      workflowId: string;
      workflowCode: string;
      version: number;
      config: WorkflowConfig;
    }> = await this.dataSource.query(
      `
      SELECT w.id AS "workflowId", w.code AS "workflowCode", wv.version, wv.config
      FROM workflow_versions wv
      JOIN workflows w ON w.id = wv.workflow_id
      WHERE wv.id = $1 AND wv.published_at IS NOT NULL
      `,
      [versionId],
    );
    return rows[0] ?? null;
  }

  async listVersions(workflowId: string): Promise<WorkflowVersionSummary[]> {
    const rows: Array<{
      id: string;
      version: number;
      publishedAt: Date | null;
      note: string | null;
    }> = await this.dataSource.query(
      `SELECT id, version, published_at AS "publishedAt", note
       FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC`,
      [workflowId],
    );
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      isDraft: r.publishedAt === null,
      publishedAt: r.publishedAt,
      note: r.note,
    }));
  }

  async usage(workflowId: string): Promise<WorkflowUsageReadModel[]> {
    const rows: WorkflowUsageReadModel[] = await this.dataSource.query(
      `
      SELECT
        c.id AS "campaignId", c.name AS "campaignName", c.code AS "campaignCode",
        c.workflow_version_id AS "workflowVersionId", wv.version AS "version"
      FROM campaigns c
      JOIN workflow_versions wv ON wv.id = c.workflow_version_id
      WHERE c.workflow_id = $1
      ORDER BY c.created_at DESC
      `,
      [workflowId],
    );
    return rows;
  }

  private toReadModel(row: WorkflowRow): WorkflowReadModel {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      status: row.status,
      currentVersionId: row.currentVersionId,
      currentVersion: row.currentVersion,
      currentConfig: row.currentConfig,
      campaignCount: Number(row.campaignCount),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
