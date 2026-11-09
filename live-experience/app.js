import { createPublicSource } from "./data-source.js";
import { Gallery } from "./gallery.js";
import { preserveInvitationContext } from "./navigation.js";

preserveInvitationContext("../");
const gallery = new Gallery(createPublicSource());
gallery.refresh();
