import { mountCloudGallery } from "./gallery-embed.js?v=17";
import { preserveInvitationContext } from "./navigation.js";

preserveInvitationContext("../");
const gallery = document.querySelector("#gallery");
gallery.querySelector("[data-gallery-retry]").addEventListener("click", () => mountCloudGallery(gallery));
mountCloudGallery(gallery);
