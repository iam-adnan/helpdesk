/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Disables the built-in Image Optimization API, which Next serves at /_next/image
  // whether or not the app renders a single <Image>. This app renders none — there is
  // no `next/image` import anywhere in src/ — yet the endpoint answered on the live
  // site (HTTP 400 for a bad url param, not 404: handled, therefore present and
  // reachable unauthenticated).
  //
  // That endpoint is the attack surface for GHSA-2xp9-vwfh-vxw4 / CVE-2026-75604,
  // unauthenticated RCE via crafted AVIF input, which is fixed only in Next 15.5.24 /
  // 16.3.3 — a major upgrade from this 14.x line. Turning the optimizer off removes the
  // vulnerable route rather than suppressing the finding and hoping nobody calls it.
  //
  // Cost of the change: none here. It only affects `next/image`, which is unused; if it
  // is adopted later, images render as plain <img> and are not resized at request time.
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://backend:8000/api/:path*' },
    ];
  },
};
module.exports = nextConfig;
