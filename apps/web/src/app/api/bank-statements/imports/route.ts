import { forwardApiRequest } from '../../../../lib/api-proxy';

export function GET(request: Request): Promise<Response> {
  return forwardApiRequest(request, '/bank-statements/imports');
}

export function POST(request: Request): Promise<Response> {
  return forwardApiRequest(request, '/bank-statements/imports');
}
