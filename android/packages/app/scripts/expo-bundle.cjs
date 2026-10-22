const path = require("node:path");

// Gradle의 자동 초기화만 제거하고 명시적인 캐시 복구 요청은 그대로 전달한다.
function bundleArguments(
  args,
  resetCache = process.env.PASEODOG_RESET_METRO_CACHE === "1",
  workers = process.env.PASEODOG_METRO_WORKERS,
) {
  if (args[0] !== "export:embed") return args;
  if (workers !== undefined && !/^[1-9]\d*$/.test(workers)) {
    throw new Error("PASEODOG_METRO_WORKERS must be a positive integer");
  }
  const result = resetCache ? [...args] : args.filter((arg) => arg !== "--reset-cache");
  if (workers && !result.includes("--max-workers")) result.push("--max-workers", workers);
  return result;
}

if (require.main === module) {
  process.argv = [
    process.argv[0],
    require.resolve("@expo/cli", { paths: [require.resolve("expo/package.json")] }),
    ...bundleArguments(process.argv.slice(2)),
  ];
  require(path.resolve(process.argv[1]));
}

module.exports = { bundleArguments };
