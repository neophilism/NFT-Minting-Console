export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function api(path: string, options: { method?: string; body?: unknown; csrf?: string; signal?: AbortSignal } = {}): Promise<unknown> {
  if (!path.startsWith('/api/')) throw new Error('Only this console API may be called.');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(path, { method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The console server returned an unexpected response.');
    if (Number(response.headers.get('content-length') || 0) > 1_048_576) throw new Error('The server response is too large.');
    const text = await response.text();
    if (text.length > 1_048_576) throw new Error('The server response is too large.');
    const data: unknown = JSON.parse(text);
    if (!response.ok) {
      const failure = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      throw new ApiError(response.status, typeof failure.code === 'string' ? failure.code.slice(0, 64) : 'request_failed',
        typeof failure.error === 'string' ? failure.error.slice(0, 240) : 'The request could not be completed.');
    }
    return data;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new Error('The console could not be reached. Check the connection and retry.');
  } finally {
    window.clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
  }
}
