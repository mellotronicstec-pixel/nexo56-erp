CREATE TABLE `agenda_appointments` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`title` varchar(160) NOT NULL,
	`notes` text,
	`status` varchar(20) NOT NULL DEFAULT 'scheduled',
	`all_day` tinyint NOT NULL DEFAULT 0,
	`start_at` datetime(3),
	`end_at` datetime(3),
	`start_date` varchar(10),
	`end_date` varchar(10),
	`assignee_id` varchar(36),
	`created_by` varchar(36),
	`service_order_id` varchar(36),
	`customer_id` varchar(36),
	`equipment_id` varchar(36),
	`warranty_id` varchar(36),
	`cancelled_at` datetime(3),
	`cancelled_by` varchar(36),
	`cancel_reason` varchar(300),
	`idempotency_key` varchar(120),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `agenda_appointments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_agenda_appt_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `ck_agenda_appt_status` CHECK(status IN ('scheduled','cancelled')),
	CONSTRAINT `ck_agenda_appt_period` CHECK(end_at IS NULL OR start_at IS NULL OR end_at > start_at),
	CONSTRAINT `ck_agenda_appt_all_day_period` CHECK(end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
--> statement-breakpoint
CREATE TABLE `agenda_tasks` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`unit_id` varchar(36) NOT NULL,
	`title` varchar(160) NOT NULL,
	`notes` text,
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`priority` varchar(10) NOT NULL DEFAULT 'normal',
	`due_date` varchar(10),
	`assignee_id` varchar(36),
	`created_by` varchar(36),
	`idempotency_key` varchar(120),
	`service_order_id` varchar(36),
	`customer_id` varchar(36),
	`equipment_id` varchar(36),
	`warranty_id` varchar(36),
	`completed_at` datetime(3),
	`completed_by` varchar(36),
	`cancelled_at` datetime(3),
	`cancelled_by` varchar(36),
	`cancel_reason` varchar(300),
	`version` int unsigned NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `agenda_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_agenda_task_idempotency` UNIQUE(`tenant_id`,`idempotency_key`),
	CONSTRAINT `ck_agenda_task_status` CHECK(status IN ('open','done','cancelled')),
	CONSTRAINT `ck_agenda_task_priority` CHECK(priority IN ('low','normal','high','urgent'))
);
--> statement-breakpoint
ALTER TABLE `agenda_appointments` ADD CONSTRAINT `fk_agenda_appt_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_appointments` ADD CONSTRAINT `fk_agenda_appt_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_appointments` ADD CONSTRAINT `fk_agenda_appt_assignee_tenant` FOREIGN KEY (`assignee_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_appointments` ADD CONSTRAINT `fk_agenda_appt_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_appointments` ADD CONSTRAINT `fk_agenda_appt_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_appointments` ADD CONSTRAINT `fk_agenda_appt_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_appointments` ADD CONSTRAINT `fk_agenda_appt_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_appointments` ADD CONSTRAINT `fk_agenda_appt_warranty_tenant` FOREIGN KEY (`warranty_id`,`tenant_id`) REFERENCES `warranties`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_tasks` ADD CONSTRAINT `fk_agenda_task_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_tasks` ADD CONSTRAINT `fk_agenda_task_unit_tenant` FOREIGN KEY (`unit_id`,`tenant_id`) REFERENCES `units`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_tasks` ADD CONSTRAINT `fk_agenda_task_assignee_tenant` FOREIGN KEY (`assignee_id`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_tasks` ADD CONSTRAINT `fk_agenda_task_created_by_tenant` FOREIGN KEY (`created_by`,`tenant_id`) REFERENCES `users`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_tasks` ADD CONSTRAINT `fk_agenda_task_order_unit` FOREIGN KEY (`service_order_id`,`unit_id`) REFERENCES `service_orders`(`id`,`unit_id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_tasks` ADD CONSTRAINT `fk_agenda_task_customer_tenant` FOREIGN KEY (`customer_id`,`tenant_id`) REFERENCES `customers`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_tasks` ADD CONSTRAINT `fk_agenda_task_equipment_tenant` FOREIGN KEY (`equipment_id`,`tenant_id`) REFERENCES `equipment`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `agenda_tasks` ADD CONSTRAINT `fk_agenda_task_warranty_tenant` FOREIGN KEY (`warranty_id`,`tenant_id`) REFERENCES `warranties`(`id`,`tenant_id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `ix_agenda_appt_unit_start` ON `agenda_appointments` (`tenant_id`,`unit_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `ix_agenda_appt_unit_day` ON `agenda_appointments` (`tenant_id`,`unit_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `ix_agenda_appt_assignee` ON `agenda_appointments` (`tenant_id`,`assignee_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `ix_agenda_appt_order` ON `agenda_appointments` (`tenant_id`,`service_order_id`);--> statement-breakpoint
CREATE INDEX `ix_agenda_task_unit_due` ON `agenda_tasks` (`tenant_id`,`unit_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `ix_agenda_task_assignee` ON `agenda_tasks` (`tenant_id`,`assignee_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `ix_agenda_task_order` ON `agenda_tasks` (`tenant_id`,`service_order_id`);
--> statement-breakpoint
--
-- CORRECAO DA REDACAO DA TAREFA DE PREPARACAO (Prompt 14).
--
-- O texto normativo da Constituicao do Nexo56 tem acentos; o Prompt 08 gravou
-- uma versao empobrecida. Esta linha corrige a REDACAO, e so ela.
--
-- POR QUE ISSO NAO DUPLICA NADA: a identidade da tarefa sistemica e
-- (service_order_id, kind, open_marker), garantida pela UNIQUE
-- `uq_so_task_open`. Nenhum codigo compara descricao para decidir se a tarefa
-- ja existe -- ver `createWorkflowTask`. Trocar o texto nao cria linha, nao
-- reabre tarefa concluida e nao toca em `service_orders.status`.
--
-- POR QUE ISSO NAO ATINGE TEXTO DE PESSOA: o alvo e recortado por `kind`, e
-- `delivery_preparation` so e escrito pela maquina de estados. A comparacao
-- com a redacao antiga NAO e a identificacao -- e uma trava adicional, para
-- que uma descricao que alguem tenha editado continue como ela a deixou.
--
-- Linhas concluidas e canceladas tambem sao corrigidas de proposito: o
-- historico deve mostrar o texto certo do trabalho que foi feito.
--
UPDATE `service_order_tasks`
   SET `description` = 'Realizar limpeza final, conferência estética e preparação do equipamento para entrega ao cliente.'
 WHERE `kind` = 'delivery_preparation'
   AND `description` = 'Realizar limpeza final, conferencia estetica e preparacao do equipamento para entrega ao cliente.';
