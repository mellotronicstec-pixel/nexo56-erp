CREATE TABLE `cash_sessions` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`financial_account_id` varchar(36) NOT NULL,
	`opened_by` varchar(36) NOT NULL,
	`opened_at` datetime(3) NOT NULL,
	`opening_amount` decimal(14,2) NOT NULL DEFAULT '0',
	`closed_by` varchar(36),
	`closed_at` datetime(3),
	`counted_amount` decimal(14,2),
	`expected_amount` decimal(14,2),
	`difference_amount` decimal(14,2),
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`notes` varchar(300),
	`open_marker` tinyint,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `cash_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cash_session_open` UNIQUE(`financial_account_id`,`open_marker`),
	CONSTRAINT `uq_cash_session_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_cash_session_opening_non_negative` CHECK(`opening_amount` >= 0)
);
--> statement-breakpoint
CREATE TABLE `financial_accounts` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36),
	`name` varchar(120) NOT NULL,
	`name_search` varchar(120) NOT NULL,
	`kind` varchar(20) NOT NULL DEFAULT 'cash',
	`current_balance` decimal(14,2) NOT NULL DEFAULT '0',
	`description` varchar(300),
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `financial_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_fin_account_tenant_name` UNIQUE(`tenant_id`,`name_search`),
	CONSTRAINT `uq_fin_account_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `financial_categories` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`name` varchar(120) NOT NULL,
	`name_search` varchar(120) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `financial_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_fin_category_tenant_kind_name` UNIQUE(`tenant_id`,`kind`,`name_search`),
	CONSTRAINT `uq_fin_category_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `financial_installments` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`title_id` varchar(36) NOT NULL,
	`number` int unsigned NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`settled_amount` decimal(14,2) NOT NULL DEFAULT '0',
	`due_date` varchar(10) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'open',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `financial_installments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_fin_installment_title_number` UNIQUE(`title_id`,`number`),
	CONSTRAINT `uq_fin_installment_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_fin_installment_amount_positive` CHECK(`amount` > 0),
	CONSTRAINT `ck_fin_installment_settled_non_negative` CHECK(`settled_amount` >= 0),
	CONSTRAINT `ck_fin_installment_no_over_settlement` CHECK(`settled_amount` <= `amount`)
);
--> statement-breakpoint
CREATE TABLE `financial_movements` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`financial_account_id` varchar(36) NOT NULL,
	`direction` varchar(12) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`resulting_balance` decimal(14,2) NOT NULL,
	`origin_kind` varchar(24) NOT NULL,
	`settlement_id` varchar(36),
	`reversal_of_movement_id` varchar(36),
	`cash_session_id` varchar(36),
	`reference` varchar(200),
	`effective_date` varchar(10) NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`actor_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `financial_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_fin_movement_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_fin_movement_reversal_of` UNIQUE(`reversal_of_movement_id`),
	CONSTRAINT `ck_fin_movement_amount_positive` CHECK(`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `financial_settlements` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`title_id` varchar(36) NOT NULL,
	`installment_id` varchar(36) NOT NULL,
	`direction` varchar(12) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`effective_date` varchar(10) NOT NULL,
	`financial_account_id` varchar(36) NOT NULL,
	`payment_method_id` varchar(36) NOT NULL,
	`card_installments` int unsigned,
	`reference` varchar(120),
	`notes` varchar(300),
	`cash_session_id` varchar(36),
	`status` varchar(20) NOT NULL DEFAULT 'confirmed',
	`reversed_at` datetime(3),
	`reversed_by` varchar(36),
	`reversal_reason` varchar(300),
	`idempotency_key` varchar(80),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `financial_settlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_fin_settlement_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `uq_fin_settlement_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_fin_settlement_amount_positive` CHECK(`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `financial_title_timeline` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`title_id` varchar(36) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`summary` varchar(300),
	`reason` varchar(300),
	`metadata` json,
	`actor_id` varchar(36),
	`occurred_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `financial_title_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `financial_titles` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`direction` varchar(12) NOT NULL,
	`number` int unsigned NOT NULL,
	`counterparty_kind` varchar(12) NOT NULL,
	`customer_id` varchar(36),
	`supplier_id` varchar(36),
	`payee_name` varchar(200),
	`description` varchar(200) NOT NULL,
	`category_id` varchar(36),
	`origin` varchar(24) NOT NULL DEFAULT 'manual',
	`origin_key` varchar(96),
	`service_order_id` varchar(36),
	`quote_id` varchar(36),
	`purchase_order_id` varchar(36),
	`purchase_receipt_id` varchar(36),
	`amount` decimal(14,2) NOT NULL,
	`settled_amount` decimal(14,2) NOT NULL DEFAULT '0',
	`issued_at` varchar(10) NOT NULL,
	`due_date` varchar(10) NOT NULL,
	`installment_count` int unsigned NOT NULL DEFAULT 1,
	`status` varchar(24) NOT NULL DEFAULT 'open',
	`cancel_reason` varchar(300),
	`cancelled_at` datetime(3),
	`notes` text,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `financial_titles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_fin_title_tenant_direction_number` UNIQUE(`tenant_id`,`direction`,`number`),
	CONSTRAINT `uq_fin_title_origin_key` UNIQUE(`tenant_id`,`origin_key`),
	CONSTRAINT `uq_fin_title_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_fin_title_id_unit` UNIQUE(`id`,`unit_id`),
	CONSTRAINT `ck_fin_title_counterparty_direction` CHECK((`direction` = 'receivable' AND `counterparty_kind` = 'customer')
          OR (`direction` = 'payable' AND `counterparty_kind` IN ('supplier', 'other'))),
	CONSTRAINT `ck_fin_title_amount_positive` CHECK(`amount` > 0),
	CONSTRAINT `ck_fin_title_settled_non_negative` CHECK(`settled_amount` >= 0),
	CONSTRAINT `ck_fin_title_no_over_settlement` CHECK(`settled_amount` <= `amount`),
	CONSTRAINT `ck_fin_title_installments_positive` CHECK(`installment_count` > 0)
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`name` varchar(80) NOT NULL,
	`name_search` varchar(80) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`position` int unsigned NOT NULL DEFAULT 0,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `payment_methods_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_payment_method_tenant_name` UNIQUE(`tenant_id`,`name_search`),
	CONSTRAINT `uq_payment_method_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD CONSTRAINT `fk_cash_session_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD CONSTRAINT `fk_cash_session_account_tenant` FOREIGN KEY (`financial_account_id`,`tenant_id`) REFERENCES `financial_accounts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `cash_sessions` ADD CONSTRAINT `fk_cash_session_opened_by` FOREIGN KEY (`opened_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_accounts` ADD CONSTRAINT `fk_fin_account_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_accounts` ADD CONSTRAINT `fk_fin_account_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_categories` ADD CONSTRAINT `fk_fin_category_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_installments` ADD CONSTRAINT `fk_fin_installment_title_tenant` FOREIGN KEY (`title_id`,`tenant_id`) REFERENCES `financial_titles`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_installments` ADD CONSTRAINT `fk_fin_installment_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_movements` ADD CONSTRAINT `fk_fin_movement_account_tenant` FOREIGN KEY (`financial_account_id`,`tenant_id`) REFERENCES `financial_accounts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_movements` ADD CONSTRAINT `fk_fin_movement_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_movements` ADD CONSTRAINT `fk_fin_movement_settlement_tenant` FOREIGN KEY (`settlement_id`,`tenant_id`) REFERENCES `financial_settlements`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_movements` ADD CONSTRAINT `fk_fin_movement_session_tenant` FOREIGN KEY (`cash_session_id`,`tenant_id`) REFERENCES `cash_sessions`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_settlements` ADD CONSTRAINT `fk_fin_settlement_title_tenant` FOREIGN KEY (`title_id`,`tenant_id`) REFERENCES `financial_titles`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_settlements` ADD CONSTRAINT `fk_fin_settlement_installment_tenant` FOREIGN KEY (`installment_id`,`tenant_id`) REFERENCES `financial_installments`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_settlements` ADD CONSTRAINT `fk_fin_settlement_account_tenant` FOREIGN KEY (`financial_account_id`,`tenant_id`) REFERENCES `financial_accounts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_settlements` ADD CONSTRAINT `fk_fin_settlement_method_tenant` FOREIGN KEY (`payment_method_id`,`tenant_id`) REFERENCES `payment_methods`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_settlements` ADD CONSTRAINT `fk_fin_settlement_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_title_timeline` ADD CONSTRAINT `fk_fin_timeline_title_tenant` FOREIGN KEY (`title_id`,`tenant_id`) REFERENCES `financial_titles`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_titles` ADD CONSTRAINT `fk_fin_title_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_titles` ADD CONSTRAINT `fk_fin_title_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_titles` ADD CONSTRAINT `fk_fin_title_supplier_tenant` FOREIGN KEY (`supplier_id`,`tenant_id`) REFERENCES `suppliers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_titles` ADD CONSTRAINT `fk_fin_title_category_tenant` FOREIGN KEY (`category_id`,`tenant_id`) REFERENCES `financial_categories`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_titles` ADD CONSTRAINT `fk_fin_title_service_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_titles` ADD CONSTRAINT `fk_fin_title_quote_tenant` FOREIGN KEY (`quote_id`,`tenant_id`) REFERENCES `quotes`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_titles` ADD CONSTRAINT `fk_fin_title_purchase_order_unit` FOREIGN KEY (`purchase_order_id`,`unit_id`) REFERENCES `purchase_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `financial_titles` ADD CONSTRAINT `fk_fin_title_purchase_receipt_tenant` FOREIGN KEY (`purchase_receipt_id`,`tenant_id`) REFERENCES `purchase_receipts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payment_methods` ADD CONSTRAINT `fk_payment_method_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_cash_session_unit` ON `cash_sessions` (`tenant_id`,`unit_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_fin_account_tenant_status` ON `financial_accounts` (`tenant_id`,`status`,`kind`);--> statement-breakpoint
CREATE INDEX `ix_fin_installment_due` ON `financial_installments` (`tenant_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `ix_fin_installment_unit_due` ON `financial_installments` (`tenant_id`,`unit_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `ix_fin_movement_account_date` ON `financial_movements` (`tenant_id`,`financial_account_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `ix_fin_movement_unit_date` ON `financial_movements` (`tenant_id`,`unit_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `ix_fin_movement_session` ON `financial_movements` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `ix_fin_settlement_title` ON `financial_settlements` (`tenant_id`,`title_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_fin_settlement_date` ON `financial_settlements` (`tenant_id`,`unit_id`,`effective_date`,`status`);--> statement-breakpoint
CREATE INDEX `ix_fin_settlement_account` ON `financial_settlements` (`tenant_id`,`financial_account_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `ix_fin_settlement_cash_session` ON `financial_settlements` (`cash_session_id`);--> statement-breakpoint
CREATE INDEX `ix_fin_timeline_title` ON `financial_title_timeline` (`tenant_id`,`title_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_fin_title_unit_direction_status` ON `financial_titles` (`tenant_id`,`unit_id`,`direction`,`status`);--> statement-breakpoint
CREATE INDEX `ix_fin_title_due` ON `financial_titles` (`tenant_id`,`direction`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `ix_fin_title_customer` ON `financial_titles` (`tenant_id`,`customer_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_fin_title_supplier` ON `financial_titles` (`tenant_id`,`supplier_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_fin_title_service_order` ON `financial_titles` (`tenant_id`,`service_order_id`);--> statement-breakpoint
CREATE INDEX `ix_fin_title_purchase_order` ON `financial_titles` (`tenant_id`,`purchase_order_id`);--> statement-breakpoint
CREATE INDEX `ix_payment_method_tenant_status` ON `payment_methods` (`tenant_id`,`status`,`position`);