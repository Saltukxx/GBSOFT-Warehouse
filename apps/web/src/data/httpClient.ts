import type { FacilityLayoutResponse } from "@gbsoft/domain";
import { ApiError } from "./demoAdapter";

/**
 * Gerçek API istemcisi.
 *
 * Faz 0 kapsamında yalnız layout ucu canlıdır; kalan uçlar sırasıyla
 * bağlanacak ve o ana kadar demo adaptöründen okunacaktır. Hangi ucun canlı
 * olduğu `LIVE_ENDPOINTS` üzerinden tek yerden görülür.
 */

const BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3001";

/** Tek kiracı kurulumda kiracı sunucu tarafında çözülür. */
const TENANT_HEADER = import.meta.env.VITE_TENANT_ID;

export const FACILITY_CODE =
  import.meta.env.VITE_FACILITY_CODE ?? "MARMARA-DC-01";

async function request<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (TENANT_HEADER) headers.set("x-tenant-id", TENANT_HEADER);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(
      `API'ye ulaşılamadı. Sunucu çalışıyor mu? (${BASE_URL})`,
      path,
    );
  }

  if (!response.ok) {
    let message = `İstek başarısız (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // Gövde JSON değilse varsayılan mesaj kullanılır.
    }
    throw new ApiError(message, path);
  }

  return (await response.json()) as T;
}

/* GET /api/facilities/:code/layout */
export async function fetchLayout(
  signal?: AbortSignal,
): Promise<FacilityLayoutResponse> {
  return request(`/api/facilities/${FACILITY_CODE}/layout`, { signal });
}
