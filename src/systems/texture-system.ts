import * as THREE from 'three'

import type { ArenaMap, ArenaVisualTheme } from '../shared/contracts'

export type WorldVariant = 'neon' | 'cavern' | 'abyssal' | 'abyssal-hd' | 'industrial'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const fract = (value: number) => value - Math.floor(value)

const smoothstep = (value: number) => value * value * (3 - 2 * value)

const hash2 = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123)

const valueNoise = (x: number, y: number) => {
  const cellX = Math.floor(x)
  const cellY = Math.floor(y)
  const localX = x - cellX
  const localY = y - cellY
  const u = smoothstep(localX)
  const v = smoothstep(localY)
  const a = hash2(cellX, cellY)
  const b = hash2(cellX + 1, cellY)
  const c = hash2(cellX, cellY + 1)
  const d = hash2(cellX + 1, cellY + 1)
  const top = a + (b - a) * u
  const bottom = c + (d - c) * u
  return top + (bottom - top) * v
}

const fbm = (x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5) => {
  let amplitude = 0.5
  let frequency = 1
  let sum = 0
  let totalAmplitude = 0
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency) * amplitude
    totalAmplitude += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return totalAmplitude > 0 ? sum / totalAmplitude : 0
}

const makePatternTexture = (
  drawer: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeatX: number,
  repeatY: number,
  options?: {
    size?: number
    smooth?: boolean
  },
) => {
  const canvas = document.createElement('canvas')
  const size = options?.size ?? 128
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D context unavailable')
  }
  drawer(ctx, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = options?.smooth ? THREE.LinearFilter : THREE.NearestFilter
  texture.minFilter = options?.smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapLinearFilter
  return texture
}

export const wallTexture = (variant: WorldVariant = 'neon') =>
  makePatternTexture((ctx, size) => {
    const image = ctx.createImageData(size, size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const primary = fbm(x / 30, y / 22, 5)
        const secondary = fbm((x + 18) / 9, (y - 11) / 11, 3)
        const ridge = Math.abs(secondary - 0.5) * 2
        const shade = clamp(primary * 0.75 + ridge * 0.25, 0, 1)
        const crack = fbm(x / 7, y / 48, 2)
        const index = (y * size + x) * 4
        const red = variant === 'abyssal-hd'
          ? Math.round(14 + shade * 30 + crack * 6)
          : variant === 'abyssal'
          ? Math.round(18 + shade * 32 + crack * 8)
          : variant === 'cavern'
          ? Math.round(26 + shade * 50 + crack * 18)
          : variant === 'industrial'
          ? Math.round(72 + shade * 56 + crack * 20)
          : Math.round(45 + shade * 85 + crack * 15)
        const green = variant === 'abyssal-hd'
          ? Math.round(36 + shade * 56 - crack * 2)
          : variant === 'abyssal'
          ? Math.round(30 + shade * 50 - crack * 3)
          : variant === 'cavern'
          ? Math.round(20 + shade * 36 - crack * 4)
          : variant === 'industrial'
          ? Math.round(58 + shade * 42 - crack * 4)
          : Math.round(15 + shade * 45 - crack * 5)
        const blue = variant === 'abyssal-hd'
          ? Math.round(42 + shade * 68 + crack * 14)
          : variant === 'abyssal'
          ? Math.round(34 + shade * 62 + crack * 14)
          : variant === 'cavern'
          ? Math.round(18 + shade * 26 + crack * 6)
          : variant === 'industrial'
          ? Math.round(48 + shade * 30 + crack * 6)
          : Math.round(60 + shade * 110 + crack * 20)
        image.data[index] = red
        image.data[index + 1] = green
        image.data[index + 2] = blue
        image.data[index + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    if (variant === 'cavern' || variant === 'abyssal' || variant === 'abyssal-hd') {
      // Add subtle mineral veins for cave walls.
      ctx.strokeStyle = variant === 'abyssal-hd'
        ? 'rgba(142, 233, 246, 0.5)'
        : variant === 'abyssal'
        ? 'rgba(112, 181, 192, 0.45)'
        : 'rgba(215, 143, 83, 0.4)'
      ctx.lineWidth = variant === 'abyssal-hd' ? 1.0 : variant === 'abyssal' ? 1.2 : 1.4
      for (let seam = 12; seam < size; seam += 26) {
        ctx.beginPath()
        ctx.moveTo(seam, 0)
        for (let y = 0; y <= size; y += 9) {
          const drift = (fbm(seam / 11, y / 14, 3) - 0.5) * 5
          ctx.lineTo(seam + drift, y)
        }
        ctx.stroke()
      }
    } else if (variant === 'industrial') {
      ctx.strokeStyle = 'rgba(198, 134, 82, 0.42)'
      ctx.lineWidth = 1.6
      for (let seam = 12; seam < size; seam += 28) {
        ctx.beginPath()
        ctx.moveTo(seam, 0)
        for (let y = 0; y <= size; y += 12) {
          const drift = (fbm(seam / 12, y / 19, 3) - 0.5) * 4
          ctx.lineTo(seam + drift, y)
        }
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(132, 110, 94, 0.24)'
      for (let y = 14; y < size; y += 26) {
        ctx.fillRect(0, y, size, 2)
      }
    } else {
      // Bright neon cyan panel edges
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.85)'
      ctx.lineWidth = 2
      for (let seam = 10; seam < size; seam += 24) {
        ctx.beginPath()
        ctx.moveTo(seam, 0)
        for (let y = 0; y <= size; y += 10) {
          const drift = (fbm(seam / 14, y / 17, 3) - 0.5) * 7
          ctx.lineTo(seam + drift, y)
        }
        ctx.stroke()
      }
      // Electric magenta highlights
      ctx.fillStyle = 'rgba(255, 0, 200, 0.3)'
      for (let y = 12; y < size; y += 26) {
        ctx.fillRect(0, y, size, 3)
      }
    }
  }, 1.5, 2.5, {
    size: variant === 'abyssal-hd' ? 256 : 128,
    smooth: variant === 'abyssal-hd' || variant === 'industrial',
  })

export const ceilingTexture = (variant: WorldVariant = 'neon') =>
  makePatternTexture((ctx, size) => {
    const image = ctx.createImageData(size, size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const rock = fbm(x / 16, y / 16, 5)
        const pockets = fbm((x + 24) / 34, (y + 80) / 28, 4)
        const rough = clamp(rock * 0.65 + pockets * 0.35, 0, 1)
        const index = (y * size + x) * 4
        image.data[index] = variant === 'abyssal-hd' ? Math.round(10 + rough * 22) : variant === 'abyssal' ? Math.round(14 + rough * 26) : variant === 'cavern' ? Math.round(22 + rough * 38) : variant === 'industrial' ? Math.round(74 + rough * 38) : Math.round(15 + rough * 40)
        image.data[index + 1] = variant === 'abyssal-hd' ? Math.round(30 + rough * 48) : variant === 'abyssal' ? Math.round(24 + rough * 44) : variant === 'cavern' ? Math.round(16 + rough * 24) : variant === 'industrial' ? Math.round(60 + rough * 28) : Math.round(8 + rough * 25)
        image.data[index + 2] = variant === 'abyssal-hd' ? Math.round(42 + rough * 62) : variant === 'abyssal' ? Math.round(30 + rough * 55) : variant === 'cavern' ? Math.round(14 + rough * 18) : variant === 'industrial' ? Math.round(52 + rough * 22) : Math.round(25 + rough * 50)
        image.data[index + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    if (variant === 'cavern' || variant === 'abyssal' || variant === 'abyssal-hd') {
      ctx.strokeStyle = variant === 'abyssal-hd' ? 'rgba(170, 239, 255, 0.42)' : variant === 'abyssal' ? 'rgba(120, 190, 210, 0.4)' : 'rgba(96, 66, 44, 0.45)'
      ctx.lineWidth = 1.4
      for (let y = 10; y < size; y += 24) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        for (let x = 0; x <= size; x += 10) {
          const wobble = (fbm(x / 16, y / 12, 3) - 0.5) * 5
          ctx.lineTo(x, y + wobble)
        }
        ctx.stroke()
      }
    } else if (variant === 'industrial') {
      ctx.strokeStyle = 'rgba(176, 128, 88, 0.34)'
      ctx.lineWidth = 1.2
      for (let y = 10; y < size; y += 24) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        for (let x = 0; x <= size; x += 14) {
          const wobble = (fbm(x / 17, y / 11, 3) - 0.5) * 3
          ctx.lineTo(x, y + wobble)
        }
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(148, 126, 112, 0.18)'
      for (let x = 14; x < size; x += 30) {
        ctx.fillRect(x, 0, 2, size)
      }
    } else {
      // Neon magenta accent lines
      ctx.strokeStyle = 'rgba(255, 0, 200, 0.5)'
      ctx.lineWidth = 1.5
      for (let y = 8; y < size; y += 22) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        for (let x = 0; x <= size; x += 12) {
          const wobble = (fbm(x / 20, y / 14, 3) - 0.5) * 6
          ctx.lineTo(x, y + wobble)
        }
        ctx.stroke()
      }
    }
  }, 8, 8, {
    size: variant === 'abyssal-hd' ? 256 : 128,
    smooth: variant === 'abyssal-hd' || variant === 'industrial',
  })

export const resolveVisualTheme = (map: ArenaMap): ArenaVisualTheme => {
  if (map.visualTheme) {
    return map.visualTheme
  }
  if (map.id === 'dark-caverns' || map.id === 'abyssal-grotto' || map.id === 'abyssal-grotto-prime') {
    return 'gothic-dungeon'
  }
  if (map.id === 'iron-cathedral') {
    return 'industrial-rust'
  }
  return 'neon-tech'
}

export const resolveWorldVariant = (map: ArenaMap): WorldVariant => {
  if (map.id === 'abyssal-grotto-prime') {
    return 'abyssal-hd'
  }
  if (map.id === 'abyssal-grotto') {
    return 'abyssal'
  }
  if (map.id === 'dark-caverns') {
    return 'cavern'
  }
  return resolveVisualTheme(map) === 'industrial-rust' ? 'industrial' : 'neon'
}
