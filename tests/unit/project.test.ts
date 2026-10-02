import { describe, expect, it, vi } from 'vitest'
import { loadProjectData, projectSnapshot } from '../../src/lib/project'

function fixtureFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.includes('raw.githubusercontent.com')) {
      return new Response('version: 2.0.0\nappVersion: "0.3.0-alpha.1"\n')
    }
    if (url.includes('/actions/')) {
      return Response.json({
        workflow_runs: [
          {
            id: 123,
            head_sha: 'a'.repeat(40),
            status: 'completed',
            conclusion: 'failure',
            updated_at: '2026-10-02T12:00:00Z',
          },
        ],
      })
    }
    return Response.json([
      { draft: true, tag_name: 'v9.0.0', published_at: null },
      {
        draft: false,
        tag_name: url.includes('/cfgate/releases') ? 'v2.0.0-alpha.1' : 'v2.0.0',
        published_at: '2026-10-02T10:00:00Z',
        html_url: 'https://untrusted.example/',
      },
    ])
  })
}

describe('project information', () => {
  it('uses the tagged chart appVersion, includes prereleases, and fixes source URLs', async () => {
    const fetcher = fixtureFetch()
    const data = await loadProjectData(fetcher)
    expect(data.releases.source).toBe('github')
    expect(data.releases.chartAppVersion).toBe('0.3.0-alpha.1')
    expect(data.releases.operator).toHaveLength(1)
    expect(data.releases.operator[0].url).toBe(
      'https://github.com/cfgate/cfgate/releases/tag/v2.0.0-alpha.1'
    )
    expect(data.ci.conclusion).toBe('failure')
    expect(data.ci.url).toBe('https://github.com/cfgate/cfgate/actions/runs/123')
    for (const [, init] of fetcher.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([403, 429, 500])('retains dated snapshots when GitHub returns %s', async (status) => {
    const data = await loadProjectData(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }))
    )
    expect(data).toEqual(projectSnapshot)
  })

  it('retains the snapshot on a timeout', async () => {
    expect(
      await loadProjectData(
        vi.fn<typeof fetch>().mockRejectedValue(new DOMException('Timed out', 'TimeoutError'))
      )
    ).toEqual(projectSnapshot)
  })

  it('keeps CI independently available when release data is malformed', async () => {
    const valid = fixtureFetch()
    const fetcher = vi.fn<typeof fetch>(async (input, init) =>
      String(input).includes('/releases?')
        ? Response.json([{ draft: false, tag_name: '../../bad', published_at: 'invalid' }])
        : valid(input, init)
    )
    const data = await loadProjectData(fetcher)
    expect(data.releases).toEqual(projectSnapshot.releases)
    expect(data.ci.source).toBe('github')
  })

  it('rejects a mismatched chart and an invalid CI identity', async () => {
    const valid = fixtureFetch()
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes('raw.githubusercontent.com'))
        return new Response('version: 9.0.0\nappVersion: 0.3.0\n')
      if (String(input).includes('/actions/')) return Response.json({ workflow_runs: [{ id: -1 }] })
      return valid(input, init)
    })
    expect(await loadProjectData(fetcher)).toEqual(projectSnapshot)
  })
})
