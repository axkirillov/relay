import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function relayHome(): string {
  const q = process.env.RELAY_QUEUE_DIR;
  return q ? dirname(q) : join(homedir(), ".relay");
}

export function rehearsing(): boolean {
  return Boolean(process.env.RELAY_QUEUE_DIR);
}

export function queueDir(): string {
  return process.env.RELAY_QUEUE_DIR || join(relayHome(), "queue");
}

export function windowFile(): string {
  return join(relayHome(), "window.json");
}

export function closedFile(): string {
  return join(relayHome(), "closed");
}

export function taskHome(): string {
  const q = process.env.RELAY_QUEUE_DIR;
  return q ? join(dirname(q), "task") : join(homedir(), ".task");
}

export function tasksDir(): string {
  return join(relayHome(), "tasks");
}

export function filledFile(): string {
  return join(relayHome(), "tasks.filled");
}
