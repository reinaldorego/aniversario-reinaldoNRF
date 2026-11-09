import { normalizeSnapshot } from "./data-source.js";

const BATCH_SIZE = 6;
const REQUEST_TIMEOUT = 15000;
const STATES = {
  "coming-soon": ["EM BREVE", "A galeria está a caminho.", "Os registros oficiais da festa estarão disponíveis aqui para acompanhar pelo celular e reviver depois."],
  empty: ["GALERIA VAZIA", "Os primeiros registros ainda não chegaram.", "Volte mais tarde ou use o botão de atualização para conferir novas imagens."],
  loading: ["CARREGANDO", "Buscando novos momentos…", "Aguarde enquanto verificamos as imagens disponíveis."],
  error: ["ATUALIZAÇÃO INDISPONÍVEL", "Não foi possível carregar a galeria.", "Confira sua conexão e tente atualizar novamente."],
  photos: ["FOTOS DISPONÍVEIS", "", ""]
};

export class Gallery {
  constructor(source, { demo = false } = {}) {
    this.source = source;
    this.demo = demo;
    this.photos = [];
    this.visibleCount = 0;
    this.requestId = 0;
    this.viewerSequence = 0;
    this.failedThumbnails = new Set();
    this.root = document.querySelector("#gallery");
    this.elements = {};
    for (const id of ["refreshGallery", "galleryState", "galleryBadge", "stateTitle", "stateDescription", "gallerySummary", "gallerySync", "gallerySkeleton", "photoGrid", "loadMore", "galleryFeedback", "photoViewer", "viewerClose", "viewerPrevious", "viewerNext", "viewerPosition", "viewerCaption", "viewerStage", "viewerMedia", "viewerMessage", "viewerStatus", "viewerRetry"]) {
      this.elements[id] = document.getElementById(id);
    }
    const e = this.elements;
    e.refreshGallery.addEventListener("click", () => this.refresh());
    e.loadMore.addEventListener("click", () => {
      const firstNewIndex = this.visibleCount;
      this.appendBatch();
      if (e.loadMore.hidden) e.photoGrid.querySelectorAll("button")[firstNewIndex]?.focus();
    });
    e.viewerClose.addEventListener("click", () => e.photoViewer.close());
    e.viewerPrevious.addEventListener("click", () => this.moveViewer(-1));
    e.viewerNext.addEventListener("click", () => this.moveViewer(1));
    e.viewerRetry.addEventListener("click", () => this.showViewerImage());
    e.photoViewer.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        const controls = [...e.photoViewer.querySelectorAll("button:not(:disabled)")]
          .filter((button) => button.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        this.moveViewer(event.key === "ArrowLeft" ? -1 : 1);
      }
    });
    e.photoViewer.addEventListener("click", (event) => {
      const bounds = e.photoViewer.getBoundingClientRect();
      if (event.target === e.photoViewer && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) {
        e.photoViewer.close();
      }
    });
    e.photoViewer.addEventListener("close", () => {
      this.viewerSequence++;
      e.viewerMedia.replaceChildren();
      document.body.classList.remove("viewer-open");
      this.opener?.isConnected && this.opener.focus();
    });
  }

  setState(state) {
    const e = this.elements;
    const [badge, title, description] = STATES[state];
    this.root.dataset.state = state;
    e.galleryBadge.textContent = badge;
    e.stateTitle.textContent = title;
    e.stateDescription.textContent = state === "error" && this.photos.length
      ? "As imagens anteriores continuam disponíveis. Tente atualizar novamente."
      : description;
    e.galleryState.hidden = state === "photos";
    e.gallerySkeleton.hidden = state !== "loading" || this.photos.length > 0;
    e.photoGrid.hidden = !this.photos.length;
    e.gallerySummary.textContent = this.photos.length
      ? this.photos.length + (this.demo ? " imagens de demonstração" : " registros publicados")
      : "Uma noite. Muitas lembranças.";
    if (state === "error") e.gallerySync.textContent = "Sem atualização confirmada. Tente novamente.";
  }

  setBusy(busy) {
    this.root.setAttribute("aria-busy", String(busy));
    this.elements.refreshGallery.disabled = busy;
    this.elements.refreshGallery.textContent = busy ? "ATUALIZANDO…" : "ATUALIZAR GALERIA";
    this.elements.loadMore.disabled = busy;
  }

  async refresh() {
    const id = ++this.requestId;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const timer = window.setTimeout(() => request.abort(), REQUEST_TIMEOUT);
    this.setBusy(true);
    this.setState("loading");
    try {
      const snapshot = normalizeSnapshot(await this.source.list({ signal: request.signal }), { allowDemo: this.demo });
      if (id !== this.requestId) return;
      this.photos = snapshot.photos;
      this.visibleCount = Math.min(Math.max(BATCH_SIZE, this.visibleCount), this.photos.length);
      this.failedThumbnails.clear();
      this.elements.galleryFeedback.textContent = "";
      this.renderPhotos();
      this.setState(snapshot.phase === "coming-soon" ? "coming-soon" : this.photos.length ? "photos" : "empty");
      const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
      this.elements.gallerySync.textContent = snapshot.phase === "coming-soon"
        ? "A galeria ainda não foi publicada."
        : (this.demo ? "Demonstração · verificação local às " : "Última verificação neste aparelho às ") + time;
    } catch {
      if (id === this.requestId) this.setState("error");
    } finally {
      window.clearTimeout(timer);
      if (id === this.requestId) this.setBusy(false);
    }
  }

  renderPhotos() {
    if (this.elements.photoViewer.open) this.elements.photoViewer.close();
    this.elements.photoGrid.replaceChildren();
    this.photos.slice(0, this.visibleCount).forEach((photo, index) => this.appendPhoto(photo, index));
    this.updateMoreButton();
  }

  appendBatch() {
    const end = Math.min(this.visibleCount + BATCH_SIZE, this.photos.length);
    this.photos.slice(this.visibleCount, end).forEach((photo, offset) => this.appendPhoto(photo, this.visibleCount + offset));
    this.visibleCount = end;
    this.updateMoreButton();
  }

  updateMoreButton() {
    this.elements.loadMore.hidden = this.visibleCount >= this.photos.length;
    this.elements.loadMore.textContent = "VER MAIS IMAGENS (" + Math.max(0, this.photos.length - this.visibleCount) + ")";
  }

  updateThumbnailFeedback() {
    const count = this.failedThumbnails.size;
    this.elements.galleryFeedback.textContent = count
      ? count + (count === 1 ? " prévia indisponível." : " prévias indisponíveis.") + " Abra a imagem para tentar novamente."
      : "";
  }

  appendPhoto(photo, index) {
    const item = document.createElement("li");
    item.className = "gallery-tile" + (photo.width > photo.height ? " gallery-tile-wide" : "");
    const figure = document.createElement("figure");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "photo-button";
    button.setAttribute("aria-label", "Abrir imagem " + (index + 1) + ": " + photo.alt);
    button.setAttribute("aria-haspopup", "dialog");
    const image = new Image();
    image.alt = photo.alt;
    image.width = photo.width;
    image.height = photo.height;
    image.loading = index < 2 ? "eager" : "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    const status = document.createElement("span");
    status.className = "photo-load-status";
    status.textContent = "Carregando prévia…";
    image.addEventListener("load", () => {
      if (!button.isConnected) return;
      status.hidden = true;
      this.failedThumbnails.delete(photo.id);
      this.updateThumbnailFeedback();
    });
    image.addEventListener("error", () => {
      if (!button.isConnected) return;
      image.hidden = true;
      status.hidden = false;
      status.textContent = "Prévia indisponível. Toque para tentar abrir.";
      this.failedThumbnails.add(photo.id);
      this.updateThumbnailFeedback();
    });
    button.append(image, status);
    if (this.demo) {
      const badge = document.createElement("span");
      badge.className = "photo-demo-badge";
      badge.textContent = "DEMO";
      button.append(badge);
    }
    button.addEventListener("click", () => this.openViewer(index, button));
    const caption = document.createElement("figcaption");
    caption.textContent = photo.caption;
    figure.append(button, caption);
    item.append(figure);
    this.elements.photoGrid.append(item);
    image.src = photo.thumbnailUrl;
  }

  openViewer(index, opener) {
    this.currentIndex = index;
    this.opener = opener;
    this.elements.photoViewer.showModal();
    document.body.classList.add("viewer-open");
    this.showViewerImage();
  }

  moveViewer(direction) {
    const index = this.currentIndex + direction;
    if (index >= 0 && index < this.photos.length) {
      this.currentIndex = index;
      this.showViewerImage();
    }
  }

  showViewerImage() {
    const e = this.elements;
    const photo = this.photos[this.currentIndex];
    if (!photo) return;
    if (document.activeElement === e.viewerRetry) e.viewerClose.focus();
    const sequence = ++this.viewerSequence;
    e.viewerPosition.textContent = (this.currentIndex + 1) + " de " + this.photos.length;
    e.viewerCaption.textContent = (this.demo ? "DEMONSTRAÇÃO · " : "") + photo.caption;
    e.viewerPrevious.disabled = this.currentIndex === 0;
    e.viewerNext.disabled = this.currentIndex === this.photos.length - 1;
    e.viewerStage.setAttribute("aria-busy", "true");
    e.viewerMessage.hidden = false;
    e.viewerStatus.textContent = "Carregando imagem…";
    e.viewerRetry.hidden = true;
    const image = new Image();
    image.alt = photo.alt;
    image.id = "viewerImage";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.hidden = true;
    const isCurrent = () => sequence === this.viewerSequence && e.photoViewer.open;
    image.addEventListener("load", () => {
      if (!isCurrent()) return;
      image.hidden = false;
      e.viewerMessage.hidden = true;
      e.viewerStage.setAttribute("aria-busy", "false");
    }, { once: true });
    image.addEventListener("error", () => {
      if (!isCurrent()) return;
      e.viewerStatus.textContent = "Não foi possível carregar esta imagem.";
      e.viewerRetry.hidden = false;
      e.viewerStage.setAttribute("aria-busy", "false");
    }, { once: true });
    e.viewerMedia.replaceChildren(image);
    image.src = photo.imageUrl;
  }
}
