import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  // The CMSBar login page.
  route("cmsbar/login", "routes/cmsbar.login.tsx"),
  // The whole CMS API, as one splat resource route -> handleCmsRequest.
  route("api/cms/*", "routes/api.cms.$.ts"),
] satisfies RouteConfig;
