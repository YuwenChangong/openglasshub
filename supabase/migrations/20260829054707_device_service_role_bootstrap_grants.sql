-- The canonical device bootstrap uses the local Supabase service-role client.
-- Data API table grants are evaluated before the service role's RLS bypass.
grant select, insert, update
on table public.devices
to service_role;
