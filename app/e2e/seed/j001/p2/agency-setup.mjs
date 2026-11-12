// Agency setup's fixtures (features/agency-setup.clan): 120 people for the CSV, with three bad rows (a missing email, an unknown
// role, a duplicate), 8 clients and 30 jobs. Placeholder names and invented agency suffixes. `peopleCsv()` returns the text.
// Each width gets its own agency (cr at 390, cs at 1440), so a run starts from nothing at both. The admin of each is on the
// roster stack's roster (people.mjs); the control list that would create the agency is a later stage of the record.
export const AGENCIES = {
  390: { slug: 'cr', name: 'Agency C', first_admin: 'cara@cr' },
  1440: { slug: 'cs', name: 'Agency S', first_admin: 'cara@cs' },
}
export const NEW_AGENCY = AGENCIES[390]
export const BAD_ROWS = [
  { line: 8, reason: 'missing email' },
  { line: 40, reason: 'unknown role' },
  { line: 70, reason: 'duplicate' },
]
const ROLES = ['planning', 'creative-director', 'account-service', 'management', 'art-director', 'copywriter', 'producer', 'traffic']
export function peopleCsv(n = 120, slug = 'cr') {
  const rows = ['email,name,roles']
  for (let i = 1; i <= n; i++) {
    const line = i + 1 // the header is line 1
    let email = `person${i}@${slug}`
    let role = ROLES[i % ROLES.length]
    if (line === 8) email = ''
    if (line === 40) role = 'wizard'
    if (line === 70) email = `person3@${slug}`
    rows.push(`${email},Person ${i} Test,${role}`)
  }
  return rows.join('\n') + '\n'
}
export const CLIENTS_CSV = 'name\n' + Array.from({ length: 8 }, (_, i) => `Client C${i + 1}`).join('\n') + '\n'
export const JOBS_CSV = 'client,title,due,budget_hours\n' + Array.from({ length: 30 }, (_, i) => `Client C${(i % 8) + 1},Job ${i + 1} launch,2026-12-${String((i % 28) + 1).padStart(2, '0')},${40 + i}`).join('\n') + '\n'
export const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#2f6fd6"/></svg>'
