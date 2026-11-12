// Protected Vercel Cron endpoint; Authorization is checked in shared handler.
module.exports = (req, res) => require('../../lib/vercel-direct')('/api/ultralytics/sync', req, res);
