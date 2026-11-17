-- Add OWNER to MembershipRole enum
ALTER TYPE "MembershipRole" ADD VALUE IF NOT EXISTS 'OWNER' BEFORE 'ORG_ADMIN';
