import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://openglasshub.pages.dev',
  integrations: [
    starlight({
      title: 'OpenGlass Hub',
      description: 'AR/AI 眼镜知识库、选购指南与开发者资源',
      favicon: '/gaze-icon-v6.ico',
      logo: {
        src: './public/brand/logo.jpg',
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
          label: 'Gaze OS',
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
      customCss: ['./src/styles/custom.css'],
      expressiveCode: {
        themes: ['github-dark'],
      },
    }),
  ],
});
