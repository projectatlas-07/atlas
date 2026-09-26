export type ManagerWorkflow = "production" | "soil" | "transport";

/** Resolves links into the existing site-entry workflows without creating new routes. */
export function resolveManagerWorkflowFromHash(hash: string): ManagerWorkflow {
  switch (hash.replace(/^#/, "")) {
    case "soil":
      return "soil";
    case "chamber-transport":
    case "transport":
      return "transport";
    case "brick-production":
    case "production":
    default:
      return "production";
  }
}
