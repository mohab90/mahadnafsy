-- Foreign keys for the money relations (tier 1). NOT a migration: apply by hand, one relation at a time.
--
-- Why this is not api/migrations/355_*.sql: the migration runner (lib/migrationRunner.js) sends each statement
-- on its own and stops at the first failure, so a migration cannot say "add this key only if the table holds
-- no orphans" - one orphan row would fail the deploy and block every migration after it, and ADD FOREIGN KEY
-- with foreign_key_checks=1 rewrites the table (writes blocked) on payments/orders-sized tables.
--
-- How to use (see docs/FOREIGN_KEYS_PLAN.md):
--   1. Run the read-only audit:   node api/tools/orphan-row-audit.cjs --tier 1
--   2. Apply ONLY the statements below whose relation shows orphans = 0 and types ok.
--   3. Apply in a quiet hour, after a backup. For a big table (payments, orders, installment_entries):
--        SET SESSION foreign_key_checks = 0;   -- skip re-validation; the audit just proved zero orphans
--        ALTER TABLE ... , ALGORITHM=INPLACE, LOCK=NONE;
--        SET SESSION foreign_key_checks = 1;
--      Re-run the audit afterwards; the relation must show 'skipped: already has a foreign key'.
--   4. To undo one:  ALTER TABLE <table> DROP FOREIGN KEY <fk_name>;
--
-- Regenerate this body with:  node api/tools/orphan-row-audit.cjs --emit-sql --tier 1
-- (a unit test keeps this file identical to the generator output)
--

-- accounts_payable_invoices.approval_journal_id>journal_entries
ALTER TABLE `accounts_payable_invoices`
  ADD CONSTRAINT `fk_accounts_payable_invoices_approval_journal_id` FOREIGN KEY (`approval_journal_id`) REFERENCES `journal_entries` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- accounts_payable_payments.journal_entry_id>journal_entries
ALTER TABLE `accounts_payable_payments`
  ADD CONSTRAINT `fk_accounts_payable_payments_journal_entry_id` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- checkout_reminders.order_id>orders
ALTER TABLE `checkout_reminders`
  ADD CONSTRAINT `fk_checkout_reminders_order_id` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- client_item_money.subscriber_id>subscribers
ALTER TABLE `client_item_money`
  ADD CONSTRAINT `fk_client_item_money_subscriber_id` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- crm_commissions.staff_id>staff
ALTER TABLE `crm_commissions`
  ADD CONSTRAINT `fk_crm_commissions_staff_id` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- crm_commissions.payment_id>payments
ALTER TABLE `crm_commissions`
  ADD CONSTRAINT `fk_crm_commissions_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- crm_commissions.rule_id>commission_rules
ALTER TABLE `crm_commissions`
  ADD CONSTRAINT `fk_crm_commissions_rule_id` FOREIGN KEY (`rule_id`) REFERENCES `commission_rules` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- crm_commissions.payroll_run_id>payroll_runs
ALTER TABLE `crm_commissions`
  ADD CONSTRAINT `fk_crm_commissions_payroll_run_id` FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- installment_entries.payment_id>payments
ALTER TABLE `installment_entries`
  ADD CONSTRAINT `fk_installment_entries_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- installment_entries.subscriber_id>subscribers
ALTER TABLE `installment_entries`
  ADD CONSTRAINT `fk_installment_entries_subscriber_id` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- installment_plans.subscriber_id>subscribers
ALTER TABLE `installment_plans`
  ADD CONSTRAINT `fk_installment_plans_subscriber_id` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- installment_plans.payment_id>payments
ALTER TABLE `installment_plans`
  ADD CONSTRAINT `fk_installment_plans_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- installment_plans.course_id>courses
ALTER TABLE `installment_plans`
  ADD CONSTRAINT `fk_installment_plans_course_id` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- installment_plans.bundle_id>bundles
ALTER TABLE `installment_plans`
  ADD CONSTRAINT `fk_installment_plans_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- instructor_fees.staff_id>staff
ALTER TABLE `instructor_fees`
  ADD CONSTRAINT `fk_instructor_fees_staff_id` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- instructor_fees.course_id>courses
ALTER TABLE `instructor_fees`
  ADD CONSTRAINT `fk_instructor_fees_course_id` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- instructor_fees.source_payment_id>payments
ALTER TABLE `instructor_fees`
  ADD CONSTRAINT `fk_instructor_fees_source_payment_id` FOREIGN KEY (`source_payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- instructor_fees.payroll_run_id>payroll_runs
ALTER TABLE `instructor_fees`
  ADD CONSTRAINT `fk_instructor_fees_payroll_run_id` FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- orders.subscriber_id>subscribers
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_subscriber_id` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- orders.course_id>courses
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_course_id` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- orders.bundle_id>bundles
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- orders.staff_id>staff
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_staff_id` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_attempts.proof_id>payment_proofs
ALTER TABLE `payment_attempts`
  ADD CONSTRAINT `fk_payment_attempts_proof_id` FOREIGN KEY (`proof_id`) REFERENCES `payment_proofs` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_attempts.payment_id>payments
ALTER TABLE `payment_attempts`
  ADD CONSTRAINT `fk_payment_attempts_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_intents.subscriber_id>subscribers
ALTER TABLE `payment_intents`
  ADD CONSTRAINT `fk_payment_intents_subscriber_id` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_intents.payment_id>payments
ALTER TABLE `payment_intents`
  ADD CONSTRAINT `fk_payment_intents_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_links.subscriber_id>subscribers
ALTER TABLE `payment_links`
  ADD CONSTRAINT `fk_payment_links_subscriber_id` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_proofs.order_id>orders
ALTER TABLE `payment_proofs`
  ADD CONSTRAINT `fk_payment_proofs_order_id` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_proofs.payment_attempt_id>payment_attempts
ALTER TABLE `payment_proofs`
  ADD CONSTRAINT `fk_payment_proofs_payment_attempt_id` FOREIGN KEY (`payment_attempt_id`) REFERENCES `payment_attempts` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_proofs.course_id>courses
ALTER TABLE `payment_proofs`
  ADD CONSTRAINT `fk_payment_proofs_course_id` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payment_proofs.bundle_id>bundles
ALTER TABLE `payment_proofs`
  ADD CONSTRAINT `fk_payment_proofs_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payments.staff_id>staff
ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_staff_id` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- paymob_order_links.order_id>orders
ALTER TABLE `paymob_order_links`
  ADD CONSTRAINT `fk_paymob_order_links_order_id` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payroll_items.payroll_run_id>payroll_runs
ALTER TABLE `payroll_items`
  ADD CONSTRAINT `fk_payroll_items_payroll_run_id` FOREIGN KEY (`payroll_run_id`) REFERENCES `payroll_runs` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payroll_items.staff_id>staff
ALTER TABLE `payroll_items`
  ADD CONSTRAINT `fk_payroll_items_staff_id` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- refund_requests.subscriber_id>subscribers
ALTER TABLE `refund_requests`
  ADD CONSTRAINT `fk_refund_requests_subscriber_id` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- refund_requests.payment_id>payments
ALTER TABLE `refund_requests`
  ADD CONSTRAINT `fk_refund_requests_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- refunds.payment_id>payments
ALTER TABLE `refunds`
  ADD CONSTRAINT `fk_refunds_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- refunds.subscriber_id>subscribers
ALTER TABLE `refunds`
  ADD CONSTRAINT `fk_refunds_subscriber_id` FOREIGN KEY (`subscriber_id`) REFERENCES `subscribers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- salary_advances.staff_id>staff
ALTER TABLE `salary_advances`
  ADD CONSTRAINT `fk_salary_advances_staff_id` FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- salary_advances.journal_entry_id>journal_entries
ALTER TABLE `salary_advances`
  ADD CONSTRAINT `fk_salary_advances_journal_entry_id` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- box_withdrawals.journal_entry_id>journal_entries
ALTER TABLE `box_withdrawals`
  ADD CONSTRAINT `fk_box_withdrawals_journal_entry_id` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- incoming_transfers.payment_id>payments
ALTER TABLE `incoming_transfers`
  ADD CONSTRAINT `fk_incoming_transfers_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- subscriber_requests.payment_id>payments
ALTER TABLE `subscriber_requests`
  ADD CONSTRAINT `fk_subscriber_requests_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- bonus_adjustments.payment_id>payments
ALTER TABLE `bonus_adjustments`
  ADD CONSTRAINT `fk_bonus_adjustments_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- orders.linked_transfer_id>incoming_transfers
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_linked_transfer_id` FOREIGN KEY (`linked_transfer_id`) REFERENCES `incoming_transfers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- payments.linked_transfer_id>incoming_transfers
ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_linked_transfer_id` FOREIGN KEY (`linked_transfer_id`) REFERENCES `incoming_transfers` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- installment_entries.plan_id>installment_plans
ALTER TABLE `installment_entries`
  ADD CONSTRAINT `fk_installment_entries_plan_id` FOREIGN KEY (`plan_id`) REFERENCES `installment_plans` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- salary_advances.deducted_payroll_run_id>payroll_runs
ALTER TABLE `salary_advances`
  ADD CONSTRAINT `fk_salary_advances_deducted_payroll_run_id` FOREIGN KEY (`deducted_payroll_run_id`) REFERENCES `payroll_runs` (`id`)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
