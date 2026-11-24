CREATE TABLE `answer_note` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`key_question_id` text NOT NULL,
	`lesson_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `answer_note_course_kq_created` ON `answer_note` (`course_id`,`key_question_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`context` text NOT NULL,
	`course_id` text NOT NULL,
	`concept_id` text,
	`exercise_id` text,
	`response` text,
	`correct` integer,
	`confidence` text,
	`self_mark` text,
	`grade` text,
	`is_retry` integer DEFAULT false NOT NULL,
	`day` text NOT NULL,
	`answered_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attempt_course_exercise` ON `attempt` (`course_id`,`exercise_id`);--> statement-breakpoint
CREATE INDEX `attempt_context_day` ON `attempt` (`context`,`day`);--> statement-breakpoint
CREATE INDEX `attempt_session` ON `attempt` (`session_id`);--> statement-breakpoint
CREATE TABLE `concept_schedule` (
	`course_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`lesson_day` text NOT NULL,
	`due_day` text NOT NULL,
	`interval_days` integer NOT NULL,
	`ease` real NOT NULL,
	`last_event_day` text NOT NULL,
	`later_day_reviews` integer DEFAULT 0 NOT NULL,
	`last_grade` text,
	`version_cursor` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`course_id`, `concept_id`)
);
--> statement-breakpoint
CREATE INDEX `concept_schedule_due_day` ON `concept_schedule` (`due_day`);--> statement-breakpoint
CREATE TABLE `course_request` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `draft` (
	`key` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guess_answer` (
	`course_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`guess_id` text NOT NULL,
	`option_id` text NOT NULL,
	`answered_at` integer NOT NULL,
	PRIMARY KEY(`course_id`, `lesson_id`, `guess_id`)
);
--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`course_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`skipped` integer DEFAULT false NOT NULL,
	`position` text,
	`recall_text` text,
	`recall_ticked` text,
	`recall_queue` text,
	`last_session_id` text,
	`completed_at` integer,
	`completed_day` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`course_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`minutes` integer NOT NULL,
	`course_id` text,
	`review_queue` text DEFAULT '[]' NOT NULL,
	`checkpoint_queue` text,
	`position` text NOT NULL,
	`last_event_id` text,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_one_open` ON `session` ((1)) WHERE "session"."ended_at" IS NULL;--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_minutes` integer DEFAULT 15 NOT NULL,
	`hide_timer` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "settings_one_row" CHECK("settings"."id" = 1),
	CONSTRAINT "settings_session_minutes" CHECK("settings"."session_minutes" IN (10, 15, 20, 30))
);
--> statement-breakpoint
CREATE TABLE `shown_up_day` (
	`day` text PRIMARY KEY NOT NULL
);
