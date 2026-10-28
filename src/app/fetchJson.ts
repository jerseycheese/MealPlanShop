// Tiny wrapper for the GET loads that treat a non-2xx as failure: fetch, throw
// on !ok, parse JSON. Replaces the `const res = await fetch(url); if (!res.ok)
// throw...; const data = await res.json()` triple that was hand-rolled (and, in
// a couple of spots, half-rolled without the ok-check) across the app.
//
// Not for the mutation POSTs that read `data.error`/`data.success` off a non-ok
// body — those use postAction below, which parses the response regardless of
// status.
export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

// The mutation counterpart: POST, parse the body whatever the status, and read
// the server's `{ success, error }` envelope. A JSON body object is sent as
// JSON; FormData goes as-is. Network and parse failures still throw, so each
// caller keeps its own "couldn't reach the server" message.
export async function postAction<T = Record<string, unknown>>(
  url: string,
  body?: object | FormData,
): Promise<{ ok: boolean; data: T; error?: string }> {
  const init: RequestInit = { method: 'POST' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json();
  return { ok: Boolean(data?.success), data, error: data?.error };
}
