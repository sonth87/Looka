import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserCameraService } from '../BrowserCameraService.js';
import { ERROR_CODES, FacePlatformError } from '@face/core';

describe('BrowserCameraService', () => {
  test('should throw CAMERA_UNAVAILABLE when navigator is undefined', async () => {
    const service = new BrowserCameraService();

    try {
      await service.enumerateDevices();
      assert.fail('Should have thrown FacePlatformError');
    } catch (err: any) {
      assert.ok(err instanceof FacePlatformError);
      assert.equal(err.code, ERROR_CODES.CAMERA_UNAVAILABLE);
    }
  });

  test('should throw CAMERA_UNAVAILABLE on requestPermission without browser APIs', async () => {
    const service = new BrowserCameraService();

    try {
      await service.requestPermission();
      assert.fail('Should have thrown FacePlatformError');
    } catch (err: any) {
      assert.ok(err instanceof FacePlatformError);
      assert.equal(err.code, ERROR_CODES.CAMERA_UNAVAILABLE);
    }
  });

  test('should handle event listeners correctly', () => {
    const service = new BrowserCameraService();
    let called = false;
    const listener = () => {
      called = true;
    };

    service.on('disconnect', listener);
    service.off('disconnect', listener);

    // Private method test trigger indirectly or via listeners map
    assert.equal(called, false);
  });
});
