import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@brain/core", "@brain/db"],
};

export default config;
