// Vercel Function: meneruskan semua request ke aplikasi NestJS (hasil `nest build`).
module.exports = require('../dist/serverless').default;
