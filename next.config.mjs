/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tldraw ships its own ESM build; keep it transpiled with the app.
  transpilePackages: ["tldraw"],
};

export default nextConfig;
