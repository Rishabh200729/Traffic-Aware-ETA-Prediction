export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/$/, '')

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, options)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new Error(`Cannot reach the API at ${API_BASE}. Is the backend running?`)
  }

  const payload: unknown = await response.json().catch((error: unknown) => {
    if (options.signal?.aborted) {
      throw error
    }
    return null
  })
  if (options.signal?.aborted) {
    throw new DOMException('The request was aborted.', 'AbortError')
  }
  if (!response.ok) {
    const detail =
      typeof payload === 'object' &&
      payload !== null &&
      'detail' in payload &&
      typeof payload.detail === 'string'
        ? payload.detail
        : `The API returned HTTP ${response.status}.`
    throw new Error(detail)
  }

  return payload as T
}
