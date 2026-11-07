// O contexto do convite é apenas transportado; não autoriza acesso a fotografias.
export function preserveInvitationContext(invitationPath) {
  const params = new URLSearchParams(window.location.search);
  const inviteToken = (params.get("token") || "").trim();
  const returnedConfirmed = params.get("confirmado") === "1";
  const returnParams = new URLSearchParams();

  if (inviteToken) returnParams.set("token", inviteToken);
  if (returnedConfirmed && inviteToken) returnParams.set("confirmado", "1");

  const query = returnParams.toString();
  const section = returnedConfirmed && inviteToken ? "countdown" : "event";
  document.querySelector("#backToInvitation").href = `${invitationPath}${query ? `?${query}` : ""}#${section}`;
}
