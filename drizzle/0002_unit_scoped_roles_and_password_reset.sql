CREATE TABLE `password_reset_tokens` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_password_reset_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `user_unit_roles` (
	`user_id` varchar(36) NOT NULL,
	`role_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `user_unit_roles_user_id_role_id_unit_id_pk` PRIMARY KEY(`user_id`,`role_id`,`unit_id`)
);
--> statement-breakpoint
ALTER TABLE `user_units` ADD `created_by` varchar(36);--> statement-breakpoint
ALTER TABLE `users` ADD `created_by` varchar(36);--> statement-breakpoint
ALTER TABLE `users` ADD `updated_by` varchar(36);--> statement-breakpoint
ALTER TABLE `sessions` ADD `user_agent_summary` varchar(120);--> statement-breakpoint
ALTER TABLE `roles` ADD `created_by` varchar(36);--> statement-breakpoint
ALTER TABLE `roles` ADD `updated_by` varchar(36);--> statement-breakpoint
ALTER TABLE `user_roles` ADD `created_by` varchar(36);--> statement-breakpoint
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `fk_password_reset_user_tenant` FOREIGN KEY (`user_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_unit_roles` ADD CONSTRAINT `fk_user_unit_roles_user_tenant` FOREIGN KEY (`user_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_unit_roles` ADD CONSTRAINT `fk_user_unit_roles_role_tenant` FOREIGN KEY (`role_id`,`tenant_id`) REFERENCES `roles`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_unit_roles` ADD CONSTRAINT `fk_user_unit_roles_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_unit_roles` ADD CONSTRAINT `fk_user_unit_roles_membership` FOREIGN KEY (`user_id`,`unit_id`) REFERENCES `user_units`(`user_id`,`unit_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_password_reset_user` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_password_reset_expires` ON `password_reset_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `ix_user_unit_roles_tenant` ON `user_unit_roles` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `ix_user_unit_roles_unit` ON `user_unit_roles` (`unit_id`);--> statement-breakpoint
CREATE INDEX `ix_user_unit_roles_role` ON `user_unit_roles` (`role_id`);