'use client';

import React, {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import { AdminLoginForm } from './AdminLoginForm';
import {
  type AdminAuthenticatedSession,
  AdminSessionApiError,
  fetchAdminSession,
  logoutAdminSession,
} from './admin-session-api';

export type AdminSessionGateState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | {
    status: 'authenticated';
    session: AdminAuthenticatedSession;
  }
  | {
    status: 'unavailable';
    message: string;
  };

interface AdminSessionGateProps {
  children: (session: AdminAuthenticatedSession) => ReactNode;
}

interface AdminSessionGateViewProps extends AdminSessionGateProps {
  state: AdminSessionGateState;
  isSigningOut: boolean;
  signOutError: string;
  onRetry: () => void;
  onAuthenticated: (session: AdminAuthenticatedSession) => void;
  onSignOut: () => void;
}

export function adminSessionStatusErrorMessage(error: unknown): string {
  if (!(error instanceof AdminSessionApiError)) {
    return '无法确认登录状态，请稍后重试。';
  }

  if (error.status === 0) {
    return '无法连接登录服务，请检查网络后重试。';
  }

  if (error.status >= 500) {
    return '登录服务暂时不可用，请稍后重试。';
  }

  return '无法确认登录状态，请稍后重试。';
}

export function adminSignOutErrorMessage(error: unknown): string {
  if (
    error instanceof AdminSessionApiError
    && error.status === 0
  ) {
    return '无法连接退出服务，请检查网络后重试。';
  }

  return '退出失败，请稍后重试。';
}

export async function resolveAdminSessionGateState(
  loadSession: typeof fetchAdminSession = fetchAdminSession,
): Promise<AdminSessionGateState> {
  try {
    return {
      status: 'authenticated',
      session: await loadSession(),
    };
  } catch (error) {
    if (
      error instanceof AdminSessionApiError
      && error.status === 401
    ) {
      return {
        status: 'signedOut',
      };
    }

    return {
      status: 'unavailable',
      message: adminSessionStatusErrorMessage(error),
    };
  }
}

function SessionCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="menu-page admin-page">
      <div className="admin-shell">
        <section className="paper-panel admin-card mx-auto max-w-lg p-6">
          {children}
        </section>
      </div>
    </main>
  );
}

function roleLabel(role: AdminAuthenticatedSession['user']['role']) {
  if (role === 'OWNER') return '所有者';
  if (role === 'EDITOR') return '编辑者';
  return '查看者';
}

export function AdminSessionGateView({
  state,
  children,
  isSigningOut,
  signOutError,
  onRetry,
  onAuthenticated,
  onSignOut,
}: AdminSessionGateViewProps) {
  if (state.status === 'loading') {
    return (
      <SessionCard>
        <p aria-live="polite" aria-busy="true">
          正在验证管理员身份…
        </p>
      </SessionCard>
    );
  }

  if (state.status === 'signedOut') {
    return (
      <SessionCard>
        <p className="site-kicker">菜单后台</p>
        <h1 className="display-type mt-2 text-4xl font-semibold">
          管理员登录
        </h1>
        <p className="mt-3 mb-6 text-sm leading-6 text-[#6b5846]">
          登录成功后才能查看和修改后台内容。
        </p>
        <AdminLoginForm onAuthenticated={onAuthenticated} />
      </SessionCard>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <SessionCard>
        <h1 className="display-type text-3xl font-semibold">
          暂时无法验证登录状态
        </h1>
        <p
          className="mt-3 text-sm leading-6 text-[#6b5846]"
          role="alert"
        >
          {state.message}
        </p>
        <button
          className="mt-5 min-h-11 rounded-lg bg-[#211914] px-4 font-bold text-[#fff8ea]"
          type="button"
          onClick={onRetry}
        >
          重新检查
        </button>
      </SessionCard>
    );
  }

  return (
    <div data-admin-session-gate="authenticated">
      <section
        className="mx-auto mt-5 flex w-[calc(100%_-_32px)] max-w-[1440px] items-center justify-between gap-4 rounded-lg border border-black/10 bg-[#fffaf1] px-4 py-3"
        aria-label="管理员会话"
      >
        <p className="min-w-0 text-sm text-[#6b5846]">
          已登录：
          <strong className="ml-1 text-[#211914]">
            {state.session.user.displayName}
          </strong>
          <span className="ml-2">
            {roleLabel(state.session.user.role)}
          </span>
        </p>
        <button
          className="min-h-10 shrink-0 rounded-lg bg-[#211914] px-4 text-sm font-bold text-[#fff8ea] disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          disabled={isSigningOut}
          onClick={onSignOut}
        >
          {isSigningOut ? '正在退出…' : '退出登录'}
        </button>
      </section>

      {signOutError ? (
        <p
          className="mx-auto mt-3 w-[calc(100%_-_32px)] max-w-[1440px] rounded-lg border border-red-900/20 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          role="alert"
        >
          {signOutError}
        </p>
      ) : null}

      {children(state.session)}
    </div>
  );
}

export function AdminSessionGate({
  children,
}: AdminSessionGateProps) {
  const [state, setState] = useState<AdminSessionGateState>({
    status: 'loading',
  });
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const signingOutRef = useRef(false);

  useEffect(() => {
    let isCurrentCheck = true;

    setState({
      status: 'loading',
    });
    setSignOutError('');

    resolveAdminSessionGateState().then((nextState) => {
      if (isCurrentCheck) {
        setState(nextState);
      }
    });

    return () => {
      isCurrentCheck = false;
    };
  }, [checkAttempt]);

  function handleAuthenticated(session: AdminAuthenticatedSession) {
    setSignOutError('');
    setState({
      status: 'authenticated',
      session,
    });
  }

  async function handleSignOut() {
    if (signingOutRef.current) {
      return;
    }

    signingOutRef.current = true;
    setIsSigningOut(true);
    setSignOutError('');

    try {
      await logoutAdminSession();
      setState({
        status: 'signedOut',
      });
    } catch (error) {
      setSignOutError(adminSignOutErrorMessage(error));
    } finally {
      signingOutRef.current = false;
      setIsSigningOut(false);
    }
  }

  return (
    <AdminSessionGateView
      state={state}
      isSigningOut={isSigningOut}
      signOutError={signOutError}
      onRetry={() => setCheckAttempt((attempt) => attempt + 1)}
      onAuthenticated={handleAuthenticated}
      onSignOut={handleSignOut}
    >
      {children}
    </AdminSessionGateView>
  );
}

export default AdminSessionGate;
