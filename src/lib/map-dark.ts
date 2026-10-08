/**
 * OpenFreeMap only ships light styles. This recolors every color paint
 * property of the loaded style for dark mode, keeping hue so parks, water and
 * roads stay distinguishable: fills go deep, roads stay lighter than land,
 * labels go light with a dark halo.
 */

import type { StyleSpecification } from 'maplibre-gl'

type Hsla = { h: number; s: number; l: number; a: number }
type Kind = 'fill' | 'line' | 'text' | 'halo'

function rgbToHsl(r: number, g: number, b: number): Omit<Hsla, 'a'> {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

function parseColor(input: string): Hsla | null {
  const s = input.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (hex) {
    let h = hex[1]!
    if (h.length <= 4) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('')
    }
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { ...rgbToHsl(r, g, b), a }
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s)
  if (!fn) return null
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const num = (p: string, scale: number) =>
    p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p)
  const a = parts[3] === undefined ? 1 : num(parts[3], 1)
  if (fn[1]!.startsWith('rgb')) {
    const r = num(parts[0]!, 255)
    const g = num(parts[1]!, 255)
    const b = num(parts[2]!, 255)
    if ([r, g, b, a].some(Number.isNaN)) return null
    return { ...rgbToHsl(r, g, b), a }
  }
  const h = parseFloat(parts[0]!)
  const sat = parseFloat(parts[1]!) / 100
  const l = parseFloat(parts[2]!) / 100
  if ([h, sat, l, a].some(Number.isNaN)) return null
  return { h, s: sat, l, a }
}

function darkenColor(input: string, kind: Kind): string | null {
  const c = parseColor(input)
  if (!c) return null
  let l: number
  let s: number
  switch (kind) {
    case 'fill':
      l = 0.045 + c.l * 0.085
      s = c.s * 0.4
      break
    case 'line':
      l = 0.11 + c.l * 0.24
      s = c.s * 0.4
      break
    case 'text':
      l = 0.64 + (1 - c.l) * 0.26
      s = c.s * 0.35
      break
    case 'halo':
      l = 0.05 + c.l * 0.05
      s = c.s * 0.4
      break
  }
  return `hsla(${c.h.toFixed(0)}, ${(s * 100).toFixed(0)}%, ${(l * 100).toFixed(1)}%, ${c.a.toFixed(3)})`
}

function darkenValue(value: unknown, kind: Kind): unknown {
  if (typeof value === 'string') return darkenColor(value, kind) ?? value
  if (Array.isArray(value)) return value.map((v) => darkenValue(v, kind))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, darkenValue(v, kind)]),
    )
  }
  return value
}

function kindFor(prop: string): Kind | null {
  if (!prop.includes('color')) return null
  if (prop === 'text-color' || prop === 'icon-color') return 'text'
  if (prop.endsWith('halo-color')) return 'halo'
  if (prop === 'line-color') return 'line'
  return 'fill'
}

/**
 * Recolors a style spec in place. Use as `map.setStyle(url, { transformStyle })`
 * so the dark colors are in the very first frame (recoloring after load would
 * animate light to dark over ~300 ms).
 */
export function darkenStyle(style: StyleSpecification): StyleSpecification {
  for (const layer of style.layers) {
    const paint = (layer as unknown as { paint?: Record<string, unknown> }).paint
    if (!paint) continue
    for (const [prop, value] of Object.entries(paint)) {
      const kind = kindFor(prop)
      if (kind) paint[prop] = darkenValue(value, kind)
    }
  }
  return style
}
