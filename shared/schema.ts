import { pgTable, uuid, text, timestamp, pgEnum, boolean, integer } from "drizzle-orm/pg-core";

export const appRoleEnum = pgEnum("app_role", ["admin", "user"]);
export const planTierEnum = pgEnum("plan_tier", ["free", "pro", "team"]);

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  role: appRoleEnum("role").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  userId: text("user_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  plan: planTierEnum("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  gumroadSaleId: text("gumroad_sale_id"),
  gumroadSubscriptionId: text("gumroad_subscription_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  status: text("status").notNull().default("success"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email"),
  message: text("message").notNull(),
  delivered: boolean("delivered").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pendingSubscriptions = pgTable("pending_subscriptions", {
  email: text("email").primaryKey(),
  plan: planTierEnum("plan").notNull(),
  gumroadSaleId: text("gumroad_sale_id"),
  gumroadSubscriptionId: text("gumroad_subscription_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
