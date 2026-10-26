// hooks/types — the dependency contract between `useAdminData` and the domain hooks.
/** Cross-domain callbacks a domain hook needs from the composition root. */
export interface HookDeps {
  setError: (message: string) => void;
  /** Re-reads the operational data shown across panels after a mutation. */
  refresh: () => Promise<void>;
}
