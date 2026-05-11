const { isAdminUser } = require("./admin");
const { buildActiveAccountQuery, isUserActive } = require("./userAccountStatus");

const buildVisibleAppUserQuery = () => ({
  role: "user",
  ...buildActiveAccountQuery(),
});

const buildVisibleAuthorPopulate = (path, select = "name avatarUrl role accountStatus") => ({
  path,
  select,
  match: buildVisibleAppUserQuery(),
});

const isVisibleAppUser = (user) => Boolean(user) && !isAdminUser(user) && isUserActive(user);

const toPlainObject = (value) => {
  if (!value || typeof value !== "object") return value;
  if (typeof value.toObject === "function") {
    return value.toObject();
  }
  return value;
};

const filterVisibleMentions = (mentions = []) =>
  (Array.isArray(mentions) ? mentions : [])
    .map((mention) => toPlainObject(mention))
    .filter((mention) => isVisibleAppUser(toPlainObject(mention?.user)));

const filterVisibleEmbeddedComments = (comments = []) =>
  (Array.isArray(comments) ? comments : [])
    .map((comment) => toPlainObject(comment))
    .filter((comment) => isVisibleAppUser(toPlainObject(comment?.author)))
    .map((comment) => {
      const mentions = filterVisibleMentions(comment?.mentions || []);
      return {
        ...comment,
        mentions,
      };
    });

const isVisibleUserId = async (UserModel, userId) => {
  const exists = await UserModel.exists({
    _id: userId,
    ...buildVisibleAppUserQuery(),
  });

  return Boolean(exists);
};

module.exports = {
  buildVisibleAppUserQuery,
  buildVisibleAuthorPopulate,
  filterVisibleEmbeddedComments,
  filterVisibleMentions,
  isVisibleAppUser,
  isVisibleUserId,
};
