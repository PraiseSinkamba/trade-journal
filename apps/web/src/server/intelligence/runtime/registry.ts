import type { Capability, CapabilityRegistry } from "../contracts/capabilities";

/**
 * The deterministic capability registry (Phase 12).
 *
 * Capabilities are registered explicitly. Registration order never decides
 * execution order: the registry always answers in a stable id-then-version
 * order, so a selection is reproducible across runs.
 */
export function createCapabilityRegistry(): CapabilityRegistry {
  const registered = new Map<string, Capability>();

  const keyOf = (capability: Capability) => `${capability.id}@${capability.version}`;

  /** Compare dotted version segments numerically, so 10 is newer than 2. */
  const compareVersions = (left: string, right: string): number => {
    const leftParts = left.split(".");
    const rightParts = right.split(".");
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
      const leftPart = Number(leftParts[index] ?? 0);
      const rightPart = Number(rightParts[index] ?? 0);
      if (leftPart !== rightPart) return leftPart - rightPart;
    }
    return 0;
  };

  const list = (): readonly Capability[] =>
    [...registered.values()].sort(
      (left, right) =>
        left.id.localeCompare(right.id) || compareVersions(left.version, right.version),
    );

  return {
    register(capability: Capability): void {
      const key = keyOf(capability);
      if (registered.has(key)) throw new Error(`Capability ${key} is already registered.`);
      registered.set(key, capability);
    },
    get(id: string, version?: string): Capability | undefined {
      if (version !== undefined) return registered.get(`${id}@${version}`);
      const versions = list().filter((capability) => capability.id === id);
      return versions[versions.length - 1];
    },
    list,
  };
}
