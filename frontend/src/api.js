const BASE = "/api";

async function request(url, options = {}) {
  const res = await fetch(BASE + url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  getTickets: () => request("/tickets"),
  getTicket: (id) => request(`/tickets/${id}`),
  createTicket: (data) =>
    request("/tickets", { method: "POST", body: JSON.stringify(data) }),
  updateTicket: (id, data) =>
    request(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTicket: (id) =>
    request(`/tickets/${id}`, { method: "DELETE" }),
  addComment: (id, text, author) =>
    request(`/tickets/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ text, author }),
    }),
};
