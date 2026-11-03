// Demo-only fault injection for the "pull the plug" moment: crash the process right after PayPal has
// accepted a set-off payment but before Untangle has written down that it succeeded, which is the worst
// possible moment. On restart the executor must find the payment on PayPal and not pay it twice.
export const chaos = { crashAfterRecords: 0 };

export function armCrash(afterRecords: number): void {
  chaos.crashAfterRecords = Math.max(1, Math.min(50, Math.floor(afterRecords)));
}

/** Called after every invoice payment PayPal accepts; exits the process when the armed count runs out. */
export async function afterPayPalRecord(onCrash: () => Promise<void>): Promise<void> {
  if (chaos.crashAfterRecords <= 0) return;
  chaos.crashAfterRecords -= 1;
  if (chaos.crashAfterRecords > 0) return;
  await onCrash().catch(() => undefined);
  process.exit(75);
}
