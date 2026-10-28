'use strict';

// lib/s3Signature.js against the worked examples AWS publishes for S3
// ("Signature Calculations for the Authorization Header" and "Authenticating
// Requests: Using Query Parameters"). Same keys, same date, same expected
// signatures — if any of these drift, every request to the bucket is refused.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMPTY_SHA256, canonicalPath, presignUrl, sha256Hex, signRequest, uriEncode,
} = require('../lib/s3Signature');

const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const date = new Date('2013-05-24T00:00:00Z');
const region = 'us-east-1';
const signatureOf = headers => /Signature=([a-f0-9]{64})$/.exec(headers.authorization)[1];

test('GET object with a Range header (AWS example)', () => {
  const headers = signRequest({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { range: 'bytes=0-9' }, payloadHash: EMPTY_SHA256, credentials, region, date,
  });
  assert.equal(signatureOf(headers), 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.match(headers.authorization, /Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
  assert.equal(headers['x-amz-date'], '20130524T000000Z');
});

test('PUT object with a body, a Date and a storage class (AWS example)', () => {
  const body = 'Welcome to Amazon S3.';
  const payloadHash = sha256Hex(body);
  assert.equal(payloadHash, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const headers = signRequest({
    method: 'PUT', url: 'https://examplebucket.s3.amazonaws.com/test$file.text',
    headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    payloadHash, credentials, region, date,
  });
  assert.equal(signatureOf(headers), '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('GET bucket lifecycle and list objects: sub-resource and query (AWS examples)', () => {
  const lifecycle = signRequest({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?lifecycle', credentials, region, date,
  });
  assert.equal(signatureOf(lifecycle), 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  const list = signRequest({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J', credentials, region, date,
  });
  assert.equal(signatureOf(list), '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('presigned GET (AWS query-string example)', () => {
  const url = presignUrl({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    credentials, region, date, expiresIn: 86400,
  });
  assert.equal(url, 'https://examplebucket.s3.amazonaws.com/test.txt'
    + '?X-Amz-Algorithm=AWS4-HMAC-SHA256'
    + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
    + '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host'
    + '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('a presigned URL is bound to its key, its method and its lifetime', () => {
  const base = { url: 'https://r2.example/bucket/videos/t/a.mp4', credentials, region: 'auto', date, expiresIn: 600 };
  const get = presignUrl({ ...base, method: 'GET' });
  assert.notEqual(get, presignUrl({ ...base, method: 'PUT' }));
  assert.notEqual(get, presignUrl({ ...base, url: 'https://r2.example/bucket/videos/t/b.mp4' }));
  assert.notEqual(get, presignUrl({ ...base, expiresIn: 601 }));
  assert.throws(() => presignUrl({ ...base, expiresIn: 8 * 24 * 3600 }), /7 days/);
  assert.throws(() => presignUrl({ ...base, expiresIn: 0 }), /7 days/);
});

test('keys are encoded the way S3 canonicalises them', () => {
  assert.equal(uriEncode('a b/ç~'), 'a%20b%2F%C3%A7~');
  assert.equal(uriEncode('a b/c', { keepSlash: true }), 'a%20b/c');
  assert.equal(canonicalPath('/bucket/test$file.text'), '/bucket/test%24file.text');
  assert.equal(canonicalPath('/bucket/test%24file.text'), '/bucket/test%24file.text');
});
