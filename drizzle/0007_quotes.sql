CREATE TABLE `quote_items` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`quote_id` varchar(36) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`description` varchar(200) NOT NULL,
	`quantity` decimal(14,4) NOT NULL,
	`unit_price` decimal(14,2) NOT NULL,
	`discount` decimal(14,2) NOT NULL,
	`total` decimal(14,2) NOT NULL,
	`position` int unsigned NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `quote_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quote_timeline` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`quote_id` varchar(36) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`summary` varchar(300),
	`metadata` json,
	`reason` varchar(300),
	`actor_id` varchar(36),
	`occurred_at` datetime(3) NOT NULL,
	CONSTRAINT `quote_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`service_order_id` varchar(36) NOT NULL,
	`number` int unsigned NOT NULL,
	`revision` int unsigned NOT NULL DEFAULT 1,
	`supersedes_quote_id` varchar(36),
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`active_marker` tinyint,
	`approved_marker` tinyint,
	`subtotal` decimal(14,2) NOT NULL,
	`discount` decimal(14,2) NOT NULL,
	`total` decimal(14,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`valid_until` varchar(10),
	`customer_notes` text,
	`internal_notes` text,
	`sent_at` datetime(3),
	`sent_by` varchar(36),
	`decided_at` datetime(3),
	`decided_by` varchar(36),
	`decision_source` varchar(40),
	`decision_reason` varchar(300),
	`version` int unsigned NOT NULL DEFAULT 1,
	`idempotency_key` varchar(80),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `quotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_quote_tenant_number_revision` UNIQUE(`tenant_id`,`number`,`revision`),
	CONSTRAINT `uq_quote_active` UNIQUE(`service_order_id`,`active_marker`),
	CONSTRAINT `uq_quote_approved` UNIQUE(`service_order_id`,`approved_marker`),
	CONSTRAINT `uq_quote_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `uq_quote_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `uq_service_order_id_unit` UNIQUE(`id`,`unit_id`);--> statement-breakpoint
ALTER TABLE `quote_items` ADD CONSTRAINT `fk_quote_item_quote_tenant` FOREIGN KEY (`quote_id`,`tenant_id`) REFERENCES `quotes`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quote_timeline` ADD CONSTRAINT `fk_quote_timeline_quote_tenant` FOREIGN KEY (`quote_id`,`tenant_id`) REFERENCES `quotes`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `fk_quote_order_tenant` FOREIGN KEY (`service_order_id`,`tenant_id`) REFERENCES `service_orders`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `fk_quote_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `fk_quote_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `fk_quote_supersedes_tenant` FOREIGN KEY (`supersedes_quote_id`,`tenant_id`) REFERENCES `quotes`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `fk_quote_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `fk_quote_sent_by_tenant` FOREIGN KEY (`sent_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quotes` ADD CONSTRAINT `fk_quote_decided_by_tenant` FOREIGN KEY (`decided_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_quote_item_quote` ON `quote_items` (`quote_id`,`position`);--> statement-breakpoint
CREATE INDEX `ix_quote_timeline_quote` ON `quote_timeline` (`quote_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_quote_order` ON `quotes` (`service_order_id`,`number`,`revision`);--> statement-breakpoint
CREATE INDEX `ix_quote_unit_status` ON `quotes` (`tenant_id`,`unit_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_quote_tenant_number` ON `quotes` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `ix_quote_valid_until` ON `quotes` (`tenant_id`,`status`,`valid_until`);--> statement-breakpoint
CREATE INDEX `ix_quote_tenant_created` ON `quotes` (`tenant_id`,`created_at`);