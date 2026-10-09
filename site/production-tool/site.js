// The one place to set the "Try it" link. Leave it empty and every Try it button
// scrolls to "Get started" instead; set it and they all open the tool.
const TRY_IT_URL = '' // TODO(owner): the Production Tool's URL for the event

if (TRY_IT_URL) {
  for (const a of document.querySelectorAll('a[data-try-it]')) {
    a.href = TRY_IT_URL
    a.rel = 'noopener'
  }
  for (const el of document.querySelectorAll('[data-try-pending]')) el.hidden = true
}

// The demo loops are decorative: stop them for people who asked for less motion.
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const v of document.querySelectorAll('video[autoplay]')) {
    v.removeAttribute('autoplay')
    v.pause()
    // Rest on the finished card rather than its empty first frame.
    const rest = () => { v.currentTime = Math.max(0, v.duration - 0.1) }
    if (v.readyState >= 1) rest()
    else v.addEventListener('loadedmetadata', rest, { once: true })
  }
}
