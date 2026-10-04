export const docsPolicy = {
  revision: 1,
  selection: 'highest-semver',
  includePrereleases: true,
  requirePublishedRelease: true,
  excludeDrafts: true,
  channels: { latest: true, next: false, versions: [] as string[] },
  locale: 'en',
  checkIntervalMs: 30 * 60 * 1000,
  retryIntervalMs: 5 * 60 * 1000,
  buildLeaseMs: 30 * 60 * 1000,
  maxReleasePages: 10,
} as const
