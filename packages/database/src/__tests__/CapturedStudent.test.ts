import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PersistentStorageAdapter } from '../PersistentStorageAdapter.js';
import { CapturedStudentRepository } from '../repositories/CapturedStudentRepository.js';

async function makeRepo() {
  const adapter = new PersistentStorageAdapter({ filename: ':memory:' });
  await adapter.initialize();
  return { adapter, repo: new CapturedStudentRepository(adapter) };
}

const approval = (over: Partial<Parameters<CapturedStudentRepository['recordApproval']>[0]> = {}) => ({
  sessionId: 'sess_1',
  subjectCode: 'SV001',
  subjectName: 'Nguyễn Văn An',
  className: 'CNTT01',
  major: 'Công nghệ thông tin',
  academicYear: '2025-2026',
  workflowId: 'default',
  photoCount: 3,
  approvedAt: 1_700_000_000_000,
  ...over,
});

describe('CapturedStudentRepository', () => {
  test('recordApproval writes a row readable back by student', async () => {
    const { adapter, repo } = await makeRepo();
    repo.recordApproval(approval());

    const rows = repo.listByStudent('SV001');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, 'sess_1');
    assert.equal(rows[0].subjectName, 'Nguyễn Văn An');
    assert.equal(rows[0].className, 'CNTT01');
    assert.equal(rows[0].photoCount, 3);
    adapter.close();
  });

  test('recordApproval is an upsert — re-approving the same session updates it in place, not duplicated', async () => {
    const { adapter, repo } = await makeRepo();
    repo.recordApproval(approval({ photoCount: 3 }));
    repo.recordApproval(approval({ photoCount: 5, subjectName: 'Nguyễn Văn An (sửa)' }));

    const rows = repo.listByStudent('SV001');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].photoCount, 5);
    assert.equal(rows[0].subjectName, 'Nguyễn Văn An (sửa)');
    adapter.close();
  });

  test('listByStudent returns every session for that student, newest first', async () => {
    const { adapter, repo } = await makeRepo();
    repo.recordApproval(approval({ sessionId: 'sess_1', approvedAt: 1000 }));
    repo.recordApproval(approval({ sessionId: 'sess_2', approvedAt: 3000 }));
    repo.recordApproval(approval({ sessionId: 'sess_3', approvedAt: 2000 }));
    repo.recordApproval(approval({ sessionId: 'sess_other', subjectCode: 'SV002', approvedAt: 5000 }));

    const rows = repo.listByStudent('SV001');
    assert.deepEqual(
      rows.map((r) => r.sessionId),
      ['sess_2', 'sess_3', 'sess_1']
    );
    adapter.close();
  });

  test('listRecentStudents returns one row per distinct student — their latest session', async () => {
    const { adapter, repo } = await makeRepo();
    repo.recordApproval(approval({ sessionId: 'sess_1', subjectCode: 'SV001', approvedAt: 1000 }));
    repo.recordApproval(approval({ sessionId: 'sess_2', subjectCode: 'SV001', approvedAt: 3000, photoCount: 9 }));
    repo.recordApproval(approval({ sessionId: 'sess_3', subjectCode: 'SV002', subjectName: 'Trần Thị Bình', approvedAt: 2000 }));

    const rows = repo.listRecentStudents();
    assert.equal(rows.length, 2);
    const sv001 = rows.find((r) => r.subjectCode === 'SV001')!;
    assert.equal(sv001.sessionId, 'sess_2', 'the later of SV001’s two sessions wins');
    assert.equal(sv001.photoCount, 9);
    assert.deepEqual(
      rows.map((r) => r.subjectCode),
      ['SV001', 'SV002'],
      'ordered by approvedAt of the winning row, newest first'
    );
    adapter.close();
  });

  test('search matches code or name, case-insensitively, one row per student', async () => {
    const { adapter, repo } = await makeRepo();
    repo.recordApproval(approval({ sessionId: 'sess_1', subjectCode: 'SV001', subjectName: 'Nguyễn Văn An', approvedAt: 1000 }));
    repo.recordApproval(approval({ sessionId: 'sess_2', subjectCode: 'SV002', subjectName: 'Trần Thị Bình', approvedAt: 2000 }));

    assert.deepEqual(
      repo.search('sv001').map((r) => r.subjectCode),
      ['SV001']
    );
    assert.deepEqual(
      repo.search('bình').map((r) => r.subjectCode),
      ['SV002']
    );
    assert.deepEqual(repo.search('không-tồn-tại'), []);
    adapter.close();
  });

  test('a session with no local rows returns an empty list, not an error', async () => {
    const { adapter, repo } = await makeRepo();
    assert.deepEqual(repo.listByStudent('SV999'), []);
    assert.deepEqual(repo.listRecentStudents(), []);
    adapter.close();
  });
});
