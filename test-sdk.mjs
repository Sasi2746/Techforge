import { TrueForge } from "@truefoundry/trueforge-sdk";

console.log("Initializing TrueForge SDK...");

const client = new TrueForge({
    baseUrl: "http://localhost:8790",
    timeoutInSeconds: 600
});

console.log("TrueForge client initialized!");

console.log("Available session methods:");
console.log(Object.getOwnPropertyNames(
    Object.getPrototypeOf(client.sessions)
));
