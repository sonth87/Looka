import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ssoBaseUrl, cmsBaseUrl, callbackUrl, loginUrl, parseCallback } from '../ssoLogin.js';

const ENV_KEYS = ['VITE_URL_LOGIN_SSO', 'VITE_URL_CMS'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('ssoLogin config', () => {
  test('falls back to the real test SSO / local CMS dev origin when unset', () => {
    assert.equal(ssoBaseUrl(), 'https://test-login.dainam.edu.vn/');
    assert.equal(cmsBaseUrl(), 'http://localhost:3200');
    assert.equal(callbackUrl(), 'http://localhost:3200/desktop-callback');
  });

  test('reads VITE_URL_LOGIN_SSO / VITE_URL_CMS overrides for a packaged build', () => {
    process.env.VITE_URL_LOGIN_SSO = 'https://login.dainam.edu.vn/';
    process.env.VITE_URL_CMS = 'https://cms.dainam.edu.vn/';
    assert.equal(callbackUrl(), 'https://cms.dainam.edu.vn/desktop-callback');
  });

  test('strips a trailing slash from VITE_URL_CMS so the callback path never doubles up', () => {
    process.env.VITE_URL_CMS = 'https://cms.dainam.edu.vn/';
    assert.equal(callbackUrl(), 'https://cms.dainam.edu.vn/desktop-callback');
  });

  test('loginUrl carries an encoded continueUrl pointing back at the callback', () => {
    const url = loginUrl();
    assert.ok(url.startsWith('https://test-login.dainam.edu.vn/?continueUrl='));
    assert.ok(url.includes(encodeURIComponent('http://localhost:3200/desktop-callback')));
  });
});

describe('parseCallback', () => {
  test('parses access_token/refresh_token/email/user_code off the callback URL', () => {
    const url =
      'http://localhost:3200/desktop-callback?access_token=abc123&refresh_token=def456&email=sontt%40dainam.edu.vn&user_code=NV001';
    assert.deepEqual(parseCallback(url), {
      accessToken: 'abc123',
      refreshToken: 'def456',
      email: 'sontt@dainam.edu.vn',
      userCode: 'NV001',
    });
  });

  test('returns null for a URL that is not the callback at all', () => {
    assert.equal(parseCallback('https://test-login.dainam.edu.vn/some-login-step'), null);
  });

  test('returns null for the callback URL before SSO has attached tokens (still mid-flow)', () => {
    assert.equal(parseCallback('http://localhost:3200/desktop-callback'), null);
  });

  test('returns null when only one of access_token/refresh_token is present', () => {
    assert.equal(parseCallback('http://localhost:3200/desktop-callback?access_token=abc123'), null);
    assert.equal(parseCallback('http://localhost:3200/desktop-callback?refresh_token=def456'), null);
  });

  test('email/user_code default to empty string when SSO omits them', () => {
    const url = 'http://localhost:3200/desktop-callback?access_token=abc123&refresh_token=def456';
    assert.deepEqual(parseCallback(url), {
      accessToken: 'abc123',
      refreshToken: 'def456',
      email: '',
      userCode: '',
    });
  });
});
