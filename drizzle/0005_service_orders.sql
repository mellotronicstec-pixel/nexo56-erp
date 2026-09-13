CREATE TABLE `service_order_timeline` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`service_order_id` varchar(36) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`summary` varchar(300),
	`metadata` json,
	`actor_id` varchar(36),
	`occurred_at` datetime(3) NOT NULL,
	CONSTRAINT `service_order_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_orders` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`number` int unsigned NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`equipment_id` varchar(36) NOT NULL,
	`intake_id` varchar(36),
	`status` varchar(40) NOT NULL DEFAULT 'awaiting_technical_opinion',
	`customer_report` text NOT NULL,
	`internal_notes` text,
	`opened_at` datetime(3) NOT NULL,
	`idempotency_key` varchar(80),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `service_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_service_order_tenant_number` UNIQUE(`tenant_id`,`number`),
	CONSTRAINT `uq_service_order_intake` UNIQUE(`tenant_id`,`intake_id`),
	CONSTRAINT `uq_service_order_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `uq_service_order_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `equipment_intakes` ADD CONSTRAINT `uq_intake_id_unit` UNIQUE(`id`,`unit_id`);--> statement-breakpoint
ALTER TABLE `service_order_timeline` ADD CONSTRAINT `fk_so_timeline_order_tenant` FOREIGN KEY (`service_order_id`,`tenant_id`) REFERENCES `service_orders`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `service_orders_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `fk_service_order_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `fk_service_order_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `fk_service_order_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `fk_service_order_intake_tenant` FOREIGN KEY (`intake_id`,`tenant_id`) REFERENCES `equipment_intakes`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `fk_service_order_intake_unit` FOREIGN KEY (`intake_id`,`unit_id`) REFERENCES `equipment_intakes`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `service_orders` ADD CONSTRAINT `fk_service_order_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_so_timeline_order_occurred` ON `service_order_timeline` (`service_order_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ix_service_order_tenant_unit_opened` ON `service_orders` (`tenant_id`,`unit_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `ix_service_order_tenant_number` ON `service_orders` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `ix_service_order_tenant_customer` ON `service_orders` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_service_order_tenant_equipment` ON `service_orders` (`tenant_id`,`equipment_id`);--> statement-breakpoint
CREATE INDEX `ix_service_order_tenant_status` ON `service_orders` (`tenant_id`,`status`);