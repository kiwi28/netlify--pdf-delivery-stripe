const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

const app = express();

// Configure Gmail transporter
const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: process.env.GMAIL_USER,
		pass: process.env.GMAIL_APP_PASSWORD,
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
		let stripeEvent;

		try {
			stripeEvent = stripe.webhooks.constructEvent(
				req.body,
				sig,
				process.env.STRIPE_WEBHOOK_SECRET
			);
		} catch (err) {
			console.error("Webhook signature verification failed:", err.message);
			return res.status(400).send(`Webhook Error: ${err.message}`);
		}

		// Handle the checkout.session.completed event
		if (stripeEvent.type === "checkout.session.completed") {
			const session = stripeEvent.data.object;

			try {
				const customerEmail =
					session.customer_details?.email || session.customer_email;
				const customerName = session.customer_details?.name;

				if (!customerEmail) {
					console.error("No customer email found");
					return res.status(400).json({ error: "No customer email found" });
				}

				const lineItems = await stripe.checkout.sessions.listLineItems(
					session.id,
					{
						expand: ["data.price.product"],
					}
				);

				for (const item of lineItems.data) {
					const product = item.price.product;
					const pdfId = product.metadata?.pdf_id;

					if (pdfId) {
						console.log(
							`Sending email for product: ${product.name}, PDF ID: ${pdfId}`
						);
						await sendEmailWithPDF(
							customerEmail,
							customerName,
							pdfId,
							product.name
						);
					} else {
						console.warn(
							`No pdf_id found in metadata for product: ${product.name}`
						);
					}
				}

				return res.json({ received: true, emailSent: true });
			} catch (error) {
				console.error("Error processing webhook:", error);
				return res.status(500).json({
					error: "Error processing webhook",
					details: error.message,
				});
			}
		}

		res.json({ received: true });
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
