import { toDao } from '@app/shared/http/to-dao.helper';
import { CampaignConfigDao } from './campaign-config.dao';

/**
 * Pure mapping check, no database — confirms the literal task requirement
 * for `GET /v1/campaigns/:id/config`: same shape as the kiosk's
 * `GET /v1/devices/config`, but WITHOUT `captureMode`/`autoHoldMs`/
 * `simultaneousCapture` (§3.1.4, 2026-09-08). `CampaignConfigDao` is a
 * standalone class specifically so these three are never `@Expose()`d on
 * it — see that class's own doc comment for why it does not extend
 * `CampaignDao` to achieve this.
 */
describe('CampaignConfigDao', () => {
  test('strips captureMode/autoHoldMs/simultaneousCapture even when present on the source object', () => {
    const sourceWithDeprecatedFields = {
      id: 'c1',
      name: 'Test campaign',
      purpose: 'STUDENT_CARD',
      code: 'C1',
      cohort: null,
      startsAt: null,
      expiresAt: null,
      quotaPlanned: null,
      manualStatus: null,
      recordVideoRoles: null,
      cardSpec: null,
      effectiveStatus: 'OPEN',
      quotaReached: false,
      requiredCameraCount: 1,
      consentContent: null,
      consentVersion: 0,
      captureAngles: null,
      recordVideo: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      // The three deprecated, kiosk-only fields - must never survive the
      // mapping onto CampaignConfigDao.
      captureMode: 'AUTO',
      autoHoldMs: 1500,
      simultaneousCapture: true,
    };

    const dao = toDao(CampaignConfigDao, sourceWithDeprecatedFields);

    expect(dao).not.toHaveProperty('captureMode');
    expect(dao).not.toHaveProperty('autoHoldMs');
    expect(dao).not.toHaveProperty('simultaneousCapture');

    // Everything else that IS part of the contract still comes through.
    expect(dao.id).toBe('c1');
    expect(dao.effectiveStatus).toBe('OPEN');
    expect(dao.quotaReached).toBe(false);
    expect(dao.requiredCameraCount).toBe(1);
  });
});
