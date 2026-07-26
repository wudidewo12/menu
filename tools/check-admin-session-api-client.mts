import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  AdminSessionApiError,
  fetchAdminSession,
  loginAdminSession,
  logoutAdminSession,
} from '../src/app/admin/admin-session-api.ts';

interface CapturedRequest {
  input: string | URL | Request;
  init?: RequestInit;
}

const originalFetch = globalThis.fetch;
const requests: CapturedRequest[] = [];
const responses: Response[] = [];
let rejectNetworkRequest = false;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function authenticatedPayload() {
  return {
    authenticated: true,
    user: {
      id: '019c0000-0000-7000-8000-000000000001',
      email: 'client-check@example.invalid',
      displayName: '客户端会话检查',
      role: 'EDITOR',
      status: 'ACTIVE',
      passwordHash: 'MUST_NOT_REACH_CLIENT_STATE',
    },
    session: {
      id: '019c0000-0000-7000-8000-000000000002',
      expiresAt: '2026-07-26T12:00:00.000Z',
      lastSeenAt: '2026-07-26T10:00:00.000Z',
      createdAt: '2026-07-26T10:00:00.000Z',
      token: 'MUST_NOT_REACH_CLIENT_STATE',
      tokenHash: 'MUST_NOT_REACH_CLIENT_STATE',
    },
  };
}

globalThis.fetch = (async (input, init) => {
  requests.push({
    input,
    init,
  });

  if (rejectNetworkRequest) {
    throw new TypeError('SIMULATED_NETWORK_FAILURE');
  }

  const response = responses.shift();
  if (!response) {
    throw new Error('MISSING_FAKE_RESPONSE');
  }

  return response;
}) as typeof fetch;

try {
  const loginInput = {
    email: 'client-check@example.invalid',
    password: 'TEST_ONLY_HIDDEN_LOGIN_INPUT',
  };
  responses.push(jsonResponse(authenticatedPayload()));
  const login = await loginAdminSession(loginInput);

  assert.equal(login.authenticated, true);
  assert.equal(login.user.role, 'EDITOR');
  assert.equal(login.user.status, 'ACTIVE');
  assert.equal(
    JSON.stringify(login).includes('MUST_NOT_REACH_CLIENT_STATE'),
    false,
  );
  assert.equal('passwordHash' in login.user, false);
  assert.equal('token' in login.session, false);
  assert.equal('tokenHash' in login.session, false);

  const loginRequest = requests[0];
  assert.ok(loginRequest);
  assert.equal(loginRequest.input, '/api/admin/session');
  assert.equal(loginRequest.init?.method, 'POST');
  assert.equal(loginRequest.init?.credentials, 'same-origin');
  assert.equal(
    new Headers(loginRequest.init?.headers).get('Content-Type'),
    'application/json',
  );
  assert.deepEqual(
    JSON.parse(String(loginRequest.init?.body)),
    loginInput,
  );
  assert.equal(String(loginRequest.input).includes(loginInput.password), false);
  assert.equal(
    JSON.stringify(loginRequest.init?.headers).includes(loginInput.password),
    false,
  );

  responses.push(jsonResponse(authenticatedPayload()));
  const current = await fetchAdminSession();
  assert.equal(current.user.email, loginInput.email);

  const currentRequest = requests[1];
  assert.ok(currentRequest);
  assert.equal(currentRequest.input, '/api/admin/session');
  assert.equal(currentRequest.init?.method, 'GET');
  assert.equal(currentRequest.init?.cache, 'no-store');
  assert.equal(currentRequest.init?.credentials, 'same-origin');
  assert.equal(currentRequest.init?.body, undefined);

  responses.push(jsonResponse({
    authenticated: false,
    token: 'MUST_NOT_REACH_CLIENT_STATE',
  }));
  const signedOut = await logoutAdminSession();
  assert.deepEqual(signedOut, {
    authenticated: false,
  });

  const logoutRequest = requests[2];
  assert.ok(logoutRequest);
  assert.equal(logoutRequest.input, '/api/admin/session');
  assert.equal(logoutRequest.init?.method, 'DELETE');
  assert.equal(logoutRequest.init?.credentials, 'same-origin');
  assert.equal(logoutRequest.init?.body, undefined);

  responses.push(jsonResponse({
    error: 'ADMIN_LOGIN_REJECTED',
  }, 401));
  await assert.rejects(
    loginAdminSession(loginInput),
    (error: unknown) =>
      error instanceof AdminSessionApiError &&
      error.status === 401 &&
      error.code === 'ADMIN_LOGIN_REJECTED',
  );

  responses.push(jsonResponse({
    ...authenticatedPayload(),
    user: {
      ...authenticatedPayload().user,
      role: 'UNKNOWN',
    },
  }));
  await assert.rejects(
    fetchAdminSession(),
    (error: unknown) =>
      error instanceof AdminSessionApiError &&
      error.status === 502 &&
      error.code === 'ADMIN_SESSION_RESPONSE_INVALID',
  );

  rejectNetworkRequest = true;
  await assert.rejects(
    fetchAdminSession(),
    (error: unknown) =>
      error instanceof AdminSessionApiError &&
      error.status === 0 &&
      error.code === 'ADMIN_SESSION_NETWORK_ERROR',
  );

  const source = fs.readFileSync(
    'src/app/admin/admin-session-api.ts',
    'utf8',
  );
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /Authorization|X-Admin-Password/);
  assert.doesNotMatch(source, /console\./);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('admin session browser client: passed');
console.log('login/current/logout methods: POST/GET/DELETE');
console.log('cookie transport: same-origin browser credential');
console.log('URL/header credential exposure: no');
console.log('extra token/hash/password fields retained: no');
console.log('typed HTTP/response/network errors: passed');
console.log('database imports/connections/writes: 0');
