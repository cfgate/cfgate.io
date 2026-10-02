import { describe, it, expect } from 'vitest'
import { generateVanityHTML } from '../../../src/handlers/vanity.js'

describe('generateVanityHTML', () => {
  it('identifies the module root and repository', () => {
    const html = generateVanityHTML()

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain(
      '<meta name="go-import" content="cfgate.io/cfgate git https://github.com/cfgate/cfgate">'
    )
  })

  it('includes source browser templates', () => {
    const html = generateVanityHTML()

    expect(html).toContain('<meta name="go-source" content="cfgate.io/cfgate')
    expect(html).toContain('/tree/main{/dir}')
    expect(html).toContain('/blob/main{/dir}/{file}#L{line}')
  })
})
