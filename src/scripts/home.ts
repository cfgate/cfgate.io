import { animate, createScope, stagger } from 'animejs'

// Content is visible without JavaScript. Motion only introduces its final layout.
const scope = createScope({ mediaQueries: { reduced: '(prefers-reduced-motion: reduce)' } })
scope.add((self) => {
  if (!self || self.matches.reduced) return
  animate('.hero > *', {
    opacity: { from: 0.45, to: 1 },
    translateY: { from: 10, to: 0 },
    delay: stagger(60),
    duration: 550,
    ease: 'out(3)',
  })
  animate('.workflow-card', {
    opacity: { from: 0.65, to: 1 },
    delay: stagger(100, { start: 150 }),
    duration: 650,
    ease: 'out(3)',
  })
  animate('.connection-path:not(.connection-return)', {
    strokeDasharray: '300 300',
    strokeDashoffset: [300, 0],
    delay: 400,
    duration: 1000,
    ease: 'out(3)',
  })
})
window.addEventListener('pagehide', () => scope.revert(), { once: true })

// CSS owns the motion; observers only gate visibility and touch viewport focus.
const cards = [...document.querySelectorAll<HTMLElement>('.workflow-card')]
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let stopCardMotion: (() => void) | undefined
function startCardMotion() {
  stopCardMotion?.()
  if (reducedMotion.matches) return

  const visible = new Set<Element>()
  const updateVisibility = () => {
    for (const card of cards) {
      card.toggleAttribute('data-visible', visible.has(card) && !document.hidden)
    }
  }
  const visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target)
      else visible.delete(entry.target)
    }
    updateVisibility()
  })
  const focus = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        entry.target.toggleAttribute('data-focused', entry.isIntersecting)
    },
    { rootMargin: `-${window.innerHeight * 0.42}px 0px -${window.innerHeight * 0.42}px 0px` }
  )
  for (const card of cards) {
    visibility.observe(card)
    focus.observe(card)
  }
  document.addEventListener('visibilitychange', updateVisibility)
  stopCardMotion = () => {
    visibility.disconnect()
    focus.disconnect()
    document.removeEventListener('visibilitychange', updateVisibility)
    for (const card of cards) {
      card.removeAttribute('data-visible')
      card.removeAttribute('data-focused')
    }
  }
}
startCardMotion()
reducedMotion.addEventListener('change', startCardMotion)
window.addEventListener('resize', startCardMotion)
window.addEventListener('pagehide', () => stopCardMotion?.())
window.addEventListener('pageshow', (event) => {
  if (event.persisted) startCardMotion()
})

const button = document.querySelector<HTMLButtonElement>('[data-copy]')
const command = document.querySelector<HTMLElement>('#install-command')
const feedback = document.querySelector<HTMLElement>('[data-copy-feedback]')
if (button && command && feedback && navigator.clipboard) {
  button.hidden = false
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command.textContent ?? '')
      feedback.textContent = button.dataset.copied ?? 'Copied'
    } catch {
      feedback.textContent = button.dataset.failed ?? 'Select the command to copy it manually'
    }
  })
}
