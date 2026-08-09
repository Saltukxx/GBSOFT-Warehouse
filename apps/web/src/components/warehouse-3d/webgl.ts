/**
 * WebGL yeteneği tespiti.
 *
 * 3B sahne bir yetenektir, zorunluluk değil. Düşük donanımda veya WebGL
 * kapalı bir tarayıcıda ürün boş ekran göstermez; mevcut 2B haritaya düşer.
 * Tespit bir kez yapılır ve önbelleğe alınır — her render'da bağlam açmak
 * pahalıdır ve bazı sürücülerde bağlam sayısı sınırlıdır.
 */

export type WebglSupport =
  | { supported: true; renderer: string | null }
  | { supported: false; reason: string };

let cached: WebglSupport | null = null;

export function detectWebgl(): WebglSupport {
  if (cached) return cached;
  cached = probe();
  return cached;
}

function probe(): WebglSupport {
  if (typeof document === "undefined") {
    return { supported: false, reason: "Tarayıcı ortamı yok." };
  }

  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
  } catch {
    return { supported: false, reason: "Canvas oluşturulamadı." };
  }

  const context =
    (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
    (canvas.getContext("webgl") as WebGLRenderingContext | null);

  if (!context) {
    return {
      supported: false,
      reason:
        "Tarayıcı WebGL bağlamı açamadı. Donanım hızlandırma kapalı olabilir.",
    };
  }

  let renderer: string | null = null;
  try {
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    if (debug) {
      renderer = String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    }
  } catch {
    // Sürücü adı gizlenmişse önemli değil; yetenek yine vardır.
  }

  // Bağlamı hemen bırak: tespit için açılan bağlam sahneninkini yiyebilir.
  context.getExtension("WEBGL_lose_context")?.loseContext();

  return { supported: true, renderer };
}
