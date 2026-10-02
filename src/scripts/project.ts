import type { ProjectData } from '@/lib/project'

async function refresh() {
  try {
    const response = await fetch('/api/project', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return
    const data = (await response.json()) as ProjectData
    for (const kind of ['operator', 'chart'] as const) {
      const release = data.releases[kind][0]
      document.querySelectorAll<HTMLAnchorElement>(`[data-release="${kind}"]`).forEach((link) => {
        link.href = release.url
        const version = link.querySelector('[data-version]')
        if (version) version.textContent = release.version
      })
      document.querySelectorAll(`[data-release-list="${kind}"]`).forEach((list) => {
        list.replaceChildren(
          ...data.releases[kind].map((release) => {
            const item = document.createElement('li')
            const link = document.createElement('a')
            link.href = release.url
            link.textContent = release.version
            const date = document.createElement('time')
            date.dateTime = release.published
            date.textContent = release.published.slice(0, 10)
            item.appendChild(link)
            item.appendChild(date)
            return item
          })
        )
      })
    }
    document.querySelectorAll('[data-chart-app]').forEach((node) => {
      node.textContent = data.releases.chartAppVersion
    })
    for (const kind of ['releases', 'ci'] as const) {
      document.querySelectorAll<HTMLElement>(`[data-source="${kind}"]`).forEach((node) => {
        const label = data[kind].source === 'github' ? node.dataset.checked : node.dataset.snapshot
        node.textContent = `${label} · ${new Date(data[kind].checkedAt).toLocaleString(document.documentElement.lang)}`
      })
    }
    const ci = document.querySelector<HTMLAnchorElement>('[data-ci]')
    if (ci) {
      ci.href = data.ci.url
      ci.textContent = `${data.ci.status === 'completed' ? (data.ci.conclusion ?? 'unknown') : data.ci.status} · ${data.ci.sha.slice(0, 7)}`
    }
    document.querySelectorAll('[data-ci-date]').forEach((node) => {
      node.textContent = data.ci.updatedAt.slice(0, 10)
    })
  } catch {
    // The dated static snapshot stays usable without a successful refresh.
  }
}
void refresh()
