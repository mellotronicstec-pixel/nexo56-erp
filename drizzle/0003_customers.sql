CREATE TABLE `customer_addresses` (
	`id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`label` varchar(80),
	`zip_code` varchar(8),
	`street` varchar(200),
	`number` varchar(20),
	`complement` varchar(120),
	`district` varchar(120),
	`city` varchar(120),
	`state` varchar(2),
	`country` varchar(2) NOT NULL DEFAULT 'BR',
	`is_primary` boolean NOT NULL DEFAULT false,
	`primary_marker` tinyint,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `customer_addresses_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customer_addresses_primary` UNIQUE(`customer_id`,`primary_marker`)
);
--> statement-breakpoint
CREATE TABLE `customer_contacts` (
	`id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`type` enum('phone','email') NOT NULL,
	`value` varchar(190) NOT NULL,
	`value_normalized` varchar(190) NOT NULL,
	`is_whatsapp` boolean NOT NULL DEFAULT false,
	`label` varchar(80),
	`is_primary` boolean NOT NULL DEFAULT false,
	`primary_marker` tinyint,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `customer_contacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customer_contacts_primary` UNIQUE(`customer_id`,`primary_marker`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`kind` enum('individual','company') NOT NULL,
	`name` varchar(200) NOT NULL,
	`name_normalized` varchar(200) NOT NULL,
	`trade_name` varchar(200),
	`trade_name_normalized` varchar(200),
	`document_type` enum('cpf','cnpj'),
	`document_digits` varchar(14),
	`state_registration` varchar(32),
	`birth_date` varchar(10),
	`notes` text,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`origin_unit_id` varchar(36),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_customers_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `uq_customers_tenant_document` UNIQUE(`tenant_id`,`document_digits`)
);
--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD CONSTRAINT `fk_customer_addresses_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `customer_contacts` ADD CONSTRAINT `fk_customer_contacts_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `customers_origin_unit_id_units_id_fk` FOREIGN KEY (`origin_unit_id`) REFERENCES `units`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_customer_addresses_customer` ON `customer_addresses` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_customer_contacts_customer` ON `customer_contacts` (`customer_id`);--> statement-breakpoint
CREATE INDEX `ix_customer_contacts_tenant_value` ON `customer_contacts` (`tenant_id`,`value_normalized`);--> statement-breakpoint
CREATE INDEX `ix_customers_tenant_name` ON `customers` (`tenant_id`,`name_normalized`);--> statement-breakpoint
CREATE INDEX `ix_customers_tenant_trade_name` ON `customers` (`tenant_id`,`trade_name_normalized`);--> statement-breakpoint
CREATE INDEX `ix_customers_tenant_status` ON `customers` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_customers_tenant_kind` ON `customers` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE INDEX `ix_customers_tenant_updated` ON `customers` (`tenant_id`,`updated_at`);