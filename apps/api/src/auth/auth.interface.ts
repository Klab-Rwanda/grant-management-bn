import { AuthTokenPayload, AuthUserContext } from '@grant-ledger/shared';

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');

export interface IAuthProvider {
  verifyToken(token: string): Promise<AuthUserContext>;
  issueDevToken(payload: AuthTokenPayload): Promise<string>;

  // Future MFA & SSO hook points
  initiateMfaChallenge?(userId: string): Promise<{ challengeId: string }>;
  verifyMfa?(challengeId: string, code: string): Promise<boolean>;
  handleSsoCallback?(provider: string, code: string): Promise<AuthUserContext>;
}
