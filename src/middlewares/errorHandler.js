const notFound = (req, _res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

const errorHandler = (error, _req, res, _next) => {
  // Log unexpected errors to help diagnose issues in development/staging
  if (!error.statusCode || error.statusCode >= 500) {
    console.error("[error]", error.message, error.stack);
  }

  if (error.code === 11000) {
    const duplicateFields = Object.keys(error.keyPattern || error.keyValue || {});
    if (duplicateFields.includes("email")) {
      return res.status(409).json({ message: "Email already in use" });
    }
    if (duplicateFields.includes("username")) {
      return res.status(409).json({ message: "Username already taken" });
    }
    return res.status(409).json({
      message: "Duplicate value",
      details: error.keyValue,
    });
  }

  if (error.name === "ValidationError") {
    const firstError = Object.values(error.errors || {})[0];
    return res.status(400).json({
      message: firstError?.message || "Validation failed",
    });
  }

  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? "Internal server error" : error.message;

  return res.status(statusCode).json({
    message,
    ...(error.details ? { details: error.details } : {}),
  });
};

module.exports = {
  notFound,
  errorHandler,
};
