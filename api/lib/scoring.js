const { pool } = require('./db');

async function calculateLeadScore(leadId) {
    let orders = 0, carts = 0, messages = 0;
    try {
        const [oRows] = await pool.query('SELECT COUNT(*) as c FROM orders WHERE lead_id = ?', [leadId]);
        orders = Number(oRows[0]?.c) || 0;
    } catch(e) {}
    
    try {
        const [cRows] = await pool.query('SELECT COUNT(*) as c FROM abandoned_carts WHERE lead_id = ?', [leadId]);
        carts = Number(cRows[0]?.c) || 0;
    } catch(e) {}
    
    try {
        const [mRows] = await pool.query('SELECT COUNT(*) as c FROM messages WHERE lead_id = ?', [leadId]);
        messages = Number(mRows[0]?.c) || 0;
    } catch(e) {}

    let interest_score = (orders * 10) + (carts * 5) + (messages * 2);
    let lead_category = 'cold';

    if (interest_score >= 20) {
        lead_category = 'hot';
    } else if (interest_score >= 10) {
        lead_category = 'warm';
    }

    try {
        await pool.query('UPDATE leads SET interest_score = ?, lead_category = ? WHERE id = ?', [interest_score, lead_category, leadId]);
    } catch(e) {}

    return { interest_score, lead_category };
}

module.exports = { calculateLeadScore };
