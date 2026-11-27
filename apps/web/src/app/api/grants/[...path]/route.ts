import { NextResponse } from 'next/server';
import { forwardApiRequest } from '../../../../lib/api-proxy';

type RouteContext = { params: Promise<{ path: string[] }> };

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

function isAllowed(method: string, route: string): boolean {
  const id = (value: string) => new RegExp(`^${value}$`, 'i').test(route);
  if (method === 'GET') {
    return (
      route === 'grants' ||
      route === 'grant-programs' ||
      route === 'grant-setup/startups' ||
      route === 'journal-lines/grant-eligible' ||
      id(`grants/${uuid}`) ||
      id(`tranches/${uuid}/(allocations|readiness)`) ||
      id(`submissions/${uuid}`) ||
      id(`submissions/${uuid}/evidence/${uuid}/download`) ||
      id(`evidence/${uuid}/download`) ||
      id(`disbursements/${uuid}/evidence/download`)
    );
  }
  if (method === 'POST') {
    return (
      route === 'grant-programs' ||
      route === 'evidence' ||
      id(`grant-programs/${uuid}/grants`) ||
      id(`tranches/${uuid}/milestones`) ||
      id(`milestones/${uuid}/submit`) ||
      id(`tranches/${uuid}/allocations`) ||
      id(`allocations/${uuid}/drop`) ||
      id(`allocations/${uuid}/evidence`) ||
      id(`milestones/${uuid}/evidence`) ||
      id(`tranches/${uuid}/submit`) ||
      id(`submissions/${uuid}/review`) ||
      id(`submissions/${uuid}/authorize`) ||
      id(`tranches/${uuid}/disbursements`) ||
      id(`disbursements/${uuid}/confirm`)
    );
  }
  if (method === 'PATCH') return id(`allocations/${uuid}`);
  return false;
}

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const route = path.join('/');
  if (!isAllowed(request.method, route)) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  const safePath = path.map((segment) => encodeURIComponent(segment)).join('/');
  return forwardApiRequest(request, `/${safePath}`);
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
