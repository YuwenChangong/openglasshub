import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://openglass.gaze.dev',
  integrations: [
    starlight({
      title: 'OpenGlass Hub',
      description: 'AR/AI 眼镜知识库、选购指南与开发者资源',
      favicon: '/favicon.svg',
      logo: {
        src: './public/brand/logo.jpg',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/openglass-hub' },
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
