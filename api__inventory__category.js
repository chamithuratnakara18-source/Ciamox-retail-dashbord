// Expose the category update at its exact Vercel URL. The shared handler keeps
// validation, the Firestore transaction, and the audit record in one place.
module.exports = (req, res) => require('../../lib/vercel-direct')('/api/inventory/category', req, res);
