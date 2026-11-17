import { z } from "zod";
import { ASSIGNABLE_ROLES } from "./rbac/permissions";

export const emailSchema = z.string().email().max(254).transform((e) => e.toLowerCase());
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200)
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/[0-9]/, "Add a number");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().min(1).max(120).optional(),
  organizationName: z.string().min(2).max(120).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const requestResetSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(10), password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export const verifyEmailSchema = z.object({ token: z.string().min(10) });

export const createOrgSchema = z.object({ name: z.string().min(2).max(120) });
export const updateOrgSchema = z.object({ name: z.string().min(2).max(120) });
export const switchOrgSchema = z.object({ orgId: z.string().min(1) });

const roleEnum = z.enum(ASSIGNABLE_ROLES as [string, ...string[]]);
export const inviteSchema = z.object({ email: emailSchema, role: roleEnum });
export const updateRoleSchema = z.object({ role: roleEnum });
export const acceptInviteSchema = z.object({ token: z.string().min(10) });
