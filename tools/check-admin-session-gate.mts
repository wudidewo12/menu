import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AdminSessionGate,
  AdminSessionGateView,
  adminSignOutErrorMessage,
  resolveAdminSessionGateState,
} from '../src/app/admin/AdminSessionGate.tsx';
import {
  type AdminAuthenticatedSession,
  AdminSessionApiError,
} from '../src/app/admin/admin-session-api.ts';

const testSession: AdminAuthenticatedSession = {
  authenticated: true,
  user: {
    id: '019c0000-0000-7000-8000-000000000021',
    email: 'gate-check@example.invalid',
    displayName: '会话入口检查',
    role: 'EDITOR',
    status: 'ACTIVE',
  },
  session: {
    id: '019c0000-0000-7000-8000-000000000022',
    expiresAt: '2026-07-27T18:00:00.000Z',
    lastSeenAt: '2026-07-27T10:00:00.000Z',
    createdAt: '2026-07-27T10:00:00.000Z',
  },
};

const authenticatedState = await resolveAdminSessionGateState(
  async () => testSession,
);
assert.equal(authenticatedState.status, 'authenticated');
if (authenticatedState.status === 'authenticated') {
  assert.equal(authenticatedState.session, testSession);
}

const signedOutState = await resolveAdminSessionGateState(
  async () => {
    throw new AdminSessionApiError(401, 'ADMIN_SESSION_REQUIRED');
  },
);
assert.deepEqual(signedOutState, {
  status: 'signedOut',
});

const networkState = await resolveAdminSessionGateState(
  async () => {
    throw new AdminSessionApiError(0, 'ADMIN_SESSION_NETWORK_ERROR');
  },
);
assert.deepEqual(networkState, {
  status: 'unavailable',
  message: '无法连接登录服务，请检查网络后重试。',
});

const serviceState = await resolveAdminSessionGateState(
  async () => {
    throw new AdminSessionApiError(503, 'INTERNAL_DATABASE_DETAIL');
  },
);
assert.deepEqual(serviceState, {
  status: 'unavailable',
  message: '登录服务暂时不可用，请稍后重试。',
});
assert.doesNotMatch(
  serviceState.status === 'unavailable' ? serviceState.message : '',
  /INTERNAL_DATABASE_DETAIL/,
);

const protectedChild = (session: AdminAuthenticatedSession) =>
  createElement(
    'div',
    {
      'data-protected-user': session.user.id,
    },
    'PROTECTED_ADMIN_CONTENT',
  );

const initialMarkup = renderToStaticMarkup(
  createElement(AdminSessionGate, null, protectedChild),
);
assert.match(initialMarkup, /正在验证管理员身份/);
assert.doesNotMatch(initialMarkup, /PROTECTED_ADMIN_CONTENT/);

const sharedViewProps = {
  children: protectedChild,
  isSigningOut: false,
  signOutError: '',
  onRetry: () => undefined,
  onAuthenticated: () => undefined,
  onSignOut: () => undefined,
};

const signedOutMarkup = renderToStaticMarkup(
  createElement(AdminSessionGateView, {
    ...sharedViewProps,
    state: signedOutState,
  }),
);
assert.match(signedOutMarkup, /管理员登录/);
assert.match(signedOutMarkup, /type="email"/);
assert.match(signedOutMarkup, /type="password"/);
assert.doesNotMatch(signedOutMarkup, /PROTECTED_ADMIN_CONTENT/);

const unavailableMarkup = renderToStaticMarkup(
  createElement(AdminSessionGateView, {
    ...sharedViewProps,
    state: serviceState,
  }),
);
assert.match(unavailableMarkup, /暂时无法验证登录状态/);
assert.match(unavailableMarkup, /重新检查/);
assert.doesNotMatch(unavailableMarkup, /PROTECTED_ADMIN_CONTENT/);
assert.doesNotMatch(unavailableMarkup, /INTERNAL_DATABASE_DETAIL/);

const authenticatedMarkup = renderToStaticMarkup(
  createElement(AdminSessionGateView, {
    ...sharedViewProps,
    state: {
      status: 'authenticated',
      session: testSession,
    },
  }),
);
assert.match(authenticatedMarkup, /PROTECTED_ADMIN_CONTENT/);
assert.match(authenticatedMarkup, /会话入口检查/);
assert.match(authenticatedMarkup, /编辑者/);
assert.match(authenticatedMarkup, /退出登录/);
assert.doesNotMatch(authenticatedMarkup, /019c0000-0000-7000-8000-000000000022/);

assert.equal(
  adminSignOutErrorMessage(
    new AdminSessionApiError(0, 'ADMIN_SESSION_NETWORK_ERROR'),
  ),
  '无法连接退出服务，请检查网络后重试。',
);
assert.equal(
  adminSignOutErrorMessage(
    new AdminSessionApiError(503, 'INTERNAL_DATABASE_DETAIL'),
  ),
  '退出失败，请稍后重试。',
);

const source = fs.readFileSync(
  'src/app/admin/AdminSessionGate.tsx',
  'utf8',
);

assert.match(source, /^'use client';/);
assert.doesNotMatch(
  source,
  /localStorage|sessionStorage|document\.cookie/,
);
assert.doesNotMatch(source, /Authorization|X-Admin-Password/);
assert.doesNotMatch(source, /src\/server|PrismaClient|console\./);

console.log('admin session gate: passed');
console.log('loading/signed-out/unavailable/authenticated states: passed');
console.log('protected content before authentication: not rendered');
console.log('login form and retry/logout controls: passed');
console.log('internal error/token/session-id exposure: no');
console.log('browser storage/cookie/database access: no');
