/* ========================================
   LEVEL XVIII
   Reinaldo NR Filho
   ======================================== */


/* ========================================
   SELETOR
   ======================================== */

   const $ = (selector) =>
   document.querySelector(selector);

/* ========================================
   INTEGRAÇÃO COM RSVP — APPS SCRIPT
   ======================================== */

// Cole aqui somente a URL-base publicada do Apps Script,
// sem ?token=...
const RSVP_BASE_URL =
  "https://script.google.com/macros/s/AKfycbwhdgcuee-ndezFAR6mOJJ0yHbXDEI2_oRdsM2OEtLjoPj3gIbX_loq3_YpGE02tKfA/exec";

const inviteToken =
  new URLSearchParams(window.location.search)
    .get("token") ||
  "NR2026-001";

function getRsvpUrl() {
  if (
    !RSVP_BASE_URL ||
    RSVP_BASE_URL.indexOf("COLE_AQUI") === 0
  ) {
    return "";
  }

  return `${RSVP_BASE_URL.replace(/\/$/, "")}?token=${encodeURIComponent(inviteToken)}`;
}
 
 
 /* ========================================
    ELEMENTOS
    ======================================== */
 
 const boot =
   $("#boot");
 
 const app =
   $("#app");
 
 const progressBar =
   $("#progressBar");
 
 const progressText =
   $("#progressText");
 
 const enterBtn =
   $("#enterBtn");
 
 const rsvpDialog =
   $("#rsvpDialog");
 
 const passDialog =
   $("#passDialog");
 
 
 /* ========================================
    INICIALIZAÇÃO
    ======================================== */
 
 let progress = 0;
 
 const bootTimer =
   setInterval(() => {
 
     progress +=
       Math.floor(
         Math.random() * 9
       ) + 5;
 
     if (
       progress >= 100
     ) {
 
       progress = 100;
 
       clearInterval(
         bootTimer
       );
 
       enterBtn
         .classList
         .remove(
           "hidden"
         );
 
     }
 
     progressBar
       .style
       .width =
       `${progress}%`;
 
     progressText
       .textContent =
       `${progress}%`;
 
   }, 120);
 
 
 /* ========================================
    ENTRAR NA EXPERIÊNCIA
    ======================================== */
 
 enterBtn
   .addEventListener(
     "click",
     () => {
 
       boot
         .classList
         .add(
           "hidden"
         );
 
       app
         .classList
         .remove(
           "hidden"
         );
 
       window
         .scrollTo({
           top: 0,
           behavior: "instant"
         });
 
     }
   );
 
 
 /* ========================================
    CONTAGEM REGRESSIVA
    15/11/2026
    20:00
    Horário de Belém
    UTC-3
    ======================================== */
 
 const eventDate =
   new Date(
     "2026-11-15T20:00:00-03:00"
   )
   .getTime();
 
 
 function updateCountdown() {
 
   const now =
     Date.now();
 
   let distance =
     eventDate - now;
 
 
   if (
     distance < 0
   ) {
 
     distance = 0;
 
   }
 
 
   const days =
     Math.floor(
       distance /
       (
         1000 *
         60 *
         60 *
         24
       )
     );
 
 
   const hours =
     Math.floor(
       (
         distance %
         (
           1000 *
           60 *
           60 *
           24
         )
       ) /
       (
         1000 *
         60 *
         60
       )
     );
 
 
   const minutes =
     Math.floor(
       (
         distance %
         (
           1000 *
           60 *
           60
         )
       ) /
       (
         1000 *
         60
       )
     );
 
 
   const seconds =
     Math.floor(
       (
         distance %
         (
           1000 *
           60
         )
       ) /
       1000
     );
 
 
   $("#days")
     .textContent =
     String(days)
       .padStart(
         2,
         "0"
       );
 
 
   $("#hours")
     .textContent =
     String(hours)
       .padStart(
         2,
         "0"
       );
 
 
   $("#minutes")
     .textContent =
     String(minutes)
       .padStart(
         2,
         "0"
       );
 
 
   $("#seconds")
     .textContent =
     String(seconds)
       .padStart(
         2,
         "0"
       );
 
 }
 
 
 updateCountdown();
 
 setInterval(
   updateCountdown,
   1000
 );
 
 
 /* ========================================
    ABRIR RSVP
    ======================================== */
 
 $("#rsvpBtn")
   .addEventListener(
     "click",
     () => {

       const rsvpUrl = getRsvpUrl();

       if (!rsvpUrl) {
         alert(
           "A URL do RSVP ainda não foi configurada."
         );
         return;
       }

       window.location.href = rsvpUrl;

     }
   );
 
 
 /* ========================================
    FECHAR RSVP
    ======================================== */
 
 $("#closeRsvp")
   .addEventListener(
     "click",
     () => {
 
       rsvpDialog
         .close();
 
     }
   );
 
 
 /* ========================================
    AINDA NÃO SEI
    ======================================== */
 
 $("#maybeBtn")
   .addEventListener(
     "click",
     () => {
 
       alert(
         "Sem problema! Você pode voltar e confirmar sua presença até 01 de novembro de 2026."
       );
 
     }
   );
 
 
 /* ========================================
    CONFIRMAÇÃO
    ======================================== */
 
 $("#rsvpForm")
   .addEventListener(
     "submit",
     (event) => {
 
       event
         .preventDefault();
 
 
       const guestName =
         $("#guestName")
           .value
           .trim();
 
 
       const companions =
         Number(
           $("#companions")
             .value
         );
 
 
       if (
         !guestName
       ) {
 
         alert(
           "Digite o nome do convidado."
         );
 
         return;
 
       }
 
 
       const randomId =
         Math
           .random()
           .toString(36)
           .slice(2, 8)
           .toUpperCase();
 
 
       const accessId =
         `LVL18-${randomId}`;
 
 
       const confirmation =
       {
 
         name:
           guestName,
 
         companions:
           companions,
 
         id:
           accessId,
 
         confirmedAt:
           new Date()
             .toISOString()
 
       };
 
 
       localStorage
         .setItem(
 
           "level18-rsvp",
 
           JSON.stringify(
             confirmation
           )
 
         );
 
 
       updateAccessPass(
         confirmation
       );
 
 
       rsvpDialog
         .close();
 
 
       passDialog
         .showModal();
 
     }
   );
 
 
 /* ========================================
    ATUALIZAR ACCESS PASS
    ======================================== */
 
 function updateAccessPass(
   data
 ) {
 
   $("#passName")
     .textContent =
     data
       .name
       .toUpperCase();
 
 
   $("#passCompanions")
     .textContent =
     data.companions;
 
 
   $("#passId")
     .textContent =
     `ID: ${data.id}`;
 
 }
 
 
 /* ========================================
    FECHAR ACCESS PASS
    ======================================== */
 
 $("#closePass")
   .addEventListener(
     "click",
     () => {
 
       passDialog
         .close();
 
     }
   );
 
 
 /* ========================================
    CARREGAR CONFIRMAÇÃO
    JÁ SALVA
    ======================================== */
 
 const savedConfirmation =
   localStorage
     .getItem(
       "level18-rsvp"
     );
 
 
 if (
   savedConfirmation
 ) {
 
   try {
 
     const data =
       JSON.parse(
         savedConfirmation
       );
 
 
     updateAccessPass(
       data
     );
 
 
   }
   catch (
     error
   ) {
 
     console.error(
       "Erro ao carregar confirmação:",
       error
     );
 
   }
 
 }
 
 
 /* ========================================
    SERVICE WORKER
    ======================================== */
 
 if (
   "serviceWorker"
   in navigator
 ) {
 
   window
     .addEventListener(
       "load",
       () => {
 
         navigator
           .serviceWorker
           .register(
             "sw.js"
           )
 
           .then(() => {
 
             console.log(
               "Service Worker registrado."
             );
 
           })
 
           .catch(
             (error) => {
 
               console.error(
                 "Erro no Service Worker:",
                 error
               );
 
             }
           );
 
       }
     );
 
 }
