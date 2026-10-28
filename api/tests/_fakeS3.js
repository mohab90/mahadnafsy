'use strict';

// A tiny S3 stand-in for the storage tests: PUT, HEAD, GET and DELETE of
// objects in memory, path-style. Like S3 it re-computes the request signature
// and refuses a body whose SHA-256 is not the one declared, so a client that
// signs or hashes wrongly fails here as it would against R2.

const http = require('node:http');
const crypto = require('node:crypto');
const { signRequest } = require('../lib/s3Signature');

function startFakeS3({ bucket = 'test-bucket', credentials, region = 'auto', port = 0 } = {}) {
  const objects = new Map();
  const log = [];
  const faults = { failPuts: 0, corruptPuts: 0 };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const [, bucketName, ...rest] = url.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      log.push({ method: req.method, key, presigned: url.searchParams.has('X-Amz-Signature') });
      const refuse = (status, code) => { res.writeHead(status, { 'content-type': 'application/xml' }); res.end(`<Error><Code>${code}</Code></Error>`); };
      if (bucketName !== bucket) return refuse(404, 'NoSuchBucket');

      if (url.searchParams.has('X-Amz-Signature')) {
        if (req.method !== 'GET') return refuse(403, 'SignatureDoesNotMatch');
      } else {
        const auth = String(req.headers.authorization || '');
        const signedNames = (/SignedHeaders=([^,]+)/.exec(auth)?.[1] || '').split(';');
        const headers = {};
        for (const name of signedNames) if (!['host', 'x-amz-content-sha256', 'x-amz-date'].includes(name)) headers[name] = req.headers[name];
        const payloadHash = req.headers['x-amz-content-sha256'];
        const date = new Date(String(req.headers['x-amz-date']).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
        const expected = signRequest({ method: req.method, url: url.toString(), headers, payloadHash, credentials, region, date });
        if (expected.authorization !== auth) return refuse(403, 'SignatureDoesNotMatch');
        if (req.method === 'PUT' && crypto.createHash('sha256').update(body).digest('hex') !== payloadHash) return refuse(400, 'XAmzContentSHA256Mismatch');
        if (req.method === 'PUT' && req.headers['transfer-encoding']) return refuse(411, 'MissingContentLength');
      }

      if (req.method === 'PUT') {
        if (faults.failPuts > 0) { faults.failPuts -= 1; return refuse(503, 'SlowDown'); }
        let stored = body;
        // A store that lost bytes after acknowledging — what verification is for.
        if (faults.corruptPuts > 0) { faults.corruptPuts -= 1; stored = body.subarray(0, Math.max(0, body.length - 1)); }
        objects.set(key, { body: stored, contentType: req.headers['content-type'], sha256: req.headers['x-amz-meta-sha256'] });
        res.writeHead(200, { etag: '"x"' });
        return res.end();
      }
      const object = objects.get(key);
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (!object) return refuse(404, 'NoSuchKey');
      const headers = { 'content-length': String(object.body.length), 'content-type': object.contentType || 'application/octet-stream' };
      if (object.sha256) headers['x-amz-meta-sha256'] = object.sha256;
      if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
      if (req.method === 'GET') { res.writeHead(200, headers); return res.end(object.body); }
      return refuse(405, 'MethodNotAllowed');
    });
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    resolve({
      endpoint, bucket, objects, log, faults,
      close: () => new Promise(done => server.close(done)),
    });
  }));
}

module.exports = { startFakeS3 };
