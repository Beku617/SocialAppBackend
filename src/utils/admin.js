const isAdminUser = (user) => Boolean(user && user.role === "admin");

module.exports = {
  isAdminUser,
};
