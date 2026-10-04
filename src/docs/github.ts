import { z } from 'zod'
import { rcompare, valid, prerelease } from 'semver'
import { parse } from 'yaml'
import { commitSchema, type DocsTarget, type SourcePin } from './contracts.js'
import { docsPolicy } from './policy.js'

const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
})
export type ReleaseObservation = z.infer<typeof releaseSchema>
export interface ConditionalEntry {
  etag?: string
  value: unknown
}
export type GithubCache = Record<string, ConditionalEntry>
export class SourceError extends Error {
  constructor(
    message: string,
    public retryAt?: number
  ) {
    super(message)
  }
}
export function eligibleReleases(
  releases: ReleaseObservation[],
  includePrereleases = true
): ReleaseObservation[] {
  return releases
    .filter(
      (r) =>
        !r.draft &&
        r.published_at &&
        Number.isFinite(Date.parse(r.published_at)) &&
        valid(r.tag_name) &&
        (includePrereleases || (!r.prerelease && !prerelease(r.tag_name)))
    )
    .sort((a, b) => rcompare(a.tag_name, b.tag_name) || a.tag_name.localeCompare(b.tag_name))
}
export class Github {
  constructor(
    private token?: string,
    private fetcher: typeof fetch = fetch,
    public cache: GithubCache = {}
  ) {}
  async get(path: string): Promise<unknown> {
    if (!/^\/repos\/cfgate\/(cfgate|helm-chart|cfgate\.io)\//.test(path))
      throw new Error('Repository not allowed')
    const previous = this.cache[path]
    const response = await this.fetcher(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cfgate.io',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(previous?.etag ? { 'If-None-Match': previous.etag } : {}),
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    })
    if (response.status === 304 && previous) return previous.value
    if (!response.ok) {
      const retry = response.headers.get('retry-after')
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
      throw new SourceError(
        `GitHub returned ${response.status}`,
        retry ? Date.now() + Number(retry) * 1000 : reset || undefined
      )
    }
    const body = await boundedText(response, 4 * 1024 * 1024)
    let value: unknown = JSON.parse(body)
    if (path.includes('/releases?')) value = z.array(releaseSchema).parse(value)
    if (path.endsWith('/commits/main')) value = z.object({ sha: commitSchema }).parse(value)
    this.cache[path] = { value, etag: response.headers.get('etag') ?? undefined }
    while (Object.keys(this.cache).length > 24 || JSON.stringify(this.cache).length > 48000)
      delete this.cache[Object.keys(this.cache)[0]]
    return value
  }
  async releases(repository: 'cfgate/cfgate' | 'cfgate/helm-chart'): Promise<ReleaseObservation[]> {
    const all: ReleaseObservation[] = []
    for (let page = 1; page <= docsPolicy.maxReleasePages; page++) {
      const chunk = z
        .array(releaseSchema)
        .parse(await this.get(`/repos/${repository}/releases?per_page=100&page=${page}`))
      all.push(...chunk)
      if (chunk.length < 100) return eligibleReleases(all, docsPolicy.includePrereleases)
    }
    throw new Error('Release inventory exceeds page limit; selection is incomplete')
  }
  async pin(repository: SourcePin['repository'], ref: string): Promise<SourcePin> {
    let object = z
      .object({ object: z.object({ type: z.enum(['commit', 'tag']), sha: commitSchema }) })
      .parse(await this.get(`/repos/${repository}/git/ref/tags/${encodeURIComponent(ref)}`)).object
    for (let depth = 0; object.type === 'tag'; depth++) {
      if (depth >= 8) throw new Error('Annotated tag chain exceeds limit')
      object = z
        .object({ object: z.object({ type: z.enum(['commit', 'tag']), sha: commitSchema }) })
        .parse(await this.get(`/repos/${repository}/git/tags/${object.sha}`)).object
    }
    return { repository, ref, commit: object.sha }
  }
  async renderer(): Promise<string> {
    return z
      .object({ sha: commitSchema })
      .parse(await this.get('/repos/cfgate/cfgate.io/commits/main')).sha
  }
  async text(source: SourcePin, path: string): Promise<string> {
    safePath(path)
    const response = await this.fetcher(
      `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${path}`,
      { signal: AbortSignal.timeout(10000), redirect: 'error' }
    )
    if (!response.ok) throw new Error(`Pinned source ${path} returned ${response.status}`)
    return boundedText(response, 2 * 1024 * 1024)
  }
  async target(): Promise<{
    target: DocsTarget
    operator: ReleaseObservation[]
    chart: ReleaseObservation[]
    chartAppVersion: string
  }> {
    const [operator, chart] = await Promise.all([
      this.releases('cfgate/cfgate'),
      this.releases('cfgate/helm-chart'),
    ])
    if (!operator.length) throw new Error('No eligible operator release')
    const operatorSource = await this.pin('cfgate/cfgate', operator[0].tag_name)
    let chartAppVersion = ''
    for (const release of chart) {
      const chartSource = await this.pin('cfgate/helm-chart', release.tag_name)
      const metadata = z
        .object({ appVersion: z.string(), version: z.string() })
        .parse(parse(await this.text(chartSource, 'Chart.yaml')))
      chartAppVersion ||= metadata.appVersion
      if (valid(metadata.version) !== valid(release.tag_name))
        throw new Error('Chart tag and version disagree')
      if (valid(metadata.appVersion) !== valid(operator[0].tag_name)) continue
      return {
        operator,
        chart,
        chartAppVersion,
        target: {
          id: 'latest',
          channel: 'latest',
          mount: '',
          locale: 'en',
          operatorVersion: operator[0].tag_name,
          operatorSource,
          documentationSource: operatorSource,
          chartSource,
          chartVersion: release.tag_name,
        },
      }
    }
    throw new Error('Waiting for a released chart matching the operator')
  }
}
export function safePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((p) => !p || p === '..' || p === '.') ||
    path.includes('%') ||
    [...path].some((c) => c.charCodeAt(0) < 32)
  )
    throw new Error('Unsafe source path')
}
export async function boundedText(
  response: Pick<Response, 'body'>,
  maxBytes: number
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const parts: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) throw new Error('Response exceeds size limit')
      parts.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
