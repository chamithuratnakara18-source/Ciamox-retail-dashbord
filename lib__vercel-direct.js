// Vercel serves files in api/ as functions. Pin the public route here because
// req.url may be rewritten to the function's internal path on deployment.
const handler = require('../api/[...path].js');

module.exports = function direct(route, req, res) {
  const query = new URL(req.url || '/', 'https://retailflow.local').search;
  req.url = route + query;
  return handler(req, res);
};
