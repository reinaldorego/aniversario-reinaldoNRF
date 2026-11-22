const activeLoads = new WeakMap();
const appsScriptFrameOrigin = /^https:\/\/(?:[a-z0-9-]+-)?script\.googleusercontent\.com$/;

function isFromGalleryFrame(source, frame) {
  // O Apps Script monta o HTML dentro dos próprios quadros de segurança.
  while (source && source !== window) {
    if (source === frame.contentWindow) return true;
    const parent = source.parent;
    if (parent === source) break;
    source = parent;
  }
  return false;
}

export async function mountCloudGallery(container) {
  const status = container.querySelector("[data-gallery-status]");
  const directLink = container.querySelector("[data-gallery-link]");
  const retry = container.querySelector("[data-gallery-retry]");
  const frameHost = container.querySelector("[data-gallery-frame]");
  activeLoads.get(container)?.abort();
  const load = new AbortController();
  activeLoads.set(container, load);
  const isCurrent = () => activeLoads.get(container) === load;

  status.textContent = "Carregando a galeria…";
  directLink.hidden = true;
  retry.hidden = true;
  frameHost.replaceChildren();

  function showFailure(message) {
    status.textContent = message;
    retry.hidden = false;
    directLink.hidden = !directLink.hasAttribute("href");
  }

  const configTimer = setTimeout(() => load.abort(), 12000);
  try {
    const response = await fetch(new URL("./config.json", import.meta.url), {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: load.signal
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
    if (!isCurrent()) return;
    if (load.signal.aborted) throw new Error("Tempo de consulta esgotado.");

    directLink.href = url.href;
    const frameId = crypto.randomUUID();
    url.searchParams.set("view", "embedded");
    url.searchParams.set("frame", frameId);

    const frame = document.createElement("iframe");
    frame.title = "Galeria de fotos — Reinaldo 18";
    frame.referrerPolicy = "no-referrer";
    // O álbum público não precisa da sessão Google do visitante. O Chrome
    // pode carregar o quadro isolado para evitar o redirecionamento por conta.
    frame.setAttribute("credentialless", "");
    frame.tabIndex = -1;
    const timer = setTimeout(failFrame, 20000);

    function removeFrame() {
      clearTimeout(timer);
      window.removeEventListener("message", onGalleryMessage);
      load.signal.removeEventListener("abort", removeFrame);
      frame.remove();
    }

    function failFrame() {
      removeFrame();
      showFailure("A galeria não carregou. Tente novamente ou abra em outra aba. Se o Google mostrar um erro de conta, use uma aba anônima.");
    }

    function onGalleryMessage(event) {
      const message = event.data;
      if (!appsScriptFrameOrigin.test(event.origin) ||
          message?.type !== "level-gallery-height" || message.frame !== frameId ||
          !isFromGalleryFrame(event.source, frame)) return;
      if (message.state === "error" && !frame.classList.contains("gallery-frame-ready")) {
        failFrame();
        return;
      }
      const height = message.height;
      if (!Number.isFinite(height) || height <= 0) return;
      frame.style.height = Math.min(20000, Math.max(400, Math.ceil(height))) + "px";
      if (message.ready !== true) return;
      clearTimeout(timer);
      frame.classList.add("gallery-frame-ready");
      frame.removeAttribute("tabindex");
      status.textContent = "";
    }

    window.addEventListener("message", onGalleryMessage);
    load.signal.addEventListener("abort", removeFrame, { once: true });
    frame.src = url.href;
    frameHost.replaceChildren(frame);
  } catch {
    if (isCurrent()) showFailure("Não foi possível abrir a galeria. Confira sua conexão e tente novamente.");
  } finally {
    clearTimeout(configTimer);
  }
}
