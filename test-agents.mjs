import { TrueForge } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({
    baseUrl: "http://localhost:8790",
    timeoutInSeconds: 600
});

try {
    console.log("Checking configured TrueForge agents...");

    const result = await client.agents.list();

    console.log("\nAgent list:");
    console.dir(result, { depth: 6 });

} catch (error) {
    console.error("Failed to retrieve agents:");
    console.error(error);
}
