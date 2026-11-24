/** The words for deleting a project, one set for Home's card and the project's own menu. The project goes to the client's
 *  Trash (the host's, S1-8) and comes back for 30 days. Nothing here says "from this browser": the server's copy goes too. */
export const TRASH_LABEL = 'Move to Trash…'
export const TRASH_HINT = 'You can restore it for 30 days'
export const TRASH_GO = 'Move to Trash'
export const trashQuestion = (name: string) => `Move “${name}” to Trash?`
export const TRASH_SUB = 'You can restore it for 30 days.'
export const deleteWords = (name: string) => `${trashQuestion(name)} ${TRASH_SUB}`

/** Where Trash is: the shell's page for the client (or the agency's, with no client), a plain link from this page. */
export const trashHref = (clientId?: string): string => (clientId ? `/#client-${encodeURIComponent(clientId)}-trash` : '/#trash')
