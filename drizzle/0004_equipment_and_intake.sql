CREATE TABLE `equipment` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`kind` varchar(80) NOT NULL,
	`kind_normalized` varchar(80) NOT NULL,
	`brand` varchar(120),
	`brand_normalized` varchar(120),
	`model` varchar(160),
	`model_normalized` varchar(160),
	`serial` varchar(120),
	`serial_normalized` varchar(120),
	`voltage` enum('v110','v127','v220','bivolt','not_applicable','unknown') NOT NULL DEFAULT 'unknown',
	`notes` text,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`origin_unit_id` varchar(36),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `equipment_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_equipment_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `equipment_intake_accessories` (
	`id` varchar(36) NOT NULL,
	`intake_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`label` varchar(120) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `equipment_intake_accessories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `equipment_intake_conditions` (
	`id` varchar(36) NOT NULL,
	`intake_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`condition_key` varchar(40) NOT NULL,
	`note` varchar(300),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `equipment_intake_conditions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_intake_condition` UNIQUE(`intake_id`,`condition_key`)
);
--> statement-breakpoint
CREATE TABLE `equipment_intakes` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`equipment_id` varchar(36) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`received_by` varchar(36),
	`power_cable` enum('yes','no','not_applicable') NOT NULL DEFAULT 'not_applicable',
	`inspection_notes` text,
	`notes` text,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `equipment_intakes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_intake_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `equipment_label_readings` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`equipment_id` varchar(36),
	`media_id` varchar(36),
	`provider` varchar(60) NOT NULL,
	`status` enum('succeeded','partial','failed','unavailable') NOT NULL,
	`fields` json,
	`confirmed_at` datetime(3),
	`confirmed_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `equipment_label_readings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `equipment_media` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`equipment_id` varchar(36) NOT NULL,
	`intake_id` varchar(36),
	`kind` enum('general','front','back','damage','label','serial','accessory','other') NOT NULL DEFAULT 'general',
	`storage_key` varchar(255) NOT NULL,
	`mime_type` varchar(40) NOT NULL,
	`byte_size` int NOT NULL,
	`width` int,
	`height` int,
	`checksum` varchar(64) NOT NULL,
	`caption` varchar(200),
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `equipment_media_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_media_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `equipment` ADD CONSTRAINT `equipment_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment` ADD CONSTRAINT `equipment_origin_unit_id_units_id_fk` FOREIGN KEY (`origin_unit_id`) REFERENCES `units`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment` ADD CONSTRAINT `fk_equipment_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment_intake_accessories` ADD CONSTRAINT `fk_intake_accessories_intake_tenant` FOREIGN KEY (`intake_id`,`tenant_id`) REFERENCES `equipment_intakes`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment_intake_conditions` ADD CONSTRAINT `fk_intake_conditions_intake_tenant` FOREIGN KEY (`intake_id`,`tenant_id`) REFERENCES `equipment_intakes`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment_intakes` ADD CONSTRAINT `equipment_intakes_received_by_users_id_fk` FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment_intakes` ADD CONSTRAINT `fk_intake_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment_intakes` ADD CONSTRAINT `fk_intake_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment_label_readings` ADD CONSTRAINT `fk_label_reading_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment_media` ADD CONSTRAINT `fk_media_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `equipment_media` ADD CONSTRAINT `fk_media_intake_tenant` FOREIGN KEY (`intake_id`,`tenant_id`) REFERENCES `equipment_intakes`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_equipment_tenant_customer` ON `equipment` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_equipment_tenant_serial` ON `equipment` (`tenant_id`,`serial_normalized`);--> statement-breakpoint
CREATE INDEX `ix_equipment_tenant_brand_model` ON `equipment` (`tenant_id`,`brand_normalized`,`model_normalized`);--> statement-breakpoint
CREATE INDEX `ix_equipment_tenant_kind` ON `equipment` (`tenant_id`,`kind_normalized`);--> statement-breakpoint
CREATE INDEX `ix_equipment_tenant_created` ON `equipment` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_intake_accessories_intake` ON `equipment_intake_accessories` (`intake_id`);--> statement-breakpoint
CREATE INDEX `ix_intake_tenant_unit_received` ON `equipment_intakes` (`tenant_id`,`unit_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `ix_intake_equipment` ON `equipment_intakes` (`equipment_id`);--> statement-breakpoint
CREATE INDEX `ix_label_reading_equipment` ON `equipment_label_readings` (`equipment_id`);--> statement-breakpoint
CREATE INDEX `ix_media_equipment` ON `equipment_media` (`equipment_id`);--> statement-breakpoint
CREATE INDEX `ix_media_intake` ON `equipment_media` (`intake_id`);