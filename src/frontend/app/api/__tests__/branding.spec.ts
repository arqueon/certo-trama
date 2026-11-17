import { useRuntimeConfig } from '#app'
import { afterEach, describe, expect, it } from 'vitest'
import { useBranding } from '@/composables/useBranding'

describe('useBranding: logotipos por fondo', () => {
  const pub = () => useRuntimeConfig().public as Record<string, unknown>
  afterEach(() => {
    Object.assign(pub(), { brandLogoUrl: '', brandLogoInverseUrl: '', brandEmblemUrl: '', brandParentName: '', brandParentLogoUrl: '', brandParentUrl: '' })
  })

  it('usa el logotipo para fondo oscuro y el emblema cuando están configurados', () => {
    Object.assign(pub(), { brandLogoUrl: '/marca/udg-logotipo.svg', brandLogoInverseUrl: ' /marca/udg-logotipo-blanco.svg ', brandEmblemUrl: '/marca/udg-escudo.svg' })
    const b = useBranding()
    expect(b.logoUrl).toBe('/marca/udg-logotipo.svg')
    expect(b.logoInverseUrl).toBe('/marca/udg-logotipo-blanco.svg')
    expect(b.emblemUrl).toBe('/marca/udg-escudo.svg')
  })

  it('sin ellos, no inventa un logotipo inverso y el emblema es el logotipo', () => {
    Object.assign(pub(), { brandLogoUrl: '/marca/udg-logotipo.svg' })
    const b = useBranding()
    expect(b.logoInverseUrl).toBe('')
    expect(b.emblemUrl).toBe('/marca/udg-logotipo.svg')
  })
})

describe('useBranding: organización madre en el pie', () => {
  const pub = () => useRuntimeConfig().public as Record<string, unknown>
  afterEach(() => {
    Object.assign(pub(), { brandParentName: '', brandParentLogoUrl: '', brandParentUrl: '' })
  })

  it('sin nombre no muestra la línea', () => {
    Object.assign(pub(), { brandParentLogoUrl: '/marca/potencia-comun.svg' })
    expect(useBranding().parent).toBeNull()
  })

  it('acepta logotipo del mismo origen o https y descarta lo demás', () => {
    Object.assign(pub(), { brandParentName: ' Potencia Común ', brandParentLogoUrl: '/marca/potencia-comun.svg', brandParentUrl: 'javascript:alert(1)' })
    expect(useBranding().parent).toEqual({ name: 'Potencia Común', logoUrl: '/marca/potencia-comun.svg', url: '' })
    Object.assign(pub(), { brandParentLogoUrl: '//otro.example/logo.svg', brandParentUrl: 'https://potenciacomun.org/' })
    expect(useBranding().parent).toEqual({ name: 'Potencia Común', logoUrl: '', url: 'https://potenciacomun.org/' })
  })
})
