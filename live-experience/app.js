import { preserveInvitationContext } from "./navigation.js";

preserveInvitationContext("../");
const currentGallery = document.querySelector("#gallery");

async function startCloudGallery() {
  const response = await fetch(new URL("./config.json", import.meta.url), {
    cache: "no-store", credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Configuração indisponível.");
  const config = await response.json();
  const url = new URL(config.galleryUrl);
  if (url.origin !== "https://script.google.com" ||
      !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ||
      !/^[a-f0-9]{64}$/i.test(url.searchParams.get("album") || "") ||
      url.username || url.password || url.hash) {
    throw new Error("Endereço da galeria inválido.");
  }
  const frameId = crypto.randomUUID();
  url.searchParams.set("view", "embedded");
  url.searchParams.set("frame", frameId);
  const section = document.createElement("section");
  section.className = "gallery";
  section.setAttribute("aria-label", "Fotos da festa");
  const status = document.createElement("p");
  status.className = "gallery-feedback";
  status.setAttribute("role", "status");
  status.textContent = "Carregando a galeria…";
  const link = document.createElement("a");
  link.className = "btn btn-outline";
  link.textContent = "ABRIR GALERIA EM OUTRA ABA";
  link.href = config.galleryUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const frame = document.createElement("iframe");
  frame.title = "Galeria de fotos — Reinaldo 18";
  frame.referrerPolicy = "no-referrer";
  frame.style.cssText = "display:block;width:100%;height:900px;border:0;margin-top:20px;background:#070706";
  frame.src = url.href;
  const timer = setTimeout(() => {
    status.textContent = "Se a galeria não aparecer abaixo, use o botão para abrir em outra aba.";
  }, 20000);
  window.addEventListener("message", event => {
    let origin;
    try { origin = new URL(event.origin); } catch { return; }
    if (origin.protocol !== "https:" || !origin.hostname.endsWith(".googleusercontent.com") ||
        event.data?.type !== "level-gallery-height" || event.data.frame !== frameId) return;
    const height = Number(event.data.height);
    if (Number.isFinite(height) && height >= 0) {
      frame.style.height = Math.min(20000, Math.max(400, Math.ceil(height))) + "px";
    }
    if (event.data.ready === true) {
      clearTimeout(timer);
      status.textContent = "";
    }
  });
  section.append(status, link, frame);
  currentGallery.replaceWith(section);
}

startCloudGallery().catch(() => {
  document.querySelector("#stateTitle").textContent = "A galeria está em preparação.";
  document.querySelector("#stateDescription").textContent = "Tente novamente em alguns instantes.";
  document.querySelector("#refreshGallery").addEventListener("click", () => location.reload());
});
