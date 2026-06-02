// Tiny wrapper for the GET loads that treat a non-2xx as failure: fetch, throw
// on !ok, parse JSON. Replaces the `const res = await fetch(url); if (!res.ok)
// throw...; const data = await res.json()` triple that was hand-rolled (and, in
// a couple of spots, half-rolled without the ok-check) across the app.
//
// Not for the mutation POSTs that read `data.error`/`data.success` off a non-ok
// body — those intentionally parse the response regardless of status.
export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return (await res.json()) as T;
}
