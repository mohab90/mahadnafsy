'use strict';
// Shared in-memory online presence map — uid -> { name, email, lastSeen }
// Imported by server.js (cleanup interval), routes/public.js (write), routes/admin.js (read)
const onlineMap = new Map();
module.exports = { onlineMap };
