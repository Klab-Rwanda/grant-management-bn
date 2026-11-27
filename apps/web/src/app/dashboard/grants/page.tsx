import { requireAuthenticatedUser } from '../../../lib/auth-session';
import GrantsWorkspace from './grants-workspace';

export default async function GrantsPage() {
  const user = await requireAuthenticatedUser();
  return <GrantsWorkspace user={user} />;
}
