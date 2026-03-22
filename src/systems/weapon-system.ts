export function getWeaponCooldown(tier: number): number {
  if (tier >= 2) {
    return 0.065
  }
  if (tier === 1) {
    return 0.09
  }
  return 0.12
}

export function getWeaponDamageMultiplier(tier: number): number {
  if (tier >= 2) {
    return 2.5
  }
  if (tier === 1) {
    return 1.7
  }
  return 1
}

export function getProjectileImpactColor(tier: number): string {
  if (tier >= 2) {
    return '#76f7ff'
  }
  if (tier === 1) {
    return '#ff9e57'
  }
  return '#ffcf63'
}
