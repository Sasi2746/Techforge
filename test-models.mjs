import { TrueForge } from "@truefoundry/trueforge-sdk";

const client = new TrueForge({
    baseUrl: "http://localhost:8790",
    timeoutInSeconds: 600
});

try {
    console.log("Checking available models...\n");

    const result = await client.models.list();

    console.dir(result, { depth: 6 });

} catch (error) {
    console.error("Model listing failed:");
    console.error(error);
}
