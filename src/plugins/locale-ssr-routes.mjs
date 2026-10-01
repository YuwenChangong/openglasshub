export default function localeSsrRoutes() {
  return {
    name: "openglass-locale-ssr-routes",
    hooks: {
      "astro:route:setup": ({ route }) => {
        const component = route.component.replaceAll("\\", "/");
        if (/(?:^|\/)src\/pages\//.test(component) && !/(?:^|\/)src\/pages\/api\//.test(component) && /\.(?:astro|md|mdx)$/.test(component)) route.prerender = false;
      },
    },
  };
}
