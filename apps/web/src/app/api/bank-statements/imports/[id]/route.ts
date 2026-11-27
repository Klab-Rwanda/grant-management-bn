import { forwardApiRequest } from '../../../../../lib/api-proxy';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  return forwardApiRequest(request, `/bank-statements/imports/${encodeURIComponent(id)}`);
}
