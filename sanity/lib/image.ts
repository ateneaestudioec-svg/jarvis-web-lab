import { createImageUrlBuilder } from "@sanity/image-url";
import { dataset, projectId } from "../env";

const builder = projectId
  ? createImageUrlBuilder({ projectId, dataset })
  : null;

export function urlForImage(source: object) {
  return builder?.image(source).auto("format").fit("max").url();
}
