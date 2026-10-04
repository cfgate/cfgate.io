import snapshot from '@/data/project.json'

export interface Release {
  version: string
  published: string
  url: string
}
export interface ProjectData {
  releases: {
    checkedAt: string
    source: 'snapshot' | 'github'
    operator: Release[]
    chart: Release[]
    chartAppVersion: string
  }
  ci: {
    checkedAt: string
    source: 'snapshot' | 'github'
    status: string
    conclusion: string | null
    sha: string
    url: string
    updatedAt: string
  }
}
export const projectSnapshot = snapshot as ProjectData
const versionPattern = /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?$/

function releases(value: unknown, repo: string): Release[] {
  if (!Array.isArray(value)) throw new Error('Invalid release list')
  const result = value
    .filter((r) => r?.draft === false)
    .slice(0, 3)
    .map((r) => {
      if (
        typeof r.tag_name !== 'string' ||
        !versionPattern.test(r.tag_name) ||
        typeof r.published_at !== 'string' ||
        !Number.isFinite(Date.parse(r.published_at))
      ) {
        throw new Error('Invalid release')
      }
      return {
        version: r.tag_name,
        published: r.published_at,
        url: `https://github.com/cfgate/${repo}/releases/tag/${r.tag_name}`,
      }
    })
  if (!result.length) throw new Error('No published releases')
  return result
}

// Each source fails independently; never refresh the timestamp of fallback data.
export async function loadProjectData(
  fetcher: typeof fetch = fetch,
  fallback: ProjectData = projectSnapshot
): Promise<ProjectData> {
  const signal = AbortSignal.timeout(6000)
  async function get(url: string) {
    const response = await fetcher(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cfgate.io' },
      signal,
    })
    if (!response.ok) throw new Error(`Source returned ${response.status}`)
    return response
  }
  const [releaseResult, ciResult] = await Promise.allSettled([
    (async () => {
      const [operatorResponse, chartResponse] = await Promise.all([
        get('https://api.github.com/repos/cfgate/cfgate/releases?per_page=10'),
        get('https://api.github.com/repos/cfgate/helm-chart/releases?per_page=10'),
      ])
      const operator = releases(await operatorResponse.json(), 'cfgate')
      const chart = releases(await chartResponse.json(), 'helm-chart')
      const chartFile = await get(
        `https://raw.githubusercontent.com/cfgate/helm-chart/${chart[0].version}/Chart.yaml`
      )
      const yaml = await chartFile.text()
      const chartVersion = /^version:\s*["']?([^\s"']+)/m.exec(yaml)?.[1]
      const chartAppVersion = /^appVersion:\s*["']?([^\s"']+)/m.exec(yaml)?.[1]
      if (
        chartVersion !== chart[0].version.replace(/^v/, '') ||
        !chartAppVersion ||
        !versionPattern.test(chartAppVersion)
      )
        throw new Error('Invalid chart pairing')
      return {
        operator,
        chart,
        chartAppVersion,
        checkedAt: new Date().toISOString(),
        source: 'github' as const,
      }
    })(),
    (async () => {
      const response = await get(
        'https://api.github.com/repos/cfgate/cfgate/actions/workflows/ci.yml/runs?branch=main&per_page=1'
      )
      const data = (await response.json()) as { workflow_runs?: Record<string, unknown>[] }
      const run = data.workflow_runs?.[0]
      if (
        !run ||
        typeof run.id !== 'number' ||
        !Number.isSafeInteger(run.id) ||
        run.id <= 0 ||
        typeof run.head_sha !== 'string' ||
        !/^[a-f0-9]{40}$/.test(run.head_sha) ||
        typeof run.status !== 'string' ||
        (run.conclusion !== null && typeof run.conclusion !== 'string') ||
        typeof run.updated_at !== 'string' ||
        !Number.isFinite(Date.parse(run.updated_at))
      ) {
        throw new Error('Invalid CI run')
      }
      return {
        checkedAt: new Date().toISOString(),
        source: 'github' as const,
        status: run.status,
        conclusion: run.conclusion,
        sha: run.head_sha,
        url: `https://github.com/cfgate/cfgate/actions/runs/${run.id}`,
        updatedAt: run.updated_at,
      }
    })(),
  ])
  return {
    releases: releaseResult.status === 'fulfilled' ? releaseResult.value : fallback.releases,
    ci: ciResult.status === 'fulfilled' ? ciResult.value : fallback.ci,
  }
}
