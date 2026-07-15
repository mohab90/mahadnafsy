'use strict';

const { uuidv4 } = require('./id');

/**
 * Creates an automated double-entry journal entry for a payment or refund.
 * @param {Object} conn The database connection (pool or transaction connection)
 * @param {Object} data The entry details
 * @param {string} data.ref_type 'payment' | 'refund'
 * @param {string} data.ref_id The ID of the payment or refund
 * @param {string} data.entry_date The date (YYYY-MM-DD)
 * @param {string} data.description The description of the transaction
 * @param {number} data.amount The transaction amount
 * @param {string} data.currency EGP, USD, etc.
 * @param {string} data.payment_method 'cash', 'bank', 'paymob', 'wallet'
 */
async function createAutomatedJournalEntry(conn, data) {
  try {
    const entryId = uuidv4();
    
    // 1. Insert the main journal entry record
    await conn.query(
      `INSERT INTO journal_entries (id, ref_type, ref_id, entry_date, description)
       VALUES (?, ?, ?, ?, ?)`,
      [entryId, data.ref_type, data.ref_id, data.entry_date || new Date(), data.description]
    );

    // 2. Determine Account Codes based on standard Chart of Accounts
    // Example logic:
    // If it's a payment (income): Debit Cash/Bank (Asset), Credit Course Revenue (Income)
    // If it's a refund: Debit Course Revenue (Income), Credit Cash/Bank (Asset)
    
    let debitAccountCode = '1100'; // Default Cash/Bank (Assets)
    let creditAccountCode = '4100'; // Default Revenue (Income)

    // Adjust debit account based on payment method
    if (data.payment_method?.toLowerCase().includes('paymob')) {
      debitAccountCode = '1120'; // e.g. Payment Gateways Receivable
    } else if (data.payment_method?.toLowerCase().includes('bank')) {
      debitAccountCode = '1110'; // e.g. Bank Account
    }

    if (data.ref_type === 'refund') {
      // Reverse the entry for a refund
      const temp = debitAccountCode;
      debitAccountCode = creditAccountCode;
      creditAccountCode = temp;
    }

    const debitAccountName = debitAccountCode.startsWith('1') ? 'Cash/Bank Assets' : 'Revenue/Sales';
    const creditAccountName = creditAccountCode.startsWith('4') ? 'Course Revenue' : 'Cash/Bank Assets';

    // 3. Insert Debit Line
    await conn.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), entryId, debitAccountCode, debitAccountName, data.amount, 0]
    );

    // 4. Insert Credit Line
    await conn.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), entryId, creditAccountCode, creditAccountName, 0, data.amount]
    );

    return entryId;
  } catch (error) {
    console.error('Failed to create automated journal entry:', error);
    // We don't throw here to avoid blocking the main payment flow, 
    // but in a strict system we might want to throw if in a transaction.
    return null;
  }
}

module.exports = {
  createAutomatedJournalEntry
};
