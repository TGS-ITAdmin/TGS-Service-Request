import nodemailer from 'nodemailer'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_API_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails'
const MAIL_FROM = process.env.MAIL_FROM || '"HelpDesk" <helpdesk@company.com>'
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

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

async function sendViaResend({ to, subject, html }) {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
}

export async function sendMail({ to, subject, html }) {
  try {
    if (RESEND_API_KEY) {
      await sendViaResend({ to, subject, html })
      sentEmails.unshift({ to, subject, previewUrl: null, at: new Date().toISOString() })
      if (sentEmails.length > 50) sentEmails.pop()
      return { ok: true, previewUrl: null }
    }
    const t = await getTransporter()
    const info = await t.sendMail({ from: MAIL_FROM, to, subject, html })
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
      <p>Hi ${esc(name)},</p>
      <p>Your verification code is:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f1f5f9;padding:16px;text-align:center;border-radius:8px">${code}</p>
      <p>Enter this code on the verification screen to activate your account.</p>
    </div>`
}

export function notificationEmail(title, body, ticketNum) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2>🎫 HelpDesk — Ticket #${ticketNum}</h2>
      <h3>${esc(title)}</h3>
      <p style="background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap">${esc(body)}</p>
      <p style="color:#64748b;font-size:13px">Log in to HelpDesk to reply.</p>
    </div>`
}
