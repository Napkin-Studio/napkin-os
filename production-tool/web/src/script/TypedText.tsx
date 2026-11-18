// Text with its typed @names marked as Screenplay marks them (ScriptEditor typedNames): known names in the
// tool's blue, others underlined. Wrapped in .sp-static so fragment.css styles them. The Video · Audio view's
// closed rows showed @mira as plain text where Screenplay showed it as a mention (live test 2026-11-16).
import { typedSpans } from './mentions'

export function TypedText({ text, names }: { text: string; names: readonly string[] }) {
  return (
    <span className="sp-static">
      {typedSpans(text, names).map((p, i) => (p.name ? <span key={i} className={p.known ? 'mention-typed' : 'mention-typed unknown'}>{p.text}</span> : p.text))}
    </span>
  )
}
