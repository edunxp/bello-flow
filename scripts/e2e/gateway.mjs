import { readFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { createServer } from "node:https";
import { request as upstreamRequest } from "node:http";
import { once } from "node:events";
export async function openGateway({
  apiPort,
  key,
  cert,
  host = "127.0.0.1",
  port = 15443,
}) {
  const origin = "https://127.0.0.1:" + port;
  const webRoot = resolve("apps/web/dist/web/browser");
  const server = createServer(
    {
      key,
      cert,
    },
    async (req, res) => {
      if (
        req.url.startsWith("/api/") ||
        ["/health/live", "/health/ready"].includes(req.url.split("?")[0])
      ) {
        const headers = { ...req.headers };
        for (const name of Object.keys(headers))
          if (name === "forwarded" || name.startsWith("x-forwarded-"))
            delete headers[name];
        const upstream = upstreamRequest(
          {
            host: "127.0.0.1",
            port: apiPort,
            path: req.url,
            method: req.method,
            headers,
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
          },
        );
        upstream.on("error", () => {
          res.writeHead(503);
          res.end();
        });
        req.pipe(upstream);
        return;
      }
      try {
        const path = new URL(req.url, origin).pathname;
        const candidate = resolve(webRoot, "." + decodeURIComponent(path));
        if (candidate !== webRoot && !candidate.startsWith(webRoot + sep)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const file = extname(candidate)
          ? candidate
          : join(webRoot, "index.html");
        const contents = await readFile(file);
        res.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".ico")
                ? "image/x-icon"
                : "text/html; charset=utf-8",
        );
        res.end(contents);
      } catch {
        res.writeHead(404);
        res.end();
      }
    },
  );
  server.on("upgrade", (req, client, head) => {
    if (req.url.split("?")[0] !== "/api/realtime") {
      client.destroy();
      return;
    }
    const headers = { ...req.headers };
    for (const name of Object.keys(headers))
      if (name === "forwarded" || name.startsWith("x-forwarded-"))
        delete headers[name];
    const request = upstreamRequest({
      host: "127.0.0.1",
      port: apiPort,
      path: req.url,
      method: "GET",
      headers,
    });
    client.on("error", () => request.destroy());
    client.on("close", () => request.destroy());
    request.on("error", () => client.destroy());
    request.on("response", (response) => {
      response.resume();
      client.end(
        `HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    });
    request.on("upgrade", (response, upstream, upstreamHead) => {
      const lines = ["HTTP/1.1 101 Switching Protocols"];
      for (let index = 0; index < response.rawHeaders.length; index += 2)
        lines.push(
          response.rawHeaders[index] + ": " + response.rawHeaders[index + 1],
        );
      client.write(lines.join("\r\n") + "\r\n\r\n");
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) upstream.write(head);
      upstream.on("error", () => client.destroy());
      upstream.on("close", () => client.destroy());
      client.on("close", () => upstream.destroy());
      client.pipe(upstream).pipe(client);
    });
    request.end();
  });
  server.listen(port, host);
  await once(server, "listening");
  return server;
}
