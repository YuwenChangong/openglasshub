import type { ResolvedLocale } from "../locale.ts";
import { formatPostTime } from "../../format-time.ts";

export const communityMessages = {
  "zh-CN": {
    tabFeed: "动态", feed: "帖子动态", feedDescription: "OpenGlass Hub 论坛公开帖子动态，支持推荐、最新与热门排序。",
    recommended: "推荐", recommendedDescription: "按新鲜度、讨论度和收藏表现综合排序。",
    latest: "最新", latestDescription: "按发布时间倒序查看最新公开帖子。",
    hot: "热门", hotDescription: "聚焦近两周互动更高的公开帖子。",
    newPost: "发帖", page: "第 {page} 页", discuss: "讨论 {name}",
    discussHint: "这里不会自动发帖。你可以先浏览动态，也可以带着设备上下文去发一个新帖子。",
    startPost: "开始发帖", relatedPosts: "查相关帖子", browseCircles: "看看圈子", previous: "上一页", next: "下一页",
    recommendedCircles: "圈子推荐", all: "全部", circleDiscussion: "进入圈子查看当前公开讨论。",
    circles: "圈子", circlesDescription: "OpenGlass Hub 论坛圈子。按话题分类的 AR/AI 眼镜社区讨论。",
    circlesLead: "按品牌、设备与使用场景进入公开讨论，先看内容，再决定去哪里继续聊。",
    backFeed: "返回动态", createCircle: "创建圈子", circlesFailed: "加载圈子失败", noCircles: "暂时还没有公开圈子",
    created: "创建于 {date}", circleNotFound: "圈子未找到", circleNotFoundDetail: "该圈子可能不存在，或者当前还没有公开显示。",
    backCircles: "返回圈子列表", circleDescription: "{name} · OpenGlass Hub 论坛圈子", breadcrumb: "面包屑", home: "首页", forum: "论坛",
    circleCover: "{name} 圈子封面", reportCircle: "举报圈子", circlePosts: "圈子帖子", allFeed: "全部动态", postsFailed: "加载帖子失败",
    noCirclePosts: "该圈子还没有公开帖子", viewAllFeed: "查看全部动态", postNotFound: "帖子未找到",
    postNotFoundDetail: "该帖子可能已被删除、尚未公开，或者当前链接无效。", anonymous: "匿名", member: "社区成员",
    viewProfile: "查看 {name} 的资料", noBody: "此帖子没有正文内容。", comments: "评论", details: "查看详情",
    enterCircle: "进入圈子", circleFallback: "查看这个圈子的公开讨论与后续动态。", publicDiscussion: "公开讨论", circleInitial: "圈",
    postImage: "帖子图片", video: "视频", videoLink: "视频链接", openVideo: "打开视频链接",
    noPosts: "还没有公开帖子", noPostsDetail: "社区刚开始启动时，第一批讨论通常会围绕设备体验、选购求助、开发限制和 Gaze Launcher 建议展开。",
    firstPost: "写第一篇帖子", viewCircles: "查看圈子", deviceExperience: "设备体验", buyingHelp: "选购求助", developmentQuestions: "开发问题", launcherSuggestions: "Gaze Launcher 建议", channels: "论坛频道",
    types: { experience: "体验", question: "提问", review: "评测", dev: "开发", news: "资讯", feedback: "反馈" },
  },
  en: {
    tabFeed: "Feed", feed: "Post Feed", feedDescription: "Public OpenGlass Hub forum posts, sorted by recommended, latest or popular.",
    recommended: "Recommended", recommendedDescription: "Ranked by freshness, discussion and bookmarks.",
    latest: "Latest", latestDescription: "Public posts in reverse publication order.",
    hot: "Popular", hotDescription: "Public posts with more activity in the past two weeks.",
    newPost: "New post", page: "Page {page}", discuss: "Discuss {name}",
    discussHint: "No post is created automatically. Browse the feed or start a new post with this device context.",
    startPost: "Start a post", relatedPosts: "Related posts", browseCircles: "Browse circles", previous: "Previous", next: "Next",
    recommendedCircles: "Suggested circles", all: "All", circleDiscussion: "Enter this circle to view public discussions.",
    circles: "Circles", circlesDescription: "OpenGlass Hub forum circles: AR/AI glasses discussions organized by topic.",
    circlesLead: "Explore public discussions by brand, device and use case before joining the conversation.",
    backFeed: "Back to feed", createCircle: "Create circle", circlesFailed: "Unable to load circles", noCircles: "No public circles yet",
    created: "Created {date}", circleNotFound: "Circle not found", circleNotFoundDetail: "This circle may not exist or may not be public yet.",
    backCircles: "Back to circles", circleDescription: "{name} · OpenGlass Hub forum circle", breadcrumb: "Breadcrumb", home: "Home", forum: "Forum",
    circleCover: "{name} circle cover", reportCircle: "Report circle", circlePosts: "Circle posts", allFeed: "All posts", postsFailed: "Unable to load posts",
    noCirclePosts: "No public posts in this circle yet", viewAllFeed: "View all posts", postNotFound: "Post not found",
    postNotFoundDetail: "This post may have been deleted, may not be public or may have an invalid link.", anonymous: "Anonymous", member: "Community member",
    viewProfile: "View {name}'s profile", noBody: "This post has no body text.", comments: "Comments", details: "View details",
    enterCircle: "Enter circle", circleFallback: "View this circle's public discussions and updates.", publicDiscussion: "Public discussion", circleInitial: "C",
    postImage: "Post image", video: "Video", videoLink: "Video link", openVideo: "Open video link",
    noPosts: "No public posts yet", noPostsDetail: "Early discussions may cover device experiences, buying advice, development constraints and Gaze Launcher suggestions.",
    firstPost: "Write the first post", viewCircles: "View circles", deviceExperience: "Device experiences", buyingHelp: "Buying advice", developmentQuestions: "Development questions", launcherSuggestions: "Gaze Launcher suggestions", channels: "Forum channels",
    types: { experience: "Experience", question: "Question", review: "Review", dev: "Development", news: "News", feedback: "Feedback" },
  },
} as const;

export function formatCommunityPostTime(createdAt: string | Date, locale: ResolvedLocale, now = new Date()): string {
  if (locale === "zh-CN") return formatPostTime(createdAt, now);
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return typeof createdAt === "string" ? createdAt : "";
  const minutes = Math.floor(Math.max(0, now.getTime() - created.getTime()) / 60000);
  if (minutes < 1) return "Just posted";
  if (minutes < 10) return `Posted ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(created);
}
