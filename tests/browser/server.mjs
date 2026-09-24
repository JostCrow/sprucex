import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

createServer(async (request, response) => {
  if (["/sprucex.js", "/sprucex.min.js"].includes(request.url)) {
    response.setHeader("Content-Type", "text/javascript");
    response.end(await readFile(new URL(`../../public/dist${request.url}`, import.meta.url)));
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><html><head><title>SpruceX tests</title></head><body></body></html>");
}).listen(4174, "127.0.0.1");
