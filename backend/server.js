const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "tickets.json");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

// --------------- Data Layer ---------------

function loadTickets() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (err) {
    console.error("Error loading tickets:", err.message);
  }
  return [];
}

function saveTickets(tickets) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2), "utf8");
}

// --------------- AI Helper ---------------

async function askAI(prompt) {
  if (!ANTHROPIC_API_KEY) {
    return "AI unavailable — please configure ANTHROPIC_API_KEY. Our IT team will review your ticket.";
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    if (data.error) {
      console.error("AI API error:", data.error);
      return "Our IT team will review your ticket shortly.";
    }
    return (data.content || []).map((b) => b.text || "").join("").trim() ||
      "Our IT team will review your ticket shortly.";
  } catch (err) {
    console.error("AI fetch error:", err.message);
    return "Our IT team will review your ticket shortly.";
  }
}

// --------------- Slack Helper ---------------

const PRIORITY_EMOJI = {
  Critical: "🔴",
  High: "🟠",
  Medium: "🟡",
  Low: "🟢",
};

async function sendSlack(blocks, text) {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks }),
    });
  } catch (err) {
    console.error("Slack webhook error:", err.message);
  }
}

async function slackNewTicket(ticket) {
  const emoji = PRIORITY_EMOJI[ticket.priority] || "🟡";
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `🎫 New Ticket: ${ticket.id}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Title:*\n${ticket.title}` },
        { type: "mrkdwn", text: `*Category:*\n${ticket.category}` },
        { type: "mrkdwn", text: `*Priority:*\n${emoji} ${ticket.priority}` },
        { type: "mrkdwn", text: `*Status:*\n${ticket.status}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Description:*\n${ticket.description.slice(0, 300)}` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🤖 *AI Suggestion:* ${ticket.aiResponse || "N/A"}`,
        },
      ],
    },
    { type: "divider" },
  ];
  await sendSlack(blocks, `New ticket ${ticket.id}: ${ticket.title}`);
}

async function slackNewComment(ticket, comment, aiReply) {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `💬 New Comment on ${ticket.id}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Ticket:* ${ticket.title}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${comment.author}:*\n${comment.text}`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `🤖 *AI Reply:* ${aiReply}` },
      ],
    },
    { type: "divider" },
  ];
  await sendSlack(blocks, `Comment on ${ticket.id} by ${comment.author}: ${comment.text}`);
}

async function slackStatusChange(ticket, oldStatus, newStatus) {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `🔄 Status Changed: ${ticket.id}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Ticket:*\n${ticket.title}` },
        { type: "mrkdwn", text: `*Change:*\n~${oldStatus}~ → *${newStatus}*` },
      ],
    },
    { type: "divider" },
  ];
  await sendSlack(blocks, `${ticket.id} status: ${oldStatus} → ${newStatus}`);
}

// --------------- Routes ---------------

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
    slack: SLACK_WEBHOOK_URL ? "configured" : "not configured",
    ai: ANTHROPIC_API_KEY ? "configured" : "not configured",
  });
});

// Get all tickets
app.get("/api/tickets", (_req, res) => {
  const tickets = loadTickets();
  res.json(tickets);
});

// Get single ticket
app.get("/api/tickets/:id", (req, res) => {
  const tickets = loadTickets();
  const ticket = tickets.find((t) => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  res.json(ticket);
});

// Create ticket (with AI response + Slack notification)
app.post("/api/tickets", async (req, res) => {
  const { title, description, category, priority, author } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: "Title and description are required" });
  }

  const aiPrompt = `You are an IT support AI. A user submitted a ticket:\nTitle: ${title}\nCategory: ${category || "General"}\nDescription: ${description}\n\nGive a ONE LINE quick troubleshooting suggestion (max 20 words). Be direct and helpful. No greetings, no fluff. Just the fix suggestion.`;

  const aiResponse = await askAI(aiPrompt);

  const ticket = {
    id: "TKT-" + uuidv4().slice(0, 6).toUpperCase(),
    title,
    description,
    category: category || "Other",
    priority: priority || "Medium",
    status: "Open",
    author: author || "User",
    created: Date.now(),
    updated: Date.now(),
    aiResponse,
    thread: [],
  };

  const tickets = loadTickets();
  tickets.unshift(ticket);
  saveTickets(tickets);

  // Notify Slack (fire-and-forget)
  slackNewTicket(ticket).catch(() => {});

  res.status(201).json(ticket);
});

// Update ticket status (+ Slack notification)
app.patch("/api/tickets/:id", (req, res) => {
  const tickets = loadTickets();
  const idx = tickets.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Ticket not found" });

  const oldStatus = tickets[idx].status;
  const { status, priority, category } = req.body;
  if (status) tickets[idx].status = status;
  if (priority) tickets[idx].priority = priority;
  if (category) tickets[idx].category = category;
  tickets[idx].updated = Date.now();
  saveTickets(tickets);

  // Notify Slack on status change
  if (status && status !== oldStatus) {
    slackStatusChange(tickets[idx], oldStatus, status).catch(() => {});
  }

  res.json(tickets[idx]);
});

// Delete ticket
app.delete("/api/tickets/:id", (req, res) => {
  let tickets = loadTickets();
  const idx = tickets.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Ticket not found" });
  tickets.splice(idx, 1);
  saveTickets(tickets);
  res.json({ success: true });
});

// Add comment to ticket thread (AI auto-replies + Slack notification)
app.post("/api/tickets/:id/comments", async (req, res) => {
  const { text, author } = req.body;
  if (!text) return res.status(400).json({ error: "Comment text is required" });

  const tickets = loadTickets();
  const idx = tickets.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Ticket not found" });

  const ticket = tickets[idx];

  // Add user comment
  const userComment = {
    id: uuidv4().slice(0, 8),
    text,
    author: author || "User",
    time: Date.now(),
    isAI: false,
  };
  ticket.thread.push(userComment);
  ticket.updated = Date.now();

  // Get AI response for the thread
  const aiPrompt = `You are an IT support AI. Context - Ticket: "${ticket.title}" - "${ticket.description}". User follow-up comment: "${text}"\nGive a ONE LINE helpful response (max 20 words). Be direct. No greetings.`;

  const aiText = await askAI(aiPrompt);
  const aiComment = {
    id: uuidv4().slice(0, 8),
    text: aiText,
    author: "AI Assistant",
    time: Date.now(),
    isAI: true,
  };
  ticket.thread.push(aiComment);

  saveTickets(tickets);

  // Notify Slack with the user comment + AI reply
  slackNewComment(ticket, userComment, aiText).catch(() => {});

  res.json({ userComment, aiComment, ticket });
});

// --------------- Start ---------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Mindstorm IT Desk API running on port ${PORT}`);
  console.log(`   AI:    ${ANTHROPIC_API_KEY ? "Configured ✓" : "⚠️  No ANTHROPIC_API_KEY set"}`);
  console.log(`   Slack: ${SLACK_WEBHOOK_URL ? "Configured ✓" : "⚠️  No SLACK_WEBHOOK_URL set"}`);
});
