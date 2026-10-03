import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The repo root has its own lockfile (the Expo app); build from this folder.
  turbopack: { root: path.resolve(import.meta.dirname) },
  // Don't bundle firebase-admin: Turbopack turns its jose import into require()
  // of an ESM-only build and /api/session 500s with an empty body.
  serverExternalPackages: ['firebase-admin', 'jose', 'jwks-rsa'],
};

export default nextConfig;
