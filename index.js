const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

const app = express();

// Configure Gmail transporter
if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASS) {
	console.log("process.env.GMAIL_USER", process.env.GMAIL_USER);
	console.log(
		"GMAIL_APP_PASS length:",
		(process.env.GMAIL_APP_PASS || "").length
	);
	throw new Error("Missing GMAIL_USER or GMAIL_APP_PASS environment variables");
}

const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: process.env.GMAIL_USER,
		pass: process.env.GMAIL_APP_PASS,
	},
});

// Helper function to get PDF link based on pdf_id
function getPDFLink(pdfId) {
	return `https://drive.google.com/file/d/${pdfId}/view`;
}

// Helper function to send email
async function sendEmailWithPDF(
	customerEmail,
	customerName,
	pdfId,
	productName
) {
	const pdfLink = getPDFLink(pdfId);

	const mailOptions = {
		from: `"Your Store Name" <${process.env.GMAIL_USER}>`,
		to: customerEmail,
		subject: `Your Purchase: ${productName}`,
		html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Thank you for your purchase, ${
					customerName || "valued customer"
				}!</h2>
        <p>Your payment has been successfully processed.</p>
        <p><strong>Product:</strong> ${productName}</p>
        <p>You can access your PDF here:</p>
        <p style="margin: 20px 0;">
          <a href="${pdfLink}" 
             style="background-color: #4CAF50; color: white; padding: 12px 24px; 
                    text-decoration: none; border-radius: 4px; display: inline-block;">
            Download PDF
          </a>
        </p>
        <p>Or copy this link: <a href="${pdfLink}">${pdfLink}</a></p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px;">
          If you have any questions, please reply to this email.
        </p>
      </div>
    `,
		text: `
      Thank you for your purchase, ${customerName || "valued customer"}!
      
      Your payment has been successfully processed.
      Product: ${productName}
      
      Download your PDF here: ${pdfLink}
      
      If you have any questions, please reply to this email.
    `,
	};

	try {
		const info = await transporter.sendMail(mailOptions);
		console.log("Email sent successfully:", info.messageId);
		return { success: true, messageId: info.messageId };
	} catch (error) {
		console.error("Error sending email:", error);
		throw error;
	}
}

// Stripe webhook endpoint
app.post(
	"/webhook",
	express.raw({ type: "application/json" }),
	async (req, res) => {
		const sig = req.headers["stripe-signature"];
		let event;

		try {
			event = stripe.webhooks.constructEvent(
				req.body,
				sig,
				process.env.STRIPE_WEBHOOK_SECRET
			);
		} catch (err) {
			return res.status(400).send(`Webhook Error: ${err?.message}`);
		}

		// Fulfill events for Payment Links/Checkout
		const fulfillable = new Set([
			"checkout.session.completed",
			"checkout.session.async_payment_succeeded",
		]);

		if (!fulfillable.has(event.type)) {
			return res.json({ received: true });
		}

		const sessionFromEvent = event.data.object; // Checkout Session for these event types ([docs.stripe.com](https://docs.stripe.com/payments/payment-element/migration-ewcs?utm_source=openai))

		// Optional: ensure this session came from a Payment Link
		// (Checkout Session has payment_link when created from a Payment Link) ([docs.stripe.com](https://docs.stripe.com/api/checkout/sessions/object?utm_source=openai))
		if (!sessionFromEvent.payment_link) {
			return res.json({ received: true });
		}

		try {
			// Stripe recommends retrieving the session and expanding line_items for fulfillment ([docs.stripe.com](https://docs.stripe.com/checkout/fulfillment?utm_source=openai))
			const session = await stripe.checkout.sessions.retrieve(
				sessionFromEvent.id,
				{
					expand: ["line_items.data.price.product"],
				}
			);

			// Only fulfill paid sessions ([docs.stripe.com](https://docs.stripe.com/api/checkout/sessions/object?utm_source=openai))
			if (session.payment_status !== "paid") {
				return res.json({
					received: true,
					fulfilled: false,
					reason: "not_paid",
				});
			}

			const customerEmail =
				session.customer_details?.email || session.customer_email;
			const customerName = session.customer_details?.name || null;

			if (!customerEmail) {
				// Don't 400 here; if you do, Stripe will keep retrying.
				// Log and acknowledge.
				console.error("No customer email on Checkout Session", session.id);
				return res.json({
					received: true,
					fulfilled: false,
					reason: "no_email",
				});
			}

			// TODO: Idempotency: check DB if session.id or event.id already fulfilled; skip if yes ([docs.stripe.com](https://docs.stripe.com/checkout/fulfillment?utm_source=openai))

			console.log("session", session);
			console.log("session.line_items", session.line_items);

			const items = session.line_items?.data || [];
			for (const item of items) {
				const product = item.price?.product; // expanded
				const pdfId = session?.metadata?.pdf_id;

				if (pdfId) {
					await sendEmailWithPDF(
						customerEmail,
						customerName,
						pdfId,
						product.name
					);
				} else {
					console.warn(
						`No pdf_id in product.metadata for product: ${product?.name}`
					);
				}
			}

			// TODO: Mark session.id fulfilled in DB here
			return res.json({ received: true, fulfilled: true });
		} catch (err) {
			console.error("Webhook fulfillment error:", err);
			// 500 tells Stripe to retry (good for transient failures)
			return res.status(500).json({ error: err.message });
		}
	}
);

// Health check endpoint
app.get("/health", (req, res) => {
	res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Webhook server listening on port ${PORT}`);
});
