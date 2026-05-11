const USER_ACCOUNT_STATUSES = ["active", "suspended", "banned", "deactivated"];

const isUserActive = (user) => (user?.accountStatus || "active") === "active";

const buildActiveAccountQuery = (field = "accountStatus") => ({
  $or: [{ [field]: "active" }, { [field]: { $exists: false } }],
});

const getUserStatusErrorMessage = (status = "active") => {
  switch (status) {
    case "suspended":
      return "Your account is suspended. Please contact support.";
    case "banned":
      return "Your account has been banned.";
    case "deactivated":
      return "Your account is deactivated.";
    default:
      return "Your account is not active.";
  }
};

module.exports = {
  buildActiveAccountQuery,
  USER_ACCOUNT_STATUSES,
  getUserStatusErrorMessage,
  isUserActive,
};
