const notFound = (req, _res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

const errorHandler = (error, _req, res, _next) => {
  if (error.code === 11000) {
    return res.status(409).json({
      message: "Duplicate value",
      details: error.keyValue,
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
