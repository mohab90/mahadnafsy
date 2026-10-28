'use strict';

// One Graph API version for everything that talks to Meta: WhatsApp Cloud API, Messenger, lead ads, page audiences, the Conversions API.
//
// Five files each carried «v19.0», which Meta retired on 21 May 2026 (developers.facebook.com/docs/graph-api/changelog/versions): a call to
// a retired version is not refused, it is answered by whichever version Meta moved it to, so message and template behaviour could change
// under the code without anyone choosing it. v25.0 is supported until July 2028. META_GRAPH_VERSION overrides it, in the form v25.0.
const DEFAULT_VERSION = 'v25.0';
const GRAPH_VERSION = /^v\d+\.\d+$/.test(String(process.env.META_GRAPH_VERSION || '')) ? process.env.META_GRAPH_VERSION : DEFAULT_VERSION;
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

module.exports = { DEFAULT_VERSION, GRAPH_VERSION, GRAPH };
