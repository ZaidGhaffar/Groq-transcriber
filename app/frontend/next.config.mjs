/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Disable ESLint during production builds
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Disable TypeScript errors during production builds
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      {
        source: '/ws',
        destination: 'https://e5c2-2407-d000-d-e7da-31c0-365e-f0dd-3320.ngrok.io/ws',
      },
      {
        source: '/health',
        destination: 'https://e5c2-2407-d000-d-e7da-31c0-365e-f0dd-3320.ngrok.io/health',
      },
    ]
  },
};

export default nextConfig; 