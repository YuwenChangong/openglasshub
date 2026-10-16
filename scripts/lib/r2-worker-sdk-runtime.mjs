import path from 'node:path';

export function resolveR2WorkerRuntime(source,importer) {
  const normalized=importer?.replaceAll('\\','/').split('?')[0];
  if(!/^\.\/runtimeConfig(?:\.js)?$/.test(source)||
    !normalized?.endsWith('/node_modules/@aws-sdk/client-s3/dist-es/S3Client.js'))return null;
  return path.posix.join(path.posix.dirname(normalized),'runtimeConfig.browser.js');
}

export function r2WorkerSdkRuntime() {
  return {
    name:'r2-worker-sdk-runtime',apply:'build',enforce:'pre',
    // Workers resolve AWS core browser exports; the S3 runtime must agree.
    resolveId:resolveR2WorkerRuntime,
  };
}
