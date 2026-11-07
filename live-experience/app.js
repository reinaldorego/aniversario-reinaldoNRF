// Transporta apenas o contexto já existente; não valida RSVP nem acessa o backend.
const params = new URLSearchParams(window.location.search);
const inviteToken = (params.get("token") || "").trim();
const returnedConfirmed = params.get("confirmado") === "1";
const returnParams = new URLSearchParams();

if (inviteToken) returnParams.set("token", inviteToken);
if (returnedConfirmed && inviteToken) returnParams.set("confirmado", "1");

const returnQuery = returnParams.toString();
const returnSection = returnedConfirmed && inviteToken ? "countdown" : "event";
document.querySelector("#backToInvitation").href = `../${returnQuery ? `?${returnQuery}` : ""}#${returnSection}`;
