import { QueryClient, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: string[],
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    if (res.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new Event('fl:unauthorised'));
    throw new ApiError(res.status, body.error ?? res.statusText, body.issues);
  }
  return res.json();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2, refetchOnWindowFocus: true },
  },
});

export function useApi<T = any>(path: string | null, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path, ...opts });
}

/** Mutation that invalidates everything on success (small app — keeps screens consistent). */
export function useAction<TVars = any, TRes = any>(fn: (vars: TVars) => Promise<TRes>, onSuccess?: (res: TRes, vars: TVars) => void) {
  const qc = useQueryClient();
  return useMutation<TRes, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: (res, vars) => {
      qc.invalidateQueries();
      onSuccess?.(res, vars);
    },
  });
}

export const post = <T = any>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} });
export const patch = <T = any>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const put = <T = any>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorText(err: unknown) {
  if (err instanceof ApiError) return err.issues?.length ? `${err.message}: ${err.issues.join('; ')}` : err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
