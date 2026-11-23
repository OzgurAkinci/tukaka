const API_BASE_URL =
  import.meta.env.VITE_LOCAL_SERVICE_URL ?? 'http://127.0.0.1:4317';

/**
 * NestJS hata gövdesinden ({ message, error, statusCode }) okunabilir mesaj çıkarır.
 */
async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as { message?: unknown };

    if (Array.isArray(parsed.message)) {
      return parsed.message.join('\n');
    }

    if (typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch {
    // JSON değil; ham metni kullan.
  }

  return body || `API error: ${response.status}`;
}

function getSessionToken(): string | undefined {
  return (
    window.desktopAPI?.sessionToken ??
    import.meta.env.VITE_LOCAL_SERVICE_TOKEN ??
    undefined
  );
}

export async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const sessionToken = getSessionToken();

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken && {
        Authorization: `Bearer ${sessionToken}`,
      }),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function jsonBody(payload: unknown): Pick<RequestInit, 'body'> {
  return { body: JSON.stringify(payload) };
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
