'use strict';
const logger = require('./logger');
const { pool } = require('./db');

// Helper: enqueue all steps for a sequence for a given recipient
async function enqueueEmailSequence(triggerEvent, recipientEmail, recipientName, triggerTime) {
  try {
    const [seqs] = await pool.query(
      'SELECT s.id FROM email_sequences s WHERE s.trigger_event=? AND s.is_active=1', [triggerEvent]
    );
    for (const seq of seqs) {
      const [steps] = await pool.query(
        'SELECT id, delay_hours FROM email_sequence_steps WHERE sequence_id=? ORDER BY step_order', [seq.id]
      );
      for (const step of steps) {
        const sendAt = new Date((triggerTime || Date.now()) + Number(step.delay_hours) * 3600000);
        // Skip if already queued for this recipient+step
        const [[existing]] = await pool.query(
          'SELECT id FROM email_sequence_queue WHERE step_id=? AND recipient_email=? LIMIT 1',
          [step.id, recipientEmail.toLowerCase()]
        );
        if (existing) continue;
        await pool.query(
          'INSERT INTO email_sequence_queue (id, step_id, recipient_email, recipient_name, scheduled_at) VALUES (UUID(),?,?,?,?)',
          [step.id, recipientEmail.toLowerCase(), recipientName || null, sendAt]
        );
      }
    }
  } catch (e) { logger.warn('[email-seq] enqueue error:', e.message); }
}

module.exports = { enqueueEmailSequence };
