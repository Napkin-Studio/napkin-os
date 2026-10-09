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
