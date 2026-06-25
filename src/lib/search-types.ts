export type ForumSearchType = "all" | "posts" | "circles" | "users" | "devices";

export interface ForumSearchPostResult {
  id: string;
  title: string;
  excerpt: string;
  created_at: string;
  type: string | null;
  preview_image_url: string | null;
  has_media: boolean;
  circle: {
    slug: string | null;
    name: string | null;
  } | null;
  author: {
    id: string | null;
    username: string | null;
    display_name: string | null;
    href: string | null;
  } | null;
}

export interface ForumSearchCircleResult {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string | null;
  image_path: string | null;
  status: string | null;
  post_count: number;
}

export interface ForumSearchUserResult {
  id: string;
  username: string | null;
  display_name: string | null;
  href: string | null;
  avatar_url: string | null;
  bio_excerpt: string | null;
  post_count: number;
  circle_count: number;
  created_at: string | null;
}

export interface ForumSearchDeviceResult {
  slug: string;
  href: string;
  name: string;
  brand_name: string;
  type_label: string | null;
  description: string | null;
  release_year: string | null;
}

export interface ForumSearchCounts {
  posts: number;
  circles: number;
  users: number;
  devices: number;
}

export interface ForumSearchResults {
  query: string;
  type: ForumSearchType;
  circle: string | null;
  posts: ForumSearchPostResult[];
  circles: ForumSearchCircleResult[];
  users: ForumSearchUserResult[];
  devices: ForumSearchDeviceResult[];
  counts: ForumSearchCounts;
}
