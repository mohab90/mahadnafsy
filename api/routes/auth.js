'use strict';
// Sign-up, sign-in and account routes.
//
// This was one file of 2,100 lines; each concern is a file under
// routes/auth/ now. Their routes are put back on this one router in the order
// they were always matched — the layers copied in, not mounted with
// router.use — so every route sits exactly where it did: the registry, the
// shadowing and authorization checks, and every test that looks a handler up
// on this router see the same flat list.
const { Router } = require('express');

const router = Router();

const PARTS = [
  'registration', 'staffAccounts', 'session', 'whatsappLogin',
  'passwordReset', 'profile', 'adminCredentials', 'refreshAndTwoFactor',
];
for (const part of PARTS) router.stack.push(...require(`./auth/${part}`).stack);

module.exports = router;
