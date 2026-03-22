export type GameAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'jump'
  | 'descend'

type ActionBindings = Record<GameAction, string | string[]>

export const DEFAULT_ACTION_BINDINGS: ActionBindings = {
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  descend: ['ShiftLeft', 'ShiftRight'],
}

const toCodeList = (value: string | string[]) => (Array.isArray(value) ? value : [value])

export const isActionCode = (
  code: string,
  action: GameAction,
  bindings: ActionBindings = DEFAULT_ACTION_BINDINGS,
) => toCodeList(bindings[action]).includes(code)

export const isActionPressed = (
  keys: Set<string>,
  action: GameAction,
  bindings: ActionBindings = DEFAULT_ACTION_BINDINGS,
) => toCodeList(bindings[action]).some((code) => keys.has(code))

export const matchesGameActionCode = (
  code: string,
  action: GameAction,
  useMappedBindings: boolean,
) => {
  if (useMappedBindings) {
    return isActionCode(code, action)
  }

  if (action === 'moveForward') return code === 'KeyW'
  if (action === 'moveBackward') return code === 'KeyS'
  if (action === 'moveLeft') return code === 'KeyA'
  if (action === 'moveRight') return code === 'KeyD'
  if (action === 'sprint') return code === 'ShiftLeft'
  if (action === 'jump') return code === 'Space'
  return code === 'ShiftLeft' || code === 'ShiftRight'
}

export const isGameActionPressed = (
  keys: Set<string>,
  action: GameAction,
  useMappedBindings: boolean,
) => {
  if (useMappedBindings) {
    return isActionPressed(keys, action)
  }

  if (action === 'moveForward') return keys.has('KeyW')
  if (action === 'moveBackward') return keys.has('KeyS')
  if (action === 'moveLeft') return keys.has('KeyA')
  if (action === 'moveRight') return keys.has('KeyD')
  if (action === 'sprint') return keys.has('ShiftLeft')
  if (action === 'jump') return keys.has('Space')
  return keys.has('ShiftLeft') || keys.has('ShiftRight')
}
