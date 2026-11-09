/* LEVEL XVIII — Navegacao mobile na primeira dobra. */
(() => {
  "use strict";

  const control = document.getElementById("mobileContinue");
  const app = document.getElementById("app");
  if (!control || !app) return;

  const smallScreen = window.matchMedia("(max-width: 720px)");
  let scheduled = false;

  function updateVisibility() {
    scheduled = false;
    // Evita cobrir o restante do convite, a pagina de RSVP ou um deep link.
    const visible = smallScreen.matches &&
      !app.classList.contains("hidden") &&
      window.scrollY <= 120 &&
      !window.location.hash;

    control.classList.toggle("is-visible", visible);
    control.tabIndex = visible ? 0 : -1;
    control.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateVisibility);
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("hashchange", scheduleUpdate);
  if (smallScreen.addEventListener) {
    smallScreen.addEventListener("change", scheduleUpdate);
  } else if (smallScreen.addListener) {
    smallScreen.addListener(scheduleUpdate);
  }

  // Quando o usuario sai da tela de inicializacao, o link passa a aparecer.
  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(app, { attributes: true, attributeFilter: ["class"] });

  control.addEventListener("click", () => {
    control.classList.remove("is-visible");
    control.tabIndex = -1;
    control.setAttribute("aria-hidden", "true");
  });

  updateVisibility();
})();
