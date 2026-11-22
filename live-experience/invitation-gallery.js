import { mountCloudGallery } from "./gallery-embed.js?v=17";

const link = document.querySelector("#liveExperienceLink");
const gallery = document.querySelector("#live-gallery");

function openGallery() {
  if (location.hash !== "#live-gallery") return;
  if (gallery.hidden) {
    gallery.hidden = false;
    mountCloudGallery(gallery);
  }
  gallery.scrollIntoView({ block: "start" });
}

link.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (location.hash === "#live-gallery") openGallery();
  else location.hash = "#live-gallery";
});

gallery.querySelector("[data-gallery-retry]").addEventListener("click", () => mountCloudGallery(gallery));
window.addEventListener("hashchange", openGallery);
openGallery();
