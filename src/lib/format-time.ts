export function formatPostTime(createdAt: string | Date, now = new Date()): string {
  const createdDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) {
    return typeof createdAt === "string" ? createdAt : "";
  }

  const diffMs = Math.max(0, now.getTime() - createdDate.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) {
    return "刚刚发布";
  }

  if (diffMinutes < 10) {
    return `${diffMinutes} 分钟前发布`;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(createdDate);
}
