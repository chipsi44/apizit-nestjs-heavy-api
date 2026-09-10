class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function textField(payload, name) {
  const value = payload?.[name];
  if (
    !payload ||
    Array.isArray(payload) ||
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 5000
  )
    throw new ApiError(`'${name}' must be a nonempty string of at most 5000 characters.`);
  return value;
}
function echo(payload) {
  const message = textField(payload, 'message');
  if (!Number.isSafeInteger(payload.count)) throw new ApiError("'count' must be a safe integer.");
  return { received: { message, count: payload.count } };
}
function item(id, query = 'false') {
  if (typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw new ApiError('Expected a positive safe integer.');
  if (typeof query !== 'string' || !['true', 'false'].includes(query.toLowerCase()))
    throw new ApiError('include_details must be true or false.');
  const result = { item_id: Number(id), include_details: query.toLowerCase() === 'true' };
  if (result.include_details) result.details = `Reference item ${id}`;
  return result;
}
module.exports = { ApiError, textField, echo, item };
