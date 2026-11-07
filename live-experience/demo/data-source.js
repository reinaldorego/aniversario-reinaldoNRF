const SCENARIOS = new Set(["photos", "coming-soon", "empty", "loading", "error", "image-error"]);
const ARTWORKS = [
  ["composition-01.svg", 1200, 750],
  ["composition-02.svg", 800, 1000],
  ["composition-03.svg", 800, 800],
  ["composition-02.svg", 800, 1000],
  ["composition-03.svg", 800, 800]
];

function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Demonstração interrompida", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createDemoSource() {
  let scenario = "photos";
  let revision = 0;
  return {
    setScenario(value) {
      if (!SCENARIOS.has(value)) throw new Error("Cenário desconhecido.");
      scenario = value;
      if (value === "photos") revision = 0;
    },
    async list({ signal } = {}) {
      const selected = scenario;
      await pause(selected === "loading" ? 60000 : 400, signal);
      signal?.throwIfAborted();
      if (selected === "error") throw new Error("Falha demonstrativa.");
      if (selected === "coming-soon") return { phase: "coming-soon", photos: [], isDemo: true };
      if (selected === "empty") return { phase: "open", photos: [], isDemo: true };
      const count = selected === "photos" ? Math.min(8 + ++revision, 12) : 9;
      const photos = Array.from({ length: count }, (_, index) => {
        const [file, width, height] = ARTWORKS[index % ARTWORKS.length];
        const label = String(index + 1).padStart(2, "0");
        const url = new URL("./assets/" + (selected === "image-error" && index === 0 ? "missing-example.svg" : file), import.meta.url).href;
        return {
          id: "demo-" + label,
          status: "published",
          isDemo: true,
          thumbnailUrl: url,
          imageUrl: url,
          width,
          height,
          alt: "Ilustração abstrata dourada, exemplo " + label + "; imagem de demonstração",
          caption: "Composição de teste " + label,
          publishedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
        };
      });
      return { phase: "open", photos, isDemo: true, updatedAt: null };
    }
  };
}
