import { describe, it, expect, vi } from 'vitest'
import bootstrap from '../../docs/bootstrap.json'
import { targetSchema, makePlan, validatePlan, docRoute } from '../../src/docs/contracts'
import { eligibleReleases, Github, safePath, boundedText } from '../../src/docs/github'
const target = targetSchema.parse(bootstrap)
const release = (tag_name: string, rest = {}) => ({
  tag_name,
  draft: false,
  prerelease: false,
  published_at: '2026-10-04T00:00:00Z',
  ...rest,
})

describe('release and plan contracts', () => {
  it('uses semantic ordering, includes alpha releases and excludes unpublished sources', () => {
    expect(
      eligibleReleases([
        release('v1.0.0-alpha.9'),
        release('v1.0.0-alpha.11'),
        release('v2.0.0', { draft: true }),
        release('v3.0.0', { published_at: null }),
      ]).map((r) => r.tag_name)
    ).toEqual(['v1.0.0-alpha.11', 'v1.0.0-alpha.9'])
    expect(
      eligibleReleases([release('v1.0.0-alpha.11'), release('v0.9.0')], false).map(
        (r) => r.tag_name
      )
    ).toEqual(['v0.9.0'])
  })
  it('excludes generation from content identity and detects plan tampering', async () => {
    const first = await makePlan('a'.repeat(40), 'b'.repeat(64), [target])
    expect((await makePlan(first.rendererCommit, first.policyDigest, [target], 2)).buildKey).toBe(
      first.buildKey
    )
    expect((await makePlan('c'.repeat(40), first.policyDigest, [target])).buildKey).not.toBe(
      first.buildKey
    )
    await expect(validatePlan({ ...first, rendererCommit: 'd'.repeat(40) })).rejects.toThrow(
      'fingerprint'
    )
  })
  it('models selective historical and next routes without substituting latest', () => {
    expect(docRoute(target, 'reference/cloudflare-tunnel')).toBe(
      '/docs/reference/cloudflare-tunnel/'
    )
    expect(
      docRoute(
        targetSchema.parse({
          ...target,
          id: 'old',
          channel: 'version',
          mount: target.operatorVersion,
        }),
        'reference/cloudflare-tunnel'
      )
    ).toBe(`/docs/${target.operatorVersion}/reference/cloudflare-tunnel/`)
    expect(
      docRoute(targetSchema.parse({ ...target, id: 'next', channel: 'next', mount: 'next' }), '')
    ).toBe('/docs/next/')
    expect(() => targetSchema.parse({ ...target, mount: 'next' })).toThrow()
  })
  it('resolves annotated tags through their commit rather than target_commitish', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ object: { type: 'tag', sha: 'a'.repeat(40) } }))
      .mockResolvedValueOnce(Response.json({ object: { type: 'commit', sha: 'b'.repeat(40) } }))
    expect((await new Github(undefined, fetcher).pin('cfgate/cfgate', 'v1.0.0')).commit).toBe(
      'b'.repeat(40)
    )
    expect(fetcher.mock.calls[1][0]).toContain(`/git/tags/${'a'.repeat(40)}`)
  })
  it('checks all release pages before selecting the highest version', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(Array.from({ length: 100 }, () => release('v1.0.0'))))
      .mockResolvedValueOnce(Response.json([release('v2.0.0')]))
    expect((await new Github(undefined, fetcher).releases('cfgate/cfgate'))[0].tag_name).toBe(
      'v2.0.0'
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('pairs documentation with a matching chart without relabeling the newest chart', async () => {
    const github = new Github()
    vi.spyOn(github, 'releases').mockImplementation(async (repo) =>
      repo === 'cfgate/cfgate' ? [release('v2.0.0')] : [release('v3.0.0'), release('v2.1.0')]
    )
    vi.spyOn(github, 'pin').mockImplementation(async (repository, ref) => ({
      repository,
      ref,
      commit: 'a'.repeat(40),
    }))
    vi.spyOn(github, 'text').mockImplementation(async (source) =>
      source.ref === 'v3.0.0'
        ? 'version: 3.0.0\nappVersion: 1.0.0'
        : 'version: 2.1.0\nappVersion: 2.0.0'
    )
    const selected = await github.target()
    expect(selected.target.chartVersion).toBe('v2.1.0')
    expect(selected.chart[0].tag_name).toBe('v3.0.0')
    expect(selected.chartAppVersion).toBe('1.0.0')
  })
  it('finds a matching chart beyond the first thirty released charts', async () => {
    const github = new Github()
    const charts = Array.from({ length: 35 }, (_, i) => release(`v1.${35 - i}.0`))
    vi.spyOn(github, 'releases').mockImplementation(async (repo) =>
      repo === 'cfgate/cfgate' ? [release('v2.0.0')] : charts
    )
    vi.spyOn(github, 'pin').mockImplementation(async (repository, ref) => ({
      repository,
      ref,
      commit: 'a'.repeat(40),
    }))
    vi.spyOn(github, 'text').mockImplementation(
      async (source) =>
        `version: ${source.ref.slice(1)}\nappVersion: ${source.ref === 'v1.1.0' ? '2.0.0' : '1.0.0'}`
    )
    expect((await github.target()).target.chartVersion).toBe('v1.1.0')
  })
  it('uses conditional reads without advancing to unobserved content', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ sha: 'a'.repeat(40) }, { headers: { etag: 'test' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const github = new Github(undefined, fetcher)
    expect(await github.renderer()).toBe(await github.renderer())
    expect(fetcher.mock.calls[1][1]?.headers).toHaveProperty('If-None-Match', 'test')
  })
  it('bounds source bodies and rejects traversal', async () => {
    for (const path of [
      '../secret',
      '/etc/passwd',
      'docs/../README.md',
      'docs/%2e%2e/key',
      'docs\\secret',
    ])
      expect(() => safePath(path)).toThrow()
    await expect(boundedText(new Response('12345'), 4)).rejects.toThrow('size')
  })
})
