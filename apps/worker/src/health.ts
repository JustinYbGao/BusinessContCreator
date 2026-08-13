import { createServer, type Server } from "node:http";

export type ReadinessState = {
  configParsed: boolean;
  supabaseReachable: boolean;
  pollingStarted: boolean;
};

export function createReadinessState(): ReadinessState {
  return {
    configParsed: false,
    supabaseReachable: false,
    pollingStarted: false,
  };
}

export async function startHealthServer(options: {
  port: number;
  state: ReadinessState;
}): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health/ready") {
      const ready =
        options.state.configParsed &&
        options.state.supabaseReachable &&
        options.state.pollingStarted;

      response.statusCode = ready ? 200 : 503;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ready }));
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, "127.0.0.1");
  });

  return server;
}
