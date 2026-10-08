/**
 * Product feature flags for Local DispatchBoard (parity with cloud `src/lib/features.ts`).
 * Default off — revive with VITE_ENABLE_JOB_CREATE=true.
 *
 * Reads Vite `import.meta.env` when present, else `process.env` (tsx unit tests).
 */
function envFlag(name: string): boolean {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  const fromVite = viteEnv?.[name]
  const fromProcess =
    typeof process !== 'undefined' && process.env ? process.env[name] : undefined
  return String(fromVite ?? fromProcess ?? '').toLowerCase() === 'true'
}

export const ENABLE_JOB_CREATE = envFlag('VITE_ENABLE_JOB_CREATE')
