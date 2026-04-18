export const TASK_STATUSES = [
  "backlog",
  "in_progress",
  "blocked",
  "review",
  "done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["in_progress", "blocked"],
  in_progress: ["blocked", "review", "done"],
  blocked: ["backlog", "in_progress"],
  review: ["in_progress", "done", "blocked"],
  done: [],
};

const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  pending: "backlog",
  todo: "backlog",
  open: "backlog",
  active: "in_progress",
  completed: "done",
  complete: "done",
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}

export function toCanonicalTaskStatus(value: unknown): TaskStatus {
  if (isTaskStatus(value)) return value;
  const normalized = String(value || "").trim().toLowerCase();
  return LEGACY_STATUS_MAP[normalized] || "backlog";
}

export function explainTaskStatusTransition(
  from: TaskStatus,
  to: TaskStatus,
): string {
  if (from === to) return `Task is already in "${to}".`;
  const allowed = TASK_STATUS_TRANSITIONS[from] || [];
  if (allowed.includes(to)) return "";
  return `Invalid task status transition: \"${from}\" → \"${to}\". Allowed next statuses: ${allowed.length ? allowed.join(", ") : "none"}.`;
}

export function validateTaskStatusTransition(
  from: TaskStatus,
  to: TaskStatus,
): { valid: true } | { valid: false; reason: string } {
  const reason = explainTaskStatusTransition(from, to);
  return reason ? { valid: false, reason } : { valid: true };
}
