insert into public.circles (slug, name, description, type) values
('xreal','XREAL','XREAL 设备与使用讨论','device'),
('rokid','Rokid','Rokid 设备与使用讨论','device'),
('rayneo','RayNeo','RayNeo 设备与使用讨论','device'),
('meta-ai-glasses','Meta AI Glasses','Ray-Ban Meta 等智能眼镜讨论','device'),
('brilliant-labs','Brilliant Labs','Brilliant Labs Frame 相关讨论','device'),
('gaze-os','Gaze Launcher','Gaze Launcher 实验方向讨论','project')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    type = excluded.type;
