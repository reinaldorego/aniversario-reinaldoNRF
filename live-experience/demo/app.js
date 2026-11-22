import { Gallery } from "../gallery.js";
import { preserveInvitationContext } from "../navigation.js";
import { createDemoSource } from "./data-source.js";

preserveInvitationContext("../../");
const source = createDemoSource();
const gallery = new Gallery(source, { demo: true });
document.querySelector("#demoScenario").addEventListener("change", (event) => {
  source.setScenario(event.target.value);
  gallery.refresh();
});
gallery.refresh();
