import { NextResponse } from 'next/server';
import { getApiBaseUrl, isRecord, SESSION_COOKIE } from '../../../../lib/auth-session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

export async function POST(request: Request) {
  const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await request.text(),
    cache: 'no-store',
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    return NextResponse.json(result, { status: response.status });
  }
  if (!isRecord(result)) {
    return NextResponse.json(
      { message: 'The authentication service returned an invalid response.' },
      { status: 502 },
    );
  }
  if (Array.isArray(result.workspaces)) {
    return NextResponse.json({ workspaces: result.workspaces });
  }
  if (typeof result.access_token !== 'string' || !isRecord(result.user)) {
    return NextResponse.json(
      { message: 'The authentication service returned an invalid response.' },
      { status: 502 },
    );
  }

  const nextResponse = NextResponse.json({ user: result.user });
  nextResponse.cookies.set(SESSION_COOKIE, result.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return nextResponse;
}
