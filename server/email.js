import nodemailer from 'nodemailer'

let transporter = null
export const sentEmails = []   // { to, subject, previewUrl, at } — surfaced in UI for testing

async function getTransporter() {
  if (transporter) return transporter
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  } else {
    const test = await nodemailer.createTestAccount()
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email', port: 587, secure: false,
      auth: { user: test.user, pass: test.pass },
    })
    console.log(`📧 Ethereal test inbox: ${test.user}`)
  }
  return transporter
}

export async function sendMail({ to, subject, html }) {
  try {
    const t = await getTransporter()
    const info = await t.sendMail({ from: '"HelpDesk" <helpdesk@company.com>', to, subject, html })
    const previewUrl = nodemailer.getTestMessageUrl(info) || null
    sentEmails.unshift({ to, subject, previewUrl, at: new Date().toISOString() })
    if (sentEmails.length > 50) sentEmails.pop()
    if (previewUrl) console.log(`📧 ${subject} → ${to} · preview: ${previewUrl}`)
    return { ok: true, previewUrl }
  } catch (err) {
    console.error('email failed:', err.message)
    sentEmails.unshift({ to, subject, previewUrl: null, error: err.message, at: new Date().toISOString() })
    return { ok: false, previewUrl: null }
  }
}

export function verificationEmail(name, code) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2>🎫 HelpDesk — Verify your email</h2>
      <p>Hi ${name},</p>
      <p>Your verification code is:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f1f5f9;padding:16px;text-align:center;border-radius:8px">${code}</p>
      <p>Enter this code on the verification screen to activate your account.</p>
    </div>`
}

export function notificationEmail(title, body, ticketNum) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2>🎫 HelpDesk — Ticket #${ticketNum}</h2>
      <h3>${title}</h3>
      <p style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${body}</p>
      <p style="color:#64748b;font-size:13px">Log in to HelpDesk to reply.</p>
    </div>`
}
