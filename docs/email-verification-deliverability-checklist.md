# Email Verification Deliverability Checklist

Use this checklist when verification emails are not arriving reliably. This is an operator/developer checklist, not end-user product copy.

1. Check Supabase Auth SMTP settings are configured correctly.
2. Check Brevo transactional email logs.
3. Confirm whether the message was sent, bounced, deferred, blocked, or suppressed.
4. Verify the sender domain SPF record.
5. Verify the sender domain DKIM record.
6. Verify the sender domain DMARC policy.
7. Confirm the sender address uses a verified domain.
8. Test delivery separately with Gmail, Outlook, QQ, and 163 mailboxes.
9. If QQ fails but Gmail succeeds, treat it as recipient-provider filtering or deliverability behavior, not a frontend bug.
10. Keep resend API responses generic so the product does not reveal whether an email exists.
