/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mirofish/shared"],
  experimental: {
    optimizePackageImports: ["react-force-graph-2d"],
  },
};

export default nextConfig;
