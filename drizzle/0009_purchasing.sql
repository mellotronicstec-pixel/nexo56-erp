CREATE TABLE `purchase_needs` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`quantity` decimal(14,4) NOT NULL,
	`ordered_quantity` decimal(14,4) NOT NULL DEFAULT '0',
	`received_quantity` decimal(14,4) NOT NULL DEFAULT '0',
	`origin` varchar(20) NOT NULL DEFAULT 'manual',
	`service_order_id` varchar(36),
	`justification` varchar(400),
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `purchase_needs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_need_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_need_quantity_positive` CHECK(`quantity` > 0),
	CONSTRAINT `ck_need_ordered_non_negative` CHECK(`ordered_quantity` >= 0),
	CONSTRAINT `ck_need_received_non_negative` CHECK(`received_quantity` >= 0)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_items` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`purchase_order_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`description` varchar(200) NOT NULL,
	`supplier_code` varchar(60),
	`unit_of_measure` varchar(20) NOT NULL,
	`quantity` decimal(14,4) NOT NULL,
	`received_quantity` decimal(14,4) NOT NULL DEFAULT '0',
	`unit_cost` decimal(14,2) NOT NULL,
	`total` decimal(14,2) NOT NULL,
	`purchase_need_id` varchar(36),
	`notes` varchar(300),
	`position` int unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `purchase_order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_purchase_item_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_purchase_item_quantity_positive` CHECK(`quantity` > 0),
	CONSTRAINT `ck_purchase_item_received_non_negative` CHECK(`received_quantity` >= 0),
	CONSTRAINT `ck_purchase_item_no_over_receipt` CHECK(`received_quantity` <= `quantity`),
	CONSTRAINT `ck_purchase_item_cost_non_negative` CHECK(`unit_cost` >= 0)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_timeline` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`purchase_order_id` varchar(36) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`summary` varchar(300),
	`metadata` json,
	`reason` varchar(300),
	`actor_id` varchar(36),
	`occurred_at` datetime(3) NOT NULL,
	CONSTRAINT `purchase_order_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`supplier_id` varchar(36) NOT NULL,
	`number` int unsigned NOT NULL,
	`status` varchar(30) NOT NULL DEFAULT 'draft',
	`approved_at` datetime(3),
	`approved_by` varchar(36),
	`placed_at` datetime(3),
	`placed_by` varchar(36),
	`expected_at` varchar(10),
	`cancelled_at` datetime(3),
	`cancel_reason` varchar(300),
	`subtotal` decimal(14,2) NOT NULL,
	`discount` decimal(14,2) NOT NULL,
	`freight` decimal(14,2) NOT NULL,
	`other_costs` decimal(14,2) NOT NULL,
	`total` decimal(14,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`document_number` varchar(60),
	`document_date` varchar(10),
	`internal_notes` text,
	`supplier_notes` text,
	`version` int unsigned NOT NULL DEFAULT 1,
	`idempotency_key` varchar(80),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `purchase_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_purchase_order_tenant_number` UNIQUE(`tenant_id`,`number`),
	CONSTRAINT `uq_purchase_order_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `uq_purchase_order_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_purchase_order_id_unit` UNIQUE(`id`,`unit_id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_price_history` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`supplier_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`purchase_order_id` varchar(36) NOT NULL,
	`purchase_receipt_id` varchar(36) NOT NULL,
	`quantity` decimal(14,4) NOT NULL,
	`unit_cost` decimal(14,2) NOT NULL,
	`total_cost` decimal(14,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`observed_lead_time_days` int unsigned,
	`occurred_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `purchase_price_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_receipt_items` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`purchase_receipt_id` varchar(36) NOT NULL,
	`purchase_order_item_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`quantity` decimal(14,4) NOT NULL,
	`unit_cost` decimal(14,2) NOT NULL,
	`total_cost` decimal(14,2) NOT NULL,
	`location_id` varchar(36),
	`unit_id` varchar(36) NOT NULL,
	`stock_movement_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `purchase_receipt_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_receipt_item_movement` UNIQUE(`stock_movement_id`),
	CONSTRAINT `ck_receipt_item_quantity_positive` CHECK(`quantity` > 0)
);
--> statement-breakpoint
CREATE TABLE `purchase_receipts` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`purchase_order_id` varchar(36) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`document_number` varchar(60),
	`document_date` varchar(10),
	`notes` varchar(300),
	`idempotency_key` varchar(80),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `purchase_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_receipt_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `uq_receipt_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `supplier_contacts` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`supplier_id` varchar(36) NOT NULL,
	`role` varchar(20) NOT NULL DEFAULT 'commercial',
	`name` varchar(120) NOT NULL,
	`email` varchar(190),
	`phone` varchar(40),
	`phone_digits` varchar(20),
	`notes` varchar(300),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `supplier_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supplier_parts` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`supplier_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`supplier_code` varchar(60),
	`supplier_code_normalized` varchar(60),
	`supplier_description` varchar(200),
	`last_unit_cost` decimal(14,2),
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`last_purchased_at` datetime(3),
	`lead_time_days` int unsigned,
	`minimum_quantity` decimal(14,4),
	`reference_url` varchar(300),
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `supplier_parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_supplier_part` UNIQUE(`supplier_id`,`part_id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`kind` varchar(20) NOT NULL DEFAULT 'company',
	`name` varchar(200) NOT NULL,
	`name_search` varchar(200) NOT NULL,
	`trade_name` varchar(200),
	`trade_name_search` varchar(200),
	`document_type` varchar(8),
	`document_digits` varchar(14),
	`state_registration` varchar(32),
	`email` varchar(190),
	`phone` varchar(40),
	`phone_digits` varchar(20),
	`phone_is_whatsapp` int unsigned NOT NULL DEFAULT 0,
	`website` varchar(200),
	`zip_code` varchar(8),
	`street` varchar(200),
	`address_number` varchar(20),
	`complement` varchar(120),
	`district` varchar(120),
	`city` varchar(120),
	`state` varchar(2),
	`lead_time_days` int unsigned,
	`commercial_terms` varchar(400),
	`notes` text,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_supplier_tenant_document` UNIQUE(`tenant_id`,`document_digits`),
	CONSTRAINT `uq_supplier_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `uq_stock_movement_id_tenant` UNIQUE(`id`,`tenant_id`);--> statement-breakpoint
ALTER TABLE `purchase_needs` ADD CONSTRAINT `fk_need_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_needs` ADD CONSTRAINT `fk_need_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_needs` ADD CONSTRAINT `fk_need_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `fk_purchase_item_order_tenant` FOREIGN KEY (`purchase_order_id`,`tenant_id`) REFERENCES `purchase_orders`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `fk_purchase_item_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `fk_purchase_item_need_tenant` FOREIGN KEY (`purchase_need_id`,`tenant_id`) REFERENCES `purchase_needs`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_order_timeline` ADD CONSTRAINT `fk_purchase_timeline_order_tenant` FOREIGN KEY (`purchase_order_id`,`tenant_id`) REFERENCES `purchase_orders`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `fk_purchase_order_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `fk_purchase_order_supplier_tenant` FOREIGN KEY (`supplier_id`,`tenant_id`) REFERENCES `suppliers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `fk_purchase_order_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_price_history` ADD CONSTRAINT `fk_price_history_supplier_tenant` FOREIGN KEY (`supplier_id`,`tenant_id`) REFERENCES `suppliers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_price_history` ADD CONSTRAINT `fk_price_history_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_receipt_items` ADD CONSTRAINT `fk_receipt_item_receipt_tenant` FOREIGN KEY (`purchase_receipt_id`,`tenant_id`) REFERENCES `purchase_receipts`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_receipt_items` ADD CONSTRAINT `fk_receipt_item_order_item_tenant` FOREIGN KEY (`purchase_order_item_id`,`tenant_id`) REFERENCES `purchase_order_items`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_receipt_items` ADD CONSTRAINT `fk_receipt_item_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_receipt_items` ADD CONSTRAINT `fk_receipt_item_location_unit` FOREIGN KEY (`location_id`,`unit_id`) REFERENCES `stock_locations`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_receipt_items` ADD CONSTRAINT `fk_receipt_item_movement_tenant` FOREIGN KEY (`stock_movement_id`,`tenant_id`) REFERENCES `stock_movements`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_receipts` ADD CONSTRAINT `fk_receipt_order_tenant` FOREIGN KEY (`purchase_order_id`,`tenant_id`) REFERENCES `purchase_orders`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_receipts` ADD CONSTRAINT `fk_receipt_order_unit` FOREIGN KEY (`purchase_order_id`,`unit_id`) REFERENCES `purchase_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `purchase_receipts` ADD CONSTRAINT `fk_receipt_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `supplier_contacts` ADD CONSTRAINT `fk_supplier_contact_supplier_tenant` FOREIGN KEY (`supplier_id`,`tenant_id`) REFERENCES `suppliers`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `supplier_parts` ADD CONSTRAINT `fk_supplier_part_supplier_tenant` FOREIGN KEY (`supplier_id`,`tenant_id`) REFERENCES `suppliers`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `supplier_parts` ADD CONSTRAINT `fk_supplier_part_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `suppliers` ADD CONSTRAINT `fk_supplier_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_need_unit_status` ON `purchase_needs` (`tenant_id`,`unit_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_need_part` ON `purchase_needs` (`tenant_id`,`part_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_need_order` ON `purchase_needs` (`tenant_id`,`service_order_id`);--> statement-breakpoint
CREATE INDEX `ix_purchase_item_order` ON `purchase_order_items` (`purchase_order_id`,`position`);--> statement-breakpoint
CREATE INDEX `ix_purchase_item_part` ON `purchase_order_items` (`tenant_id`,`part_id`);--> statement-breakpoint
CREATE INDEX `ix_purchase_item_need` ON `purchase_order_items` (`tenant_id`,`purchase_need_id`);--> statement-breakpoint
CREATE INDEX `ix_purchase_timeline_order` ON `purchase_order_timeline` (`purchase_order_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_purchase_order_unit_status` ON `purchase_orders` (`tenant_id`,`unit_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_purchase_order_supplier` ON `purchase_orders` (`tenant_id`,`supplier_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_purchase_order_tenant_number` ON `purchase_orders` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `ix_purchase_order_tenant_created` ON `purchase_orders` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_price_history_part` ON `purchase_price_history` (`tenant_id`,`part_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_price_history_supplier` ON `purchase_price_history` (`tenant_id`,`supplier_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_receipt_item_receipt` ON `purchase_receipt_items` (`purchase_receipt_id`);--> statement-breakpoint
CREATE INDEX `ix_receipt_item_order_item` ON `purchase_receipt_items` (`purchase_order_item_id`);--> statement-breakpoint
CREATE INDEX `ix_receipt_order` ON `purchase_receipts` (`purchase_order_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `ix_receipt_unit` ON `purchase_receipts` (`tenant_id`,`unit_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `ix_supplier_contact_supplier` ON `supplier_contacts` (`supplier_id`,`role`);--> statement-breakpoint
CREATE INDEX `ix_supplier_part_part` ON `supplier_parts` (`tenant_id`,`part_id`);--> statement-breakpoint
CREATE INDEX `ix_supplier_part_code` ON `supplier_parts` (`tenant_id`,`supplier_code_normalized`);--> statement-breakpoint
CREATE INDEX `ix_supplier_tenant_name` ON `suppliers` (`tenant_id`,`name_search`);--> statement-breakpoint
CREATE INDEX `ix_supplier_tenant_status` ON `suppliers` (`tenant_id`,`status`,`name_search`);--> statement-breakpoint
CREATE INDEX `ix_supplier_tenant_trade_name` ON `suppliers` (`tenant_id`,`trade_name_search`);--> statement-breakpoint
CREATE INDEX `ix_supplier_tenant_phone` ON `suppliers` (`tenant_id`,`phone_digits`);