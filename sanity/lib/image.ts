import imageUrlBuilder from "@sanity/image-url";
import { dataset, projectId } from "../env";

const builder = projectId ? imageUrlBuilder({ projectId, dataset }) : null;

export function urlForImage(source: object) {
  return builder?.image(source).auto("format").fit("max").url();
}
