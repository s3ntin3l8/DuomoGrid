ALTER TABLE `listings` ADD `heating_system` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `energy_source` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `parking_spaces` integer;--> statement-breakpoint
ALTER TABLE `listings` ADD `parking_type` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `parking_price_eur` real;--> statement-breakpoint
ALTER TABLE `listings` ADD `bathrooms` integer;--> statement-breakpoint
ALTER TABLE `listings` ADD `bedrooms` integer;--> statement-breakpoint
ALTER TABLE `listings` ADD `available_from` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `listed_at` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `portal_previous_price_eur` real;--> statement-breakpoint
ALTER TABLE `listings` ADD `portal_market_eur_per_m2` real;--> statement-breakpoint
ALTER TABLE `listings` ADD `portal_market_low_eur_per_m2` real;--> statement-breakpoint
ALTER TABLE `listings` ADD `portal_market_high_eur_per_m2` real;--> statement-breakpoint
ALTER TABLE `listings` ADD `description_json` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `details_json` text;