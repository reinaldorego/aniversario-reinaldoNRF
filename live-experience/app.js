import { createCloudSource } from "./cloud-source.js?v=18";
import { Gallery } from "./gallery.js?v=18";
import { preserveInvitationContext } from "./navigation.js";

preserveInvitationContext("../");
const directLink = document.querySelector("[data-gallery-link]");
const source = createCloudSource(url => {
  directLink.href = url.href;
  directLink.hidden = false;
});
const gallery = new Gallery(source);
gallery.refresh();

const timer = window.setInterval(() => {
  if (!document.hidden && !gallery.elements.photoViewer.open && !gallery.elements.refreshGallery.disabled) {
    gallery.refresh();
  }
}, 65000);

window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  window.clearInterval(timer);
  gallery.request?.abort();
  source.dispose();
});
