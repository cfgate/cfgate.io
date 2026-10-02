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
