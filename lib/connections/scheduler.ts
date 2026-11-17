import { prisma } from "@/lib/db";
import { queuesEnabled } from "@/lib/queue/connection";
import { scheduledQueue } from "@/lib/queue/queues";

export function validCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 && parts.every((part) => /^[\d*/?,\-]+$/.test(part));
}

export async function registerSchedule(schedule: { id: bigint; cron: string; enabled: boolean }) {
  if (!queuesEnabled()) return false;
  const queue = scheduledQueue();
  const jobId = `schedule-${schedule.id}`;
  await queue.removeRepeatable("scheduled-sync", { pattern: schedule.cron }, jobId).catch(() => false);
  if (schedule.enabled) {
    await queue.add("scheduled-sync", { scheduleId: schedule.id.toString() }, {
      jobId,
      repeat: { pattern: schedule.cron },
    });
  }
  return true;
}

export async function unregisterSchedule(schedule: { id: bigint; cron: string }) {
  if (!queuesEnabled()) return false;
  return scheduledQueue().removeRepeatable("scheduled-sync", { pattern: schedule.cron }, `schedule-${schedule.id}`);
}

export async function recoverSchedules(): Promise<number> {
  if (!queuesEnabled()) return 0;
  const schedules = await prisma.syncSchedule.findMany({ where: { enabled: true } });
  await Promise.all(schedules.map(registerSchedule));
  return schedules.length;
}
