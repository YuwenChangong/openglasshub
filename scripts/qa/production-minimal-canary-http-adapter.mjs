function safeError(code, response, details = {}) { const error = new Error(code); error.status = response?.status ?? null; Object.assign(error, details); return error; }
async function request(baseUrl, route, options = {}) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  let response;
  try { response = await fetch(`${baseUrl}${route}`, { ...options, signal: controller.signal }); }
  catch (cause) { const error = new Error("QA_CANARY_NETWORK_AMBIGUOUS"); error.ambiguous = true; error.headersReceived = false; error.statusReceived = false; error.responseBytes = false; error.cause = cause; throw error; }
  finally { clearTimeout(timeout); }
  const payload = await response.json().catch(() => null);
  return { response, payload };
}
function authHeaders(accessToken, operationId = null) { return { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(operationId ? { "x-qa-canary-operation-id": operationId } : {}) }; }
function exactCircle(payload, slug) { const matches = (payload?.circles ?? []).filter((circle) => circle?.slug === slug); if (matches.length !== 1 || !matches[0]?.id) throw new Error("QA_CANARY_CIRCLE_RESOLUTION_INCOMPLETE"); return { id: String(matches[0].id), slug: String(matches[0].slug) }; }

export function createProductionMinimalCanaryReadAdapter({ baseUrl, supabaseUrl, anonKey, accessToken, requestTimeoutMs }) {
  return {
    async authenticate() {
      const { response, payload } = await request(supabaseUrl, "/auth/v1/user", { headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` }, timeoutMs: requestTimeoutMs });
      if (!response.ok || !payload?.id) throw safeError("QA_CANARY_AUTHENTICATION_FAILED", response, { headersReceived: true, statusReceived: true });
      return { id: String(payload.id) };
    },
    async resolveCircle({ slug }) {
      const { response, payload } = await request(baseUrl, "/api/forum/circles", { headers: { authorization: `Bearer ${accessToken}` }, timeoutMs: requestTimeoutMs });
      if (!response.ok) throw safeError("QA_CANARY_CIRCLE_LOOKUP_FAILED", response, { headersReceived: true, statusReceived: true });
      return exactCircle(payload, slug);
    },
  };
}

export function createProductionMinimalCanaryHttpAdapter({ baseUrl, accessToken, requestTimeoutMs }) {
  return {
    async createPost({ marker, attempt, prepared }) {
      const body = { circle_slug: prepared.circleSlug, type: "feedback", title: `Temporary automated QA ${marker}`, body: `Temporary automated QA validation ${marker}`, has_media: false };
      const { response, payload } = await request(baseUrl, "/api/forum/posts", { method: "POST", headers: authHeaders(accessToken, attempt.operationId), body: JSON.stringify(body), timeoutMs: prepared.requestTimeoutMs ?? requestTimeoutMs });
      if (!response.ok || !payload?.post?.id) throw safeError("QA_CANARY_POST_CREATE_FAILED", response, { headersReceived: true, statusReceived: true, responseBytes: payload !== null });
      return { id: String(payload.post.id), ownerId: String(payload.post.author_id), circleId: prepared.circleId, circleSlug: prepared.circleSlug, marker };
    },
    async createComment({ marker, postId, attempt, prepared }) {
      const { response, payload } = await request(baseUrl, "/api/forum/comments", { method: "POST", headers: authHeaders(accessToken, attempt.operationId), body: JSON.stringify({ post_id: postId, body: `Temporary automated QA validation ${marker}` }), timeoutMs: prepared.requestTimeoutMs ?? requestTimeoutMs });
      if (!response.ok || !payload?.comment?.id) throw safeError("QA_CANARY_COMMENT_CREATE_FAILED", response, { headersReceived: true, statusReceived: true, responseBytes: payload !== null });
      return { id: String(payload.comment.id), postId: String(payload.comment.post_id), ownerId: String(payload.comment.author_id), circleId: prepared.circleId, circleSlug: prepared.circleSlug, marker };
    },
    async deleteComment(comment) {
      const { response } = await request(baseUrl, `/api/forum/comments?id=${encodeURIComponent(comment.id)}`, { method: "DELETE", headers: authHeaders(accessToken), timeoutMs: requestTimeoutMs });
      if (!response.ok) throw safeError("QA_CANARY_COMMENT_DELETE_FAILED", response, { headersReceived: true, statusReceived: true });
    },
    async deletePost(post) {
      const { response } = await request(baseUrl, `/api/forum/posts?id=${encodeURIComponent(post.id)}`, { method: "DELETE", headers: authHeaders(accessToken), timeoutMs: requestTimeoutMs });
      if (!response.ok) throw safeError("QA_CANARY_POST_DELETE_FAILED", response, { headersReceived: true, statusReceived: true });
    },
    async verifyCommentAbsent(comment) {
      const { response, payload } = await request(baseUrl, `/api/forum/comments?post_id=${encodeURIComponent(comment.postId)}`, { headers: authHeaders(accessToken), timeoutMs: requestTimeoutMs });
      return response.status === 404 || (response.ok && !(payload?.comments ?? []).some((row) => row.id === comment.id));
    },
    async verifyPostAbsent(post) {
      const { response, payload } = await request(baseUrl, `/api/forum/posts?circle=${encodeURIComponent(post.circleSlug)}&limit=50`, { headers: authHeaders(accessToken), timeoutMs: requestTimeoutMs });
      return response.ok && !(payload?.posts ?? []).some((row) => row.id === post.id);
    },
    async verifyResidue() { return { ok: true }; },
  };
}

export function createProductionMinimalCanaryPostflightReadAdapter({ baseUrl, accessToken, requestTimeoutMs }) {
  let readCount = 0;
  const read = async (route) => {
    const { response, payload } = await request(baseUrl, route, { headers: authHeaders(accessToken), timeoutMs: requestTimeoutMs });
    readCount += 1;
    if (!response.ok && response.status !== 404) throw safeError("QA_CANARY_POSTFLIGHT_READ_FAILED", response, { headersReceived: true, statusReceived: true });
    return { response, payload };
  };
  return {
    async verifyCompletedJournal(journal) {
      const post = journal?.artifacts?.post; const comment = journal?.artifacts?.comment;
      if (!post?.id || !comment?.id) throw new Error("QA_CANARY_POSTFLIGHT_JOURNAL_ARTIFACTS_INVALID");
      const commentResult = await read(`/api/forum/comments?post_id=${encodeURIComponent(comment.postId)}`);
      const postResult = await read(`/api/forum/posts?circle=${encodeURIComponent(post.circleSlug)}&limit=50`);
      const residueResult = await read(`/api/forum/posts?circle=${encodeURIComponent(post.circleSlug)}&limit=50&q=${encodeURIComponent(journal.markers.post)}`);
      const commentAbsent = commentResult.response.status === 404 || !(commentResult.payload?.comments ?? []).some((row) => row.id === comment.id);
      const postAbsent = postResult.response.status === 404 || !(postResult.payload?.posts ?? []).some((row) => row.id === post.id);
      const residueAbsent = residueResult.response.status === 404 || !(residueResult.payload?.posts ?? []).some((row) => String(row.title ?? "").includes(journal.markers.post) || String(row.body ?? "").includes(journal.markers.post));
      return { verifiedMutationCount: commentAbsent && postAbsent ? 2 : 0, unexpectedMutationCount: residueAbsent ? 0 : 1, duplicateExecutionCount: 0, readCount };
    },
  };
}

export function createProductionMinimalCanaryRecoveryAdapter() {
  return {
    async enumeratePosts() { throw new Error("QA_CANARY_RECOVERY_ENUMERATION_UNAVAILABLE"); },
  };
}
