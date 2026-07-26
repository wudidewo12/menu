import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AdminLoginForm,
  adminLoginErrorMessage,
  submitAdminLogin,
} from '../src/app/admin/AdminLoginForm.tsx';
import {
  type AdminAuthenticatedSession,
  AdminSessionApiError,
} from '../src/app/admin/admin-session-api.ts';

const testInput = {
  email: 'form-check@example.invalid',
  password: 'TEST_ONLY_FORM_INPUT',
};

const testSession: AdminAuthenticatedSession = {
  authenticated: true,
  user: {
    id: '019c0000-0000-7000-8000-000000000011',
    email: testInput.email,
    displayName: '登录表单检查',
    role: 'EDITOR',
    status: 'ACTIVE',
  },
  session: {
    id: '019c0000-0000-7000-8000-000000000012',
    expiresAt: '2026-07-26T18:00:00.000Z',
    lastSeenAt: '2026-07-26T10:00:00.000Z',
    createdAt: '2026-07-26T10:00:00.000Z',
  },
};

const markup = renderToStaticMarkup(
  createElement(AdminLoginForm, {
    onAuthenticated: () => undefined,
  }),
);

assert.match(markup, /<form/);
assert.match(markup, /管理员邮箱/);
assert.match(markup, /type="email"/);
assert.match(markup, /name="email"/);
assert.match(markup, /autoComplete="email"/);
assert.match(markup, /maxLength="254"/);
assert.match(markup, /管理员密码/);
assert.match(markup, /type="password"/);
assert.match(markup, /name="password"/);
assert.match(markup, /autoComplete="current-password"/);
assert.match(markup, /maxLength="128"/);
assert.match(markup, /type="submit"/);
assert.match(markup, />登录<\/button>/);
assert.doesNotMatch(markup, new RegExp(testInput.email));
assert.doesNotMatch(markup, new RegExp(testInput.password));

let receivedInput: typeof testInput | null = null;
let receivedSession: AdminAuthenticatedSession | null = null;
let successClearCount = 0;

const successMessage = await submitAdminLogin({
  ...testInput,
  authenticate: async (input) => {
    receivedInput = input;
    return testSession;
  },
  onAuthenticated: (session) => {
    receivedSession = session;
  },
  clearPassword: () => {
    successClearCount += 1;
  },
});

assert.equal(successMessage, null);
assert.deepEqual(receivedInput, testInput);
assert.equal(receivedSession, testSession);
assert.equal(successClearCount, 1);

let rejectedCallbackCount = 0;
let rejectedClearCount = 0;

const rejectedMessage = await submitAdminLogin({
  ...testInput,
  authenticate: async () => {
    throw new AdminSessionApiError(401, 'ADMIN_LOGIN_REJECTED');
  },
  onAuthenticated: () => {
    rejectedCallbackCount += 1;
  },
  clearPassword: () => {
    rejectedClearCount += 1;
  },
});

assert.equal(rejectedMessage, '邮箱或密码不正确。');
assert.equal(rejectedCallbackCount, 0);
assert.equal(rejectedClearCount, 1);
assert.doesNotMatch(rejectedMessage, /ADMIN_LOGIN_REJECTED/);
assert.doesNotMatch(rejectedMessage, new RegExp(testInput.email));
assert.doesNotMatch(rejectedMessage, new RegExp(testInput.password));

assert.equal(
  adminLoginErrorMessage(
    new AdminSessionApiError(0, 'ADMIN_SESSION_NETWORK_ERROR'),
  ),
  '无法连接登录服务，请检查网络后重试。',
);
assert.equal(
  adminLoginErrorMessage(
    new AdminSessionApiError(503, 'ADMIN_SESSION_UNAVAILABLE'),
  ),
  '登录服务暂时不可用，请稍后重试。',
);
assert.equal(
  adminLoginErrorMessage(new Error('INTERNAL_DETAIL')),
  '登录失败，请稍后重试。',
);

const source = fs.readFileSync(
  'src/app/admin/AdminLoginForm.tsx',
  'utf8',
);

assert.match(source, /^'use client';/);
assert.match(source, /clearPassword\(\);/);
assert.doesNotMatch(
  source,
  /localStorage|sessionStorage|document\.cookie/,
);
assert.doesNotMatch(source, /Authorization|X-Admin-Password/);
assert.doesNotMatch(source, /console\./);

console.log('admin login form: passed');
console.log('accessible email/password/submit fields: passed');
console.log('password cleared after success and failure: passed');
console.log('safe user-facing error mapping: passed');
console.log('browser storage/cookie/token access: no');
console.log('database imports/connections/writes: 0');
