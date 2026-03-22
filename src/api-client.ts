import type { ArenaMap, ArenaMapSummary, HighScoreSubmission } from './shared/contracts'

const apiFetch = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

export const loadArenaMap = async (mapId: string, fallbackMap: ArenaMap) => {
  try {
    return await apiFetch<ArenaMap>(`/api/maps/${mapId}`)
  } catch {
    return fallbackMap
  }
}

export const loadAvailableMaps = async (fallbackMap: ArenaMap) => {
  try {
    return await apiFetch<ArenaMapSummary[]>('/api/maps')
  } catch {
    return [{
      id: fallbackMap.id,
      name: fallbackMap.name,
      description: fallbackMap.description,
      updatedAt: fallbackMap.updatedAt,
    }]
  }
}

export const submitHighScore = async (submission: HighScoreSubmission) => {
  await apiFetch('/api/highscores', {
    method: 'POST',
    body: JSON.stringify(submission),
  })
}
