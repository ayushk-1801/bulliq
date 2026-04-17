import { execSync } from "node:child_process";

const scripts = [
  { name: "Seeding NIFTY50 companies", script: "pnpm db:seed:nifty50" },
  { name: "Seeding competitions", script: "pnpm db:seed:competitions" },
  { name: "Saving competition news", script: "pnpm news:save" },
  { name: "Saving volatile minute data", script: "pnpm db:save:volatile" },
];

async function runSeedScripts() {
  console.log("🌱 Starting complete seeding process...\n");

  for (let i = 0; i < scripts.length; i++) {
    const { name, script } = scripts[i];
    const stepNumber = i + 1;

    console.log(`[${stepNumber}/${scripts.length}] ${name}...`);
    console.log(`Running: ${script}\n`);

    try {
      execSync(script, { stdio: "inherit" });
      console.log(`\n✅ Completed: ${name}\n`);
    } catch (error) {
      console.error(`\n❌ Failed: ${name}`);
      console.error(`\nSeeding stopped at step ${stepNumber}. Fix the error and try again.\n`);
      process.exit(1);
    }
  }

  console.log("✅ All seeding scripts completed successfully!");
}

runSeedScripts().catch((error) => {
  console.error("Fatal error during seeding:", error);
  process.exit(1);
});
