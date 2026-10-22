import { COMPUTER_ACTION_TYPES, type ComputerActionType, type DesktopPermissions } from '@opendots/shared';
import { z } from 'zod';
import { getSetting, setSetting } from '../settings.ts';

export const desktopPermissionsSchema = z.object({
  mode: z.enum(['auto', 'ask', 'custom']),
  actions: z.array(z.enum(COMPUTER_ACTION_TYPES)).max(COMPUTER_ACTION_TYPES.length),
}).strict();

export async function getDesktopPermissions(agentId: string): Promise<DesktopPermissions> {
  const saved = await getSetting(`desktop.permissions.${agentId}`);
  // Desktop access is still explicit. Once granted, agents can use their machine.
  if (saved === null) return { mode: 'auto', actions: [] };
  const parsed = desktopPermissionsSchema.safeParse(saved);
  return parsed.success ? parsed.data : { mode: 'ask', actions: [] };
}

export async function setDesktopPermissions(agentId: string, input: DesktopPermissions) {
  const value = desktopPermissionsSchema.parse(input);
  await setSetting(`desktop.permissions.${agentId}`, value);
  return value;
}

export async function desktopActionNeedsApproval(agentId: string, action: ComputerActionType) {
  const policy = await getDesktopPermissions(agentId);
  return policy.mode !== 'auto' && !(policy.mode === 'custom' && policy.actions.includes(action));
}
