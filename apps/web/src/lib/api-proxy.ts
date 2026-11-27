import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getApiBaseUrl, SESSION_COOKIE } from './auth-session';

export async function forwardApiRequest(request: Request, apiPath: string): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Authentication is required' }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const headers = new Headers({ authorization: `Bearer ${token}` });
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const upstream = await fetch(`${getApiBaseUrl()}${apiPath}${requestUrl.search}`, {
    method: request.method,
    headers,
    body,
    cache: 'no-store',
  });
  const responseHeaders = new Headers();
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) responseHeaders.set('content-type', upstreamContentType);
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}
