'use strict';

// The rules of a message from the administration to the employees (routes/staff-announcements.js): what a pop-up may carry,
// who it is for, and which of them an employee still has to see.

const MAX_IMAGES = 4;
const STYLES = ['info', 'urgent', 'celebrate'];

/** A picture the pop-up may draw: https, or one of our own uploads. */
const safeImageUrl = raw => {
  const value = String(raw || '').trim().slice(0, 500);
  return /^(https:\/\/|\/uploads\/)[^\s"'<>]+$/i.test(value) ? value : '';
};

/**
 * A video the pop-up may play, kept as the address the person pasted once it is known to be one: a YouTube or Vimeo link or a
 * direct video file. The page turns it into a player (shared/siteOffers.ts popupVideo — the same rule, here so a pop-up
 * cannot be saved with an address the page would refuse).
 */
const safeVideoUrl = raw => {
  const value = String(raw || '').trim().slice(0, 500);
  if (!value) return '';
  if (/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{11}(?![A-Za-z0-9_-])/i.test(value)) return value;
  if (/^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?\d{6,12}(?!\d)/i.test(value)) return value;
  if (/^(https:\/\/[^\s?#]+|\/uploads\/[^\s?#]+)\.(mp4|webm|mov|m4v)(\?[^\s#]*)?$/i.test(value)) return value;
  return '';
};

const cleanImages = list => (Array.isArray(list) ? list : []).map(safeImageUrl).filter(Boolean).slice(0, MAX_IMAGES);

const cleanRoles = list => [...new Set((Array.isArray(list) ? list : [])
  .map(role => String(role || '').trim().toUpperCase())
  .filter(role => /^[A-Z][A-Z0-9_]{1,40}$/.test(role)))].slice(0, 40);

/** Who sees it: no roles named = every employee. */
const reachesRole = (audienceRoles, role) => {
  const roles = String(audienceRoles || '').split(',').map(item => item.trim().toUpperCase()).filter(Boolean);
  return roles.length === 0 || roles.includes(String(role || '').toUpperCase());
};

const parseImages = text => {
  try { const list = JSON.parse(text || '[]'); return Array.isArray(list) ? list.map(safeImageUrl).filter(Boolean) : []; } catch { return []; }
};

const shape = row => ({
  id: row.id,
  title: row.title,
  body: row.body || '',
  images: parseImages(row.image_urls),
  videoUrl: row.video_url || '',
  style: STYLES.includes(row.style) ? row.style : 'info',
  roles: String(row.audience_roles || '').split(',').map(item => item.trim()).filter(Boolean),
  expiresAt: row.expires_at || null,
  createdAt: row.created_at,
  createdByName: row.created_by_name || '',
});

/**
 * The announcements this employee has not closed yet, newest first. A staff row with no role is shown only what is for everyone.
 * @returns {Promise<object[]>}
 */
async function pendingFor(db, { tenantId, staffId, role }) {
  const [rows] = await db.query(
    `SELECT a.* FROM staff_announcements a
      WHERE a.tenant_id=? AND a.is_active=1 AND (a.expires_at IS NULL OR a.expires_at > NOW())
        AND NOT EXISTS (SELECT 1 FROM staff_announcement_seen s
                         WHERE s.tenant_id=a.tenant_id AND s.announcement_id=a.id AND s.staff_id=?)
      ORDER BY a.created_at DESC LIMIT 20`,
    [tenantId, String(staffId)]);
  return rows.filter(row => reachesRole(row.audience_roles, role)).map(shape);
}

module.exports = { MAX_IMAGES, STYLES, safeImageUrl, safeVideoUrl, cleanImages, cleanRoles, reachesRole, shape, pendingFor };
