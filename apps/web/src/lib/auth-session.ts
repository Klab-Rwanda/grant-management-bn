import { AuthUserContext } from '@grant-ledger/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getWebEnv } from './env';

export const SESSION_COOKIE = 'grant-ledger-session';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getApiBaseUrl(): string {
  return getWebEnv().NEXT_PUBLIC_API_URL.replace(/\/$/, '');
}

export async function requireAuthenticatedUser(): Promise<AuthUserContext> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    redirect('/login');
  }

  const response = await fetch(`${getApiBaseUrl()}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (response.status === 401) {
    redirect('/login?expired=1');
  }
  if (!response.ok) {
    throw new Error(`Could not verify the current session (HTTP ${response.status})`);
  }
  return (await response.json()) as AuthUserContext;
}
