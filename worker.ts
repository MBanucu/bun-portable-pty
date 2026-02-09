// worker.ts (new file to add to the project)

setInterval(() => {
  const randomMessage = `Random message: ${Math.random().toString(36).substring(2)}`;
  postMessage(randomMessage);
}, 1000); // Send a random message every second