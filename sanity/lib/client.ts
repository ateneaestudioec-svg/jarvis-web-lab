import { createClient } from "next-sanity";
import { apiVersion, dataset, projectId } from "../env";

export const HOME_PAGE_CACHE_TAG = "sanity:homePage";

export const client = projectId
  ? createClient({
      projectId,
      dataset,
      apiVersion,
      useCdn: false,
    })
  : null;
