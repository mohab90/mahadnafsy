'use strict';

const multer = require('multer');

function assertS3Configured() {
  const required = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`S3 upload is not configured. Missing: ${missing.join(', ')}`);
  }
}

function createS3Upload(options = {}) {
  assertS3Configured();

  const { S3Client } = require('@aws-sdk/client-s3');
  const multerS3 = require('multer-s3');
  const s3Config = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  return multer({
    storage: multerS3({
      s3: s3Config,
      bucket: process.env.AWS_S3_BUCKET_NAME,
      acl: options.acl || 'private',
      metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
      key: (req, file, cb) => {
        const safeName = String(file.originalname || 'upload').replace(/[^\w.-]+/g, '-');
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${options.prefix || 'uploads'}/${uniqueSuffix}-${safeName}`);
      },
    }),
    limits: { fileSize: options.fileSize || 5 * 1024 * 1024 },
  });
}

module.exports = {
  createS3Upload,
  get uploadS3() {
    return createS3Upload();
  },
};
