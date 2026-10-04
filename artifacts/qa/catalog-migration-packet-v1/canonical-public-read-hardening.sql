BEGIN;
REVOKE SELECT ON public.devices FROM anon;
REVOKE SELECT(full_specs,key_specs) ON public.devices FROM anon;
GRANT SELECT(id,slug,brand_key,brand_name,name,short_description,long_description,positioning,release_year,availability,type_label,status_label,media,product_image_url,official_image_url,image_alt,product_url,official_product_url,buy_url,category,route_label,route_description,best_for,not_ideal_for,key_limitations,catalog_normalized,publication_status) ON public.devices TO anon;
DROP POLICY devices_select_published_public ON public.devices;
CREATE POLICY devices_select_published_public ON public.devices FOR SELECT TO anon USING(publication_status='published');
COMMIT;
