'use client';

import React, {
  type FormEvent,
  useId,
  useState,
} from 'react';

import {
  type AdminAuthenticatedSession,
  AdminSessionApiError,
  loginAdminSession,
} from './admin-session-api';

interface AdminLoginFormProps {
  onAuthenticated: (
    session: AdminAuthenticatedSession,
  ) => void | Promise<void>;
}

interface SubmitAdminLoginOptions {
  email: string;
  password: string;
  authenticate?: typeof loginAdminSession;
  onAuthenticated: AdminLoginFormProps['onAuthenticated'];
  clearPassword: () => void;
}

export function adminLoginErrorMessage(error: unknown): string {
  if (!(error instanceof AdminSessionApiError)) {
    return '登录失败，请稍后重试。';
  }

  if (error.status === 401) {
    return '邮箱或密码不正确。';
  }

  if (error.status === 0) {
    return '无法连接登录服务，请检查网络后重试。';
  }

  if (error.status >= 500) {
    return '登录服务暂时不可用，请稍后重试。';
  }

  return '登录失败，请稍后重试。';
}

export async function submitAdminLogin({
  email,
  password,
  authenticate = loginAdminSession,
  onAuthenticated,
  clearPassword,
}: SubmitAdminLoginOptions): Promise<string | null> {
  try {
    const session = await authenticate({
      email,
      password,
    });
    await onAuthenticated(session);
    return null;
  } catch (error) {
    return adminLoginErrorMessage(error);
  } finally {
    clearPassword();
  }
}

export function AdminLoginForm({
  onAuthenticated,
}: AdminLoginFormProps) {
  const errorId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    const nextErrorMessage = await submitAdminLogin({
      email,
      password,
      onAuthenticated,
      clearPassword: () => setPassword(''),
    });

    setErrorMessage(nextErrorMessage ?? '');
    setIsSubmitting(false);
  }

  const errorDescriptionId = errorMessage ? errorId : undefined;

  return (
    <form
      className="grid gap-5"
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
    >
      <label className="grid gap-2 text-sm font-bold text-[#716259]">
        <span>管理员邮箱</span>
        <input
          className="w-full rounded-lg border border-black/15 bg-[#fffaf1] px-3 py-2.5 text-[#211914] outline-none focus:border-[#256b57]"
          type="email"
          name="email"
          autoComplete="email"
          maxLength={254}
          required
          disabled={isSubmitting}
          aria-describedby={errorDescriptionId}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className="grid gap-2 text-sm font-bold text-[#716259]">
        <span>管理员密码</span>
        <input
          className="w-full rounded-lg border border-black/15 bg-[#fffaf1] px-3 py-2.5 text-[#211914] outline-none focus:border-[#256b57]"
          type="password"
          name="password"
          autoComplete="current-password"
          maxLength={128}
          required
          disabled={isSubmitting}
          aria-describedby={errorDescriptionId}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {errorMessage ? (
        <p
          id={errorId}
          className="rounded-lg border border-red-900/20 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}

      <button
        className="min-h-11 rounded-lg bg-[#211914] px-4 font-bold text-[#fff8ea] disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? '登录中…' : '登录'}
      </button>
    </form>
  );
}

export default AdminLoginForm;
