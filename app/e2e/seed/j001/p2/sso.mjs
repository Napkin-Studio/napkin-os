// Single sign-on's fixtures (features/sso.clan): a fake identity provider the stack starts with NAPKIN_E2E_SSO=1. One person on its
// list, one from a domain it does not know, and the plain lines the interface says.
export const SSO_AGENCY = 'wk'
export const SSO_PERSON = { email: 'aoife@wk', name: 'Aoife Test', roles: ['planning'] }
export const UNKNOWN_DOMAIN_PERSON = { email: 'stranger@elsewhere.example', name: 'Stranger Test' }
export const SSO_BUTTON = 'Continue with your agency sign-in'
export const NOT_ON_LIST_LINE = 'You are not on this agency’s list. Ask your admin to add you.'
