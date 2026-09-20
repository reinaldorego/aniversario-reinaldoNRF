/* ========================================
   LEVEL XVIII
   Reinaldo NR Filho
   ======================================== */

const $ = (selector) => document.querySelector(selector);

const RSVP_BASE_URL =
  "https://script.google.com/macros/s/AKfycbwhdgcuee-ndezFAR6mOJJ0yHbXDEI2_oRdsM2OEtLjoPj3gIbX_loq3_YpGE02tKfA/exec";

const params = new URLSearchParams(window.location.search);
const inviteToken = (params.get("token") || "").trim();
const returnedConfirmed = params.get("confirmado") === "1";

const boot = $("#boot");
const app = $("#app");
const progressBar = $("#progressBar");
const progressText = $("#progressText");
const enterBtn = $("#enterBtn");
const confirmationStatus = $("#confirmationStatus");
const viewPassBtn = $("#viewPassBtn");

function getRsvpUrl() {
  if (
    !RSVP_BASE_URL ||
    RSVP_BASE_URL.indexOf("COLE_AQUI") === 0 ||
    !inviteToken
  ) {
    return "";
  }

  return `${RSVP_BASE_URL.replace(/\/$/, "")}?token=${encodeURIComponent(inviteToken)}`;
}

function scrollToCurrentSection() {
  const targetId = window.location.hash.slice(1);

  if (!targetId) {
    window.scrollTo({ top: 0, behavior: "auto" });
    return;
  }

  window.requestAnimationFrame(() => {
    const target = document.getElementById(targetId);

    if (target) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    }
  });
}

function showInvitation() {
  boot.classList.add("hidden");
  app.classList.remove("hidden");
  scrollToCurrentSection();
}

function openRealRsvp() {
  const rsvpUrl = getRsvpUrl();

  if (!rsvpUrl) {
    alert(
      "Para confirmar, abra o link individual enviado pelo anfitrião. Este link não possui a identificação do convidado."
    );
    return;
  }

  window.location.assign(rsvpUrl);
}

let progress = 0;
let bootTimer = null;

function startBoot() {
  bootTimer = window.setInterval(() => {
    progress += Math.floor(Math.random() * 9) + 5;

    if (progress >= 100) {
      progress = 100;
      window.clearInterval(bootTimer);
      enterBtn.classList.remove("hidden");
    }

    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${progress}%`;
  }, 120);
}

enterBtn.addEventListener("click", showInvitation);

$("#rsvpBtn").addEventListener("click", openRealRsvp);
$("#maybeBtn").addEventListener("click", openRealRsvp);

if (returnedConfirmed && inviteToken) {
  confirmationStatus.classList.remove("hidden");
  viewPassBtn.href = getRsvpUrl();
}

if (returnedConfirmed || window.location.hash) {
  showInvitation();
} else {
  startBoot();
}

const eventDate = new Date("2026-11-15T20:00:00-03:00").getTime();

function updateCountdown() {
  let distance = eventDate - Date.now();

  if (distance < 0) {
    distance = 0;
  }

  const days = Math.floor(distance / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor(
    (distance % (1000 * 60 * 60)) / (1000 * 60)
  );
  const seconds = Math.floor((distance % (1000 * 60)) / 1000);

  $("#days").textContent = String(days).padStart(2, "0");
  $("#hours").textContent = String(hours).padStart(2, "0");
  $("#minutes").textContent = String(minutes).padStart(2, "0");
  $("#seconds").textContent = String(seconds).padStart(2, "0");
}

updateCountdown();
window.setInterval(updateCountdown, 1000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then(() => {
        console.log("Service Worker registrado.");
      })
      .catch((error) => {
        console.error("Erro no Service Worker:", error);
      });
  });
}

