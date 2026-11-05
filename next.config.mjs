/**
 * Content-Security-Policy (PT-35).
 * - 'unsafe-eval' only in development: the dev server's hot reload needs it;
 *   the production build does not.
 * - script-src keeps 'unsafe-inline': Next.js 14 App Router inlines its
 *   bootstrap and RSC payload scripts. Replacing it with a nonce requires a
 *   middleware on every route that generates the nonce per request and forces
 *   dynamic rendering of all pages (today middleware only guards /dashboard and
 *   several pages are static). Documented rather than changed.
 * - style-src keeps 'unsafe-inline' for React style attributes (e.g. bar widths).
 */
const isDev = process.env.NODE_ENV !== 'production';
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ') + ';';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // backend/ is a workspace package written in TypeScript: Next compiles it
  transpilePackages: ['@mic/backend'],
  experimental: {
    serverActions: {
      bodySizeLimit: '128kb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/student/:path*',
        destination: '/participant/:path*',
        permanent: true,
      },
      {
        source: '/sala/:pin',
        destination: '/room/:pin',
        permanent: true,
      },
      {
        source: '/api/salas/:id/export/:path*',
        destination: '/api/rooms/:id/export/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
