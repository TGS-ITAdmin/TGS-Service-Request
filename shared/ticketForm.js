// The Service request form (replaces the Asana form). Every option list lives here, in one place.
// A Concern decides the department, and therefore who the ticket is routed to.
export const CLIENTS = ['Detector Inspector', 'ET', 'HVAC', 'KNS', 'Internal', 'TGS Sales', 'Unique Plumping', 'Shamrock', 'EDJ', 'Emerge']
export const SITES = ['Dumaguete', 'Cebu', 'Tuburan', 'WFH']

export const DEPT_PAYROLL = 'dept-payroll'
export const DEPT_RECRUIT = 'dept-recruit'

// Concern -> department. Order is the order shown on the form.
export const CONCERNS = [
  { name: 'Certificate of Employment',             dept: 'dept-hr' },
  { name: 'Payroll Dispute',                       dept: DEPT_PAYROLL },
  { name: 'HMO',                                   dept: 'dept-hr' },
  { name: 'Incident report',                       dept: 'dept-hr' },
  { name: 'Supplies',                              dept: 'dept-hr' },
  { name: 'Client or Site Visit support request',  dept: 'dept-it' },
  { name: 'Badge Deactivation / Reactivation',     dept: 'dept-it' },
  { name: 'New Hiring Request',                    dept: DEPT_RECRUIT },
  { name: 'Resignation Acceptance Letter',         dept: 'dept-hr' },
  { name: 'Employment Contract Creation or Update', dept: 'dept-hr' },
  { name: 'Hubstaff',                              dept: 'dept-it' },
  { name: 'Government Benefits',                   dept: DEPT_PAYROLL },
  { name: 'Applicant / Employee referral',         dept: DEPT_RECRUIT },
  { name: 'Change Department and Manager',         dept: 'dept-hr' },
  { name: 'Others',                                dept: 'dept-it' },
]
export const concernDept = (name) => CONCERNS.find(c => c.name === name)?.dept ?? null
export const URGENCY_NOTE = 'Kindly note that we will change the Urgency level when we review the details and set it to the right Urgency level.'
export const DETAILS_NOTE = 'Please indicate all details needed to complete the request. Kindly include dates, reason for request, etc.'

// Returns an error message, or null when the form is complete and every choice is a listed one.
export function validateServiceRequest(b = {}) {
  if (!b.title?.trim()) return 'Request Title is required'
  if (!b.description?.trim()) return 'Details of Request is required'
  if (!CLIENTS.includes(b.client)) return 'Client is required'
  if (!SITES.includes(b.site)) return 'Site is required'
  if (!CONCERNS.some(c => c.name === b.category)) return 'Concern is required'
  return null
}
