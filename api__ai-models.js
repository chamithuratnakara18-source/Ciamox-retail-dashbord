// Direct Vercel function for camera training.
module.exports = (req, res) => require('../lib/vercel-direct')('/api/ai-models', req, res);
