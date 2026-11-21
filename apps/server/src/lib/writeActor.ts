/** Device writes use membership alone. An MCP credential further narrows it to one workspace. */
export type WriteActor =
  | { userId: string; workspaceId?: never; viaTokenName?: never }
  | {
      userId: string;
      workspaceId: string;
      viaTokenName: string;
    };
