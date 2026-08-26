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

export const api = {
  auth: {
    register: (data) => req('POST', '/auth/register', data),
    verify: (data) => req('POST', '/auth/verify', data),
    resend: (data) => req('POST', '/auth/resend', data),
    login: (data) => req('POST', '/auth/login', data),
    me: () => req('GET', '/auth/me'),
  },
  tickets: {
    list: () => req('GET', '/tickets'),
    get: (id) => req('GET', `/tickets/${id}`),
    create: (data) => req('POST', '/tickets', data),
    update: (id, data) => req('PATCH', `/tickets/${id}`, data),
    addMessage: (id, data) => req('POST', `/tickets/${id}/messages`, data),
    rate: (id, data) => req('POST', `/tickets/${id}/rating`, data),
  },
  users: {
    list: () => req('GET', '/users'),
    ratings: () => req('GET', '/users/ratings'),
    create: (data) => req('POST', '/users', data),
    update: (id, data) => req('PATCH', `/users/${id}`, data),
    delete: (id) => req('DELETE', `/users/${id}`),
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
