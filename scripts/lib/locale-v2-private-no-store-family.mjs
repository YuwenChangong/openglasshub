export const privateNoStoreCases = Object.freeze([
  { path:'/', status:200, kind:'home' },
  { path:'/products/', status:200, kind:'catalog' },
  { path:'/products/xreal/', status:200, kind:'brand' },
  { path:'/search/', status:200, kind:'search' },
  { path:'/settings/', status:200, kind:'settings' },
  { path:'/products/xreal/xreal-air/', status:200, kind:'product-detail' },
  { path:'/products/meta/ray-ban-meta/', status:200, kind:'product-detail' },
  { path:'/admin/devices/', status:200, kind:'admin-catalog' },
  { path:'/guides/index/?lang=en', status:200, kind:'reviewed-document' },
  { path:'/guides/index/?lang=zh-CN', status:200, kind:'reviewed-document' },
  { path:'/guides/ar-ai-xr-glasses-difference/?lang=en', status:200, kind:'original-document' },
  { path:'/__owned-locale-v2-missing-page__/', status:404, kind:'not-found' },
]);
