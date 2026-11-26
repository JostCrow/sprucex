import { getIntegration, registerIntegration } from "./index.js";
import { createGridStackIntegration } from "./gridstack.js";

export function ensureBuiltInIntegrationsRegistered() {
  if (!getIntegration("gridstack")) {
    registerIntegration("gridstack", createGridStackIntegration());
  }
}
