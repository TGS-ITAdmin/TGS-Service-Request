const BASE = '/api'
const TOKEN_KEY = 'hd_token'

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
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    const e = new Error(err.error || res.statusText)
    e.status = res.status
    e.code = err.error
    throw e
  }
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
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    const e = new Error(err.error || res.statusText)
    e.status = res.status
    throw e
  }
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
