import createMDX from '@next/mdx';
import { docsManifest } from '@vgpu/cli/lib/generated/docs-manifest.generated.js';

const withMDX = createMDX({
  extension: /\.mdx?$/,
});

function referencePackageName(record) {
  if (record.package === 'vgpu' || record.package === 'vgpu/core' || record.package === 'vgpu/scene') return record.package;
  if (record.package.startsWith('@vgpu/wgsl-std')) return '@vgpu/wgsl-std';
  if (record.package.startsWith('@vgpu/wgsl')) return '@vgpu/wgsl';
  if (record.package.startsWith('@vgpu/render')) return '@vgpu/render';
  return record.package;
}

function slugifyPackage(packageName) {
  if (packageName === '@vgpu/wgsl') return 'wgsl';
  if (packageName === '@vgpu/wgsl-std') return 'wgsl-std';
  if (packageName === '@vgpu/render') return 'render';
  return packageName.replace(/^@/, '').replace(/[\/@]/g, '-');
}

function legacyPackageSlug(packageName) {
  return packageName.replace(/^@/, '').replace(/[\/@]/g, '-');
}

const packageRedirects = Array.from(new Set(
  docsManifest.records
    .filter((record) => record.kind === 'api')
    .map((record) => record.package),
)).map((packageName) => ({
  source: `/packages/${legacyPackageSlug(packageName)}`,
  destination: `/docs/reference#${slugifyPackage(referencePackageName({ package: packageName }))}`,
  permanent: false,
}));

const symbolRedirects = docsManifest.records
  .filter((record) => record.kind === 'api')
  .map((record) => ({
    source: `/packages/${legacyPackageSlug(record.package)}/${encodeURIComponent(record.symbol)}`,
    destination: `/docs/reference/${slugifyPackage(referencePackageName(record))}/${encodeURIComponent(record.topic)}#${record.anchor}`,
    permanent: false,
  }));

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/get-started', destination: '/docs/get-started', permanent: false },
      { source: '/get-started/:path*', destination: '/docs/get-started/:path*', permanent: false },
      { source: '/concepts', destination: '/docs/concepts', permanent: false },
      { source: '/concepts/:path*', destination: '/docs/concepts/:path*', permanent: false },
      { source: '/guides', destination: '/docs/guides', permanent: false },
      { source: '/guides/:path*', destination: '/docs/guides/:path*', permanent: false },
      { source: '/reference/vgpu/pass', destination: '/docs/reference/vgpu/effect', permanent: false },
      { source: '/reference', destination: '/docs/reference', permanent: false },
      { source: '/reference/:path*', destination: '/docs/reference/:path*', permanent: false },
      { source: '/cli', destination: '/docs/cli', permanent: false },
      { source: '/api', destination: '/docs/reference', permanent: false },
      { source: '/packages', destination: '/docs/reference', permanent: false },
      { source: '/packages/vgpu/Pass', destination: '/docs/reference/vgpu/effect#effect', permanent: false },
      { source: '/packages/vgpu/PassOptions', destination: '/docs/reference/vgpu/effect#effectoptions', permanent: false },
      { source: '/getting-started', destination: '/docs/get-started', permanent: false },
      ...packageRedirects,
      ...symbolRedirects,
    ];
  },
  transpilePackages: [
    'vgpu',
    '@vgpu/core',
    '@vgpu/wgsl',
    '@vgpu/wgsl-std',
    '@vgpu/adapter-mock',
    '@vgpu/adapter-node',
  ],
  turbopack: {
    rules: {
      '*.wgsl': {
        loaders: ['@vgpu/wgsl/loader-webpack'],
        as: '*.js',
      },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.wgsl$/,
      use: '@vgpu/wgsl/loader-webpack',
    });
    return config;
  },
};

export default withMDX(nextConfig);
