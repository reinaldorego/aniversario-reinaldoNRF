/* O controle acompanha a reprodução e guarda a escolha enquanto a aba estiver aberta. */
(() => {
  const audio = document.getElementById("invitationAudio");
  const button = document.getElementById("musicToggle");
  const label = document.getElementById("musicLabel");
  const soundOnIcon = document.getElementById("musicOnIcon");
  const soundOffIcon = document.getElementById("musicOffIcon");
  const status = document.getElementById("musicStatus");
  if (!audio || !button || !label || !soundOnIcon || !soundOffIcon || !status) return;

  const enterButton = document.getElementById("enterBtn");
  const bootScreen = document.getElementById("boot");
  const storageKey = "level-xviii:music";
  const loadingMessage = "Carregando a música…";
  const resumeMessage = "Toque no alto-falante para continuar a música.";
  let preference;
  let playRequest = 0;
  let positionFrame = 0;

  function savePreference(value = preference) {
    preference = value;
    if (!value) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ value, time: audio.currentTime }));
    } catch { /* A música continua disponível sem armazenamento. */ }
  }

  function restorePreference() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (saved?.value !== "playing" && saved?.value !== "paused") return;
      preference = saved.value;
      if (preference === "paused" && !audio.paused) audio.pause();
      if (audio.paused && Number.isFinite(saved.time) && saved.time >= 0) {
        audio.currentTime = saved.time;
      }
    } catch { /* A preferência é opcional. */ }
  }

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

  function playAudio(failureMessage = "Não foi possível reproduzir. Toque para tentar novamente.") {
    const request = ++playRequest;
    setStatus(loadingMessage);
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
          setStatus(failureMessage);
          syncButton();
        }
      );
    } catch {
      if (request !== playRequest) return;
      if (!audio.paused) audio.pause();
      setStatus(failureMessage);
      syncButton();
    }
  }

  button.addEventListener("click", () => {
    if (!audio.paused) {
      ++playRequest;
      audio.pause();
      savePreference("paused");
      setStatus("");
      syncButton();
      return;
    }

    savePreference("playing");
    playAudio();
  });

  audio.addEventListener("play", syncButton);
  audio.addEventListener("pause", () => {
    if (audio.paused && status.textContent === loadingMessage) setStatus("");
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

  function resumeIfAllowed() {
    const invitationIsOpen = !bootScreen || bootScreen.classList.contains("hidden");
    if (invitationIsOpen && preference === "playing" && audio.paused) playAudio(resumeMessage);
    syncButton();
  }

  restorePreference();
  resumeIfAllowed();
  button.classList.remove("hidden");
  window.addEventListener("scroll", schedulePosition, { passive: true });
  window.addEventListener("resize", schedulePosition);
  window.addEventListener("pagehide", () => savePreference());
  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      restorePreference();
      resumeIfAllowed();
      schedulePosition();
    }
  });
  enterButton?.addEventListener("click", () => {
    if (audio.paused && preference !== "paused") {
      savePreference("playing");
      playAudio();
    }
    schedulePosition();
  }, { capture: true });
  schedulePosition();
})();
