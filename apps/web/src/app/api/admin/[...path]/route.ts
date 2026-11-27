import { forwardApiRequest } from '../../../../lib/api-proxy';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const route = path.join('/');
  const isWorkspaceRoute =
    route === 'workspaces' ||
    (request.method === 'PATCH' &&
      /^workspaces\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/status$/i.test(
        route,
      ));
  const isMembershipRoute =
    route === 'memberships' ||
    (request.method === 'PATCH' &&
      /^memberships\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/status$/i.test(
        route,
      ));
  const isReadRoute = ['audit-events', 'analytics', 'integrations/bank-statement-imports'].includes(
    route,
  );
  const allowed =
    (request.method === 'GET' && (isWorkspaceRoute || isMembershipRoute || isReadRoute)) ||
    (request.method === 'POST' && route === 'workspaces') ||
    (request.method === 'PATCH' && (isWorkspaceRoute || isMembershipRoute));
  if (!allowed) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const safePath = path.map((segment) => encodeURIComponent(segment)).join('/');
  return forwardApiRequest(request, `/admin/${safePath}`);
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
