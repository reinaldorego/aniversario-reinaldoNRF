/* Inicia após gesto explícito do convidado na entrada ou no controle de áudio. */
(() => {
  const audio = document.getElementById("invitationAudio");
  const button = document.getElementById("musicToggle");
  const label = document.getElementById("musicLabel");
  const soundOnIcon = document.getElementById("musicOnIcon");
  const soundOffIcon = document.getElementById("musicOffIcon");
  const status = document.getElementById("musicStatus");
  if (!audio || !button || !label || !soundOnIcon || !soundOffIcon || !status) return;

  let playRequest = 0;
  let positionFrame = 0;

  function schedulePosition() {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      if (!button.getClientRects().length) return;

      const buttonRect = button.getBoundingClientRect();
      const statusRect = status.textContent ? status.getBoundingClientRect() : null;
      const previousLift = parseFloat(button.style.getPropertyValue("--music-lift")) || 0;
      const baseBottom = parseFloat(getComputedStyle(button).bottom) - previousLift;
      const baseTop = window.innerHeight - baseBottom - buttonRect.height;
      const statusHeight = statusRect ? statusRect.height + 8 : 0;
      const panelLeft = buttonRect.right - Math.max(buttonRect.width, statusRect?.width || 0);
      const actions = [...document.querySelectorAll("a[href], button")]
        .filter((element) => element !== button)
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width && rect.height && rect.bottom > 0 && rect.top < window.innerHeight);

      let top = baseTop;
      for (let attempt = 0; attempt < actions.length; attempt++) {
        const collision = actions.find((rect) =>
          rect.left < buttonRect.right + 8 && rect.right > panelLeft - 8 &&
          rect.top < top + buttonRect.height + 8 && rect.bottom > top - statusHeight - 8
        );
        if (!collision) break;
        const nextTop = Math.max(8, collision.top - buttonRect.height - statusHeight - 8);
        if (nextTop >= top) break;
        top = nextTop;
      }

      const lift = Math.max(0, Math.round(baseTop - top));
      button.style.setProperty("--music-lift", `${lift}px`);
      status.style.setProperty("--music-lift", `${lift}px`);
    });
  }

  function setStatus(message) {
    status.textContent = message;
    schedulePosition();
  }

  function syncButton() {
    const playing = !audio.paused && !audio.ended;
    label.textContent = playing ? "Pausar música" : "Reproduzir música";
    soundOnIcon.classList.toggle("hidden", !playing);
    soundOffIcon.classList.toggle("hidden", playing);
  }

  function playFromGesture() {
    const request = ++playRequest;
    setStatus("Carregando a música…");
    try {
      if (audio.error) audio.load();
      else if (audio.ended) audio.currentTime = 0;
      const playback = audio.play();
      syncButton();
      Promise.resolve(playback).then(
        () => {
          if (request !== playRequest) return;
          setStatus("");
          syncButton();
        },
        () => {
          if (request !== playRequest) return;
          if (!audio.paused) audio.pause();
          setStatus("Não foi possível reproduzir. Toque para tentar novamente.");
          syncButton();
        }
      );
    } catch {
      if (request !== playRequest) return;
      if (!audio.paused) audio.pause();
      setStatus("Não foi possível reproduzir. Toque para tentar novamente.");
      syncButton();
    }
  }

  button.addEventListener("click", () => {
    if (!audio.paused) {
      ++playRequest;
      audio.pause();
      setStatus("");
      syncButton();
      return;
    }

    playFromGesture();
  });

  audio.addEventListener("play", syncButton);
  audio.addEventListener("pause", () => {
    ++playRequest;
    if (status.textContent === "Carregando a música…") setStatus("");
    syncButton();
  });
  audio.addEventListener("ended", () => {
    ++playRequest;
    setStatus("Faixa finalizada. Toque para ouvir novamente.");
    syncButton();
  });
  audio.addEventListener("error", () => {
    ++playRequest;
    audio.pause();
    setStatus("Não foi possível carregar a música. Toque para tentar novamente.");
    syncButton();
  });

  syncButton();
  button.classList.remove("hidden");
  window.addEventListener("scroll", schedulePosition, { passive: true });
  window.addEventListener("resize", schedulePosition);
  document.getElementById("enterBtn")?.addEventListener("click", () => {
    if (audio.paused) playFromGesture();
    schedulePosition();
  }, { capture: true });
  schedulePosition();
})();
