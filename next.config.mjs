/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Ne pas bloquer le dev server à cause des erreurs ESLint (apostrophes, etc.)
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'maps.googleapis.com',
        pathname: '/maps/api/staticmap/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/v0/b/**',
      },
    ],
  },
};

export default nextConfig;
