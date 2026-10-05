import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { z } from 'zod'
import YAML from 'yaml'

export type Secrets = Record<string, string>
export interface SecretCodec {
  decrypt(path: string): Secrets
  encrypt(value: Secrets, path: string): string
}
function sops(args: string[], input?: string): string {
  try {
    return execFileSync('sops', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    throw new Error(
      'SOPS failed; check installation and your local age identity. No secret output was logged.'
    )
  }
}
export const sopsCodec: SecretCodec = {
  decrypt: (path) =>
    z
      .record(z.string(), z.string())
      .parse(JSON.parse(sops(['decrypt', '--output-type', 'json', path]))),
  encrypt: (value, path) =>
    sops(
      ['encrypt', '--filename-override', path, '--input-type', 'json', '--output-type', 'yaml'],
      JSON.stringify(value)
    ),
}
export class SecretStore {
  private original = ''
  values: Secrets = {}
  constructor(
    readonly path = 'secrets.enc.yaml',
    private codec: SecretCodec = sopsCodec
  ) {}
  async load(): Promise<this> {
    const info = await lstat(this.path)
    if (!info.isFile()) throw new Error('Encrypted secrets must be a regular file')
    this.original = await readFile(this.path, 'utf8')
    this.values = this.codec.decrypt(this.path)
    return this
  }
  async update(patch: Secrets): Promise<void> {
    if (Object.entries(patch).every(([key, value]) => this.values[key] === value)) return
    const next = { ...this.values, ...patch }
    const encrypted = this.codec.encrypt(next, this.path)
    const doc = YAML.parse(encrypted)
    if (
      !doc?.sops ||
      Object.keys(next).some((key) => typeof doc[key] !== 'string' || !doc[key].startsWith('ENC['))
    )
      throw new Error('Refusing to store a document with unencrypted secret values')
    if ((await readFile(this.path, 'utf8')) !== this.original)
      throw new Error('Encrypted secrets changed during setup; reload before retrying')
    const temporary = `${this.path}.${randomBytes(12).toString('hex')}.tmp`
    try {
      await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
      // The temporary file contains ciphertext only. Never persist decrypted JSON.
      if ((await readFile(this.path, 'utf8')) !== this.original)
        throw new Error('Encrypted secrets changed during setup; reload before retrying')
      await rename(temporary, this.path)
      this.original = encrypted
      this.values = next
    } finally {
      await rm(temporary, { force: true })
    }
  }
}
export async function prepareSecrets(
  store: SecretStore,
  accountId: string,
  legacyPath = '.activation/credentials.json'
): Promise<void> {
  const patch: Secrets = {}
  let legacy:
    { accountId: string; DOCS_ADMIN_TOKEN: string; DOCS_BUILDER_TOKEN: string } | undefined
  try {
    legacy = z
      .object({
        accountId: z.literal(accountId),
        DOCS_ADMIN_TOKEN: z.string().min(32),
        DOCS_BUILDER_TOKEN: z.string().min(32),
      })
      .parse(JSON.parse(await readFile(legacyPath, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(
        'Cannot import legacy activation credentials; check account and file contents'
      )
  }
  for (const key of ['DOCS_ADMIN_TOKEN', 'DOCS_BUILDER_TOKEN', 'GITHUB_WEBHOOK_SECRET'] as const) {
    const old = key === 'GITHUB_WEBHOOK_SECRET' ? undefined : legacy?.[key]
    if (old && store.values[key] && old !== store.values[key])
      throw new Error('Legacy and encrypted credentials disagree; do not rotate implicitly')
    if (store.values[key] && store.values[key].length < 32)
      throw new Error('Existing application credential is too short; review before replacing it')
    patch[key] = store.values[key] || old || randomBytes(32).toString('hex')
  }
  await store.update(patch)
}
