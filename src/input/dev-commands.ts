export type DevCommand =
  | 'toggleDetailLevel'
  | 'toggleLighting'
  | 'toggleViewMode'
  | 'toggleGodMode'

const DEV_COMMAND_BINDINGS: Record<DevCommand, string | string[]> = {
  toggleDetailLevel: 'KeyL',
  toggleLighting: 'KeyG',
  toggleViewMode: 'KeyV',
  toggleGodMode: ['F10', 'Backquote'],
}

const toCodeList = (value: string | string[]) => (Array.isArray(value) ? value : [value])

export const resolveDevCommand = (code: string): DevCommand | null => {
  for (const [command, binding] of Object.entries(DEV_COMMAND_BINDINGS) as Array<[DevCommand, string | string[]]>) {
    if (toCodeList(binding).includes(code)) {
      return command
    }
  }

  return null
}
