import { BadRequestException } from '@nestjs/common';
import { PrintItemService } from './print-item.service';

/**
 * `PrintItemService.preview` — 2026-09-30: with no print template configured
 * (templates are not in use yet) the FRONT preview used to be a raw 400, so
 * "Xem trước" and the per-campaign thumbnails showed nothing even though the
 * student's approved card photo exists. It now falls back to that photo.
 * Same plain-fake convention as `print-item.service.spec.ts` (fakes stay
 * typed as object shapes until the `new PrintItemService(...)` call).
 */
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const RENDERED = Buffer.from('rendered-png');

function build(opts: {
  item?: Record<string, unknown>;
  batch?: Record<string, unknown> | null;
  photo?: Buffer | null;
}) {
  const item = {
    id: 'item-1',
    setId: 'set-1',
    batchId: opts.batch === null || opts.batch === undefined ? null : 'batch-1',
    templateId: null,
    printerId: null,
    renderedFrontFsFileId: null,
    renderedBackFsFileId: null,
    ...opts.item,
  };
  const items = { findOne: jest.fn().mockResolvedValue(item) };
  const batches = { findOne: jest.fn().mockResolvedValue(opts.batch ?? null) };
  const templateService = {
    loadTemplateOrFail: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
  };
  const renderService = {
    render: jest.fn().mockResolvedValue(RENDERED),
    cardPhotoForSet: jest.fn().mockResolvedValue(opts.photo ?? null),
  };
  const service = new PrintItemService(
    items as never,
    undefined as never,
    batches as never,
    undefined as never,
    templateService as never,
    renderService as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  return { service, renderService, templateService };
}

describe('PrintItemService.preview — approved-photo stand-in when no template is configured', () => {
  it('front side, no template anywhere → the approved card photo, flagged CARD_PHOTO (not a 400)', async () => {
    const { service, renderService } = build({ photo: PHOTO });

    const result = await service.preview('item-1', 'front');

    expect(result.kind).toBe('CARD_PHOTO');
    expect(result.buffer).toBe(PHOTO);
    expect(renderService.cardPhotoForSet).toHaveBeenCalledWith('set-1');
    expect(renderService.render).not.toHaveBeenCalled();
  });

  it('front side, no template AND the photo cannot be read → a clear 400 (never a blank/placeholder image)', async () => {
    const { service } = build({ photo: null });

    await expect(service.preview('item-1', 'front')).rejects.toThrow(
      /Chưa chọn phôi in và chưa đọc được ảnh thẻ/,
    );
  });

  it('back side, no template → a 400 that explains why (there is no photo stand-in for the back)', async () => {
    const { service, renderService } = build({ photo: PHOTO });

    const promise = service.preview('item-1', 'back');

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toThrow(/mặt sau/);
    expect(renderService.cardPhotoForSet).not.toHaveBeenCalled();
  });

  it('a template IS configured (on the batch) → the normal live render, flagged RENDERED, photo lookup never touched', async () => {
    const { service, renderService, templateService } = build({
      batch: { id: 'batch-1', defaultTemplateId: 'tpl-1', printerId: null },
      photo: PHOTO,
    });

    const result = await service.preview('item-1', 'front');

    expect(result.kind).toBe('RENDERED');
    expect(result.buffer).toBe(RENDERED);
    expect(templateService.loadTemplateOrFail).toHaveBeenCalledWith('tpl-1');
    expect(renderService.render).toHaveBeenCalledTimes(1);
    expect(renderService.cardPhotoForSet).not.toHaveBeenCalled();
  });
});
