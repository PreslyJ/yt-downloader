/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.ytimg.com' }],
  },
  experimental: {
    // Keep ffmpeg-static unbundled so its __dirname-relative binary path resolves.
    serverComponentsExternalPackages: ['ffmpeg-static'],
    // Make sure Vercel's function bundler ships the ffmpeg binary.
    outputFileTracingIncludes: {
      '/api/download': ['./node_modules/ffmpeg-static/ffmpeg'],
    },
  },
};

export default nextConfig;
