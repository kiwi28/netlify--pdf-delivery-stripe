// server.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

// Basic bearer token auth
const API_KEY = process.env.MY_API_KEY;
if (!API_KEY) {
	console.error("Missing MY_API_KEY");
	process.exit(1);
}

// Rate limiting: adjust window and max as needed
const limiter = rateLimit({
	windowMs: 60 * 1000, // 1 minute
	max: 30, // max 30 requests per minute per IP
});
app.use(limiter);

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASS = process.env.GMAIL_APP_PASS;
if (!GMAIL_USER || !GMAIL_APP_PASS) {
	console.error("Missing GMAIL_USER or GMAIL_APP_PASS");
	process.exit(1);
}

const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: GMAIL_USER,
		pass: GMAIL_APP_PASS,
	},
});

app.post("/send", async (req, res) => {
	const auth = (req.headers.authorization || "").trim();
	if (auth !== `Bearer ${API_KEY}`)
		return res.status(401).json({ error: "unauthorized" });

	const { to, subject, text, html } = req.body;
	if (!to || !subject || (!text && !html))
		return res.status(400).json({ error: "missing fields" });

	try {
		const info = await transporter.sendMail({
			from: GMAIL_USER,
			to,
			subject,
			text,
			html,
		});
		return res.json({ ok: true, messageId: info.messageId });
	} catch (err) {
		console.error("sendMail error:", err);
		return res
			.status(502)
			.json({ error: "email_send_error", details: err.message || String(err) });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "127.0.0.1", () =>
	console.log(`mailer listening on 127.0.0.1:${PORT}`)
);
