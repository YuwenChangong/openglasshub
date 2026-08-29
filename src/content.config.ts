import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { isGazeLauncherDocumentationEntryPublic } from './plugins/remark-gaze-launcher-visibility.ts';

const starlightDocsLoader = docsLoader();

const docs = defineCollection({
  loader: {
    name: 'openglass-public-docs-loader',
    async load(context) {
      await starlightDocsLoader.load(context);

      for (const [id] of context.store.entries()) {
        if (!isGazeLauncherDocumentationEntryPublic(id)) {
          context.store.delete(id);
        }
      }
    },
  },
  schema: docsSchema(),
});

export const collections = { docs };
