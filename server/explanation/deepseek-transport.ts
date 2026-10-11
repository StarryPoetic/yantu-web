import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { ModelError, validateDeepSeekEndpoint } from "./deepseek.ts";
import { createPublicDohResolver } from "./dns.ts";
import type { AddressResolver } from "./dns.ts";
import { resolvePublicAddress } from "./public-address.ts";

/** Guard cancellation against a concurrent native end/error event. */
function responseBody(response: IncomingMessage): ReadableStream<Uint8Array> {
  const iterator = response[Symbol.asyncIterator]();
  let closed = false;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (closed) return;
          if (next.done) {
            closed = true;
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          if (closed) return;
          closed = true;
          controller.error(error);
        }
      },
      cancel() {
        closed = true;
        response.destroy();
        void iterator.return?.().catch(() => {});
      },
    },
    { highWaterMark: 65536, size: (chunk) => chunk.byteLength },
  );
}

/** Fixed-provider transport; only DNS may retry, never the model POST. */
export function createDeepSeekTransport(
  dependencies: {
    resolver?: AddressResolver;
    request?: typeof httpsRequest;
  } = {},
): typeof fetch {
  const resolver = dependencies.resolver ?? createPublicDohResolver();
  const request = dependencies.request ?? httpsRequest;
  return async (input, init) => {
    if (typeof input !== "string" && !(input instanceof URL))
      throw new ModelError("UNSAFE_PROVIDER_ENDPOINT");
    const url = validateDeepSeekEndpoint(String(input));
    if (
      init?.method !== "POST" ||
      init.redirect !== "error" ||
      typeof init.body !== "string" ||
      Buffer.byteLength(init.body) > B.requestBytes ||
      !init.signal
    )
      throw new ModelError("PROVIDER_INVALID_REQUEST");
    const signal = init.signal;
    if (signal.aborted) throw new ModelError("MODEL_TIMEOUT");
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new ModelError("MODEL_TIMEOUT"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    let address;
    try {
      address = await Promise.race([
        resolvePublicAddress(url.hostname, resolver, { signal }),
        aborted,
      ]);
    } catch (error) {
      if (signal.aborted) throw new ModelError("MODEL_TIMEOUT");
      // DNS details are transport failures, never facts about the user's profile.
      throw new ModelError("PROVIDER_DNS_UNAVAILABLE");
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) throw new ModelError("MODEL_TIMEOUT");
    const provided = new Headers(init.headers);
    const authorization = provided.get("Authorization");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept-Encoding": "identity",
      ...(authorization ? { Authorization: authorization } : {}),
    };
    return await new Promise<Response>((resolve, reject) => {
      const req = request(
        url,
        {
          method: "POST",
          agent: false,
          signal,
          servername: "api.deepseek.com",
          rejectUnauthorized: true,
          headers,
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status > 599 || (status >= 300 && status < 400)) {
            response.destroy();
            reject(new ModelError("PROVIDER_UNAVAILABLE"));
            return;
          }
          const contentEncoding = response.headers["content-encoding"];
          if (contentEncoding && contentEncoding !== "identity") {
            response.destroy();
            reject(new ModelError("INVALID_RESPONSE"));
            return;
          }
          const responseHeaders = new Headers();
          for (const name of ["content-type", "content-length"]) {
            const value = response.headers[name];
            if (typeof value === "string") responseHeaders.set(name, value);
          }
          if ([204, 205].includes(status)) {
            response.destroy();
            resolve(new Response(null, { status, headers: responseHeaders }));
            return;
          }
          resolve(
            new Response(responseBody(response), {
              status,
              headers: responseHeaders,
            }),
          );
        },
      );
      req.once("error", () =>
        reject(
          new ModelError(
            signal.aborted ? "MODEL_TIMEOUT" : "PROVIDER_NETWORK_ERROR",
          ),
        ),
      );
      req.end(init.body);
    });
  };
}
