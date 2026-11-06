import { Capacitor } from '@capacitor/core';

/** UI registers these so the tracking start can explain a permission before the system dialog. */
let handlers = null;

export function registerPatrolPromptHandlers(next) {
  handlers = next;
  return () => {
    if (handlers === next) handlers = null;
  };
}

export function patrolPromptHandlersReady() {
  return Boolean(handlers);
}

export async function waitForPatrolPromptHandlers(timeoutMs = 3000) {
  if (Capacitor.getPlatform() !== 'android') return null;
  const deadline = Date.now() + timeoutMs;
  while (!handlers && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return handlers;
}
