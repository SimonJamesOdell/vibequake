import * as THREE from 'three'

type TextureSet = {
  diffuse: THREE.Texture
  normal: THREE.Texture
  roughness: THREE.Texture
}

export class TextureManager {
  private cache = new Map<string, TextureSet>()

  constructor() {
    // No shared canvas - each texture gets its own
  }

  getTextureSet(textureName: string): TextureSet {
    const cached = this.cache.get(textureName)
    if (cached) {
      return cached
    }

    const textureSet = this.generateTextureSet(textureName)
    this.cache.set(textureName, textureSet)
    return textureSet
  }

  private createCanvas(size = 512): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    return { canvas, ctx }
  }

  private generateTextureSet(textureName: string): TextureSet {
    const name = textureName.toLowerCase()

    // Detect texture type from name
    if (name.includes('concrete') || name.includes('cement')) {
      return this.generateConcrete(name)
    } else if (name.includes('metal') || name.includes('steel')) {
      return this.generateMetal(name)
    } else if (name.includes('floor') || name.includes('tile')) {
      return this.generateFloor(name)
    } else if (name.includes('trim') || name.includes('baseboard')) {
      return this.generateTrim(name)
    } else if (name.includes('light') || name.includes('beam')) {
      return this.generateLight(name)
    } else if (name.includes('holes') || name.includes('grate')) {
      return this.generateGrate(name)
    } else if (name.includes('caulk') || name.includes('skip') || name.includes('clip')) {
      return this.generateInvisible()
    } else if (name.includes('liquid') || name.includes('water') || name.includes('lava')) {
      return this.generateLiquid(name)
    } else if (name.includes('sky') || name.includes('cloud')) {
      return this.generateSky()
    } else {
      return this.generateGeneric(name)
    }
  }

  private generateConcrete(name: string): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    // Base color - determine color variant
    const isRed = name.includes('red')
    const isBlue = name.includes('blue')
    const baseColor = isRed ? [80, 45, 50] : isBlue ? [45, 55, 80] : [65, 70, 75]

    // Diffuse map
    ctx.fillStyle = `rgb(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]})`
    ctx.fillRect(0, 0, size, size)

    // Add noise and variation
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      const variation = (Math.random() - 0.5) * 40
      const color = baseColor.map(c => Math.max(0, Math.min(255, c + variation)))
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.3)`
      ctx.fillRect(x, y, Math.random() * 8 + 2, Math.random() * 8 + 2)
    }

    // Add cracks
    for (let i = 0; i < 15; i++) {
      ctx.strokeStyle = `rgba(${baseColor[0] - 20}, ${baseColor[1] - 20}, ${baseColor[2] - 20}, 0.5)`
      ctx.lineWidth = Math.random() * 2 + 0.5
      ctx.beginPath()
      ctx.moveTo(Math.random() * size, Math.random() * size)
      for (let j = 0; j < 5; j++) {
        ctx.lineTo(Math.random() * size, Math.random() * size)
      }
      ctx.stroke()
    }

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.repeat.set(2, 2)
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    // Normal map
    const normal = this.generateNormalMap(0.3)

    // Roughness map
    const roughness = this.generateRoughnessMap(0.85)

    return { diffuse, normal, roughness }
  }

  private generateMetal(name: string): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    // Base metallic color
    const baseColor = name.includes('rust') 
      ? [90, 60, 45] 
      : name.includes('gold')
      ? [180, 140, 70]
      : [70, 75, 80]

    ctx.fillStyle = `rgb(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]})`
    ctx.fillRect(0, 0, size, size)

    // Add brushed metal effect
    for (let y = 0; y < size; y++) {
      const variation = (Math.random() - 0.5) * 15
      const alpha = Math.random() * 0.15 + 0.05
      const color = baseColor.map(c => Math.max(0, Math.min(255, c + variation)))
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`
      ctx.fillRect(0, y, size, 1)
    }

    // Add panels/seams
    const panelSize = size / 4
    for (let x = 0; x < size; x += panelSize) {
      for (let y = 0; y < size; y += panelSize) {
        ctx.strokeStyle = `rgba(${baseColor[0] - 25}, ${baseColor[1] - 25}, ${baseColor[2] - 25}, 0.6)`
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, panelSize, panelSize)
      }
    }

    // Add rivets
    for (let x = panelSize / 2; x < size; x += panelSize) {
      for (let y = panelSize / 2; y < size; y += panelSize) {
        ctx.fillStyle = `rgba(${baseColor[0] - 15}, ${baseColor[1] - 15}, ${baseColor[2] - 15}, 0.8)`
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(${baseColor[0] + 30}, ${baseColor[1] + 30}, ${baseColor[2] + 30}, 0.4)`
        ctx.beginPath()
        ctx.arc(x - 1, y - 1, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.repeat.set(1, 1)
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    const normal = this.generateNormalMap(0.5)
    const roughness = this.generateRoughnessMap(0.4)

    return { diffuse, normal, roughness }
  }

  private generateFloor(name: string): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    // Detect floor type
    const isTile = name.includes('tile')

    const baseColor = [55, 60, 65]

    ctx.fillStyle = `rgb(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]})`
    ctx.fillRect(0, 0, size, size)

    if (isTile) {
      // Generate tile pattern
      const tileSize = size / 8
      for (let x = 0; x < size; x += tileSize) {
        for (let y = 0; y < size; y += tileSize) {
          const variation = (Math.random() - 0.5) * 15
          const color = baseColor.map(c => Math.max(0, Math.min(255, c + variation)))
          ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`
          ctx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2)
          
          // Grout lines
          ctx.strokeStyle = `rgba(${baseColor[0] - 20}, ${baseColor[1] - 20}, ${baseColor[2] - 20}, 0.7)`
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, tileSize, tileSize)
        }
      }
    } else {
      // Random pattern
      for (let i = 0; i < 3000; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        const variation = (Math.random() - 0.5) * 30
        const color = baseColor.map(c => Math.max(0, Math.min(255, c + variation)))
        ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.4)`
        ctx.fillRect(x, y, Math.random() * 6 + 2, Math.random() * 6 + 2)
      }
    }

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.repeat.set(4, 4)
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    const normal = this.generateNormalMap(0.2)
    const roughness = this.generateRoughnessMap(0.6)

    return { diffuse, normal, roughness }
  }

  private generateTrim(_name: string): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    const baseColor = [60, 55, 50]

    // Create wood/trim texture
    ctx.fillStyle = `rgb(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]})`
    ctx.fillRect(0, 0, size, size)

    // Wood grain effect
    for (let y = 0; y < size; y++) {
      const wave = Math.sin(y * 0.02) * 10 + Math.sin(y * 0.05) * 5
      const variation = wave + (Math.random() - 0.5) * 8
      const color = baseColor.map(c => Math.max(0, Math.min(255, c + variation)))
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.5)`
      ctx.fillRect(0, y, size, 1)
    }

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.repeat.set(2, 2)
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    const normal = this.generateNormalMap(0.15)
    const roughness = this.generateRoughnessMap(0.7)

    return { diffuse, normal, roughness }
  }

  private generateLight(name: string): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    // Emissive light panel
    const isRed = name.includes('red')
    const isBlue = name.includes('blue')
    const isGreen = name.includes('green')

    const emissiveColor = isRed 
      ? [255, 80, 100] 
      : isBlue
      ? [80, 150, 255]
      : isGreen
      ? [100, 255, 150]
      : [200, 220, 255]

    // Create gradient glow
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, `rgb(${emissiveColor[0]}, ${emissiveColor[1]}, ${emissiveColor[2]})`)
    gradient.addColorStop(0.7, `rgb(${emissiveColor[0] * 0.7}, ${emissiveColor[1] * 0.7}, ${emissiveColor[2] * 0.7})`)
    gradient.addColorStop(1, `rgb(${emissiveColor[0] * 0.3}, ${emissiveColor[1] * 0.3}, ${emissiveColor[2] * 0.3})`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    const normal = this.generateNormalMap(0.05)
    const roughness = this.generateRoughnessMap(0.2)

    return { diffuse, normal, roughness }
  }

  private generateGrate(_name: string): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    const baseColor = [40, 45, 50]

    ctx.fillStyle = `rgb(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]})`
    ctx.fillRect(0, 0, size, size)

    // Create grate pattern
    const holeSize = 16
    const spacing = 24
    for (let x = 0; x < size; x += spacing) {
      for (let y = 0; y < size; y += spacing) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
        ctx.fillRect(x + 4, y + 4, holeSize, holeSize)
        
        // Highlight edges
        ctx.strokeStyle = `rgba(${baseColor[0] + 30}, ${baseColor[1] + 30}, ${baseColor[2] + 30}, 0.6)`
        ctx.lineWidth = 1
        ctx.strokeRect(x + 4, y + 4, holeSize, holeSize)
      }
    }

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.repeat.set(2, 2)
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    const normal = this.generateNormalMap(0.6)
    const roughness = this.generateRoughnessMap(0.5)

    return { diffuse, normal, roughness }
  }

  private generateInvisible(): TextureSet {
    const { canvas, ctx } = this.createCanvas()

    ctx.fillStyle = 'rgba(0, 0, 0, 0)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const diffuse = new THREE.CanvasTexture(canvas)
    const normal = this.generateNormalMap(0)
    const roughness = this.generateRoughnessMap(1)

    return { diffuse, normal, roughness }
  }

  private generateGeneric(_name: string): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    // Generic tech/industrial texture
    const baseColor = [70, 75, 80]

    ctx.fillStyle = `rgb(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]})`
    ctx.fillRect(0, 0, size, size)

    // Add noise
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      const variation = (Math.random() - 0.5) * 30
      const color = baseColor.map(c => Math.max(0, Math.min(255, c + variation)))
      ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.3)`
      ctx.fillRect(x, y, Math.random() * 4 + 1, Math.random() * 4 + 1)
    }

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.repeat.set(2, 2)
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    const normal = this.generateNormalMap(0.3)
    const roughness = this.generateRoughnessMap(0.7)

    return { diffuse, normal, roughness }
  }

  private generateNormalMap(intensity: number): THREE.Texture {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')!

    const imageData = ctx.createImageData(512, 512)
    const data = imageData.data

    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * intensity
      data[i] = 128 + noise * 127     // R (X normal)
      data[i + 1] = 128 + noise * 127 // G (Y normal)
      data[i + 2] = 255              // B (Z normal - pointing up)
      data[i + 3] = 255              // A
    }

    ctx.putImageData(imageData, 0, 0)

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(2, 2)
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.generateMipmaps = true
    return texture
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true
  }

  private generateRoughnessMap(baseRoughness: number): THREE.Texture {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')!

    const value = Math.floor(baseRoughness * 255)
    ctx.fillStyle = `rgb(${value}, ${value}, ${value})`
    ctx.fillRect(0, 0, 512, 512)

    // Add variation
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * 512
      const y = Math.random() * 512
      const variation = (Math.random() - 0.5) * 40
      const varValue = Math.max(0, Math.min(255, value + variation))
      ctx.fillStyle = `rgba(${varValue}, ${varValue}, ${varValue}, 0.3)`
      ctx.fillRect(x, y, Math.random() * 8 + 2, Math.random() * 8 + 2)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(2, 2)
    return texture
  }

  private generateLiquid(name: string): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    // Dark blue base color
    const isLava = name.includes('lava')
    const baseColor = isLava ? [120, 40, 20] : [20, 40, 80]

    // Diffuse map with wave ripple effect
    const gradient = ctx.createLinearGradient(0, 0, size, size)
    gradient.addColorStop(0, `rgb(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]})`)
    gradient.addColorStop(0.5, `rgb(${baseColor[0] + 10}, ${baseColor[1] + 10}, ${baseColor[2] + 10})`)
    gradient.addColorStop(1, `rgb(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]})`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    // Add wave/ripple pattern
    ctx.strokeStyle = `rgba(${baseColor[0] + 30}, ${baseColor[1] + 30}, ${baseColor[2] + 30}, 0.15)`
    ctx.lineWidth = 1.5
    for (let i = 0; i < 20; i++) {
      const centerX = size / 2 + Math.random() * size * 0.2 - size * 0.1
      const centerY = size / 2 + Math.random() * Math.random() * size * 0.2 - size * 0.1
      const radius = Math.random() * size * 0.3 + size * 0.1

      for (let r = 0; r < radius; r += 20) {
        ctx.beginPath()
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // Add random shimmer spots
    for (let i = 0; i < 800; i++) {
      const x = Math.random() * size
      const y = Math.random() * size
      const brightness = 150 + Math.random() * 60
      ctx.fillStyle = `rgba(${brightness}, ${brightness + 20}, ${brightness + 40}, 0.1)`
      ctx.fillRect(x, y, Math.random() * 4 + 1, Math.random() * 4 + 1)
    }

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.repeat.set(1, 1)
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    // Normal map with wave detail
    const normalCanvas = document.createElement('canvas')
    normalCanvas.width = 512
    normalCanvas.height = 512
    const normalCtx = normalCanvas.getContext('2d')!

    // Perlin-like wave pattern for normal map
    normalCtx.fillStyle = 'rgb(128, 128, 255)'
    normalCtx.fillRect(0, 0, 512, 512)

    for (let i = 0; i < 15; i++) {
      const centerX = Math.random() * 512
      const centerY = Math.random() * 512
      const radius = Math.random() * 150 + 50

      for (let r = 0; r < radius; r += 15) {
        const strength = (1 - r / radius) * 40
        normalCtx.strokeStyle = `rgba(${128 + strength}, ${128}, ${255 - strength}, 0.3)`
        normalCtx.lineWidth = 2
        normalCtx.beginPath()
        normalCtx.arc(centerX, centerY, r, 0, Math.PI * 2)
        normalCtx.stroke()
      }
    }

    const normal = new THREE.CanvasTexture(normalCanvas)
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping
    normal.repeat.set(2, 2)

    // Glossy roughness
    const roughness = this.generateRoughnessMap(0.2)

    return { diffuse, normal, roughness }
  }

  private generateSky(): TextureSet {
    const { canvas, ctx } = this.createCanvas()
    const size = canvas.width

    // Bright blue sky
    const gradient = ctx.createLinearGradient(0, 0, 0, size)
    gradient.addColorStop(0, 'rgb(135, 206, 255)')      // Sky blue at top
    gradient.addColorStop(0.3, 'rgb(170, 220, 255)')    // Lighter blue
    gradient.addColorStop(1, 'rgb(200, 235, 255)')      // Very light at horizon

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    // Add white clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * size
      const y = Math.random() * size * 0.6
      const width = Math.random() * 150 + 80
      const height = Math.random() * 40 + 20

      // Cloud shape using multiple circles
      for (let j = 0; j < 4; j++) {
        ctx.beginPath()
        ctx.arc(x + j * width / 4, y, height, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Add sun
    ctx.fillStyle = 'rgba(255, 255, 200, 0.95)'
    const sunX = size * 0.75  // 10AM position (upper right)
    const sunY = size * 0.25
    ctx.beginPath()
    ctx.arc(sunX, sunY, 50, 0, Math.PI * 2)
    ctx.fill()

    // Sun glow
    ctx.fillStyle = 'rgba(255, 255, 100, 0.3)'
    ctx.beginPath()
    ctx.arc(sunX, sunY, 80, 0, Math.PI * 2)
    ctx.fill()

    const diffuse = new THREE.CanvasTexture(canvas)
    diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping
    diffuse.repeat.set(1, 1)
    diffuse.minFilter = THREE.LinearMipmapLinearFilter
    diffuse.magFilter = THREE.LinearFilter
    diffuse.generateMipmaps = true

    // Flat normal map for sky
    const normal = this.generateNormalMap(0)

    // Very glossy (low roughness)
    const roughness = this.generateRoughnessMap(0.05)

    return { diffuse, normal, roughness }
  }

  getMaterial(textureName: string): THREE.MeshStandardMaterial {
    const textureSet = this.getTextureSet(textureName)
    const name = textureName.toLowerCase()

    // Determine if this is an emissive material
    const isLight = name.includes('light') || name.includes('beam')
    const isInvisible = name.includes('caulk') || name.includes('skip') || name.includes('clip')
    const isLiquid = name.includes('liquid') || name.includes('water') || name.includes('lava')
    const isSky = name.includes('sky') || name.includes('cloud')

    let metalness = name.includes('metal') ? 0.8 : 0.1
    let roughness = 0.7

    // Adjust for liquid: more reflective and glossy
    if (isLiquid) {
      metalness = 0.3
      roughness = 0.15
    }

    // Adjust for sky: emissive and glossy
    if (isSky) {
      metalness = 0
      roughness = 0.05
    }

    const material = new THREE.MeshStandardMaterial({
      map: textureSet.diffuse,
      normalMap: textureSet.normal,
      roughnessMap: textureSet.roughness,
      metalness,
      roughness,
      transparent: isInvisible || isLiquid,
      opacity: isInvisible ? 0 : isLiquid ? 0.9 : 1,
      visible: !isInvisible,
      side: THREE.DoubleSide, // Render both sides due to coordinate transformation winding issues
    })

    if (isLight) {
      material.emissive = new THREE.Color(0xffffff)
      material.emissiveMap = textureSet.diffuse
      material.emissiveIntensity = 2.0
    }

    if (isSky) {
      material.emissive = new THREE.Color(0xffffcc)
      material.emissiveMap = textureSet.diffuse
      material.emissiveIntensity = 0.8
    }

    return material
  }
}
