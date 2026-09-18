CREATE TABLE `warranties` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`number` int unsigned NOT NULL,
	`type` varchar(20) NOT NULL,
	`policy_id` varchar(36),
	`customer_id` varchar(36) NOT NULL,
	`equipment_id` varchar(36) NOT NULL,
	`service_order_id` varchar(36),
	`duration_amount` int unsigned NOT NULL,
	`duration_unit` varchar(10) NOT NULL,
	`coverage_summary` text,
	`exclusions` text,
	`terms` text,
	`covers_whole_service` tinyint NOT NULL DEFAULT 1,
	`starts_on` varchar(10) NOT NULL,
	`ends_on` varchar(10) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`manufacturer` varchar(160),
	`external_reference` varchar(120),
	`part_id` varchar(36),
	`part_description` varchar(200),
	`part_code` varchar(60),
	`part_quantity` decimal(14,4),
	`installed_on` varchar(10),
	`stock_movement_id` varchar(36),
	`supplier_id` varchar(36),
	`notes` text,
	`idempotency_key` varchar(120),
	`activated_at` datetime(3),
	`activated_by` varchar(36),
	`cancelled_at` datetime(3),
	`cancel_reason` text,
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `warranties_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_warranty_tenant_number` UNIQUE(`tenant_id`,`number`),
	CONSTRAINT `uq_warranty_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `uq_warranty_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_warranty_period_ordered` CHECK(`warranties`.`starts_on` <= `warranties`.`ends_on`),
	CONSTRAINT `ck_warranty_duration_positive` CHECK(`warranties`.`duration_amount` >= 1 AND `warranties`.`duration_amount` <= 120)
);
--> statement-breakpoint
CREATE TABLE `warranty_certificates` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`warranty_id` varchar(36) NOT NULL,
	`token` varchar(64) NOT NULL,
	`format` varchar(10) NOT NULL DEFAULT 'html',
	`snapshot` text NOT NULL,
	`checksum` varchar(64) NOT NULL,
	`issued_at` datetime(3) NOT NULL,
	`issued_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `warranty_certificates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_warranty_certificate_warranty` UNIQUE(`warranty_id`),
	CONSTRAINT `uq_warranty_certificate_token` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `warranty_costs` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`warranty_id` varchar(36) NOT NULL,
	`warranty_return_id` varchar(36),
	`service_order_id` varchar(36),
	`kind` varchar(20) NOT NULL,
	`description` varchar(200) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`stock_movement_id` varchar(36),
	`part_id` varchar(36),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `warranty_costs_id` PRIMARY KEY(`id`),
	CONSTRAINT `ck_warranty_cost_non_negative` CHECK(`warranty_costs`.`amount` >= 0)
);
--> statement-breakpoint
CREATE TABLE `warranty_coverage_items` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`warranty_id` varchar(36) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`description` varchar(200) NOT NULL,
	`part_id` varchar(36),
	`position` int unsigned NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `warranty_coverage_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `warranty_policies` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`name_search` varchar(120) NOT NULL,
	`type` varchar(20) NOT NULL,
	`duration_amount` int unsigned NOT NULL,
	`duration_unit` varchar(10) NOT NULL,
	`coverage_summary` text,
	`exclusions` text,
	`terms` text,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `warranty_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_warranty_policy_tenant_name` UNIQUE(`tenant_id`,`name_search`),
	CONSTRAINT `uq_warranty_policy_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_warranty_policy_duration_positive` CHECK(`warranty_policies`.`duration_amount` >= 1 AND `warranty_policies`.`duration_amount` <= 120)
);
--> statement-breakpoint
CREATE TABLE `warranty_returns` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`warranty_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`equipment_id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`original_service_order_id` varchar(36),
	`return_service_order_id` varchar(36),
	`customer_report` text NOT NULL,
	`reference_date` varchar(10) NOT NULL,
	`coverage_assessment` varchar(20) NOT NULL,
	`assessment_notes` text,
	`was_enforceable` tinyint NOT NULL,
	`idempotency_key` varchar(120),
	`registered_at` datetime(3) NOT NULL,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `warranty_returns_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_warranty_return_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `uq_warranty_return_new_order` UNIQUE(`return_service_order_id`),
	CONSTRAINT `uq_warranty_return_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `warranty_timeline` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`warranty_id` varchar(36) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`summary` varchar(300) NOT NULL,
	`reason` text,
	`actor_id` varchar(36),
	`occurred_at` datetime(3) NOT NULL,
	CONSTRAINT `warranty_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `service_orders` ADD `classification` varchar(30) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `service_orders` ADD `warranty_id` varchar(36);--> statement-breakpoint
ALTER TABLE `service_orders` ADD `original_service_order_id` varchar(36);--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_service_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_uses_policy_tenant` FOREIGN KEY (`policy_id`,`tenant_id`) REFERENCES `warranty_policies`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_movement_tenant` FOREIGN KEY (`stock_movement_id`,`tenant_id`) REFERENCES `stock_movements`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranties` ADD CONSTRAINT `fk_warranty_supplier_tenant` FOREIGN KEY (`supplier_id`,`tenant_id`) REFERENCES `suppliers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD CONSTRAINT `fk_warranty_certificate_warranty_tenant` FOREIGN KEY (`warranty_id`,`tenant_id`) REFERENCES `warranties`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_certificates` ADD CONSTRAINT `fk_warranty_certificate_issued_by` FOREIGN KEY (`issued_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_costs` ADD CONSTRAINT `fk_warranty_cost_warranty_tenant` FOREIGN KEY (`warranty_id`,`tenant_id`) REFERENCES `warranties`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_costs` ADD CONSTRAINT `fk_warranty_cost_return_tenant` FOREIGN KEY (`warranty_return_id`,`tenant_id`) REFERENCES `warranty_returns`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_costs` ADD CONSTRAINT `fk_warranty_cost_order_tenant` FOREIGN KEY (`service_order_id`,`tenant_id`) REFERENCES `service_orders`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_costs` ADD CONSTRAINT `fk_warranty_cost_movement_tenant` FOREIGN KEY (`stock_movement_id`,`tenant_id`) REFERENCES `stock_movements`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_costs` ADD CONSTRAINT `fk_warranty_cost_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_coverage_items` ADD CONSTRAINT `fk_warranty_coverage_warranty_tenant` FOREIGN KEY (`warranty_id`,`tenant_id`) REFERENCES `warranties`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_coverage_items` ADD CONSTRAINT `fk_warranty_coverage_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_policies` ADD CONSTRAINT `fk_warranty_policy_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_returns` ADD CONSTRAINT `fk_warranty_return_warranty_tenant` FOREIGN KEY (`warranty_id`,`tenant_id`) REFERENCES `warranties`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_returns` ADD CONSTRAINT `fk_warranty_return_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_returns` ADD CONSTRAINT `fk_warranty_return_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_returns` ADD CONSTRAINT `fk_warranty_return_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_returns` ADD CONSTRAINT `fk_warranty_return_original_order_tenant` FOREIGN KEY (`original_service_order_id`,`tenant_id`) REFERENCES `service_orders`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_returns` ADD CONSTRAINT `fk_warranty_return_new_order_tenant` FOREIGN KEY (`return_service_order_id`,`tenant_id`) REFERENCES `service_orders`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `warranty_timeline` ADD CONSTRAINT `fk_warranty_timeline_warranty_tenant` FOREIGN KEY (`warranty_id`,`tenant_id`) REFERENCES `warranties`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_warranty_tenant_equipment` ON `warranties` (`tenant_id`,`equipment_id`);--> statement-breakpoint
CREATE INDEX `ix_warranty_tenant_customer` ON `warranties` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_warranty_tenant_service_order` ON `warranties` (`tenant_id`,`service_order_id`);--> statement-breakpoint
CREATE INDEX `ix_warranty_tenant_status_ends` ON `warranties` (`tenant_id`,`status`,`ends_on`);--> statement-breakpoint
CREATE INDEX `ix_warranty_tenant_type` ON `warranties` (`tenant_id`,`type`);--> statement-breakpoint
CREATE INDEX `ix_warranty_cost_warranty` ON `warranty_costs` (`warranty_id`);--> statement-breakpoint
CREATE INDEX `ix_warranty_cost_tenant_kind` ON `warranty_costs` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE INDEX `ix_warranty_coverage_warranty` ON `warranty_coverage_items` (`warranty_id`,`position`);--> statement-breakpoint
CREATE INDEX `ix_warranty_policy_tenant_type` ON `warranty_policies` (`tenant_id`,`type`,`status`);--> statement-breakpoint
CREATE INDEX `ix_warranty_return_warranty` ON `warranty_returns` (`warranty_id`,`registered_at`);--> statement-breakpoint
CREATE INDEX `ix_warranty_return_tenant_unit` ON `warranty_returns` (`tenant_id`,`unit_id`,`registered_at`);--> statement-breakpoint
CREATE INDEX `ix_warranty_timeline_warranty` ON `warranty_timeline` (`warranty_id`,`occurred_at`);