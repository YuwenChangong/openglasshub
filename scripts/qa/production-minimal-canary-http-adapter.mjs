function safeError(code, response) { const error = new Error(code); error.status = response?.status ?? null; return error; }
async function request(baseUrl, path, options = {}) {
  let response;
  try { response = await fetch(`${baseUrl}${path}`, options); }
  catch { const error = new Error("QA_CANARY_NETWORK_AMBIGUOUS"); error.ambiguous = true; throw error; }
  const payload = await response.json().catch(() => null);
  return { response, payload };
}
function exactOne(matches, code) { if (matches.length > 1) throw new Error(code); return matches[0] ?? null; }
export function createProductionMinimalCanaryHttpAdapter({ baseUrl, supabaseUrl, anonKey, accessToken, qaUserId, circleSlug }) {
  const authHeaders = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  async function ownership(postId) {
    const { response, payload } = await request(baseUrl, `/api/forum/posts?ownership_check=${encodeURIComponent(postId)}`, { headers: { authorization: `Bearer ${accessToken}` } });
    return response.ok && payload?.exists === true && payload?.is_author === true;
  }
  async function searchPosts(marker) {
    const { response, payload } = await request(baseUrl, `/api/forum/search?q=${encodeURIComponent(marker)}&type=posts&limit_posts=2`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw safeError("QA_CANARY_POST_RECOVERY_SEARCH_FAILED", response);
    return (payload?.results?.posts ?? []).filter((post) => post?.author?.id === qaUserId && `${post?.title ?? ""} ${post?.excerpt ?? ""}`.includes(marker));
  }
  return {
    async authenticate() {
      const { response, payload } = await request(supabaseUrl, "/auth/v1/user", { headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` } });
      if (!response.ok || payload?.id !== qaUserId) throw safeError("QA_CANARY_AUTHENTICATION_FAILED", response);
      return { id: payload.id };
    },
    async createPost({ marker }) {
      const { response, payload } = await request(baseUrl, "/api/forum/posts", { method: "POST", headers: authHeaders, body: JSON.stringify({ circle_slug: circleSlug, type: "feedback", title: `Temporary automated QA ${marker}`, body: `Temporary automated QA validation ${marker}`, has_media: false }) });
      if (!response.ok || !payload?.post?.id) throw safeError("QA_CANARY_POST_CREATE_FAILED", response);
      return { id: payload.post.id, ownerId: payload.post.author_id, marker };
    },
    async createComment({ marker, postId }) {
      const { response, payload } = await request(baseUrl, "/api/forum/comments", { method: "POST", headers: authHeaders, body: JSON.stringify({ post_id: postId, body: `Temporary automated QA validation ${marker}` }) });
      if (!response.ok || !payload?.comment?.id) throw safeError("QA_CANARY_COMMENT_CREATE_FAILED", response);
      return { id: payload.comment.id, postId: payload.comment.post_id, ownerId: payload.comment.author_id, marker };
    },
    async verifyPost(post) { return post.ownerId === qaUserId && await ownership(post.id) && (await searchPosts(post.marker)).filter((item) => item.id === post.id).length === 1; },
    async verifyComment(comment) { const { response, payload } = await request(baseUrl, `/api/forum/comments?post_id=${encodeURIComponent(comment.postId)}`, { headers: { authorization: `Bearer ${accessToken}` } }); return response.ok && (payload?.comments ?? []).some((row) => row.id === comment.id && row.author_id === qaUserId && row.body?.includes(comment.marker)); },
    async findPostByMarker({ marker }) { return searchPosts(marker).then(async (rows) => Promise.all(rows.map(async (row) => ({ id: row.id, ownerId: qaUserId, marker })))); },
    async findCommentByMarker({ marker, postId }) { const { response, payload } = await request(baseUrl, `/api/forum/comments?post_id=${encodeURIComponent(postId)}`, { headers: { authorization: `Bearer ${accessToken}` } }); if (!response.ok) throw safeError("QA_CANARY_COMMENT_RECOVERY_SEARCH_FAILED", response); const matches = (payload?.comments ?? []).filter((row) => row.author_id === qaUserId && row.body?.includes(marker)).map((row) => ({ id: row.id, ownerId: row.author_id, postId: row.post_id, marker })); return matches; },
    async deleteComment(comment) { if (!(await this.verifyComment(comment))) throw new Error("QA_CANARY_COMMENT_CLEANUP_IDENTITY_MISMATCH"); const { response } = await request(baseUrl, `/api/forum/comments?id=${encodeURIComponent(comment.id)}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } }); if (!response.ok) throw safeError("QA_CANARY_COMMENT_DELETE_FAILED", response); },
    async deletePost(post) { if (!(await this.verifyPost(post))) throw new Error("QA_CANARY_POST_CLEANUP_IDENTITY_MISMATCH"); const { response } = await request(baseUrl, `/api/forum/posts?id=${encodeURIComponent(post.id)}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } }); if (!response.ok) throw safeError("QA_CANARY_POST_DELETE_FAILED", response); },
    async verifyCommentAbsent(comment) { const { response, payload } = await request(baseUrl, `/api/forum/comments?post_id=${encodeURIComponent(comment.postId)}`, { headers: { authorization: `Bearer ${accessToken}` } }); return response.status === 404 || (response.ok && !(payload?.comments ?? []).some((row) => row.id === comment.id || row.body?.includes(comment.marker))); },
    async verifyPostAbsent(post) { return (await searchPosts(post.marker)).length === 0; },
    async verifyResidue({ markers }) { return { ok: (await searchPosts(markers.post)).length === 0 }; },
  };
}
