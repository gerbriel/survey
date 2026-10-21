/**
 * Server-only auth helpers for the (dashboard) group. Guards are UX only;
 * authorization is RLS. Pure helpers (roles, paths, invite cookie options)
 * can also be imported from their own files in client code.
 */
export * from './guards'
export * from './roles'
export * from './paths'
export * from './invite-cookies'
export { getGoogleSignInUrl } from './oauth'
export { claimInvitesFromCookies, handleAuthCallback, setInviteCookie } from './callback'
export { postSignInPath, type ClaimOutcome } from './post-sign-in'
