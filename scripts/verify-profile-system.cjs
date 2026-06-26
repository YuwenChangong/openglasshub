const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const srcDir = path.join(rootDir, "src");

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log("  ✓", label);
    return;
  }
  fail += 1;
  failures.push(detail ? `${label}: ${detail}` : label);
  console.log("  ✗", label, detail || "");
}

function read(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(rootDir, relPath));
}

function search(dir, matcher) {
  const hits = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const content = fs.readFileSync(fullPath, "utf8");
      if (matcher(content, fullPath)) {
        hits.push(fullPath.replace(rootDir + path.sep, ""));
      }
    }
  };
  walk(dir);
  return hits;
}

console.log("\n============================================================");
console.log("  OPENGLASS HUB — PROFILE SYSTEM AUDIT");
console.log("============================================================");

const requiredFiles = [
  "src/pages/me/index.astro",
  "src/pages/me/edit.astro",
  "src/pages/u/[username].astro",
  "src/pages/users/[id].astro",
  "src/pages/api/users/me/profile.ts",
  "src/components/profile/MyProfilePage.tsx",
  "src/components/profile/EditProfileForm.tsx",
  "src/lib/profile-data.ts",
  "src/lib/profile-links.ts",
  "src/lib/profile-media.ts",
  "supabase/migrations/20260606_profile_banner_and_storage.sql",
  "supabase/migrations/20260620_lock_profile_role_updates.sql",
  "supabase/tests/profile_role_lockdown.sql",
  "supabase/tests/profile_system_smoke.sql",
];

console.log("\n--- 1. Required files ---");
for (const relPath of requiredFiles) {
  check(`${relPath} exists`, exists(relPath));
}

console.log("\n--- 2. Profile routes ---");
const profileLinks = read("src/lib/profile-links.ts");
check("buildProfileHref prefers username route", profileLinks.includes("return `/u/${encodeURIComponent(username)}/`;"));
check("buildProfileHref falls back to id route", profileLinks.includes("return `/users/${encodeURIComponent(id)}/`;"));

const usernamePage = read("src/pages/u/[username].astro");
check("username route preserves query on canonical redirect", usernamePage.includes("const canonicalUsernameHref = `${canonicalUsernamePath}${Astro.url.search}`;"));
check("username route uses unified profile component", usernamePage.includes("<MyProfilePage client:load"));

const idPage = read("src/pages/users/[id].astro");
check("id route redirects to username route with query preserved", idPage.includes("return Astro.redirect(`/u/${encodeURIComponent(profile.username)}/${Astro.url.search}`);"));

console.log("\n--- 3. Edit profile + media ---");
const editProfile = read("src/components/profile/EditProfileForm.tsx");
check("edit profile supports avatar uploads", editProfile.includes('kind === "avatar" ? "profile-avatars" : "profile-banners"'));
check("edit profile supports new upload size limits", editProfile.includes('kind === "avatar" ? "头像不能超过 5MB。" : "横幅不能超过 8MB。"'));
check(
  "edit profile validates username format",
  editProfile.includes("normalizeUsernameForSave") &&
    editProfile.includes("isValidProfileUsername") &&
    editProfile.includes("主页地址仅支持小写英文、数字、下划线和短横线。"),
);
check("edit profile removes URL preview helper text", !editProfile.includes("保存后地址：") && !editProfile.includes("当前公开主页："));
check("edit profile delays media save until profile save", editProfile.includes("avatar_url: avatarPending.path ?? profile.avatar_url ?? null"));
check("edit profile saves through server API", editProfile.includes('fetch("/api/users/me/profile"'));
check("edit profile does not directly update profiles table", !editProfile.includes('.from("profiles")'));

const profileApi = read("src/pages/api/users/me/profile.ts");
check("profile API rejects forbidden fields", profileApi.includes("PROFILE_FORBIDDEN_FIELD_UPDATE"));
check("profile API defines explicit forbidden fields", profileApi.includes('const FORBIDDEN_PROFILE_FIELDS = ["role", "id", "email", "created_at", "updated_at", "updated_by"]'));

const profileMedia = read("src/lib/profile-media.ts");
check("profile media uses post-media bucket", profileMedia.includes('PROFILE_MEDIA_BUCKET = "post-media"'));
check("profile media signs avatar urls", profileMedia.includes("resolveProfileAvatarUrl"));
check("profile media signs banner urls", profileMedia.includes("resolveProfileBannerUrl"));

console.log("\n--- 4. Own profile tabs ---");
const myProfile = read("src/components/profile/MyProfilePage.tsx");
check("my profile has posts tab", myProfile.includes('posts: "帖子"'));
check("my profile has comments tab", myProfile.includes('comments: "评论"'));
check("my profile has circles tab", myProfile.includes('circles: "创建的圈子"'));
check("my profile has liked tab", myProfile.includes('liked: "我的喜欢"'));
check("my profile has saved tab", myProfile.includes('saved: "我的收藏"'));
check("saved posts are gated by availability", myProfile.includes("const [savedPostsAvailable, setSavedPostsAvailable] = useState(false);"));

console.log("\n--- 5. Public activity rules ---");
const profileData = read("src/lib/profile-data.ts");
check("profile comments only count published parent posts", profileData.includes('.eq("posts.status", "published")'));
check("profile circles only show active/null status", profileData.includes('.or("status.is.null,status.eq.active")'));

console.log("\n--- 6. Author links ---");
const authorLinkFiles = [
  { path: "src/components/community/PostCard.astro", mode: "buildProfileHref" },
  { path: "src/components/forum/CommentsSection.tsx", mode: "buildProfileHref" },
  { path: "src/components/forum/CircleOwnerDashboard.tsx", mode: "buildProfileHref" },
  { path: "src/components/admin/AdminCirclesDashboard.tsx", mode: "buildProfileHref" },
  { path: "src/pages/search/index.astro", mode: "searchAuthorLink" },
];
for (const entry of authorLinkFiles) {
  const content = read(entry.path);
  if (entry.mode === "buildProfileHref") {
    check(`${entry.path} uses buildProfileHref`, content.includes("buildProfileHref"));
  } else if (entry.mode === "postcardAuthorProps") {
    check(
      `${entry.path} passes authorId and authorUsername`,
      content.includes("authorId={post.author?.id ?? undefined}") &&
        content.includes("authorUsername={post.author?.username ?? undefined}"),
    );
  } else {
    check(
      `${entry.path} keeps searchable author profile links`,
      content.includes("post.author?.href") && content.includes("post.author.display_name || post.author.username"),
    );
  }
}

console.log("\n--- 7. Safety ---");
const emailExposureDirs = [
  path.join(srcDir, "components"),
  path.join(srcDir, "pages"),
];
const emailHits = emailExposureDirs.flatMap((dir) =>
  search(dir, (content, fullPath) => {
    if (fullPath.includes(`${path.sep}api${path.sep}`)) return false;
    return content.includes("user.email");
  }),
);
check("no user.email exposure in UI routes/components", emailHits.length === 0, emailHits.join(", "));

const promptHits = search(srcDir, (content) =>
  content.includes("window.confirm") ||
  content.includes("window.alert") ||
  content.includes("window.prompt"),
);
check("no native confirm/alert/prompt in src", promptHits.length === 0, promptHits.join(", "));

const serviceRoleHits = search(srcDir, (content) => content.includes("SUPABASE_SERVICE_ROLE_KEY"));
check("no service role usage in src", serviceRoleHits.length === 0, serviceRoleHits.join(", "));

const roleLockMigration = read("supabase/migrations/20260620_lock_profile_role_updates.sql");
check("role lockdown migration revokes broad profile updates", /revoke update on table public\.profiles from authenticated;/i.test(roleLockMigration));
check("role lockdown migration adds role trigger", /create trigger trg_profiles_prevent_role_change/i.test(roleLockMigration));

console.log("\n============================================================");
console.log(`  PASS: ${pass}`);
console.log(`  FAIL: ${fail}`);
if (failures.length > 0) {
  console.log("\n  Failures:");
  for (const failure of failures) {
    console.log("   -", failure);
  }
  process.exitCode = 1;
} else {
  console.log("\n  Profile system static audit passed.");
}
console.log("============================================================");
