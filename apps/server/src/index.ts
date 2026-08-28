import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const webDistDir = path.resolve(here, "../../web/dist");

const app = await buildApp(webDistDir);

try {
	await app.listen({ port: env.KAGAMI_PORT, host: "0.0.0.0" });
} catch (err) {
	logger.error(err, "failed to start server");
	process.exit(1);
}
