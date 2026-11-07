import { readFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { createServer } from "node:https";
import { request as upstreamRequest } from "node:http";
import { once } from "node:events";
export async function openGateway({ apiPort, key, cert, host = "127.0.0.1" }) {
  const origin = "https://127.0.0.1:15443";
  const webRoot = resolve("apps/web/dist/web/browser");
  const server = createServer(
    {
      key,
      cert,
    },
    async (req, res) => {
      if (
        req.url.startsWith("/api/") ||
        req.url.split("?")[0] === "/health/live"
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
  server.listen(15443, host);
  await once(server, "listening");
  return server;
}
