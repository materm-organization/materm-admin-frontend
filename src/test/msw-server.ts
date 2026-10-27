import { setupServer } from "msw/node";

// One MSW server for the whole test run (started in setup.ts). Tests add handlers with `server.use(...)`;
// they are reset after every test. A request nobody mocked fails the test (`onUnhandledFrame: "error"`).
export const server = setupServer();
