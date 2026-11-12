// The client wall's canary for Phase 2 (tests 38, 62 and 67). A sentence is planted in every free-text field of a seed
// document; a response that must not carry the work (a client's link, a telemetry row, another brain) is then searched for it.
// The Phase 1 lesson: a thin seed hid a real leak on the client link, so the seed holds every field and every field holds this.

export const CANARY_SENTENCE = 'Canary sentence of Client A: the orange door opens at nine'

/** Keys whose string value is an id, a kind, a state or a link and not free text: left as they are. */
const NOT_TEXT = new Set(['id', 'kind', 'state', 'status', 'type', 'schema', 'version', 'by', 'at', 'role', 'person', 'actor', 'agent', 'action',
  'uri', 'url', 'path', 'doc', 'decision', 'fact', 'slug', 'page', 'beat', 'route', 'card', 'source', 'rule', 'rights', 'origin', 'email', 'username',
  'sha256', 'text_sha256', 'handler', 'backend', 'model', 'rubric_version', 'taxonomy_version', 'reason_code', 'polarity', 'advised_route', 'trust',
  'date', 'due', 'since', 'format', 'tag', 'branch', 'hash', 'value', 'dim', 'method', 'superseded_by', 'brief_version', 'cites', 'upstream',
  // keys the Brief Maker schema holds to an enum or a pattern (client-review-full): a canary there is refused 422, and it is not free text
  'key', 'gaps', 'material_id', 'dimension', 'verdict', 'licence', 'pack', 'scope', 'pack_version', 'retrieved_at'])

/** A copy of `doc` with the canary sentence appended to every free-text string, and the number of strings it reached. */
export function plantCanary(doc, sentence = CANARY_SENTENCE) {
  let planted = 0
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (key && NOT_TEXT.has(key)) return v
      if (!/[a-z]{3}/i.test(v)) return v
      planted++
      return `${v} ${sentence}`
    }
    if (Array.isArray(v)) return v.map(x => walk(x, key))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]))
    return v
  }
  const out = walk(doc, null)
  return { doc: out, planted }
}

/** Strings that must never reach a client's link (test 38): one distinct marker per agency-only field. */
export const AGENCY_ONLY = {
  judge_score: 'Marker judge note: the craft scored five of ten',
  agency_note: 'Marker agency note: Client A is slow to reply',
  idea_card: 'Marker idea card: a quiet bar with one song',
  banned_list: 'Marker banned idea: a toast with strangers',
}
