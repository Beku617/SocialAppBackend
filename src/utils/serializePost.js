const toId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return "";
};

const uniqueNonEmptyStrings = (values) => {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });

  return result;
};

const normalizeImageUrls = (post) =>
  uniqueNonEmptyStrings([
    ...(Array.isArray(post?.imageUrls) ? post.imageUrls : []),
    post?.imageUrl || "",
  ]);

const serializeAuthor = (author, fallbackId = "") => ({
  id: toId(author?.id || author?._id || fallbackId),
  name:
    typeof author?.name === "string" && author.name.trim()
      ? author.name.trim()
      : "Unknown user",
  avatarUrl:
    typeof author?.avatarUrl === "string" ? author.avatarUrl.trim() : "",
});

const arrayHasUser = (values, userId) =>
  Array.isArray(values) &&
  values.some((value) => toId(value) === String(userId || ""));

const serializeComment = (comment, currentUserId = "") => ({
  id: toId(comment?.id || comment?._id),
  author: serializeAuthor(comment?.author),
  text: typeof comment?.text === "string" ? comment.text : "",
  createdAt: comment?.createdAt || null,
  parentCommentId: toId(comment?.parentComment),
  repliedToUserId: toId(comment?.repliedToUser),
  repliedToUsername:
    typeof comment?.repliedToUsername === "string"
      ? comment.repliedToUsername
      : "",
  likesCount: Array.isArray(comment?.likes) ? comment.likes.length : 0,
  likedByMe: arrayHasUser(comment?.likes, currentUserId),
  replies: [],
});

const buildCommentTree = (comments, currentUserId = "") => {
  if (!Array.isArray(comments) || comments.length === 0) return [];

  const mapped = comments.map((comment) =>
    serializeComment(comment, currentUserId),
  );
  const byId = new Map();
  const roots = [];

  mapped.forEach((comment) => {
    byId.set(comment.id, comment);
  });

  mapped.forEach((comment) => {
    const parentId = comment.parentCommentId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).replies.push(comment);
      return;
    }
    roots.push(comment);
  });

  return roots;
};

const serializeSharedPost = (post) => {
  if (!post) return null;
  const imageUrls = normalizeImageUrls(post);

  return {
    id: toId(post?.id || post?._id),
    author: serializeAuthor(post?.author, post?.author),
    text: typeof post?.text === "string" ? post.text : "",
    imageUrl: imageUrls[0] || "",
    imageUrls,
    visibility:
      typeof post?.visibility === "string" ? post.visibility : "public",
    createdAt: post?.createdAt || null,
  };
};

const serializePost = (post, currentUserId = "") => {
  const imageUrls = normalizeImageUrls(post);

  return {
    id: toId(post?.id || post?._id),
    author: serializeAuthor(post?.author, post?.author),
    text: typeof post?.text === "string" ? post.text : "",
    imageUrl: imageUrls[0] || "",
    imageUrls,
    likes: Array.isArray(post?.likes) ? post.likes.map((like) => toId(like)) : [],
    comments: buildCommentTree(post?.comments, currentUserId),
    visibility:
      typeof post?.visibility === "string" ? post.visibility : "public",
    sharedPost: serializeSharedPost(post?.sharedPost),
    notificationsEnabled:
      typeof post?.notificationsEnabled === "boolean"
        ? post.notificationsEnabled
        : true,
    createdAt: post?.createdAt || null,
    updatedAt: post?.updatedAt || null,
  };
};

module.exports = {
  normalizeImageUrls,
  serializePost,
};
