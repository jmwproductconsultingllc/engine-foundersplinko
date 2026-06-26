/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't bundle unpdf (and its pdfjs internals) — load it at runtime from
  // node_modules. It's only used server-side in the targeted financials pass,
  // and bundling it under Turbopack fails to resolve.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
