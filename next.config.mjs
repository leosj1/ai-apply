/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "pdf-parse",
      "mammoth",
      "playwright-core",
      "puppeteer-extra",
      "puppeteer-extra-plugin-stealth",
      "clone-deep",
      "@prisma/client",
      "@libsql/client",
      "@prisma/adapter-libsql",
      "googleapis",
      "nodemailer",
      "openai",
      "@anthropic-ai/sdk",
      "svix",
      "cheerio",
      "2captcha-ts",
      "jspdf",
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize heavy server-only packages to avoid bundling them — speeds up dev compilation
      config.externals = config.externals || [];
      config.externals.push(
        "playwright-core",
        "puppeteer-extra",
        "puppeteer-extra-plugin-stealth",
        "clone-deep",
        "merge-deep",
        "googleapis",
        "nodemailer",
        "openai",
        "@anthropic-ai/sdk",
        "svix",
        "cheerio",
        "2captcha-ts",
        "jspdf",
        "mammoth",
        "pdf-parse",
      );
    }
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
      {
        protocol: "https",
        hostname: "images.clerk.dev",
      },
    ],
  },
};

export default nextConfig;
