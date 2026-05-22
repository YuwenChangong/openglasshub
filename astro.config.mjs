import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://openglasshub.pages.dev',
  output: 'static',
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
  }),
  integrations: [
    react(),
    starlight({
      title: 'OpenGlass Hub',
      description: 'AR/AI 眼镜知识库、选购指南与开发者资源',
      defaultLocale: 'root',
      locales: {
        root: {
          label: '简体中文',
          lang: 'zh-CN',
        },
      },
      favicon: '/gaze-icon-v6.ico',
      logo: {
        src: './public/brand/openglass-nav-logo.png',
        alt: 'OpenGlass Hub',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/openglass-hub' },
      ],
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/x-icon',
            href: '/gaze-icon-v6.ico',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/svg+xml',
            href: '/gaze-icon-v6.svg',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/png',
            sizes: '32x32',
            href: '/gaze-icon-32-v6.png',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/png',
            sizes: '192x192',
            href: '/gaze-icon-192-v6.png',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'apple-touch-icon',
            sizes: '180x180',
            href: '/apple-touch-icon-v6.png',
          },
        },
      ],
      sidebar: [
        {
          label: '设备库',
          link: '/devices',
        },
        {
          label: '选购指南',
          link: '/guides',
        },
        {
          label: '开发者',
          link: '/developers',
        },
        {
          label: 'Gaze Launcher',
          link: '/gaze-os',
        },
        {
          label: '社区',
          link: '/community',
        },
        {
          label: '关于',
          link: '/about',
        },
      ],
      components: {
        Header: './src/components/starlight/Header.astro',
      },
      customCss: ['./src/styles/custom.css'],
      expressiveCode: {
        themes: ['github-dark'],
      },
    }),
  ],
});
