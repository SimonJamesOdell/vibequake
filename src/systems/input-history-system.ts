import type { Vec3 } from '../shared/contracts'

export type InputHistorySample = {
  seq: number
  position: Vec3
  yaw: number
  recordedAt: number
}

export class InputHistorySystem {
  private readonly samples: InputHistorySample[] = []
  private readonly limit: number

  constructor(limit = 200) {
    this.limit = limit
  }

  record(seq: number, position: Vec3, yaw: number) {
    this.samples.push({
      seq,
      position: { ...position },
      yaw,
      recordedAt: Date.now(),
    })

    if (this.samples.length > this.limit) {
      this.samples.splice(0, this.samples.length - this.limit)
    }
  }

  find(seq: number) {
    for (let index = this.samples.length - 1; index >= 0; index -= 1) {
      const sample = this.samples[index]
      if (sample.seq === seq) {
        return sample
      }
    }
    return null
  }

  prune(minSeq: number) {
    if (this.samples.length === 0) {
      return
    }

    const cutoff = Math.max(0, minSeq)
    let firstKeepIndex = 0
    while (firstKeepIndex < this.samples.length && this.samples[firstKeepIndex].seq < cutoff) {
      firstKeepIndex += 1
    }

    if (firstKeepIndex > 0) {
      this.samples.splice(0, firstKeepIndex)
    }
  }

  clear() {
    this.samples.length = 0
  }
}
