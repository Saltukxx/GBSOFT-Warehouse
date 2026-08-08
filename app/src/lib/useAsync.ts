import { useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: Error };

/**
 * Basit veri çekme kancası. Mock API'nin gecikme ve hata davranışını
 * gerçek bir istemci gibi ele alır; iptal desteklidir.
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { retryToken: number; retry: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    status: "loading",
    data: null,
    error: null,
  });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading", data: null, error: null });

    loader(controller.signal)
      .then((data) => {
        if (active) setState({ status: "ready", data, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          data: null,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retryToken]);

  return { ...state, retryToken, retry: () => setRetryToken((t) => t + 1) };
}
