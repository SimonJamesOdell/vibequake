type FloatingHit = {
  element: HTMLSpanElement
  life: number
  duration: number
  offsetX: number
  driftX: number
  riseY: number
}

export class HitCounterSystem {
  private readonly container: HTMLDivElement
  private readonly floatingHits: FloatingHit[] = []

  constructor(container: HTMLDivElement) {
    this.container = container
  }

  showHit(damage: number, criticalHit: boolean): void {
    const marker = document.createElement('span')
    marker.className = 'hit-counter-value'
    if (criticalHit) {
      marker.classList.add('critical-hit')
    }
    marker.textContent = criticalHit ? `-${damage} CRITICAL HIT` : `-${damage}`

    const floatingHit: FloatingHit = {
      element: marker,
      life: criticalHit ? 0.72 : 0.55,
      duration: criticalHit ? 0.72 : 0.55,
      offsetX: (Math.random() - 0.5) * (criticalHit ? 36 : 28),
      driftX: (Math.random() - 0.5) * (criticalHit ? 24 : 18),
      riseY: (criticalHit ? 48 : 34) + Math.random() * (criticalHit ? 26 : 20),
    }

    marker.style.opacity = '1'
    marker.style.transform = `translate(${floatingHit.offsetX}px, -12px) scale(0.92)`
    this.container.appendChild(marker)
    this.floatingHits.push(floatingHit)

    if (this.floatingHits.length > 18) {
      const oldest = this.floatingHits.shift()
      oldest?.element.remove()
    }
  }

  update(delta: number): void {
    for (let index = this.floatingHits.length - 1; index >= 0; index -= 1) {
      const floatingHit = this.floatingHits[index]
      floatingHit.life = Math.max(0, floatingHit.life - delta)
      const progress = 1 - floatingHit.life / floatingHit.duration
      const opacity = 1 - progress
      const x = floatingHit.offsetX + floatingHit.driftX * progress
      const y = -12 - floatingHit.riseY * progress
      const scale = 0.92 + progress * 0.16
      floatingHit.element.style.opacity = String(opacity)
      floatingHit.element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
      if (floatingHit.life > 0) {
        continue
      }
      floatingHit.element.remove()
      this.floatingHits.splice(index, 1)
    }
  }

  dispose(): void {
    for (const floatingHit of this.floatingHits) {
      floatingHit.element.remove()
    }
    this.floatingHits.length = 0
  }
}
