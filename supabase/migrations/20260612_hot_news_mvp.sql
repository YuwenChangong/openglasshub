-- OpenGlass Hub Hot News MVP
-- Admin/moderator published information feed for /news/ and /admin/news/.

create table if not exists public.news_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text,
  content text,
  cover_image_url text,
  category text not null default 'industry',
  source_name text,
  source_url text,
  status text not null default 'draft',
  author_id uuid references public.profiles(id) on delete set null,
  pinned boolean not null default false,
  featured boolean not null default false,
  view_count integer not null default 0 check (view_count >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (category in ('industry', 'devices', 'ai_glasses', 'ar_glasses', 'developer', 'community', 'openglass')),
  check (status in ('draft', 'published', 'archived'))
);

create index if not exists news_articles_status_published_idx
  on public.news_articles(status, published_at desc, created_at desc);

create index if not exists news_articles_category_published_idx
  on public.news_articles(category, status, published_at desc, created_at desc);

create index if not exists news_articles_featured_idx
  on public.news_articles(featured, pinned, published_at desc);

drop trigger if exists trg_news_articles_set_updated_at on public.news_articles;
create trigger trg_news_articles_set_updated_at
before update on public.news_articles
for each row execute function public.set_updated_at();

grant select on table public.news_articles to anon, authenticated;
grant insert, update, delete on table public.news_articles to authenticated;

alter table public.news_articles enable row level security;

drop policy if exists "news_articles_select_published_public" on public.news_articles;
create policy "news_articles_select_published_public"
on public.news_articles
for select
to anon, authenticated
using (status = 'published');

drop policy if exists "news_articles_select_staff_all" on public.news_articles;
create policy "news_articles_select_staff_all"
on public.news_articles
for select
to authenticated
using ((select public.is_moderator_or_admin()));

drop policy if exists "news_articles_insert_staff" on public.news_articles;
create policy "news_articles_insert_staff"
on public.news_articles
for insert
to authenticated
with check (
  (select public.is_moderator_or_admin())
);

drop policy if exists "news_articles_update_staff" on public.news_articles;
create policy "news_articles_update_staff"
on public.news_articles
for update
to authenticated
using ((select public.is_moderator_or_admin()))
with check (
  (select public.is_moderator_or_admin())
);

drop policy if exists "news_articles_delete_staff" on public.news_articles;
create policy "news_articles_delete_staff"
on public.news_articles
for delete
to authenticated
using ((select public.is_moderator_or_admin()));

insert into public.news_articles (
  slug,
  title,
  summary,
  content,
  category,
  source_name,
  status,
  pinned,
  featured,
  published_at
)
values
  (
    'community-discussion-shifts-to-real-usage',
    '社区观察：AR / AI 眼镜讨论开始回到真实使用问题',
    '从参数表回到佩戴体验、兼容性、续航和系统限制，是当前更有价值的讨论方向。',
    '过去一段时间，很多中文讨论仍停留在参数、宣传视频和品牌口号层面。'
      || E'\n\n'
      || '但真正会影响购买决策和长期体验的，通常是佩戴舒适度、链路稳定性、输入方式、权限边界，以及是否存在明确的开发入口。'
      || E'\n\n'
      || 'OpenGlass Hub 会把这类更接近真实体验的内容优先放到前台，让“热点”更有复用价值。',
    'community',
    'OpenGlass Hub 编辑部',
    'published',
    true,
    true,
    timezone('utc', now()) - interval '1 day'
  ),
  (
    'product-watch-focus-on-system-boundaries',
    '行业整理：看眼镜产品，不应只看硬件，也要看系统边界',
    '很多设备的分野并不只来自显示能力，而来自系统权限、可安装路径和输入方式的约束。',
    '同样是“眼镜”，不同产品的实际能力可能完全不同。'
      || E'\n\n'
      || '对用户和开发者来说，真正需要长期追踪的是系统边界：是否能安装第三方应用，是否开放开发接口，是否允许持续调用摄像头或麦克风，输入方式是否足够稳定。'
      || E'\n\n'
      || '因此“热点”内容的重点，不应只是追逐一张参数表，而是帮助用户更快理解产品分层。',
    'industry',
    'OpenGlass Hub 编辑部',
    'published',
    false,
    true,
    timezone('utc', now()) - interval '2 day'
  ),
  (
    'device-updates-are-shifting-toward-better-daily-utility',
    '设备动态：新一轮产品更新更强调日常可用性，而不是概念演示',
    '更轻的机身、更稳的语音链路和更清晰的角色定位，正在成为新一轮设备更新的共同方向。',
    '与早期只强调“能做什么”的展示不同，新一轮产品更新更关注“能否每天使用”。'
      || E'\n\n'
      || '包括佩戴负担、续航、镜片信息密度、音频私密性，以及和手机系统之间的配合，都会直接影响产品是否能进入日常场景。'
      || E'\n\n'
      || '对读者来说，这类变化往往比单次发布会上的概念演示更值得追踪。',
    'devices',
    '设备追踪',
    'published',
    false,
    false,
    timezone('utc', now()) - interval '3 day'
  ),
  (
    'developer-conversations-now-focus-on-permissions-and-input',
    '开发者观察：讨论重点正在转向权限、输入和媒体能力',
    '比起单纯问有没有 SDK，更重要的是搞清楚摄像头、麦克风、安装路径和输入链路是否真正可用。',
    '很多开发者在看 AR / AI 眼镜平台时，第一反应是找 SDK。'
      || E'\n\n'
      || '但真正进入实现阶段后，最先撞到的问题通常不是文档，而是权限、安装链路、输入方式和系统限制。'
      || E'\n\n'
      || '如果平台不能稳定处理媒体、通知、前后台切换或持续输入，那么很多看起来“能做”的场景最终都落不了地。',
    'developer',
    '开发者观察',
    'published',
    false,
    false,
    timezone('utc', now()) - interval '4 day'
  ),
  (
    'openglass-community-is-prioritizing-verifiable-coverage',
    'OpenGlass 更新：热点页将优先呈现可验证、可复查的信息整理',
    '对 OpenGlass Hub 来说，热点不只是“快”，还要便于后来者快速建立判断。',
    '热点页的价值不在于把所有消息都堆出来，而在于让后来者能够快速建立判断。'
      || E'\n\n'
      || '因此 OpenGlass Hub 会把设备更新、开发边界、社区讨论和项目进展整理成更适合阅读的信息流，而不是公告墙。'
      || E'\n\n'
      || '这也意味着每条内容都需要尽量做到可验证、可复查，而不是只追求情绪化表达。',
    'openglass',
    'OpenGlass Hub',
    'published',
    false,
    false,
    timezone('utc', now()) - interval '5 day'
  )
on conflict (slug) do nothing;
