/**
 * Rasterizes the job-type icons for the map. Each icon is drawn twice, white
 * and near-black, and the pin picks whichever clears 3:1 on its disc color.
 * Image ids look like `ji-tank-light`.
 */
import { ICON_BODIES, type IconName } from './icon-paths.ts'
import { GLYPH_COLOR } from './job-icons.ts'

export type GlyphTone = 'light' | 'dark'

export const GLYPH_PX = 24
export const GLYPH_PIXEL_RATIO = 2

export function glyphId(icon: IconName, tone: GlyphTone): string {
  return `ji-${icon}-${tone}`
}

function svgFor(icon: IconName, tone: GlyphTone, px: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${GLYPH_COLOR[tone]}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON_BODIES[icon]}</svg>`
  )
}

function draw(icon: IconName, tone: GlyphTone): Promise<ImageData> {
  const px = GLYPH_PX * GLYPH_PIXEL_RATIO
  return new Promise((resolve, reject) => {
    const img = new Image(px, px)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = px
      canvas.height = px
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas is not available.'))
        return
      }
      ctx.drawImage(img, 0, 0, px, px)
      resolve(ctx.getImageData(0, 0, px, px))
    }
    img.onerror = () => reject(new Error(`Could not draw icon ${icon}.`))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFor(icon, tone, px))}`
  })
}

let cache: Promise<Map<string, ImageData>> | null = null

/** Built once per window, then reused after every basemap swap. */
export function loadPinGlyphs(): Promise<Map<string, ImageData>> {
  cache ??= (async () => {
    const out = new Map<string, ImageData>()
    const names = Object.keys(ICON_BODIES) as IconName[]
    await Promise.all(
      names.flatMap((name) =>
        (['light', 'dark'] as const).map(async (tone) => {
          try {
            out.set(glyphId(name, tone), await draw(name, tone))
          } catch {
            // One bad glyph should not take the others down. The pin keeps its disc.
          }
        }),
      ),
    )
    return out
  })()
  return cache
}
