/**
 * Two builds from one config:
 *
 *  - `npm run dev` / `npm run build`: a normal Next app, API route included.
 *  - `npm run build:static` (STATIC_EXPORT=1): a folder of files for GitHub
 *    Pages. Pages serves from /<repo>, so every absolute URL the app builds
 *    at runtime has to carry that prefix — NEXT_PUBLIC_BASE_PATH is how the
 *    worker learns about it.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isStatic = process.env.STATIC_EXPORT === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isStatic
    ? {
        output: "export",
        basePath,
        assetPrefix: basePath || undefined,
        images: { unoptimized: true }
      }
    : {}),
  trailingSlash: isStatic
};
export default nextConfig;
