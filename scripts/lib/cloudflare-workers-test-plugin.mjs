export function cloudflareWorkersTestPlugin() {
  const id = "\0openglass-cloudflare-workers-test";
  return {
    name: "openglass-cloudflare-workers-test",
    resolveId(source) {
      return source === "cloudflare:workers" ? id : null;
    },
    load(source) {
      return source === id ? "const state = globalThis.__openglassWorkersTestBinding ??= { value: undefined }; export const env = new Proxy({}, { get: (_target, key) => state.value?.[key] });" : null;
    },
  };
}

export function setCloudflareWorkersTestBinding(value) {
  (globalThis.__openglassWorkersTestBinding ??= {}).value = value;
}
