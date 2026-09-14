CREATE TABLE `parts` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`code` varchar(40) NOT NULL,
	`code_normalized` varchar(40) NOT NULL,
	`name` varchar(120) NOT NULL,
	`name_search` varchar(160) NOT NULL,
	`description` varchar(500),
	`brand` varchar(80),
	`brand_search` varchar(120),
	`part_number` varchar(60),
	`part_number_normalized` varchar(60),
	`barcode` varchar(64),
	`barcode_normalized` varchar(64),
	`unit_of_measure` varchar(20) NOT NULL DEFAULT 'unit',
	`suggested_price` decimal(14,2),
	`notes` text,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `parts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_part_tenant_code` UNIQUE(`tenant_id`,`code_normalized`),
	CONSTRAINT `uq_part_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `stock_balances` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`on_hand` decimal(14,4) NOT NULL DEFAULT '0',
	`reserved` decimal(14,4) NOT NULL DEFAULT '0',
	`minimum_quantity` decimal(14,4) NOT NULL DEFAULT '0',
	`average_cost` decimal(14,2),
	`primary_location_id` varchar(36),
	`low_stock_alerted_at` datetime(3),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `stock_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_balance_unit_part` UNIQUE(`unit_id`,`part_id`),
	CONSTRAINT `ck_stock_balance_on_hand_non_negative` CHECK(`on_hand` >= 0),
	CONSTRAINT `ck_stock_balance_reserved_non_negative` CHECK(`reserved` >= 0),
	CONSTRAINT `ck_stock_balance_reserved_within_on_hand` CHECK(`reserved` <= `on_hand`),
	CONSTRAINT `ck_stock_balance_minimum_non_negative` CHECK(`minimum_quantity` >= 0)
);
--> statement-breakpoint
CREATE TABLE `stock_locations` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`name` varchar(80) NOT NULL,
	`code` varchar(30),
	`code_normalized` varchar(30),
	`description` varchar(300),
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `stock_locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_location_unit_code` UNIQUE(`unit_id`,`code_normalized`),
	CONSTRAINT `uq_stock_location_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_stock_location_id_unit` UNIQUE(`id`,`unit_id`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`location_id` varchar(36),
	`type` varchar(20) NOT NULL,
	`quantity` decimal(14,4) NOT NULL,
	`resulting_on_hand` decimal(14,4) NOT NULL,
	`unit_cost` decimal(14,2),
	`total_cost` decimal(14,2),
	`origin_kind` varchar(20) NOT NULL,
	`reference` varchar(120),
	`reason` varchar(300),
	`service_order_id` varchar(36),
	`transfer_id` varchar(36),
	`reservation_id` varchar(36),
	`idempotency_key` varchar(80),
	`actor_id` varchar(36),
	`occurred_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `stock_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_movement_idempotency` UNIQUE(`tenant_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `stock_reservations` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`service_order_id` varchar(36) NOT NULL,
	`quantity` decimal(14,4) NOT NULL,
	`consumed_quantity` decimal(14,4) NOT NULL DEFAULT '0',
	`released_quantity` decimal(14,4) NOT NULL DEFAULT '0',
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`notes` varchar(300),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `stock_reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_reservation_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_stock_reservation_within_quantity` CHECK(`consumed_quantity` + `released_quantity` <= `quantity`),
	CONSTRAINT `ck_stock_reservation_quantity_positive` CHECK(`quantity` > 0),
	CONSTRAINT `ck_stock_reservation_consumed_non_negative` CHECK(`consumed_quantity` >= 0),
	CONSTRAINT `ck_stock_reservation_released_non_negative` CHECK(`released_quantity` >= 0)
);
--> statement-breakpoint
CREATE TABLE `stock_transfers` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`number` int unsigned NOT NULL,
	`from_unit_id` varchar(36) NOT NULL,
	`to_unit_id` varchar(36) NOT NULL,
	`part_id` varchar(36) NOT NULL,
	`quantity` decimal(14,4) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'completed',
	`notes` varchar(300),
	`idempotency_key` varchar(80),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `stock_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_transfer_tenant_number` UNIQUE(`tenant_id`,`number`),
	CONSTRAINT `uq_stock_transfer_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `ck_stock_transfer_quantity_positive` CHECK(`quantity` > 0)
);
--> statement-breakpoint
ALTER TABLE `quote_items` ADD `part_id` varchar(36);--> statement-breakpoint
ALTER TABLE `parts` ADD CONSTRAINT `parts_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `parts` ADD CONSTRAINT `fk_part_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_balances` ADD CONSTRAINT `fk_stock_balance_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_balances` ADD CONSTRAINT `fk_stock_balance_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_balances` ADD CONSTRAINT `fk_stock_balance_location_unit` FOREIGN KEY (`primary_location_id`,`unit_id`) REFERENCES `stock_locations`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_locations` ADD CONSTRAINT `fk_stock_location_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movement_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movement_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movement_location_unit` FOREIGN KEY (`location_id`,`unit_id`) REFERENCES `stock_locations`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movement_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD CONSTRAINT `fk_stock_movement_actor_tenant` FOREIGN KEY (`actor_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_reservations` ADD CONSTRAINT `fk_stock_reservation_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_reservations` ADD CONSTRAINT `fk_stock_reservation_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_reservations` ADD CONSTRAINT `fk_stock_reservation_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `fk_stock_transfer_from_unit_tenant` FOREIGN KEY (`from_unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `fk_stock_transfer_to_unit_tenant` FOREIGN KEY (`to_unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `fk_stock_transfer_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `fk_stock_transfer_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_part_tenant_name` ON `parts` (`tenant_id`,`name_search`);--> statement-breakpoint
CREATE INDEX `ix_part_tenant_status` ON `parts` (`tenant_id`,`status`,`name_search`);--> statement-breakpoint
CREATE INDEX `ix_part_tenant_part_number` ON `parts` (`tenant_id`,`part_number_normalized`);--> statement-breakpoint
CREATE INDEX `ix_part_tenant_barcode` ON `parts` (`tenant_id`,`barcode_normalized`);--> statement-breakpoint
CREATE INDEX `ix_part_tenant_brand` ON `parts` (`tenant_id`,`brand_search`);--> statement-breakpoint
CREATE INDEX `ix_stock_balance_unit` ON `stock_balances` (`tenant_id`,`unit_id`,`part_id`);--> statement-breakpoint
CREATE INDEX `ix_stock_balance_low_stock` ON `stock_balances` (`tenant_id`,`unit_id`,`minimum_quantity`);--> statement-breakpoint
CREATE INDEX `ix_stock_location_unit` ON `stock_locations` (`tenant_id`,`unit_id`,`status`,`name`);--> statement-breakpoint
CREATE INDEX `ix_stock_movement_part` ON `stock_movements` (`tenant_id`,`unit_id`,`part_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_stock_movement_order` ON `stock_movements` (`tenant_id`,`service_order_id`);--> statement-breakpoint
CREATE INDEX `ix_stock_movement_transfer` ON `stock_movements` (`transfer_id`);--> statement-breakpoint
CREATE INDEX `ix_stock_movement_unit_occurred` ON `stock_movements` (`tenant_id`,`unit_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_stock_reservation_order` ON `stock_reservations` (`tenant_id`,`service_order_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_stock_reservation_part` ON `stock_reservations` (`tenant_id`,`unit_id`,`part_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_stock_transfer_from` ON `stock_transfers` (`tenant_id`,`from_unit_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_stock_transfer_to` ON `stock_transfers` (`tenant_id`,`to_unit_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_stock_transfer_part` ON `stock_transfers` (`tenant_id`,`part_id`);--> statement-breakpoint
ALTER TABLE `quote_items` ADD CONSTRAINT `fk_quote_item_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_quote_item_part` ON `quote_items` (`tenant_id`,`part_id`);