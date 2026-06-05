export type ForumSearchType = "all" | "posts" | "circles";

export interface ForumSearchPostResult {
  id: string;
  title: string;
  excerpt: string;
  created_at: string;
  type: string | null;
  circle: {
    slug: string | null;
    name: string | null;
  } | null;
  author: {
    username: string | null;
    display_name: string | null;
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
}

export interface ForumSearchResults {
  query: string;
  type: ForumSearchType;
  posts: ForumSearchPostResult[];
  circles: ForumSearchCircleResult[];
}
