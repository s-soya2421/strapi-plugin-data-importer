import { defineConfig } from '@strapi/pack-up';

export default defineConfig({
  sourcemap: false,
  externals: [
    '@strapi/utils',
    '@strapi/admin',
    'react',
    'react-dom',
    'react-intl',
  ],
});
