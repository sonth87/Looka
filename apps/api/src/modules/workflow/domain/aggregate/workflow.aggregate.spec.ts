import { Workflow } from './workflow.aggregate';

describe('Workflow aggregate (pure — no DB, per plan §6 Giai đoạn 0 unit test convention)', () => {
  describe('create', () => {
    it('creates a workflow in DRAFT, uppercases the code, and raises WorkflowCreated', () => {
      const result = Workflow.create({
        code: 'the_card',
        name: 'Chụp thẻ sinh viên',
        createdByUserId: 'user-1',
      });
      expect(result.isSuccess).toBe(true);
      const workflow = result.value;
      expect(workflow.code).toBe('THE_CARD');
      expect(workflow.status).toBe('DRAFT');
      expect(workflow.currentVersionId).toBeNull();
      expect(workflow.domainEvents).toHaveLength(1);
      expect(workflow.domainEvents[0].eventName).toBe('WorkflowCreated');
    });

    it('fails on an empty code', () => {
      const result = Workflow.create({
        code: '   ',
        name: 'x',
        createdByUserId: null,
      });
      expect(result.isFailure).toBe(true);
    });

    it('fails on a code starting with a digit', () => {
      const result = Workflow.create({
        code: '1CODE',
        name: 'x',
        createdByUserId: null,
      });
      expect(result.isFailure).toBe(true);
    });

    it('fails on an empty name', () => {
      const result = Workflow.create({
        code: 'CODE',
        name: '  ',
        createdByUserId: null,
      });
      expect(result.isFailure).toBe(true);
    });
  });

  describe('rename', () => {
    it('updates name/description and does not raise a domain event', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'Old',
        createdByUserId: null,
      }).value;
      workflow.clearDomainEvents();

      const result = workflow.rename('New name', 'New description');
      expect(result.isSuccess).toBe(true);
      expect(workflow.name).toBe('New name');
      expect(workflow.description).toBe('New description');
      expect(workflow.domainEvents).toHaveLength(0);
    });

    it('returns noop when nothing actually changed', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'Same',
        createdByUserId: null,
      }).value;
      const result = workflow.rename('Same', undefined);
      expect(result.isNoop).toBe(true);
      expect(result.isSuccess).toBe(true);
    });

    it('fails on an empty name', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'X',
        createdByUserId: null,
      }).value;
      const result = workflow.rename('   ');
      expect(result.isFailure).toBe(true);
    });
  });

  describe('markVersionPublished', () => {
    it('moves a DRAFT workflow to ACTIVE and sets currentVersionId, raising WorkflowPublished', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'X',
        createdByUserId: null,
      }).value;
      workflow.clearDomainEvents();

      const result = workflow.markVersionPublished('version-1');
      expect(result.isSuccess).toBe(true);
      expect(workflow.status).toBe('ACTIVE');
      expect(workflow.currentVersionId).toBe('version-1');
      expect(workflow.domainEvents).toHaveLength(1);
      expect(workflow.domainEvents[0].eventName).toBe('WorkflowPublished');
    });

    it('allows publishing a later version while already ACTIVE, swapping currentVersionId', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'X',
        createdByUserId: null,
      }).value;
      workflow.markVersionPublished('version-1');
      workflow.clearDomainEvents();

      const result = workflow.markVersionPublished('version-2');
      expect(result.isSuccess).toBe(true);
      expect(workflow.status).toBe('ACTIVE');
      expect(workflow.currentVersionId).toBe('version-2');
    });

    it('fails once the workflow is ARCHIVED', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'X',
        createdByUserId: null,
      }).value;
      workflow.markVersionPublished('version-1');
      workflow.archive();

      const result = workflow.markVersionPublished('version-2');
      expect(result.isFailure).toBe(true);
      expect(workflow.currentVersionId).toBe('version-1');
    });
  });

  describe('archive', () => {
    it('moves an ACTIVE workflow to ARCHIVED and raises WorkflowArchived', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'X',
        createdByUserId: null,
      }).value;
      workflow.markVersionPublished('version-1');
      workflow.clearDomainEvents();

      const result = workflow.archive();
      expect(result.isSuccess).toBe(true);
      expect(workflow.status).toBe('ARCHIVED');
      expect(workflow.domainEvents).toHaveLength(1);
      expect(workflow.domainEvents[0].eventName).toBe('WorkflowArchived');
    });

    it('fails on a DRAFT workflow (never published)', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'X',
        createdByUserId: null,
      }).value;
      const result = workflow.archive();
      expect(result.isFailure).toBe(true);
    });

    it('fails on an already-ARCHIVED workflow', () => {
      const workflow = Workflow.create({
        code: 'CODE',
        name: 'X',
        createdByUserId: null,
      }).value;
      workflow.markVersionPublished('version-1');
      workflow.archive();

      const result = workflow.archive();
      expect(result.isFailure).toBe(true);
    });
  });

  describe('reconstruct', () => {
    it('rebuilds a workflow from persisted state without raising any event', () => {
      const workflow = Workflow.reconstruct({
        id: 'existing-id',
        code: 'CODE',
        name: 'X',
        description: null,
        status: 'ACTIVE',
        currentVersionId: 'version-1',
        createdByUserId: 'user-1',
      });
      expect(workflow.id).toBe('existing-id');
      expect(workflow.status).toBe('ACTIVE');
      expect(workflow.domainEvents).toHaveLength(0);
    });
  });
});
