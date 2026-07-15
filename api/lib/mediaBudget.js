'use strict';

const DATA_IMAGE_MAX_BYTES = Number(process.env.MAHAD_DATA_IMAGE_MAX_BYTES || 400000);
const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function dataUrlByteLength(value) {
  const comma = value.indexOf(',');
  const payload = comma >= 0 ? value.slice(comma + 1) : value;
  return Math.ceil((payload.length * 3) / 4);
}

function findOversizedDataImages(value, path = '$', findings = []) {
  if (typeof value === 'string') {
    if (DATA_IMAGE_RE.test(value)) {
      const bytes = dataUrlByteLength(value);
      if (bytes > DATA_IMAGE_MAX_BYTES) findings.push({ path, bytes, limit: DATA_IMAGE_MAX_BYTES });
    }
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findOversizedDataImages(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => findOversizedDataImages(item, `${path}.${key}`, findings));
  }
  return findings;
}

function rejectOversizedDataImages(req, res) {
  const findings = findOversizedDataImages(req.body);
  if (findings.length === 0) return false;
  res.status(413).json({
    error: 'Image payload exceeds performance budget',
    code: 'IMAGE_BUDGET_EXCEEDED',
    maxBytes: DATA_IMAGE_MAX_BYTES,
    fields: findings.slice(0, 10),
  });
  return true;
}

module.exports = {
  DATA_IMAGE_MAX_BYTES,
  dataUrlByteLength,
  findOversizedDataImages,
  rejectOversizedDataImages,
};
