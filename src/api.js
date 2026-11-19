const BASE = '/api'
const TOKEN_KEY = 'hd_token'

// The sign-in screens return 401 for "wrong password" etc. — that is NOT an expired session.
const AUTH_ENTRY = /^\/auth\/(login|register|verify|resend)(\/|\?|$)/
let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn || (() => {}) }
function rejected(res, path, hadToken, err) {
  const e = new Error(err.error || res.statusText)
  e.status = res.status
  e.code = err.code || err.error
  if (res.status === 401 && hadToken && !AUTH_ENTRY.test(path)) { e.sessionExpired = true; onUnauthorized() }
  return e
}

export const authToken = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY),
}

async function req(method, path, body) {
  const token = authToken.get()
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw rejected(res, path, !!token, await res.json().catch(() => ({ error: res.statusText })))
  if (res.status === 204) return null
  return res.json()
}

async function rawFetch(method, path, { body, headers } = {}) {
  const token = authToken.get()
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body,
  })
  if (!res.ok) throw rejected(res, path, !!token, await res.json().catch(() => ({ error: res.statusText })))
  return res
}

export const api = {
  auth: {
    register: (data) => req('POST', '/auth/register', data),
    verify: (data) => req('POST', '/auth/verify', data),
    resend: (data) => req('POST', '/auth/resend', data),
    login: (data) => req('POST', '/auth/login', data),
    me: () => req('GET', '/auth/me'),
    changePassword: (data) => req('POST', '/auth/change-password', data),
  },
  tickets: {
    list: () => req('GET', '/tickets'),
    get: (id) => req('GET', `/tickets/${id}`),
    create: (data) => req('POST', '/tickets', data),
    update: (id, data) => req('PATCH', `/tickets/${id}`, data),
    addMessage: (id, data) => req('POST', `/tickets/${id}/messages`, data),
    rate: (id, data) => req('POST', `/tickets/${id}/rating`, data),
    addSubtask: (id, data) => req('POST', `/tickets/${id}/subtasks`, data),
    updateSubtask: (id, sid, data) => req('PATCH', `/tickets/${id}/subtasks/${sid}`, data),
    deleteSubtask: (id, sid) => req('DELETE', `/tickets/${id}/subtasks/${sid}`),
    uploadAttachment: async (id, file) => {
      const res = await rawFetch('POST', `/tickets/${id}/attachments`, {
        body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), 'X-Mime': file.type || 'application/octet-stream' },
      })
      return res.json()
    },
    downloadAttachment: async (id, aid) => (await rawFetch('GET', `/tickets/${id}/attachments/${aid}`)).blob(),
    deleteAttachment: (id, aid) => req('DELETE', `/tickets/${id}/attachments/${aid}`),
  },
  projects: {
    list: () => req('GET', '/projects'),
    get: (id) => req('GET', `/projects/${id}`),
    create: (data) => req('POST', '/projects', data),
    update: (id, data) => req('PATCH', `/projects/${id}`, data),
    delete: (id) => req('DELETE', `/projects/${id}`),
    setFavorite: (id, on) => req(on ? 'PUT' : 'DELETE', `/projects/${id}/favorite`),
    addMember: (id, data) => req('POST', `/projects/${id}/members`, data),
    setMemberRole: (id, uid, role) => req('PATCH', `/projects/${id}/members/${uid}`, { role }),
    removeMember: (id, uid) => req('DELETE', `/projects/${id}/members/${uid}`),
    addSection: (id, name) => req('POST', `/projects/${id}/sections`, { name }),
    updateSection: (id, sid, data) => req('PATCH', `/projects/${id}/sections/${sid}`, data),
    deleteSection: (id, sid) => req('DELETE', `/projects/${id}/sections/${sid}`),
    addTask: (id, data) => req('POST', `/projects/${id}/tasks`, data),
    addTicket: (id, data) => req('POST', `/projects/${id}/tickets`, data),
    moveItem: (id, itemId, data) => req('PATCH', `/projects/${id}/items/${itemId}`, data),
    removeItem: (id, itemId) => req('DELETE', `/projects/${id}/items/${itemId}`),
    addField: (id, data) => req('POST', `/projects/${id}/fields`, data),
    updateField: (id, fid, data) => req('PATCH', `/projects/${id}/fields/${fid}`, data),
    deleteField: (id, fid) => req('DELETE', `/projects/${id}/fields/${fid}`),
    setFieldValue: (id, itemId, fid, value) => req('PUT', `/projects/${id}/items/${itemId}/fields/${fid}`, { value }),
  },
  tasks: {
    mine: () => req('GET', '/tasks/mine'),
    get: (id) => req('GET', `/tasks/${id}`),
    update: (id, data) => req('PATCH', `/tasks/${id}`, data),
    delete: (id) => req('DELETE', `/tasks/${id}`),
    addToProject: (id, data) => req('POST', `/tasks/${id}/projects`, data),
    addDependency: (id, blockedBy) => req('POST', `/tasks/${id}/dependencies`, { blocked_by: blockedBy }),
    removeDependency: (id, otherId) => req('DELETE', `/tasks/${id}/dependencies/${otherId}`),
    dependencyCandidates: (id, q = '') => req('GET', `/tasks/${id}/dependency-candidates?q=${encodeURIComponent(q)}`),
    addSubtask: (id, data) => req('POST', `/tasks/${id}/subtasks`, data),
    updateSubtask: (id, sid, data) => req('PATCH', `/tasks/${id}/subtasks/${sid}`, data),
    deleteSubtask: (id, sid) => req('DELETE', `/tasks/${id}/subtasks/${sid}`),
    addMessage: (id, data) => req('POST', `/tasks/${id}/messages`, data),
    uploadAttachment: async (id, file) => {
      const res = await rawFetch('POST', `/tasks/${id}/attachments`, {
        body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), 'X-Mime': file.type || 'application/octet-stream' },
      })
      return res.json()
    },
    downloadAttachment: async (id, aid) => (await rawFetch('GET', `/tasks/${id}/attachments/${aid}`)).blob(),
    deleteAttachment: (id, aid) => req('DELETE', `/tasks/${id}/attachments/${aid}`),
  },
  users: {
    list: () => req('GET', '/users'),
    ratings: () => req('GET', '/users/ratings'),
    create: (data) => req('POST', '/users', data),
    update: (id, data) => req('PATCH', `/users/${id}`, data),
    delete: (id) => req('DELETE', `/users/${id}`),
    resetPassword: (id, data = {}) => req('POST', `/users/${id}/reset-password`, data),
  },
  departments: {
    list: () => req('GET', '/departments'),
    routing: () => req('GET', '/departments/routing'),
    setRouting: (data) => req('PUT', '/departments/routing', data),
    create: (data) => req('POST', '/departments', data),
    delete: (id) => req('DELETE', `/departments/${id}`),
    addCategory: (id, name) => req('POST', `/departments/${id}/categories`, { name }),
    deleteCategory: (id, name) => req('DELETE', `/departments/${id}/categories/${encodeURIComponent(name)}`),
  },
}
