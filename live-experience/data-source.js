// Contrato de leitura. A futura API será integrada aqui, sem operações de publicação.
export function createPublicSource() {
  return {
    async list({ signal } = {}) {
      signal?.throwIfAborted();
      return { phase: "coming-soon", photos: [], isDemo: false, updatedAt: null };
    }
  };
}

function imageUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Imagem sem endereço.");
  const url = new URL(value, window.location.href);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Endereço de imagem não permitido.");
  }
  return url.href;
}

export function normalizeSnapshot(snapshot, { allowDemo = false } = {}) {
  if (!snapshot || !["coming-soon", "open"].includes(snapshot.phase) || !Array.isArray(snapshot.photos)) {
    throw new Error("Resposta de galeria inválida.");
  }
  if (!allowDemo && (snapshot.isDemo || snapshot.photos.some((photo) => photo?.isDemo))) {
    throw new Error("Conteúdo de demonstração não pertence à galeria pública.");
  }
  if (snapshot.phase === "coming-soon") return { ...snapshot, photos: [] };

  const ids = new Set();
  const photos = snapshot.photos.filter((photo) => photo?.status === "published").map((photo) => {
    if (typeof photo.id !== "string" || !photo.id || ids.has(photo.id)) {
      throw new Error("Identificador de imagem inválido.");
    }
    const publishedAt = Date.parse(photo.publishedAt);
    if (!Number.isFinite(publishedAt) || !Number.isFinite(photo.width) || !Number.isFinite(photo.height) || photo.width <= 0 || photo.height <= 0) {
      throw new Error("Metadados de imagem inválidos.");
    }
    ids.add(photo.id);
    return {
      id: photo.id,
      thumbnailUrl: imageUrl(photo.thumbnailUrl),
      imageUrl: imageUrl(photo.imageUrl),
      width: photo.width,
      height: photo.height,
      alt: typeof photo.alt === "string" && photo.alt.trim() ? photo.alt : "Registro da festa",
      caption: typeof photo.caption === "string" ? photo.caption : "",
      publishedAt,
      isDemo: Boolean(photo.isDemo)
    };
  });
  photos.sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id));
  return { ...snapshot, photos };
}
