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

const serializeComment = (comment) => ({
  id: toId(comment?.id || comment?._id),
  author: serializeAuthor(comment?.author),
  text: typeof comment?.text === "string" ? comment.text : "",
  createdAt: comment?.createdAt || null,
});

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

const serializePost = (post) => {
  const imageUrls = normalizeImageUrls(post);

  return {
    id: toId(post?.id || post?._id),
    author: serializeAuthor(post?.author, post?.author),
    text: typeof post?.text === "string" ? post.text : "",
    imageUrl: imageUrls[0] || "",
    imageUrls,
    likes: Array.isArray(post?.likes) ? post.likes.map((like) => toId(like)) : [],
    comments: Array.isArray(post?.comments)
      ? post.comments.map(serializeComment)
      : [],
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
