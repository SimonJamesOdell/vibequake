export const getHudHintText = (options: {
  pointerLocked: boolean
  cheatsEnabled: boolean
  godModeEnabled: boolean
}) => {
  if (!options.pointerLocked) {
    return ''
  }

  if (options.cheatsEnabled) {
    return `WASD move  SHIFT surge  SPACE jump  MOUSE fire  F10/~ godmode ${options.godModeEnabled ? 'ON' : 'OFF'}`
  }

  return 'WASD move  SHIFT surge  SPACE jump  MOUSE fire'
}
