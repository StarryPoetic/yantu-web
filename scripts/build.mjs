import { build } from "vite";

// Build from checked-in configuration and explicitly supplied process variables.
// Vite must not discover local credential files, including mode-specific files.
await build({ envFile: false });
