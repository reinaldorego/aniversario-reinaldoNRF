const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BASE64 = 4 * Math.ceil(MAX_PREVIEW_BYTES / 3);
const PHOTO_ID = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function readGalleryUrl(signal) {
  const response = await fetch(new URL("./config.json", import.meta.url), {
    cache: "no-store", credentials: "omit", redirect: "error", signal
  });
  if (!response.ok) throw new Error("Configuração indisponível.");
  const { galleryUrl } = await response.json();
  const url = new URL(galleryUrl);
  if (url.origin !== "https://script.google.com" ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ||
      !/^[a-f0-9]{64}$/i.test(url.searchParams.get("album") || "") ||
      [...url.searchParams.keys()].length !== 1 || url.username || url.password || url.hash) {
    throw new Error("Endereço da galeria inválido.");
  }
  return url;
}

async function readFeed(endpoint, feed, signal, photoId) {
  const url = new URL(endpoint);
  url.searchParams.set("feed", feed);
  if (photoId) url.searchParams.set("photo", photoId);
  const response = await fetch(url, {
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal
  });
  if (!response.ok || !/^application\/json\b/i.test(response.headers.get("content-type") || "")) {
    throw new Error("Serviço da galeria indisponível.");
  }
  const result = await response.json();
  if (!result || result.ok !== true) throw new Error("Resposta da galeria indisponível.");
  return result;
}

function decodePreview(preview, photoId) {
  if (preview.id !== photoId || !["image/jpeg", "image/png"].includes(preview.mime) ||
      typeof preview.base64 !== "string" || preview.base64.length > MAX_PREVIEW_BASE64 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(preview.base64)) {
    throw new Error("Prévia indisponível.");
  }
  const data = Uint8Array.from(atob(preview.base64), char => char.charCodeAt(0));
  const valid = preview.mime === "image/png"
    ? PNG_SIGNATURE.every((byte, index) => data[index] === byte)
    : data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!valid || data.length > MAX_PREVIEW_BYTES) throw new Error("Prévia inválida.");
  return new Blob([data], { type: preview.mime });
}

export function createCloudSource(onEndpoint) {
  const media = new Map();
  const queue = [];
  let endpoint;
  let active = new Set();
  let running = 0;

  function drain() {
    while (running < 2 && queue.length) {
      const job = queue.shift();
      running++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
        running--;
        drain();
      });
    }
  }

  return {
    async list({ signal } = {}) {
      const url = await readGalleryUrl(signal);
      onEndpoint(url);
      const snapshot = await readFeed(url, "snapshot", signal);
      signal?.throwIfAborted();
      if (snapshot.phase !== "open" || snapshot.isDemo !== false ||
          !Array.isArray(snapshot.photos) || snapshot.photos.length > 200 ||
          snapshot.photos.some(photo => !PHOTO_ID.test(photo?.id || "") || photo.status !== "published" || photo.isDemo)) {
        throw new Error("Lista da galeria inválida.");
      }
      if (endpoint?.href !== url.href) {
        this.dispose();
        endpoint = url;
      }
      active = new Set(snapshot.photos.map(photo => photo.id));
      for (const [id, entry] of media) {
        if (!active.has(id)) {
          if (entry.url) URL.revokeObjectURL(entry.url);
          media.delete(id);
        }
      }
      return snapshot;
    },
    getMedia(photo) {
      if (media.has(photo.id)) return media.get(photo.id).promise;
      const entry = {};
      entry.promise = new Promise((resolve, reject) => {
        queue.push({
          resolve, reject,
          run: async () => {
            if (!active.has(photo.id) || media.get(photo.id) !== entry) throw new Error("Imagem retirada.");
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
              const preview = await readFeed(endpoint, "preview", controller.signal, photo.id);
              if (!active.has(photo.id) || media.get(photo.id) !== entry) throw new Error("Imagem retirada.");
              entry.url = URL.createObjectURL(decodePreview(preview, photo.id));
              return entry.url;
            } finally {
              clearTimeout(timer);
            }
          }
        });
      }).catch(error => {
        if (media.get(photo.id) === entry) media.delete(photo.id);
        throw error;
      });
      media.set(photo.id, entry);
      drain();
      return entry.promise;
    },
    dispose() {
      active.clear();
      for (const entry of media.values()) if (entry.url) URL.revokeObjectURL(entry.url);
      media.clear();
    }
  };
}
