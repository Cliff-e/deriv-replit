import { defineConfig } from '@rsbuild/core';
  import { pluginReact } from '@rsbuild/plugin-react';
  import { pluginSass } from '@rsbuild/plugin-sass';

  const path = require('path');
  const port = Number(process.env.PORT) || 5000;

  export default defineConfig({
      plugins: [
          pluginSass({
              sassLoaderOptions: {
                  sourceMap: true,
                  sassOptions: {},
              },
              exclude: /node_modules/,
          }),
          pluginReact(),
      ],
      source: {
          entry: { index: './src/main.tsx' },
          define: {
              'process.env': {
                  TRANSLATIONS_CDN_URL: JSON.stringify(process.env.TRANSLATIONS_CDN_URL),
                  R2_PROJECT_NAME: JSON.stringify(process.env.R2_PROJECT_NAME),
                  CROWDIN_BRANCH_NAME: JSON.stringify(process.env.CROWDIN_BRANCH_NAME),
                  TRACKJS_TOKEN: JSON.stringify(process.env.TRACKJS_TOKEN),
                  APP_ENV: JSON.stringify(process.env.APP_ENV),
                  REF_NAME: JSON.stringify(process.env.REF_NAME),
                  REMOTE_CONFIG_URL: JSON.stringify(process.env.REMOTE_CONFIG_URL),
                  GD_CLIENT_ID: JSON.stringify(process.env.GD_CLIENT_ID),
                  GD_APP_ID: JSON.stringify(process.env.GD_APP_ID),
                  GD_API_KEY: JSON.stringify(process.env.GD_API_KEY),
                  DATADOG_SESSION_REPLAY_SAMPLE_RATE: JSON.stringify(process.env.DATADOG_SESSION_REPLAY_SAMPLE_RATE),
                  DATADOG_SESSION_SAMPLE_RATE: JSON.stringify(process.env.DATADOG_SESSION_SAMPLE_RATE),
                  DATADOG_APPLICATION_ID: JSON.stringify(process.env.DATADOG_APPLICATION_ID),
                  DATADOG_CLIENT_TOKEN: JSON.stringify(process.env.DATADOG_CLIENT_TOKEN),
                  RUDDERSTACK_KEY: JSON.stringify(process.env.RUDDERSTACK_KEY),
                  GROWTHBOOK_CLIENT_KEY: JSON.stringify(process.env.GROWTHBOOK_CLIENT_KEY),
                  GROWTHBOOK_DECRYPTION_KEY: JSON.stringify(process.env.GROWTHBOOK_DECRYPTION_KEY),
              },
              // Expose VITE_DERIV_APP_ID via import.meta.env for AiBots WS connection
              'import.meta.env.VITE_DERIV_APP_ID': JSON.stringify(process.env.VITE_DERIV_APP_ID ?? '36300'),
          },
          alias: {
              // React singletons — prevent duplicates across workspaces
              react: path.resolve('./node_modules/react'),
              'react-dom': path.resolve('./node_modules/react-dom'),

              // Explicit source aliases — all @/* roots used in the project
              '@/external':    path.resolve(__dirname, './src/external'),
              '@/components':  path.resolve(__dirname, './src/components'),
              '@/hooks':       path.resolve(__dirname, './src/hooks'),
              '@/utils':       path.resolve(__dirname, './src/utils'),
              '@/constants':   path.resolve(__dirname, './src/constants'),
              '@/stores':      path.resolve(__dirname, './src/stores'),

              // Aliases missing from original config — caused build failures
              '@/auth':        path.resolve(__dirname, './src/auth'),
              '@/bot':         path.resolve(__dirname, './src/bot'),
              '@/analytics':   path.resolve(__dirname, './src/analytics'),
              '@/pages':       path.resolve(__dirname, './src/pages'),
              '@/public-path': path.resolve(__dirname, './src/public-path.ts'),
              '@/types':       path.resolve(__dirname, './src/types'),
              '@/Types':       path.resolve(__dirname, './src/types'),
              '@/app':         path.resolve(__dirname, './src/app'),
              '@/scanner':     path.resolve(__dirname, './src/scanner'),
              '@/engine':      path.resolve(__dirname, './src/engine'),
              '@/styles':      path.resolve(__dirname, './src/styles'),
              '@/xml':         path.resolve(__dirname, './src/xml'),
          },
      },
      output: {
          copy: [
              {
                  from: 'node_modules/@deriv/deriv-charts/dist/*',
                  to: 'js/smartcharts/[name][ext]',
                  globOptions: { ignore: ['**/*.LICENSE.txt'] },
              },
              { from: 'node_modules/@deriv/deriv-charts/dist/chart/assets/*',        to: 'assets/[name][ext]' },
              { from: 'node_modules/@deriv/deriv-charts/dist/chart/assets/fonts/*',  to: 'assets/fonts/[name][ext]' },
              { from: 'node_modules/@deriv/deriv-charts/dist/chart/assets/shaders/*',to: 'assets/shaders/[name][ext]' },
              { from: path.join(__dirname, 'public') },
          ],
          filename: {
              js: ({ chunk }) => {
                  if (chunk?.name === 'sw') return '[name].js';
                  return '[name].[contenthash:8].js';
              },
          },
      },
      html: { template: './index.html' },
      server: {
          port,
          host: '0.0.0.0',
          compress: true,
          headers: {
              'Cross-Origin-Opener-Policy': 'unsafe-none',
              'Cross-Origin-Embedder-Policy': 'unsafe-none',
              'Cache-Control': 'no-cache',
          },
      },
      dev: { hmr: true },
      tools: {
          rspack: {
              plugins: [],
              resolve: {},
              module: {
                  rules: [
                      { test: /\.xml$/, exclude: /node_modules/, use: 'raw-loader' },
                  ],
              },
          },
      },
  });
  