// Agency setup's fixtures (features/agency-setup.clan): 120 people for the CSV, with three bad rows (a missing email, an unknown
// role, a duplicate), and 8 clients. Placeholder names and an invented agency suffix. `peopleCsv()` returns the text.
export const NEW_AGENCY = { slug: 'cr', name: 'Agency C', first_admin: 'cara@cr' }
export const BAD_ROWS = [
  { line: 8, reason: 'missing email' },
  { line: 40, reason: 'unknown role' },
  { line: 70, reason: 'duplicate' },
]
const ROLES = ['planning', 'creative-director', 'account-service', 'management', 'art-director', 'copywriter', 'producer', 'traffic']
export function peopleCsv(n = 120) {
  const rows = ['email,name,roles']
  for (let i = 1; i <= n; i++) {
    const line = i + 1 // the header is line 1
    let email = `person${i}@cr`
    let role = ROLES[i % ROLES.length]
    if (line === 8) email = ''
    if (line === 40) role = 'wizard'
    if (line === 70) email = 'person3@cr'
    rows.push(`${email},Person ${i} Test,${role}`)
  }
  return rows.join('\n') + '\n'
}
export const CLIENTS_CSV = 'name\n' + Array.from({ length: 8 }, (_, i) => `Client C${i + 1}`).join('\n') + '\n'
export const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#2f6fd6"/></svg>'
