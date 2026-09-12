CREATE TABLE `tenant_sequences` (
	`tenant_id` varchar(36) NOT NULL,
	`sequence_type` varchar(64) NOT NULL,
	`current_value` bigint unsigned NOT NULL DEFAULT 0,
	`prefix` varchar(16) NOT NULL DEFAULT '',
	`padding` int NOT NULL DEFAULT 6,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tenant_sequences_tenant_id_sequence_type_pk` PRIMARY KEY(`tenant_id`,`sequence_type`)
);
--> statement-breakpoint
ALTER TABLE `user_units` DROP FOREIGN KEY `user_units_user_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `user_units` DROP FOREIGN KEY `user_units_unit_id_units_id_fk`;
--> statement-breakpoint
ALTER TABLE `user_units` DROP FOREIGN KEY `user_units_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `sessions` DROP FOREIGN KEY `sessions_user_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `sessions` DROP FOREIGN KEY `sessions_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `user_roles` DROP FOREIGN KEY `user_roles_user_id_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `user_roles` DROP FOREIGN KEY `user_roles_role_id_roles_id_fk`;
--> statement-breakpoint
ALTER TABLE `user_roles` DROP FOREIGN KEY `user_roles_tenant_id_tenants_id_fk`;
--> statement-breakpoint
ALTER TABLE `units` ADD CONSTRAINT `uq_units_id_tenant` UNIQUE(`id`,`tenant_id`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `uq_users_id_tenant` UNIQUE(`id`,`tenant_id`);--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `uq_roles_id_tenant` UNIQUE(`id`,`tenant_id`);--> statement-breakpoint
ALTER TABLE `tenant_sequences` ADD CONSTRAINT `tenant_sequences_tenant_id_tenants_id_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_units` ADD CONSTRAINT `fk_user_units_user_tenant` FOREIGN KEY (`user_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_units` ADD CONSTRAINT `fk_user_units_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_user_tenant` FOREIGN KEY (`user_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `fk_user_roles_user_tenant` FOREIGN KEY (`user_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `fk_user_roles_role_tenant` FOREIGN KEY (`role_id`,`tenant_id`) REFERENCES `roles`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;