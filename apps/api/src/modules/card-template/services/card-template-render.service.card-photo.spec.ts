import { CardTemplateRenderService } from './card-template-render.service';

/**
 * `CardTemplateRenderService.cardPhotoForSet` (2026-09-30) — the approved
 * card photo of a set for the print preview's no-template stand-in. The
 * contract that matters: bytes when they can be read (locally held copy is
 * enough — no file-service needed), and `null`, never a gray placeholder,
 * when they cannot.
 */
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

function build(rowsBySql: (sql: string) => unknown[]) {
  const dataSource = {
    query: jest.fn((sql: string) => Promise.resolve(rowsBySql(sql))),
  };
  const fileStorage = { issueViewLink: jest.fn() };
  const service = new CardTemplateRenderService(
    dataSource as never,
    undefined as never,
    fileStorage as never,
  );
  return { service, dataSource, fileStorage };
}

describe('CardTemplateRenderService.cardPhotoForSet', () => {
  it('returns null when the set has no current card variant', async () => {
    const { service } = build((sql) =>
      sql.includes('FROM subject_photo_sets')
        ? [{ current_card_variant_id: null }]
        : [],
    );
    await expect(service.cardPhotoForSet('set-1')).resolves.toBeNull();
  });

  it('returns null when the set does not exist', async () => {
    const { service } = build(() => []);
    await expect(service.cardPhotoForSet('nope')).resolves.toBeNull();
  });

  it('returns the locally held bytes when the variant is not on the file-service (no remote call made)', async () => {
    const { service, fileStorage } = build((sql) => {
      if (sql.includes('FROM subject_photo_sets'))
        return [{ current_card_variant_id: 'var-1' }];
      if (sql.includes('FROM photo_variants'))
        return [{ fs_file_id: null, fs_status: null }];
      if (sql.includes('FROM variant_upload_outbox'))
        return [{ content: BYTES }];
      return [];
    });

    const photo = await service.cardPhotoForSet('set-1');

    expect(photo).toBe(BYTES);
    expect(fileStorage.issueViewLink).not.toHaveBeenCalled();
  });

  it('returns null (not a placeholder image) when the variant has neither a readable remote copy nor local bytes', async () => {
    const { service } = build((sql) => {
      if (sql.includes('FROM subject_photo_sets'))
        return [{ current_card_variant_id: 'var-1' }];
      if (sql.includes('FROM photo_variants'))
        return [{ fs_file_id: null, fs_status: null }];
      return [];
    });

    await expect(service.cardPhotoForSet('set-1')).resolves.toBeNull();
  });

  it('falls through to the local copy when the remote view-link fails', async () => {
    const { service, fileStorage } = build((sql) => {
      if (sql.includes('FROM subject_photo_sets'))
        return [{ current_card_variant_id: 'var-1' }];
      if (sql.includes('FROM photo_variants'))
        return [{ fs_file_id: 'fs-1', fs_status: 'READY' }];
      if (sql.includes('FROM variant_upload_outbox'))
        return [{ content: BYTES }];
      return [];
    });
    fileStorage.issueViewLink.mockRejectedValue(new Error('fs-core down'));

    await expect(service.cardPhotoForSet('set-1')).resolves.toBe(BYTES);
    expect(fileStorage.issueViewLink).toHaveBeenCalledTimes(1);
  });
});
