CREATE TABLE `part_search_candidates` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`source_type` varchar(20) NOT NULL,
	`title` varchar(200) NOT NULL,
	`part_number` varchar(60),
	`brand` varchar(120),
	`part_id` varchar(36),
	`compatibility_label` varchar(20) NOT NULL,
	`dedupe_key` varchar(160) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `part_search_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_part_search_candidate_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_part_search_candidate_source_type` CHECK(source_type IN ('internal_inventory','purchase_history','external')),
	CONSTRAINT `ck_part_search_candidate_label` CHECK(compatibility_label IN ('confirmada','alta_probabilidade','provavel','nao_verificada','incompativel'))
);
--> statement-breakpoint
CREATE TABLE `part_search_evidence` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`candidate_id` varchar(36) NOT NULL,
	`source` varchar(60) NOT NULL,
	`type` varchar(40) NOT NULL,
	`observed_at` datetime(3) NOT NULL,
	`field` varchar(80),
	`value` varchar(300),
	CONSTRAINT `part_search_evidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `ck_part_search_evidence_type` CHECK(type IN ('exact_part_number','exact_equipment_model','manufacturer_part_mapping','internal_verified_mapping','provider_exact_fit_signal','title_description_mention','explicit_incompatibility','ai_inference'))
);
--> statement-breakpoint
CREATE TABLE `part_search_offers` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`candidate_id` varchar(36) NOT NULL,
	`source_key` varchar(60) NOT NULL,
	`provider_offer_id` varchar(120),
	`seller_name` varchar(160),
	`price` decimal(14,2),
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`availability` varchar(20) NOT NULL,
	`lead_time_days` int,
	`freight` decimal(14,2),
	`total_cost` decimal(14,2),
	`url` varchar(2048),
	`is_historical` tinyint NOT NULL DEFAULT 0,
	`observed_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `part_search_offers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_part_search_offer_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_part_search_offer_availability` CHECK(availability IN ('in_stock','available','unavailable','unknown'))
);
--> statement-breakpoint
CREATE TABLE `part_search_provider_calls` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`provider_key` varchar(60) NOT NULL,
	`status` varchar(20) NOT NULL,
	`result_count` int,
	`error_code` varchar(60),
	`latency_ms` int,
	`requested_at` datetime(3) NOT NULL,
	CONSTRAINT `part_search_provider_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `ck_part_search_provider_call_status` CHECK(status IN ('ok','error','timeout','not_configured'))
);
--> statement-breakpoint
CREATE TABLE `part_search_selections` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`candidate_id` varchar(36) NOT NULL,
	`offer_id` varchar(36),
	`selected_by` varchar(36) NOT NULL,
	`selected_at` datetime(3) NOT NULL,
	`unverified_acknowledged` tinyint NOT NULL DEFAULT 0,
	`purchase_need_id` varchar(36),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	CONSTRAINT `part_search_selections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `part_search_sessions` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`service_order_id` varchar(36),
	`equipment_id` varchar(36),
	`requested_by` varchar(36) NOT NULL,
	`query_term` varchar(200) NOT NULL,
	`query_search_key` varchar(200) NOT NULL,
	`part_number_hint` varchar(60),
	`status` varchar(20) NOT NULL,
	`external_requested` tinyint NOT NULL DEFAULT 0,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `part_search_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_part_search_session_id_tenant` UNIQUE(`id`,`tenant_id`),
	CONSTRAINT `ck_part_search_session_status` CHECK(status IN ('requested','running','completed','partial','failed'))
);
--> statement-breakpoint
ALTER TABLE `part_search_candidates` ADD CONSTRAINT `fk_part_search_candidate_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_candidates` ADD CONSTRAINT `fk_part_search_candidate_session_tenant` FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `part_search_sessions`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_candidates` ADD CONSTRAINT `fk_part_search_candidate_part_tenant` FOREIGN KEY (`part_id`,`tenant_id`) REFERENCES `parts`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_evidence` ADD CONSTRAINT `fk_part_search_evidence_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_evidence` ADD CONSTRAINT `fk_part_search_evidence_candidate_tenant` FOREIGN KEY (`candidate_id`,`tenant_id`) REFERENCES `part_search_candidates`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_offers` ADD CONSTRAINT `fk_part_search_offer_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_offers` ADD CONSTRAINT `fk_part_search_offer_candidate_tenant` FOREIGN KEY (`candidate_id`,`tenant_id`) REFERENCES `part_search_candidates`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_provider_calls` ADD CONSTRAINT `fk_part_search_provider_call_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_provider_calls` ADD CONSTRAINT `fk_part_search_provider_call_session_tenant` FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `part_search_sessions`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_selections` ADD CONSTRAINT `fk_part_search_selection_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_selections` ADD CONSTRAINT `fk_part_search_selection_session_tenant` FOREIGN KEY (`session_id`,`tenant_id`) REFERENCES `part_search_sessions`(`id`,`tenant_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_selections` ADD CONSTRAINT `fk_part_search_selection_candidate_tenant` FOREIGN KEY (`candidate_id`,`tenant_id`) REFERENCES `part_search_candidates`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_selections` ADD CONSTRAINT `fk_part_search_selection_offer_tenant` FOREIGN KEY (`offer_id`,`tenant_id`) REFERENCES `part_search_offers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_selections` ADD CONSTRAINT `fk_part_search_selection_selected_by_tenant` FOREIGN KEY (`selected_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_sessions` ADD CONSTRAINT `fk_part_search_session_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_sessions` ADD CONSTRAINT `fk_part_search_session_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_sessions` ADD CONSTRAINT `fk_part_search_session_order_tenant` FOREIGN KEY (`service_order_id`,`tenant_id`) REFERENCES `service_orders`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_sessions` ADD CONSTRAINT `fk_part_search_session_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_sessions` ADD CONSTRAINT `fk_part_search_session_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `part_search_sessions` ADD CONSTRAINT `fk_part_search_session_requested_by_tenant` FOREIGN KEY (`requested_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_part_search_candidate_session` ON `part_search_candidates` (`tenant_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `ix_part_search_evidence_candidate` ON `part_search_evidence` (`tenant_id`,`candidate_id`);--> statement-breakpoint
CREATE INDEX `ix_part_search_offer_candidate` ON `part_search_offers` (`tenant_id`,`candidate_id`);--> statement-breakpoint
CREATE INDEX `ix_part_search_provider_call_session` ON `part_search_provider_calls` (`tenant_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `ix_part_search_selection_session` ON `part_search_selections` (`tenant_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `ix_part_search_selection_candidate` ON `part_search_selections` (`tenant_id`,`candidate_id`);--> statement-breakpoint
CREATE INDEX `ix_part_search_session_tenant_unit_created` ON `part_search_sessions` (`tenant_id`,`unit_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_part_search_session_order` ON `part_search_sessions` (`tenant_id`,`service_order_id`);