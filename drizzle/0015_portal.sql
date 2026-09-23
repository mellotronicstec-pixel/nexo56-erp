CREATE TABLE `portal_identities` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`blocked_reason` varchar(300),
	`blocked_at` datetime(3),
	`blocked_by` varchar(36),
	`first_authenticated_at` datetime(3),
	`last_authenticated_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `portal_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_portal_identity_customer` UNIQUE(`customer_id`),
	CONSTRAINT `uq_portal_identity_id_tenant` UNIQUE(`id`,`tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `portal_login_tokens` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`requested_via` varchar(10) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `portal_login_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_portal_login_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `portal_sessions` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`portal_identity_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`last_used_at` datetime(3) NOT NULL,
	`user_agent_summary` varchar(120),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `portal_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_portal_session_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `portal_identities` ADD CONSTRAINT `fk_portal_identity_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `portal_login_tokens` ADD CONSTRAINT `fk_portal_login_token_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `portal_sessions` ADD CONSTRAINT `fk_portal_session_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `portal_sessions` ADD CONSTRAINT `fk_portal_session_identity_tenant` FOREIGN KEY (`portal_identity_id`,`tenant_id`) REFERENCES `portal_identities`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_portal_identity_tenant_status` ON `portal_identities` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_portal_login_token_customer` ON `portal_login_tokens` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_portal_login_token_expires` ON `portal_login_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `ix_portal_session_customer` ON `portal_sessions` (`customer_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `ix_portal_session_identity` ON `portal_sessions` (`portal_identity_id`);