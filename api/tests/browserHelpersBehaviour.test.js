'use strict';
/**
 * Small browser helpers called for real (bundled with the admin's esbuild; see support/repo.js `bundle`) — what they answer, not what their source says.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bundle } = require('./support/repo');

const branchCurrency = bundle('admin/lib/branchCurrency.ts');
const images = bundle('shared/img.ts');
const skip = !branchCurrency && 'admin dependencies are not installed here';

test('a payment draft starts in the currency of the client\'s branch: Saudi in riyals, abroad in dollars, everything else in pounds', { skip }, () => {
  const { currencyForBranch } = branchCurrency;
  assert.equal(currencyForBranch('ONLINE_SAUDI'), 'SAR');
  assert.equal(currencyForBranch('online-saudi'), 'SAR', 'spelled with a hyphen or in lower case');
  assert.equal(currencyForBranch('ONLINE_ABROAD'), 'USD');
  assert.equal(currencyForBranch('ONLINE_EGYPT'), 'EGP');
  assert.equal(currencyForBranch('DOKKI'), 'EGP');
  assert.equal(currencyForBranch(null), 'EGP');
  assert.equal(currencyForBranch(''), 'EGP');
});

test('a missing image is no src at all, never an empty one that makes the browser fetch the page again', { skip }, () => {
  const { cdnImg, cdnSrcSet } = images;
  assert.equal(cdnImg('', 300), undefined);
  assert.equal(cdnImg(null, 300), undefined);
  assert.equal(cdnImg(undefined, 300), undefined);
  assert.equal(cdnImg('/uploads/a.png', 300), '/uploads/a.png', 'a relative picture is returned as it is');
  assert.equal(cdnImg('https://top4top.io/x.jpg', 300), '/api/img?src=https%3A%2F%2Ftop4top.io%2Fx.jpg&w=300', 'a big external picture goes through the resize proxy');
  assert.equal(cdnImg('https://example.com/x.jpg', 300), 'https://example.com/x.jpg');
  assert.equal(cdnSrcSet('', [300, 600]), undefined);
});
