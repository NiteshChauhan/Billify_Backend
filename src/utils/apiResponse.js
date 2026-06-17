exports.successResponse = (res, statusCode, message, data = null, meta = null) => {
  const payload = { success: true, message };
  if (data !== null) payload.data = data;
  if (meta !== null) payload.meta = meta;
  return res.status(statusCode).json(payload);
};

exports.errorResponse = (res, statusCode, message, code = null) => {
  const payload = { success: false, message };
  if (code) payload.code = code;
  return res.status(statusCode).json(payload);
};
