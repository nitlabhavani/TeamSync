const ApiError = require("../utils/apiError");

/** validate({ body: zodSchema, params, query }) */
module.exports = (schemas) => (req, res, next) => {
  try {
    for (const key of ["body", "params", "query"]) {
      if (schemas[key]) req[key] = schemas[key].parse(req[key]);
    }
    next();
  } catch (err) {
    next(
      ApiError.badRequest(
        "Validation failed",
        err.errors?.map((e) => `${e.path.join(".")}: ${e.message}`) || undefined
      )
    );
  }
};
