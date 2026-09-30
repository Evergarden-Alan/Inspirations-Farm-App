import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // `@/` → src/ (tsconfig paths), so route/lib modules importing via the
      // alias resolve under --experimental-strip-types too.
      if (specifier.startsWith("@/")) {
        const target = SRC_ROOT + specifier.slice(2);
        try {
          return nextResolve(pathToFileURL(target).href, context);
        } catch {
          return nextResolve(pathToFileURL(target + ".ts").href, context);
        }
      }
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      if (isRelative && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
